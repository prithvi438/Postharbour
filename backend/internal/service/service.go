// Package service contains the business rules. HTTP handlers only translate JSON;
// this package decides who may act, validates input, and coordinates persistence.
package service

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	"net"
	"net/mail"
	"postharbor/internal/config"
	provider "postharbor/internal/mail"
	"postharbor/internal/model"
	"postharbor/internal/store"
	"regexp"
	"strings"
	"time"
)

// Error is a safe, actionable error that may be returned to the browser.
type Error struct {
	Status  int
	Message string
}

// Error implements the standard error interface.
func (e *Error) Error() string { return e.Message }

// problem constructs application errors without exposing database/provider details.
func problem(status int, message string) error { return &Error{status, message} }

// Resolver permits deterministic DNS tests without changing production behavior.
type Resolver interface {
	LookupTXT(context.Context, string) ([]string, error)
	LookupMX(context.Context, string) ([]*net.MX, error)
}

// Service has explicit dependencies so tests can replace only the network boundary.
type Service struct {
	DB     *store.DB
	Mail   provider.Provider
	DNS    Resolver
	Config config.Config
}

// AuthorizeTenant enforces membership independently of IDs supplied by the browser.
func (s *Service) AuthorizeTenant(ctx context.Context, u model.User, id string) (model.Tenant, error) {
	if u.Role != "platform_admin" && u.TenantID != id {
		return model.Tenant{}, problem(404, "Business not found")
	}
	return store.One[model.Tenant](ctx, s.DB, `SELECT row_to_json(t) FROM tenants t WHERE id=$1`, id)
}

// Tenants returns all businesses to the owner, and only the caller's business otherwise.
func (s *Service) Tenants(ctx context.Context, u model.User) ([]model.Tenant, error) {
	return store.List[model.Tenant](ctx, s.DB, `SELECT row_to_json(t) FROM tenants t WHERE $1='platform_admin' OR id=$2 ORDER BY created_at`, u.Role, u.TenantID)
}

// TenantInput creates a business and its first dashboard administrator together.
type TenantInput struct {
	Name         string `json:"name"`
	AdminName    string `json:"admin_name"`
	AdminEmail   string `json:"admin_email"`
	Password     string `json:"password"`
	MaxMailboxes int    `json:"max_mailboxes"`
	QuotaMB      int    `json:"quota_mb"`
}

// PasswordHash centralizes the credential policy used for administrators/mailboxes.
func PasswordHash(password string) (string, error) {
	if err := ValidatePassword(password); err != nil {
		return "", err
	}
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(h), err
}

// ValidatePassword checks bcrypt's byte-length boundary without doing expensive hashing.
func ValidatePassword(password string) error {
	if len(password) < 12 || len(password) > 72 {
		return problem(400, "Use a password between 12 and 72 bytes")
	}
	return nil
}

// ValidEmail accepts an ordinary address, not a display-name or header fragment.
func ValidEmail(value string) bool {
	a, err := mail.ParseAddress(value)
	return err == nil && a.Address == value && len(value) <= 254
}

