package httpapi

import (
	"crypto/subtle"
	"errors"
	"mime"
	"net"
	"net/http"
	"postharbor/internal/service"
	"postharbor/internal/store"
	"postharbor/internal/webmail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

const webmailCookieName = "postharbor_webmail"

// mailboxUser is a mailbox identity, with no administrator role or permissions.
type mailboxUser struct {
	ID      string `json:"id"`
	Address string `json:"address"`
	Name    string `json:"name"`
	mail    webmail.Store
}
type mailboxSession struct {
	User mailboxUser
	CSRF string
}
type mailboxEndpoint func(http.ResponseWriter, *http.Request, mailboxUser) error

// webmailEnabled requires either a configured local capture adapter or encrypted live sessions.
func (s *Server) webmailEnabled() error {
	if s.Service.Config.Mode == "stalwart" {
		if s.Service.Config.WebmailSessionKey == "" {
			return &service.Error{Status: 503, Message: "Live webmail is not configured"}
		}
		return nil
	}
	if s.Service.Config.MailpitURL == "" {
		return &service.Error{Status: 503, Message: "Start the local mail demo with MAILPIT_URL configured"}
	}
	return nil
}

// webmailCookie is separate from the administrator session and scoped to mail APIs.
func (s *Server) webmailCookie(w http.ResponseWriter, value string, age int) {
	expires := time.Now().Add(time.Duration(age) * time.Second)
	if age < 0 {
		expires = time.Unix(1, 0)
	}
	http.SetCookie(w, &http.Cookie{Name: webmailCookieName, Value: value, Path: "/api/webmail", HttpOnly: true,
		Secure: s.Service.Config.SecureCookies, SameSite: http.SameSiteStrictMode, MaxAge: age, Expires: expires})
}

// mailboxSession reads the current mailbox status so deletion immediately denies access.
func (s *Server) mailboxSession(r *http.Request) (mailboxSession, error) {
	var session mailboxSession
	cookie, err := r.Cookie(webmailCookieName)
	if err != nil {
		return session, err
	}
	var encrypted string
	err = s.Service.DB.QueryRow(r.Context(), `SELECT m.id,m.address,m.name,s.csrf,s.encrypted_credentials FROM webmail_sessions s JOIN mailboxes m ON m.id=s.mailbox_id WHERE s.token_hash=$1 AND s.expires_at>now() AND m.status='active'`, tokenHash(cookie.Value)).Scan(&session.User.ID, &session.User.Address, &session.User.Name, &session.CSRF, &encrypted)
	if err == nil {
		session.User.mail = s.capture
		if s.Service.Config.Mode == "stalwart" {
			credentials, e := webmail.OpenCredentials(s.Service.Config.WebmailSessionKey, tokenHash(cookie.Value), encrypted)
			if e != nil || credentials.Username != session.User.Address {
				return session, errors.New("invalid live mailbox session")
			}
			session.User.mail = webmail.NewJMAP(s.Service.Config.StalwartURL, credentials)
		}
	}
	return session, err
}

// mailAuth applies the same local-mode/session/CSRF boundary to every mailbox route.
func (s *Server) mailAuth(next mailboxEndpoint) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := s.webmailEnabled(); err != nil {
			writeError(w, err)
			return
		}
		session, err := s.mailboxSession(r)
		if err != nil {
			writeError(w, &service.Error{Status: 401, Message: "Sign in to your mailbox"})
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(session.CSRF)) != 1 {
			writeError(w, &service.Error{Status: 403, Message: "Mailbox session verification failed. Refresh and retry."})
			return
		}
		if err = next(w, r, session.User); err != nil {
			writeError(w, err)
		}
	}
}

