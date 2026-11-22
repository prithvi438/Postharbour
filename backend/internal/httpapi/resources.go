package httpapi

import (
	"net/http"
	"postharbor/internal/model"
	"postharbor/internal/service"
)

// tenants serves the business selector with only authorized businesses.
func (s *Server) tenants(w http.ResponseWriter, r *http.Request, u model.User) error {
	data, err := s.Service.Tenants(r.Context(), u)
	if err != nil {
		return err
	}
	return respond(w, 200, data)
}

// createTenant creates a business plus its first administrator (owner only).
func (s *Server) createTenant(w http.ResponseWriter, r *http.Request, u model.User) error {
	var in service.TenantInput
	if err := decode(w, r, &in); err != nil {
		return err
	}
	data, err := s.Service.CreateTenant(r.Context(), u, in)
	if err != nil {
		return err
	}
	return respond(w, 201, data)
}

// provisionTenant retries a saved business whose provider setup did not complete.
func (s *Server) provisionTenant(w http.ResponseWriter, r *http.Request, u model.User) error {
	data, err := s.Service.ProvisionTenant(r.Context(), u, r.PathValue("tenant"))
	if err != nil {
		return err
	}
	return respond(w, 200, data)
}

// domains lists domains belonging to the selected business.
func (s *Server) domains(w http.ResponseWriter, r *http.Request, u model.User) error {
	data, err := s.Service.Domains(r.Context(), u, r.PathValue("tenant"))
	if err != nil {
		return err
	}
	return respond(w, 200, data)
}

// createDomain reserves a domain and issues its DNS ownership challenge.
func (s *Server) createDomain(w http.ResponseWriter, r *http.Request, u model.User) error {
	var in struct {
		Name string `json:"name"`
	}
	if err := decode(w, r, &in); err != nil {
		return err
	}
	data, err := s.Service.CreateDomain(r.Context(), u, r.PathValue("tenant"), in.Name)
	if err != nil {
		return err
	}
	return respond(w, 201, data)
}

// verifyDomain checks the TXT challenge and provisions the mail-engine domain.
func (s *Server) verifyDomain(w http.ResponseWriter, r *http.Request, u model.User) error {
	var in struct {
		Simulate bool `json:"simulate"`
	}
	if err := decode(w, r, &in); err != nil {
		return err
	}
	data, err := s.Service.VerifyDomain(r.Context(), u, r.PathValue("tenant"), r.PathValue("id"), in.Simulate)
	if err != nil {
		return err
	}
	return respond(w, 200, data)
}

// domainDNS returns instructions, engine-generated records, and a basic MX check.
func (s *Server) domainDNS(w http.ResponseWriter, r *http.Request, u model.User) error {
	data, err := s.Service.DomainDNS(r.Context(), u, r.PathValue("tenant"), r.PathValue("id"))
	if err != nil {
		return err
	}
	return respond(w, 200, data)
}

// mailboxes lists account metadata, never mail contents or credentials.
func (s *Server) mailboxes(w http.ResponseWriter, r *http.Request, u model.User) error {
	data, err := s.Service.Mailboxes(r.Context(), u, r.PathValue("tenant"))
	if err != nil {
		return err
	}
	return respond(w, 200, data)
}

// createMailbox validates limits and creates an account under a verified domain.
func (s *Server) createMailbox(w http.ResponseWriter, r *http.Request, u model.User) error {
	var in service.MailboxInput
	if err := decode(w, r, &in); err != nil {
		return err
	}
	data, err := s.Service.CreateMailbox(r.Context(), u, r.PathValue("tenant"), in)
	if err != nil {
		return err
	}
	return respond(w, 201, data)
}

// passwordInput is shared by provisioning retries and explicit password resets.
type passwordInput struct {
	Password string `json:"password"`
}

// provisionMailbox retries a pending account without persisting its password.
func (s *Server) provisionMailbox(w http.ResponseWriter, r *http.Request, u model.User) error {
	var in passwordInput
	if err := decode(w, r, &in); err != nil {
		return err
	}
	data, err := s.Service.ProvisionMailbox(r.Context(), u, r.PathValue("tenant"), r.PathValue("id"), in.Password)
	if err != nil {
		return err
	}
	return respond(w, 200, data)
}

// mailboxPassword replaces the owned mail account's credentials.
func (s *Server) mailboxPassword(w http.ResponseWriter, r *http.Request, u model.User) error {
	var in passwordInput
	if err := decode(w, r, &in); err != nil {
		return err
	}
	if err := s.Service.ResetMailboxPassword(r.Context(), u, r.PathValue("tenant"), r.PathValue("id"), in.Password); err != nil {
		return err
	}
	return respond(w, 200, map[string]bool{"ok": true})
}

// deleteMailbox removes mail-engine data only after exact address confirmation.
func (s *Server) deleteMailbox(w http.ResponseWriter, r *http.Request, u model.User) error {
	var in struct {
		Confirm string `json:"confirm"`
	}
	if err := decode(w, r, &in); err != nil {
		return err
	}
	if err := s.Service.DeleteMailbox(r.Context(), u, r.PathValue("tenant"), r.PathValue("id"), in.Confirm); err != nil {
		return err
	}
	return respond(w, 200, map[string]bool{"ok": true})
}

// audit returns the newest tenant-scoped administrator activity.
func (s *Server) audit(w http.ResponseWriter, r *http.Request, u model.User) error {
	data, err := s.Service.Audit(r.Context(), u, r.PathValue("tenant"))
	if err != nil {
		return err
	}
	return respond(w, 200, data)
}
