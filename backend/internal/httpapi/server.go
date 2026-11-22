// Package httpapi translates HTTP requests into service calls and owns sessions.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"postharbor/internal/model"
	"postharbor/internal/service"
	"postharbor/internal/webmail"
	"strings"
	"time"
)

// Server shares dependencies and a bounded login limiter across route handlers.
type Server struct {
	Service *service.Service
	limiter *loginLimiter
	capture *webmail.Client
}

// endpoint is a typed authenticated handler; auth wraps it once for all routes.
type endpoint func(http.ResponseWriter, *http.Request, model.User) error

// New registers every API explicitly. See docs/API.md for payloads and permissions.
func New(svc *service.Service) http.Handler {
	s := &Server{Service: svc, limiter: newLoginLimiter(), capture: webmail.New(svc.Config.MailpitURL)}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("POST /api/webmail/login", s.webmailLogin)
	mux.HandleFunc("GET /api/webmail/session", s.mailAuth(s.webmailSession))
	mux.HandleFunc("POST /api/webmail/logout", s.mailAuth(s.webmailLogout))
	mux.HandleFunc("GET /api/webmail/messages", s.mailAuth(s.webmailMessages))
	mux.HandleFunc("GET /api/webmail/messages/{id}", s.mailAuth(s.webmailMessage))
	mux.HandleFunc("GET /api/webmail/messages/{id}/conversation", s.mailAuth(s.webmailConversation))
	mux.HandleFunc("POST /api/webmail/messages/{id}/read", s.mailAuth(s.webmailRead))
	mux.HandleFunc("GET /api/webmail/messages/{id}/attachments/{attachment}", s.mailAuth(s.webmailAttachment))
	mux.HandleFunc("GET /api/webmail/messages/{id}/attachments/{attachment}/preview", s.mailAuth(s.webmailPreview))
	mux.HandleFunc("POST /api/webmail/send", s.mailAuth(s.webmailSend))
	mux.HandleFunc("GET /api/webmail/organizer", s.mailAuth(s.webmailOrganizer))
	mux.HandleFunc("PUT /api/webmail/organizer", s.mailAuth(s.webmailOrganizer))
	mux.HandleFunc("GET /api/webmail/filters", s.mailAuth(s.webmailFilters))
	mux.HandleFunc("POST /api/webmail/filters", s.mailAuth(s.createWebmailFilter))
	mux.HandleFunc("PUT /api/webmail/filters/{filter}", s.mailAuth(s.updateWebmailFilter))
	mux.HandleFunc("DELETE /api/webmail/filters/{filter}", s.mailAuth(s.deleteWebmailFilter))
	mux.HandleFunc("POST /api/login", s.login)
	mux.HandleFunc("GET /api/session", s.auth(s.session))
	mux.HandleFunc("POST /api/logout", s.auth(s.logout))
	mux.HandleFunc("POST /api/account/password", s.auth(s.changePassword))
	mux.HandleFunc("GET /api/tenants", s.auth(s.tenants))
	mux.HandleFunc("POST /api/tenants", s.auth(s.createTenant))
	mux.HandleFunc("POST /api/tenants/{tenant}/provision", s.auth(s.provisionTenant))
	mux.HandleFunc("GET /api/tenants/{tenant}/domains", s.auth(s.domains))
	mux.HandleFunc("POST /api/tenants/{tenant}/domains", s.auth(s.createDomain))
	mux.HandleFunc("POST /api/tenants/{tenant}/domains/{id}/verify", s.auth(s.verifyDomain))
	mux.HandleFunc("GET /api/tenants/{tenant}/domains/{id}/dns", s.auth(s.domainDNS))
	mux.HandleFunc("GET /api/tenants/{tenant}/mailboxes", s.auth(s.mailboxes))
	mux.HandleFunc("POST /api/tenants/{tenant}/mailboxes", s.auth(s.createMailbox))
	mux.HandleFunc("POST /api/tenants/{tenant}/mailboxes/{id}/provision", s.auth(s.provisionMailbox))
	mux.HandleFunc("POST /api/tenants/{tenant}/mailboxes/{id}/password", s.auth(s.mailboxPassword))
	mux.HandleFunc("DELETE /api/tenants/{tenant}/mailboxes/{id}", s.auth(s.deleteMailbox))
	mux.HandleFunc("GET /api/tenants/{tenant}/audit", s.auth(s.audit))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, &service.Error{Status: 404, Message: "API route not found"})
	})
	mux.HandleFunc("/", s.static)
	return s.security(mux)
}

