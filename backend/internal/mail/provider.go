// Package mail isolates the application from the mail engine's management API.
package mail

import (
	"context"
	"postharbor/internal/model"
)

// Provider provisions mail resources. Ensure operations must be retry-safe:
// a timed-out HTTP request may still have succeeded on the remote server.
type Provider interface {
	EnsureTenant(context.Context, model.Tenant) (string, error)
	EnsureDomain(context.Context, model.Tenant, model.Domain) (string, error)
	EnsureMailbox(context.Context, model.Tenant, model.Domain, model.Mailbox, string) (string, error)
	ResetPassword(context.Context, string, string) error
	DeleteMailbox(context.Context, string) error
	DomainDNS(context.Context, string) (string, error)
}

// Simulation lets developers exercise real application/database flows without
// creating mail accounts or sending messages. It is stateless and deterministic.
type Simulation struct{}

// EnsureTenant returns a stable simulated ID for repeatable development.
func (Simulation) EnsureTenant(_ context.Context, t model.Tenant) (string, error) {
	return "sim-" + t.ID, nil
}

// EnsureDomain simulates provisioning, not DNS ownership verification.
func (Simulation) EnsureDomain(_ context.Context, _ model.Tenant, d model.Domain) (string, error) {
	return "sim-" + d.ID, nil
}

// EnsureMailbox returns a simulated identity without creating an IMAP/SMTP account.
// The service separately stores a bcrypt hash for the optional local capture reader.
func (Simulation) EnsureMailbox(_ context.Context, _ model.Tenant, _ model.Domain, m model.Mailbox, _ string) (string, error) {
	return "sim-" + m.ID, nil
}

// ResetPassword acknowledges the adapter change; the service updates the local reader hash.
func (Simulation) ResetPassword(context.Context, string, string) error { return nil }

// DeleteMailbox acknowledges removing a simulated account.
func (Simulation) DeleteMailbox(context.Context, string) error { return nil }

// DomainDNS deliberately avoids inventing a usable DKIM public key.
func (Simulation) DomainDNS(context.Context, string) (string, error) {
	return "; Simulation: no DNS zone or DKIM key has been generated. Real records come from Stalwart.", nil
}