// CreateTenant reserves the database identity before any remote side effect.
// A failed provider request leaves a visible pending record that can be retried.
func (s *Service) CreateTenant(ctx context.Context, u model.User, in TenantInput) (model.Tenant, error) {
	var t model.Tenant
	if u.Role != "platform_admin" {
		return t, problem(403, "Only the platform administrator can create businesses")
	}
	in.Name = strings.TrimSpace(in.Name)
	in.AdminEmail = strings.ToLower(strings.TrimSpace(in.AdminEmail))
	in.AdminName = strings.TrimSpace(in.AdminName)
	if in.Name == "" || len(in.Name) > 100 || in.AdminName == "" || len(in.AdminName) > 100 || !ValidEmail(in.AdminEmail) {
		return t, problem(400, "Provide a business name, administrator name, and valid email")
	}
	if in.MaxMailboxes < 1 || in.MaxMailboxes > s.Config.MaxMailboxes || in.QuotaMB < 100 || in.QuotaMB > 102400 {
		return t, problem(400, "Business limits are outside the supported range")
	}
	hash, err := PasswordHash(in.Password)
	if err != nil {
		return t, err
	}
	t = model.Tenant{ID: store.ID(), Name: in.Name, MaxMailboxes: in.MaxMailboxes, QuotaMB: in.QuotaMB, Status: "pending"}
	err = s.DB.Locked(ctx, func(tx pgx.Tx) error {
		// The lock makes concurrent first-business requests safe in Community mode.
		if s.Config.Mode == "stalwart" && s.Config.StalwartEdition == "community" {
			var exists bool
			if e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tenants)`).Scan(&exists); e != nil {
				return e
			}
			if exists {
				return problem(409, "Community mode supports one business. Native multi-business hosting requires Enterprise.")
			}
		}
		if _, e := tx.Exec(ctx, `INSERT INTO tenants(id,name,max_mailboxes,quota_mb) VALUES($1,$2,$3,$4)`, t.ID, t.Name, t.MaxMailboxes, t.QuotaMB); e != nil {
			return e
		}
		if _, e := tx.Exec(ctx, `INSERT INTO users(id,email,name,password_hash,role,tenant_id) VALUES($1,$2,$3,$4,'tenant_admin',$5)`, store.ID(), in.AdminEmail, in.AdminName, hash, t.ID); e != nil {
			return e
		}
		return store.Audit(ctx, tx, t.ID, u.Email, "business.created", t.Name)
	})
	if err != nil {
		return t, err
	}
	return s.ProvisionTenant(ctx, u, t.ID)
}

// ProvisionTenant retries an interrupted native tenant creation without duplicating it.
func (s *Service) ProvisionTenant(ctx context.Context, u model.User, id string) (model.Tenant, error) {
	t, err := s.AuthorizeTenant(ctx, u, id)
	if err != nil {
		return t, err
	}
	err = s.DB.Locked(ctx, func(tx pgx.Tx) error {
		var e error
		t, e = store.One[model.Tenant](ctx, tx, `SELECT row_to_json(t) FROM tenants t WHERE id=$1`, id)
		if e != nil {
			return e
		}
		if t.Status == "active" {
			return nil
		}
		remote, e := s.Mail.EnsureTenant(ctx, t)
		if e != nil {
			return problem(502, "Business saved; mail provisioning failed. Check the mail provider, then retry.")
		}
		_, e = tx.Exec(ctx, `UPDATE tenants SET provider_id=$2,status='active' WHERE id=$1`, id, remote)
		if e != nil {
			return e
		}
		return store.Audit(ctx, tx, id, u.Email, "business.provisioned", t.Name)
	})
	if err != nil {
		return t, err
	}
	return s.AuthorizeTenant(ctx, u, id)
}

var domainPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$`)
var localPattern = regexp.MustCompile(`^[a-z0-9]+(?:[._+-][a-z0-9]+)*$`)

// NormalizeDomain accepts DNS names only. International names can use punycode.
func NormalizeDomain(value string) (string, error) {
	value = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(value)), ".")
	if len(value) > 253 || !domainPattern.MatchString(value) || net.ParseIP(value) != nil {
		return "", problem(400, "Enter a domain such as example.com, without a URL or path")
	}
	return value, nil
}

// Domains always scopes results to the authorized business, including for owners.
func (s *Service) Domains(ctx context.Context, u model.User, tenant string) ([]model.Domain, error) {
	if _, err := s.AuthorizeTenant(ctx, u, tenant); err != nil {
		return nil, err
	}
	return store.List[model.Domain](ctx, s.DB, `SELECT row_to_json(d) FROM domains d WHERE tenant_id=$1 ORDER BY created_at`, tenant)
}