// webmailLogin authenticates a mailbox without granting dashboard access.
func (s *Server) webmailLogin(w http.ResponseWriter, r *http.Request) {
	if err := s.webmailEnabled(); err != nil {
		writeError(w, err)
		return
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	if !s.limiter.allow("mail:" + ip) {
		writeError(w, &service.Error{Status: 429, Message: "Too many mailbox sign-in attempts. Try again in a minute."})
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
	if s.Service.Config.Mode == "stalwart" {
		s.liveWebmailLogin(w, r, email, in.Password)
		return
	}
	token, csrf := store.ID(), store.ID()
	err := s.Service.DB.Locked(r.Context(), func(tx pgx.Tx) error {
		var id, hash string
		err := tx.QueryRow(r.Context(), `SELECT m.id,c.password_hash FROM mailboxes m JOIN simulation_mailbox_credentials c ON c.mailbox_id=m.id WHERE m.address=$1 AND m.status='active'`, email).Scan(&id, &hash)
		if err != nil {
			hash = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"
		}
		valid := bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.Password)) == nil
		if err != nil || !valid {
			return &service.Error{Status: 401, Message: "Mailbox email or password is incorrect"}
		}
		if _, err = tx.Exec(r.Context(), `DELETE FROM webmail_sessions WHERE expires_at<now() OR mailbox_id=$1`, id); err != nil {
			return err
		}
		_, err = tx.Exec(r.Context(), `INSERT INTO webmail_sessions(token_hash,mailbox_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')`, tokenHash(token), id, csrf)
		return err
	})
	if err != nil {
		writeError(w, err)
		return
	}
	s.webmailCookie(w, token, 12*60*60)
	respond(w, 200, map[string]string{"csrf": csrf})
}

// webmailSession returns only the mailbox identity and its own anti-CSRF token.
func (s *Server) webmailSession(w http.ResponseWriter, r *http.Request, u mailboxUser) error {
	session, err := s.mailboxSession(r)
	if err != nil {
		return err
	}
	return respond(w, 200, map[string]any{"user": u, "csrf": session.CSRF, "mode": s.Service.Config.Mode})
}

// webmailLogout revokes this mailbox token while leaving the admin login untouched.
func (s *Server) webmailLogout(w http.ResponseWriter, r *http.Request, _ mailboxUser) error {
	cookie, _ := r.Cookie(webmailCookieName)
	if _, err := s.Service.DB.Exec(r.Context(), `DELETE FROM webmail_sessions WHERE token_hash=$1`, tokenHash(cookie.Value)); err != nil {
		return err
	}
	s.webmailCookie(w, "", -1)
	return respond(w, 200, map[string]bool{"ok": true})
}

// captureUnavailable gives readers a recoverable message without leaking upstream data.
func captureUnavailable() error {
	return &service.Error{Status: 503, Message: "The mail service could not complete this request. Please retry or contact your administrator."}
}