// security establishes a same-origin API contract and browser security headers.
// TLS termination belongs to Caddy; cookie security uses APP_ORIGIN, not spoofable headers.
func (s *Server) security(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
		if s.Service.Config.SecureCookies {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
			if r.Method != "GET" && r.Method != "HEAD" {
				if r.Header.Get("Origin") != s.Service.Config.Origin {
					writeError(w, &service.Error{Status: 403, Message: "Request origin is not allowed"})
					return
				}
				if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
					writeError(w, &service.Error{Status: 415, Message: "Use application/json"})
					return
				}
			}
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		defer func() {
			if recover() != nil {
				slog.Error("request panic", "path", r.URL.Path)
				writeError(w, errors.New("internal error"))
			}
		}()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// decode rejects extra fields, trailing JSON, and oversized request bodies.
func decode(w http.ResponseWriter, r *http.Request, out any) error {
	return decodeLimit(w, r, out, 16<<10)
}

// decodeLimit gives only the attachment-send endpoint a larger bounded body.
// Ordinary configuration and sign-in requests retain the small 16 KiB limit.
func decodeLimit(w http.ResponseWriter, r *http.Request, out any, limit int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		var large *http.MaxBytesError
		if errors.As(err, &large) {
			return &service.Error{Status: 413, Message: "Request body is too large"}
		}
		return &service.Error{Status: 400, Message: "Invalid JSON request"}
	}
	if d.Decode(&struct{}{}) != io.EOF {
		return &service.Error{Status: 400, Message: "Send one JSON object"}
	}
	return nil
}

// respond keeps all JSON responses consistent; secrets are excluded by model types.
func respond(w http.ResponseWriter, status int, data any) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(data)
}

// writeError maps expected failures to useful messages and hides internal details.
func writeError(w http.ResponseWriter, err error) {
	status, message := 500, "An internal error occurred. Check the server logs."
	var app *service.Error
	var pg *pgconn.PgError
	switch {
	case errors.As(err, &app):
		status, message = app.Status, app.Message
	case errors.Is(err, pgx.ErrNoRows):
		status, message = 404, "Resource not found"
	case errors.As(err, &pg) && pg.Code == "23505":
		status, message = 409, "That email address or domain is already registered"
	default:
		slog.Error("request failed", "error_type", fmt.Sprintf("%T", err))
	}
	respond(w, status, map[string]string{"error": message})
}

// health verifies database readiness without disclosing configuration or secrets.
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if err := s.Service.DB.Ping(r.Context()); err != nil {
		respond(w, 503, map[string]string{"status": "unavailable"})
		return
	}
	respond(w, 200, map[string]string{"status": "ok"})
}

// static serves the built React SPA. Unknown API paths never fall back to HTML.
func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" && r.Method != "HEAD" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	root := s.Service.Config.StaticDir
	clean := filepath.Clean("/" + r.URL.Path)
	path := filepath.Join(root, clean)
	if info, err := os.Stat(path); err == nil && !info.IsDir() {
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		http.ServeFile(w, r, path)
		return
	}
	if filepath.Ext(r.URL.Path) != "" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if _, err := os.Stat(filepath.Join(root, "index.html")); err != nil {
		http.Error(w, "Frontend not built. Run npm run build in frontend, or use the Vite development server.", 503)
		return
	}
	http.ServeFile(w, r, filepath.Join(root, "index.html"))
}