// CreateDomain reserves a unique name and a random DNS challenge, without routing mail.
func (s *Service) CreateDomain(ctx context.Context, u model.User, tenant, name string) (model.Domain, error) {
	var d model.Domain
	if _, err := s.AuthorizeTenant(ctx, u, tenant); err != nil {
		return d, err
	}
	name, err := NormalizeDomain(name)
	if err != nil {
		return d, err
	}
	d = model.Domain{ID: store.ID(), TenantID: tenant, Name: name, VerificationToken: "postharbor=" + store.ID(), Status: "pending"}
	err = s.DB.Locked(ctx, func(tx pgx.Tx) error {
		var count int
		if e := tx.QueryRow(ctx, `SELECT count(*) FROM domains WHERE tenant_id=$1`, tenant).Scan(&count); e != nil {
			return e
		}
		if count >= 20 {
			return problem(409, "This business has reached the 20-domain limit")
		}
		if _, e := tx.Exec(ctx, `INSERT INTO domains(id,tenant_id,name,verification_token) VALUES($1,$2,$3,$4)`, d.ID, tenant, d.Name, d.VerificationToken); e != nil {
			return e
		}
		return store.Audit(ctx, tx, tenant, u.Email, "domain.added", name)
	})
	if err != nil {
		return d, err
	}
	return s.domain(ctx, tenant, d.ID)
}

// domain prevents a valid domain ID from being used through a different tenant URL.
func (s *Service) domain(ctx context.Context, tenant, id string) (model.Domain, error) {
	return store.One[model.Domain](ctx, s.DB, `SELECT row_to_json(d) FROM domains d WHERE tenant_id=$1 AND id=$2`, tenant, id)
}

// VerifyDomain requires an exact TXT challenge. Simulation bypass is explicit,
// localhost-only by configuration, and limited to reserved .test domains.
func (s *Service) VerifyDomain(ctx context.Context, u model.User, tenant, id string, simulate bool) (model.Domain, error) {
	t, err := s.AuthorizeTenant(ctx, u, tenant)
	if err != nil {
		return model.Domain{}, err
	}
	d, err := s.domain(ctx, tenant, id)
	if err != nil {
		return d, err
	}
	if t.Status != "active" {
		return d, problem(409, "Provision the business before verifying its domains")
	}
	if simulate && (s.Config.Mode != "simulation" || !strings.HasSuffix(d.Name, ".test")) {
		return d, problem(400, "Simulated verification is only available for .test domains in local simulation mode")
	}
	if !simulate {
		dnsCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		records, e := s.DNS.LookupTXT(dnsCtx, "_postharbor."+d.Name)
		found := false
		for _, r := range records {
			if r == d.VerificationToken {
				found = true
			}
		}
		if e != nil || !found {
			return d, problem(409, "Ownership TXT record was not found. Publish it, allow DNS propagation, then retry.")
		}
	}
	// Persist proof before provisioning. A provider timeout must not lose ownership.
	if _, err = s.DB.Exec(ctx, `UPDATE domains SET verified=true WHERE id=$1 AND tenant_id=$2`, id, tenant); err != nil {
		return d, err
	}
	err = s.DB.Locked(ctx, func(tx pgx.Tx) error {
		current, e := store.One[model.Domain](ctx, tx, `SELECT row_to_json(d) FROM domains d WHERE id=$1 AND tenant_id=$2`, id, tenant)
		if e != nil {
			return e
		}
		if current.Status == "active" {
			return nil
		}
		remote, e := s.Mail.EnsureDomain(ctx, t, current)
		if e != nil {
			return problem(502, "Ownership verified; mail provisioning failed. Check the provider and retry verification.")
		}
		if _, e = tx.Exec(ctx, `UPDATE domains SET provider_id=$2,status='active' WHERE id=$1`, id, remote); e != nil {
			return e
		}
		return store.Audit(ctx, tx, tenant, u.Email, "domain.verified", d.Name)
	})
	if err != nil {
		return d, err
	}
	return s.domain(ctx, tenant, id)
}

// DNSInfo separates basic routing checks from full SPF/DKIM/DMARC validation.
type DNSInfo struct {
	OwnershipName  string `json:"ownership_name"`
	OwnershipValue string `json:"ownership_value"`
	MXHost         string `json:"mx_host"`
	MXMatches      bool   `json:"mx_matches"`
	Zone           string `json:"zone"`
	Note           string `json:"note"`
}

