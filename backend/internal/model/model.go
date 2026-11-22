// Package model defines the small, shared vocabulary used by the API and storage.
package model

import "time"

// User is a dashboard administrator, not an IMAP mailbox account.
// Password hashes never leave the store; the API only returns this public view.
type User struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	TenantID string `json:"tenant_id"`
}

// Tenant is one business. Limits are allocation limits, not measured usage.
type Tenant struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	MaxMailboxes int       `json:"max_mailboxes"`
	QuotaMB      int       `json:"quota_mb"`
	ProviderID   string    `json:"provider_id"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
}

// Domain keeps ownership verification separate from mail-engine provisioning.
type Domain struct {
	ID                string    `json:"id"`
	TenantID          string    `json:"tenant_id"`
	Name              string    `json:"name"`
	VerificationToken string    `json:"verification_token"`
	Verified          bool      `json:"verified"`
	ProviderID        string    `json:"provider_id"`
	Status            string    `json:"status"`
	CreatedAt         time.Time `json:"created_at"`
}

// Mailbox describes a mail account. No password is persisted in this model.
type Mailbox struct {
	ID         string    `json:"id"`
	TenantID   string    `json:"tenant_id"`
	DomainID   string    `json:"domain_id"`
	Address    string    `json:"address"`
	Name       string    `json:"name"`
	QuotaMB    int       `json:"quota_mb"`
	ProviderID string    `json:"provider_id"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
}

// AuditEvent records actions without request bodies, tokens, or credentials.
type AuditEvent struct {
	ID        int64     `json:"id"`
	TenantID  string    `json:"tenant_id"`
	Actor     string    `json:"actor"`
	Action    string    `json:"action"`
	Target    string    `json:"target"`
	CreatedAt time.Time `json:"created_at"`
}
