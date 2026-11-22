package httpapi

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	"net"
	"net/http"
	"postharbor/internal/model"
	"postharbor/internal/service"
	"postharbor/internal/store"
	"strings"
	"sync"
	"time"
)

const cookieName = "postharbor_session"

// sessionRecord stays private to HTTP authentication; tokens are hashed at rest.
type sessionRecord struct {
	User model.User
	CSRF string
}

// tokenHash makes a stolen database session record unusable as a browser cookie.
func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// cookie centralizes HttpOnly, SameSite, path, expiry, and HTTPS behavior.
func (s *Server) cookie(w http.ResponseWriter, value string, age int) {
	expires := time.Now().Add(time.Duration(age) * time.Second)
	if age < 0 {
		expires = time.Unix(1, 0)
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: value, Path: "/", HttpOnly: true, Secure: s.Service.Config.SecureCookies, SameSite: http.SameSiteStrictMode, MaxAge: age, Expires: expires})
}

// readSession joins against the current user so authorization is not frozen in a JWT.
func (s *Server) readSession(r *http.Request) (sessionRecord, error) {
	var record sessionRecord
	c, err := r.Cookie(cookieName)
	if err != nil {
		return record, err
	}
	err = s.Service.DB.QueryRow(r.Context(), `SELECT u.id,u.email,u.name,u.role,COALESCE(u.tenant_id,''),s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, tokenHash(c.Value)).Scan(&record.User.ID, &record.User.Email, &record.User.Name, &record.User.Role, &record.User.TenantID, &record.CSRF)
	return record, err
}

// auth applies session and CSRF checks once instead of repeating them per handler.
func (s *Server) auth(next endpoint) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		record, err := s.readSession(r)
		if err != nil {
			writeError(w, &service.Error{Status: 401, Message: "Please sign in"})
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(record.CSRF)) != 1 {
			writeError(w, &service.Error{Status: 403, Message: "Session verification failed. Refresh and try again."})
			return
		}
		if err = next(w, r, record.User); err != nil {
			writeError(w, err)
		}
	}
}

// login verifies a bcrypt password and creates a new opaque, expiring session.
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if !s.limiter.allow(ip) {
		w.Header().Set("Retry-After", "60")
		writeError(w, &service.Error{Status: 429, Message: "Too many sign-in attempts. Try again in a minute."})
		return
	}
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decode(w, r, &in); err != nil {
		writeError(w, err)
		return
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))
	var id, hash string
	err := s.Service.DB.QueryRow(r.Context(), `SELECT id,password_hash FROM users WHERE email=$1`, email).Scan(&id, &hash)
	// Comparing a dummy hash prevents immediate failures from revealing valid users.
	if err != nil {
		hash = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"
	}
	valid := bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.Password)) == nil
	if err != nil || !valid {
		writeError(w, &service.Error{Status: 401, Message: "Email or password is incorrect"})
		return
	}
	token, csrf := store.ID(), store.ID()
	err = s.Service.DB.Locked(r.Context(), func(tx pgx.Tx) error {
		if _, e := tx.Exec(r.Context(), `DELETE FROM sessions WHERE expires_at<now() OR user_id=$1`, id); e != nil {
			return e
		}
		_, e := tx.Exec(r.Context(), `INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')`, tokenHash(token), id, csrf)
		return e
	})
	if err != nil {
		writeError(w, err)
		return
	}
	s.cookie(w, token, 12*60*60)
	respond(w, 200, map[string]string{"csrf": csrf})
}

// session returns safe configuration and the current anti-CSRF token to React.
func (s *Server) session(w http.ResponseWriter, r *http.Request, u model.User) error {
	record, err := s.readSession(r)
	if err != nil {
		return err
	}
	return respond(w, 200, map[string]any{"user": u, "csrf": record.CSRF, "mode": s.Service.Config.Mode, "mail_host": s.Service.Config.MailHost, "webmail_url": s.Service.Config.WebmailURL, "max_mailboxes": s.Service.Config.MaxMailboxes})
}

// logout invalidates the server-side session and expires the browser cookie.
func (s *Server) logout(w http.ResponseWriter, r *http.Request, _ model.User) error {
	c, _ := r.Cookie(cookieName)
	if _, err := s.Service.DB.Exec(r.Context(), `DELETE FROM sessions WHERE token_hash=$1`, tokenHash(c.Value)); err != nil {
		return err
	}
	s.cookie(w, "", -1)
	return respond(w, 200, map[string]bool{"ok": true})
}

// changePassword requires the existing password and revokes every dashboard session.
func (s *Server) changePassword(w http.ResponseWriter, r *http.Request, u model.User) error {
	var in struct {
		Current string `json:"current_password"`
		New     string `json:"new_password"`
	}
	if err := decode(w, r, &in); err != nil {
		return err
	}
	var old string
	if err := s.Service.DB.QueryRow(r.Context(), `SELECT password_hash FROM users WHERE id=$1`, u.ID).Scan(&old); err != nil {
		return err
	}
	if bcrypt.CompareHashAndPassword([]byte(old), []byte(in.Current)) != nil {
		return &service.Error{Status: 400, Message: "Current password is incorrect"}
	}
	hash, err := service.PasswordHash(in.New)
	if err != nil {
		return err
	}
	err = s.Service.DB.Locked(r.Context(), func(tx pgx.Tx) error {
		if _, e := tx.Exec(r.Context(), `UPDATE users SET password_hash=$2 WHERE id=$1`, u.ID, hash); e != nil {
			return e
		}
		if _, e := tx.Exec(r.Context(), `DELETE FROM sessions WHERE user_id=$1`, u.ID); e != nil {
			return e
		}
		return store.Audit(r.Context(), tx, u.TenantID, u.Email, "administrator.password_changed", u.Email)
	})
	if err != nil {
		return err
	}
	s.cookie(w, "", -1)
	return respond(w, 200, map[string]bool{"ok": true})
}

// loginLimiter is deliberately process-local. The proxy may add stricter limits.
// Never trust arbitrary X-Forwarded-For values; the proxy's IP shares a bucket.
type loginLimiter struct {
	mu      sync.Mutex
	entries map[string]attempts
}
type attempts struct {
	count int
	until time.Time
}

// newLoginLimiter constructs a small, bounded failed/successful attempt tracker.
func newLoginLimiter() *loginLimiter { return &loginLimiter{entries: make(map[string]attempts)} }

// allow permits 20 attempts per minute per peer and cleans expired entries.
func (l *loginLimiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	for key, v := range l.entries {
		if now.After(v.until) {
			delete(l.entries, key)
		}
	}
	v, ok := l.entries[ip]
	if !ok {
		if len(l.entries) >= 10000 {
			return false
		}
		v = attempts{until: now.Add(time.Minute)}
	}
	v.count++
	l.entries[ip] = v
	return v.count <= 20
}