// DomainDNS exposes the real engine's DNS zone only to the owning administrator.
func (s *Service) DomainDNS(ctx context.Context, u model.User, tenant, id string) (DNSInfo, error) {
	var out DNSInfo
	if _, err := s.AuthorizeTenant(ctx, u, tenant); err != nil {
		return out, err
	}
	d, err := s.domain(ctx, tenant, id)
	if err != nil {
		return out, err
	}
	out = DNSInfo{OwnershipName: "_postharbor." + d.Name, OwnershipValue: d.VerificationToken, MXHost: s.Config.MailHost, Note: "MX matching is only a routing check. Validate SPF, DKIM, DMARC, PTR, and test delivery separately."}
	if d.ProviderID != "" {
		out.Zone, err = s.Mail.DomainDNS(ctx, d.ProviderID)
		if err != nil {
			return out, problem(502, "Could not load the mail provider's DNS records")
		}
	}
	dnsCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	mx, _ := s.DNS.LookupMX(dnsCtx, d.Name)
	for _, r := range mx {
		if strings.EqualFold(strings.TrimSuffix(r.Host, "."), s.Config.MailHost) {
			out.MXMatches = true
		}
	}
	return out, nil
}

// Mailboxes lists metadata only; message bodies and passwords stay out of this API.
func (s *Service) Mailboxes(ctx context.Context, u model.User, tenant string) ([]model.Mailbox, error) {
	if _, err := s.AuthorizeTenant(ctx, u, tenant); err != nil {
		return nil, err
	}
	return store.List[model.Mailbox](ctx, s.DB, `SELECT row_to_json(m) FROM mailboxes m WHERE tenant_id=$1 ORDER BY created_at`, tenant)
}

// MailboxInput contains a one-time password; it must never be logged or queued.
type MailboxInput struct {
	DomainID  string `json:"domain_id"`
	LocalPart string `json:"local_part"`
	Name      string `json:"name"`
	Password  string `json:"password"`
	QuotaMB   int    `json:"quota_mb"`
}

// CreateMailbox atomically reserves capacity before making a retryable remote call.
func (s *Service) CreateMailbox(ctx context.Context, u model.User, tenant string, in MailboxInput) (model.Mailbox, error) {
	var m model.Mailbox
	t, err := s.AuthorizeTenant(ctx, u, tenant)
	if err != nil {
		return m, err
	}
	d, err := s.domain(ctx, tenant, in.DomainID)
	if err != nil {
		return m, err
	}
	in.LocalPart = strings.ToLower(strings.TrimSpace(in.LocalPart))
	in.Name = strings.TrimSpace(in.Name)
	if !localPattern.MatchString(in.LocalPart) || len(in.LocalPart) > 64 || in.Name == "" || len(in.Name) > 100 || in.QuotaMB < 100 || in.QuotaMB > 102400 {
		return m, problem(400, "Provide a valid mailbox name and a quota between 100 and 102400 MiB")
	}
	if !d.Verified || d.Status != "active" {
		return m, problem(409, "Verify and provision the domain first")
	}
	if err = ValidatePassword(in.Password); err != nil {
		return m, err
	}
	m = model.Mailbox{ID: store.ID(), TenantID: tenant, DomainID: d.ID, Address: in.LocalPart + "@" + d.Name, Name: in.Name, QuotaMB: in.QuotaMB, Status: "pending"}
	err = s.DB.Locked(ctx, func(tx pgx.Tx) error {
		var total, count, allocated int
		if e := tx.QueryRow(ctx, `SELECT count(*) FROM mailboxes`).Scan(&total); e != nil {
			return e
		}
		if e := tx.QueryRow(ctx, `SELECT count(*),COALESCE(sum(quota_mb),0) FROM mailboxes WHERE tenant_id=$1`, tenant).Scan(&count, &allocated); e != nil {
			return e
		}
		if total >= s.Config.MaxMailboxes || count >= t.MaxMailboxes || allocated+in.QuotaMB > t.QuotaMB {
			return problem(409, "Mailbox count or allocated storage limit reached")
		}
		if _, e := tx.Exec(ctx, `INSERT INTO mailboxes(id,tenant_id,domain_id,address,name,quota_mb) VALUES($1,$2,$3,$4,$5,$6)`, m.ID, tenant, m.DomainID, m.Address, m.Name, m.QuotaMB); e != nil {
			return e
		}
		return store.Audit(ctx, tx, tenant, u.Email, "mailbox.created", m.Address)
	})
	if err != nil {
		return m, err
	}
	return s.ProvisionMailbox(ctx, u, tenant, m.ID, in.Password)
}