// mailList merges per-mailbox read state without trusting Mailpit's global Read flag.
func (s *Server) mailList(r *http.Request, u mailboxUser) ([]webmail.Summary, error) {
	list, err := u.mail.List(r.Context())
	if err != nil {
		return nil, captureUnavailable()
	}
	rows, err := s.Service.DB.Query(r.Context(), `SELECT message_id FROM webmail_read_messages WHERE mailbox_id=$1`, u.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	read := map[string]bool{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		read[id] = true
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	for i := range list {
		list[i].Read = list[i].Read || read[list[i].ID]
	}
	return list, nil
}

// webmailMessages filters exact recipient/sender membership before returning metadata.
func (s *Server) webmailMessages(w http.ResponseWriter, r *http.Request, u mailboxUser) error {
	folder := r.URL.Query().Get("folder")
	if folder == "" {
		folder = "inbox"
	}
	if folder != "inbox" && folder != "sent" {
		return &service.Error{Status: 400, Message: "Choose inbox or sent"}
	}
	list, err := s.mailList(r, u)
	if err != nil {
		return err
	}
	out := []webmail.Summary{}
	for _, m := range list {
		if (folder == "inbox" && m.ReceivedBy(u.Address)) || (folder == "sent" && m.SentBy(u.Address)) {
			out = append(out, m)
		}
	}
	return respond(w, 200, map[string]any{"messages": out})
}

// ownedMessage checks visibility before fetching a body or invoking any upstream side effect.
func (s *Server) ownedMessage(r *http.Request, u mailboxUser, id string) (webmail.Summary, error) {
	list, err := s.mailList(r, u)
	if err != nil {
		return webmail.Summary{}, err
	}
	for _, m := range list {
		if m.ID == id && m.VisibleTo(u.Address) {
			return m, nil
		}
	}
	return webmail.Summary{}, &service.Error{Status: 404, Message: "Message not found"}
}

// webmailMessage never exposes HTML or another mailbox's hidden recipients.
func (s *Server) webmailMessage(w http.ResponseWriter, r *http.Request, u mailboxUser) error {
	m, err := s.ownedMessage(r, u, r.PathValue("id"))
	if err != nil {
		return err
	}
	detail, err := u.mail.Detail(r.Context(), m)
	if err != nil {
		return captureUnavailable()
	}
	return respond(w, 200, detail)
}

// webmailConversation never includes a message merely because its subject matches.
// Scope is checked before fetching reference headers or joining reply chains.
func (s *Server) webmailConversation(w http.ResponseWriter, r *http.Request, u mailboxUser) error {
	list, err := s.mailList(r, u)
	if err != nil {
		return err
	}
	visible := []webmail.Summary{}
	found := false
	for _, item := range list {
		if item.VisibleTo(u.Address) {
			visible = append(visible, item)
			if item.ID == r.PathValue("id") {
				found = true
			}
		}
	}
	if !found {
		return &service.Error{Status: 404, Message: "Message not found"}
	}
	conversation, err := u.mail.Conversation(r.Context(), visible, r.PathValue("id"))
	if err != nil {
		return captureUnavailable()
	}
	return respond(w, 200, conversation)
}

// webmailRead stores read state for this account, without changing other accounts.
func (s *Server) webmailRead(w http.ResponseWriter, r *http.Request, u mailboxUser) error {
	m, err := s.ownedMessage(r, u, r.PathValue("id"))
	if err != nil {
		return err
	}
	if live, ok := u.mail.(*webmail.JMAP); ok {
		if err := live.MarkRead(r.Context(), m.ID); err != nil {
			return captureUnavailable()
		}
	}
	_, err = s.Service.DB.Exec(r.Context(), `INSERT INTO webmail_read_messages(mailbox_id,message_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, u.ID, m.ID)
	if err != nil {
		return err
	}
	return respond(w, 200, map[string]bool{"ok": true})
}

// webmailAttachment authorizes both the message and MIME part, then forces download.
func (s *Server) webmailAttachment(w http.ResponseWriter, r *http.Request, u mailboxUser) error {
	m, err := s.ownedMessage(r, u, r.PathValue("id"))
	if err != nil {
		return err
	}
	detail, err := u.mail.Detail(r.Context(), m)
	if err != nil {
		return captureUnavailable()
	}
	for _, a := range detail.AttachmentList {
		if a.ID != r.PathValue("attachment") {
			continue
		}
		data, err := u.mail.Download(r.Context(), m.ID, a.ID)
		if err != nil {
			return captureUnavailable()
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": a.Name}))
		w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
		_, err = w.Write(data)
		return err
	}
	return &service.Error{Status: 404, Message: "Attachment not found"}
}

// webmailPreview shares download authorization but permits only sniffed raster
// images inline. The uploaded MIME label is never sufficient to enable preview.
func (s *Server) webmailPreview(w http.ResponseWriter, r *http.Request, u mailboxUser) error {
	m, err := s.ownedMessage(r, u, r.PathValue("id"))
	if err != nil {
		return err
	}
	detail, err := u.mail.Detail(r.Context(), m)
	if err != nil {
		return captureUnavailable()
	}
	for _, a := range detail.AttachmentList {
		if a.ID != r.PathValue("attachment") {
			continue
		}
		data, err := u.mail.Download(r.Context(), m.ID, a.ID)
		if err != nil {
			return captureUnavailable()
		}
		kind := webmail.PreviewType(data)
		if kind == "" {
			return &service.Error{Status: 415, Message: "This file is available as a download; only raster photos can be previewed"}
		}
		w.Header().Set("Content-Type", kind)
		w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": a.Name}))
		w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
		_, err = w.Write(data)
		return err
	}
	return &service.Error{Status: 404, Message: "Attachment not found"}
}

// webmailSend forces the authenticated sender, validates attachments, and applies
// the saved signature. Only simulation mode restricts recipients to .test.
func (s *Server) webmailSend(w http.ResponseWriter, r *http.Request, u mailboxUser) error {
	var in struct {
		To               string           `json:"to"`
		Subject          string           `json:"subject"`
		Text             string           `json:"text"`
		HTML             string           `json:"html"`
		ReplyTo          string           `json:"reply_to"`
		Attachments      []webmail.Upload `json:"attachments"`
		IncludeSignature *bool            `json:"include_signature"`
	}
	if err := decodeLimit(w, r, &in, 8<<20); err != nil {
		return err
	}
	if err := webmail.ValidateUploads(in.Attachments); err != nil {
		status := 400
		if errors.Is(err, webmail.ErrUploadSize) {
			status = 413
		}
		return &service.Error{Status: status, Message: err.Error()}
	}
	if len(in.HTML) > 50000 {
		return &service.Error{Status: 400, Message: "Formatted message must be under 50 KB"}
	}
	if len(in.Subject) > 200 || strings.ContainsAny(in.Subject, "\r\n") || len(in.Text) > 7000 || (strings.TrimSpace(in.Text) == "" && len(in.Attachments) == 0) {
		return &service.Error{Status: 400, Message: "Use a single-line subject up to 200 bytes and a message up to 7000 bytes"}
	}
	to := strings.Split(in.To, ",")
	if len(to) > 10 {
		return &service.Error{Status: 400, Message: "Send to at most 10 recipients"}
	}
	for i, address := range to {
		address = strings.ToLower(strings.TrimSpace(address))
		if !service.ValidEmail(address) || (s.Service.Config.Mode == "simulation" && !strings.HasSuffix(address, ".test")) || strings.ContainsAny(address, "\r\n") {
			return &service.Error{Status: 400, Message: "Enter valid recipients; local simulation accepts only .test addresses"}
		}
		to[i] = address
	}
	if s.Service.Config.Mode == "simulation" && !strings.HasSuffix(u.Address, ".test") {
		return &service.Error{Status: 400, Message: "Use a .test mailbox for local mail"}
	}
	var replyID string
	if in.ReplyTo != "" {
		m, err := s.ownedMessage(r, u, in.ReplyTo)
		if err != nil {
			return err
		}
		detail, err := u.mail.Detail(r.Context(), m)
		if err != nil {
			return captureUnavailable()
		}
		replyID = detail.MessageID
	}
	settings, err := s.readMailSettings(r.Context(), u.ID)
	if err != nil {
		return err
	}
	in.Text, in.HTML = appendSignature(in.Text, in.HTML, settings, in.IncludeSignature)
	if len(in.Text) > 17000 || len(in.HTML) > 60000 {
		return &service.Error{Status: 400, Message: "Message and signature are too large"}
	}
	id, err := u.mail.Send(r.Context(), webmail.Address{Name: u.Name, Address: u.Address}, to, in.Subject, in.Text, replyID, in.Attachments, in.HTML)
	if err != nil {
		return captureUnavailable()
	}
	return respond(w, 200, map[string]any{"ok": true, "id": id})
}

// liveWebmailLogin authenticates against the engine, then saves only encrypted,
// short-lived credentials for the exact active mailbox registered in Postharbor.
func (s *Server) liveWebmailLogin(w http.ResponseWriter, r *http.Request, email, password string) {
	reject := func() { writeError(w, &service.Error{Status: 401, Message: "Mailbox email or password is incorrect"}) }
	if !service.ValidEmail(email) || len(password) > 256 {
		reject()
		return
	}
	var id string
	err := s.Service.DB.QueryRow(r.Context(), `SELECT id FROM mailboxes WHERE address=$1 AND status='active'`, email).Scan(&id)
	if err != nil {
		reject()
		return
	}
	client := webmail.NewJMAP(s.Service.Config.StalwartURL, webmail.Credentials{Username: email, Password: password})
	if err = client.Authenticate(r.Context()); err != nil {
		reject()
		return
	}
	token, csrf := store.ID(), store.ID()
	encrypted, err := webmail.SealCredentials(s.Service.Config.WebmailSessionKey, tokenHash(token), client.Credentials)
	if err != nil {
		writeError(w, err)
		return
	}
	err = s.Service.DB.Locked(r.Context(), func(tx pgx.Tx) error {
		// Recheck status after network authentication so deletion cannot race login.
		var active bool
		if e := tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM mailboxes WHERE id=$1 AND status='active')`, id).Scan(&active); e != nil {
			return e
		}
		if !active {
			return &service.Error{Status: 401, Message: "Mailbox is unavailable"}
		}
		if _, e := tx.Exec(r.Context(), `DELETE FROM webmail_sessions WHERE expires_at<now() OR mailbox_id=$1`, id); e != nil {
			return e
		}
		_, e := tx.Exec(r.Context(), `INSERT INTO webmail_sessions(token_hash,mailbox_id,csrf,expires_at,encrypted_credentials) VALUES($1,$2,$3,now()+interval '12 hours',$4)`, tokenHash(token), id, csrf, encrypted)
		return e
	})
	if err != nil {
		writeError(w, err)
		return
	}
	s.webmailCookie(w, token, 12*60*60)
	respond(w, 200, map[string]string{"csrf": csrf})
}