// mailbox applies the tenant boundary even when the caller already knows the ID.
func (s *Service) mailbox(ctx context.Context, tenant, id string) (model.Mailbox, error) {
	return store.One[model.Mailbox](ctx, s.DB, `SELECT row_to_json(m) FROM mailboxes m WHERE tenant_id=$1 AND id=$2`, tenant, id)
}

// ProvisionMailbox asks for the password again on retry instead of persisting it.
func (s *Service) ProvisionMailbox(ctx context.Context, u model.User, tenant, id, password string) (model.Mailbox, error) {
	t, err := s.AuthorizeTenant(ctx, u, tenant)
	if err != nil {
		return model.Mailbox{}, err
	}
	hash, err := PasswordHash(password)
	if err != nil {
		return model.Mailbox{}, err
	}
	err = s.DB.Locked(ctx, func(tx pgx.Tx) error {
		m, e := store.One[model.Mailbox](ctx, tx, `SELECT row_to_json(m) FROM mailboxes m WHERE tenant_id=$1 AND id=$2`, tenant, id)
		if e != nil {
			return e
		}
		if m.Status == "active" {
			return nil
		}
		if m.Status == "deleting" {
			return problem(409, "Mailbox deletion is pending; retry deletion")
		}
		d, e := store.One[model.Domain](ctx, tx, `SELECT row_to_json(d) FROM domains d WHERE id=$1 AND tenant_id=$2`, m.DomainID, tenant)
		if e != nil {
			return e
		}
		remote, e := s.Mail.EnsureMailbox(ctx, t, d, m, hash)
		if e != nil {
			return problem(502, "Mailbox saved as pending. Check the provider, then retry provisioning with the same password.")
		}
		if _, e = tx.Exec(ctx, `UPDATE mailboxes SET provider_id=$2,status='active' WHERE id=$1`, id, remote); e != nil {
			return e
		}
		if e = s.saveSimulationPassword(ctx, tx, id, hash); e != nil {
			return e
		}
		return store.Audit(ctx, tx, tenant, u.Email, "mailbox.provisioned", m.Address)
	})
	if err != nil {
		return model.Mailbox{}, err
	}
	return s.mailbox(ctx, tenant, id)
}

// ResetMailboxPassword explicitly resets credentials only for an active owned account.
func (s *Service) ResetMailboxPassword(ctx context.Context, u model.User, tenant, id, password string) error {
	if _, err := s.AuthorizeTenant(ctx, u, tenant); err != nil {
		return err
	}
	hash, err := PasswordHash(password)
	if err != nil {
		return err
	}
	return s.DB.Locked(ctx, func(tx pgx.Tx) error {
		m, e := store.One[model.Mailbox](ctx, tx, `SELECT row_to_json(m) FROM mailboxes m WHERE tenant_id=$1 AND id=$2`, tenant, id)
		if e != nil {
			return e
		}
		if m.Status != "active" {
			return problem(409, "Only provisioned mailboxes can be reset")
		}
		if e = s.Mail.ResetPassword(ctx, m.ProviderID, hash); e != nil {
			return problem(502, "Mail provider could not reset credentials; you can retry this operation")
		}
		if e = s.saveSimulationPassword(ctx, tx, id, hash); e != nil {
			return e
		}
		return store.Audit(ctx, tx, tenant, u.Email, "mailbox.password_reset", m.Address)
	})
}

// saveSimulationPassword enables local mailbox sign-in with only a bcrypt hash.
// Credential changes revoke all mailbox sessions; production uses Stalwart only.
func (s *Service) saveSimulationPassword(ctx context.Context, tx pgx.Tx, id, hash string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM webmail_sessions WHERE mailbox_id=$1`, id); err != nil {
		return err
	}
	if s.Config.Mode != "simulation" {
		return nil
	}
	if _, err := tx.Exec(ctx, `INSERT INTO simulation_mailbox_credentials(mailbox_id,password_hash) VALUES($1,$2) ON CONFLICT(mailbox_id) DO UPDATE SET password_hash=excluded.password_hash`, id, hash); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `DELETE FROM webmail_sessions WHERE mailbox_id=$1`, id)
	return err
}

// DeleteMailbox requires the full address as confirmation and retains a deletion
// marker if a remote timeout leaves the outcome uncertain. Retry completes cleanup.
func (s *Service) DeleteMailbox(ctx context.Context, u model.User, tenant, id, confirm string) error {
	if _, err := s.AuthorizeTenant(ctx, u, tenant); err != nil {
		return err
	}
	m, err := s.mailbox(ctx, tenant, id)
	if err != nil {
		return err
	}
	if confirm != m.Address {
		return problem(400, "Type the full mailbox address to confirm deletion")
	}
	if m.ProviderID == "" {
		return problem(409, "Resolve pending provisioning before deleting this mailbox")
	}
	if _, err = s.DB.Exec(ctx, `UPDATE mailboxes SET status='deleting' WHERE id=$1 AND tenant_id=$2`, id, tenant); err != nil {
		return err
	}
	return s.DB.Locked(ctx, func(tx pgx.Tx) error {
		if e := s.Mail.DeleteMailbox(ctx, m.ProviderID); e != nil {
			return problem(502, "Deletion is pending. Check the provider and retry.")
		}
		if _, e := tx.Exec(ctx, `DELETE FROM mailboxes WHERE id=$1 AND tenant_id=$2`, id, tenant); e != nil {
			return e
		}
		return store.Audit(ctx, tx, tenant, u.Email, "mailbox.deleted", m.Address)
	})
}

// Audit returns the latest 100 events visible to this administrator.
func (s *Service) Audit(ctx context.Context, u model.User, tenant string) ([]model.AuditEvent, error) {
	if _, err := s.AuthorizeTenant(ctx, u, tenant); err != nil {
		return nil, err
	}
	return store.List[model.AuditEvent](ctx, s.DB, `SELECT row_to_json(a) FROM audit_events a WHERE tenant_id=$1 ORDER BY id DESC LIMIT 100`, tenant)
}

// Bootstrap creates the first owner once. Restarts never overwrite its password.
func (s *Service) Bootstrap(ctx context.Context) error {
	return s.DB.Locked(ctx, func(tx pgx.Tx) error {
		// Prevent accidentally attaching production to a database full of simulated IDs.
		if _, err := tx.Exec(ctx, `INSERT INTO app_metadata(key,value) VALUES('provider',$1) ON CONFLICT DO NOTHING`, s.Config.Mode); err != nil {
			return err
		}
		var mode string
		if err := tx.QueryRow(ctx, `SELECT value FROM app_metadata WHERE key='provider'`).Scan(&mode); err != nil {
			return err
		}
		if mode != s.Config.Mode {
			return fmt.Errorf("database provider is %s; use a separate database for %s", mode, s.Config.Mode)
		}
		if s.Config.Mode == "stalwart" {
			edition := s.Config.StalwartEdition
			if edition == "" {
				edition = "enterprise"
			}
			if _, err := tx.Exec(ctx, `INSERT INTO app_metadata(key,value) VALUES('stalwart_edition',$1) ON CONFLICT DO NOTHING`, edition); err != nil {
				return err
			}
			var saved string
			if err := tx.QueryRow(ctx, `SELECT value FROM app_metadata WHERE key='stalwart_edition'`).Scan(&saved); err != nil {
				return err
			}
			if saved != edition {
				return errors.New("changing Stalwart edition requires an explicit data migration")
			}
		}
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE role='platform_admin')`).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return nil
		}
		if !ValidEmail(s.Config.BootstrapEmail) {
			return errors.New("BOOTSTRAP_EMAIL must be a valid email on first start")
		}
		hash, err := PasswordHash(s.Config.BootstrapPassword)
		if err != nil {
			return fmt.Errorf("BOOTSTRAP_PASSWORD: %w", err)
		}
		_, err = tx.Exec(ctx, `INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,'Platform owner',$3,'platform_admin')`, store.ID(), s.Config.BootstrapEmail, hash)
		return err
	})
}
