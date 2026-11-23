package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"html"
	"image"
	_ "image/jpeg"
	"image/png"
	"net/http"
	"postharbor/internal/model"
	"postharbor/internal/service"
	"postharbor/internal/webmail"
	"strings"
)

type mailTemplate struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Subject string `json:"subject"`
	HTML    string `json:"html"`
}
type mailSettings struct {
	Revision         int            `json:"revision"`
	Avatar           string         `json:"avatar"`
	Signature        string         `json:"signature"`
	SignatureEnabled bool           `json:"signature_enabled"`
	Templates        []mailTemplate `json:"templates"`
}

// normalizeAvatar strips image metadata and refuses SVG, malformed files and
// oversized dimensions before decoding. The browser prepares a small square photo.
func normalizeAvatar(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	bad := &service.Error{Status: 400, Message: "Choose a PNG or JPEG photo under 256 KiB and 512 × 512 pixels"}
	if !strings.HasPrefix(value, "data:image/png;base64,") && !strings.HasPrefix(value, "data:image/jpeg;base64,") {
		return "", bad
	}
	_, payload, _ := strings.Cut(value, ",")
	data, err := base64.StdEncoding.DecodeString(payload)
	if err != nil || len(data) > 256<<10 {
		return "", bad
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 512 || cfg.Height > 512 {
		return "", bad
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", bad
	}
	var out bytes.Buffer
	if err = png.Encode(&out, img); err != nil {
		return "", err
	}
	if out.Len() > 256<<10 {
		return "", bad
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(out.Bytes()), nil
}

// readMailSettings supplies an empty settings document for existing mailboxes.
func (s *Server) readMailSettings(ctx context.Context, id string) (mailSettings, error) {
	out := mailSettings{Templates: []mailTemplate{}}
	var data []byte
	err := s.Service.DB.QueryRow(ctx, `SELECT data,revision FROM webmail_settings WHERE mailbox_id=$1`, id).Scan(&data, &out.Revision)
	if err == pgx.ErrNoRows {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	revision := out.Revision
	err = json.Unmarshal(data, &out)
	out.Revision = revision
	return out, err
}

// webmailSettings changes only the authenticated mailbox's settings. Revisions
// reject stale writes from another tab instead of silently losing saved templates.
func (s *Server) webmailSettings(w http.ResponseWriter, r *http.Request, u mailboxUser) error {
	if r.Method == "GET" {
		out, err := s.readMailSettings(r.Context(), u.ID)
		if err != nil {
			return err
		}
		return respond(w, 200, out)
	}
	var in mailSettings
	if err := decodeLimit(w, r, &in, 2<<20); err != nil {
		return err
	}
	bad := &service.Error{Status: 400, Message: "Use at most 30 named templates, bodies under 50 KB and signatures under 10 KB"}
	if in.Revision < 0 || len(in.Signature) > 10000 || len(in.Templates) > 30 {
		return bad
	}
	var err error
	in.Avatar, err = normalizeAvatar(in.Avatar)
	if err != nil {
		return err
	}
	in.Signature = webmail.SafeHTML(in.Signature)
	if in.Templates == nil {
		in.Templates = []mailTemplate{}
	}
	ids := map[string]bool{}
	for i := range in.Templates {
		t := &in.Templates[i]
		t.Name = strings.TrimSpace(t.Name)
		if t.ID == "" || len(t.ID) > 80 || ids[t.ID] || t.Name == "" || len(t.Name) > 120 || len(t.Subject) > 200 || strings.ContainsAny(t.Subject, "\r\n") || len(t.HTML) > 50000 {
			return bad
		}
		ids[t.ID] = true
		t.HTML = webmail.SafeHTML(t.HTML)
	}
	data, err := json.Marshal(in)
	if err != nil {
		return err
	}
	conflict := &service.Error{Status: 409, Message: "Settings changed in another tab. Reload settings before saving"}
	if in.Revision == 0 {
		result, e := s.Service.DB.Exec(r.Context(), `INSERT INTO webmail_settings(mailbox_id,revision,data) VALUES($1,1,$2) ON CONFLICT DO NOTHING`, u.ID, data)
		err = e
		if err == nil && result.RowsAffected() == 0 {
			return conflict
		}
	} else {
		result, e := s.Service.DB.Exec(r.Context(), `UPDATE webmail_settings SET data=$2,revision=revision+1 WHERE mailbox_id=$1 AND revision=$3`, u.ID, data, in.Revision)
		err = e
		if err == nil && result.RowsAffected() == 0 {
			return conflict
		}
	}
	if err != nil {
		return err
	}
	in.Revision++
	return respond(w, 200, in)
}

// accountProfile edits the signed-in dashboard user's photo, never another user.
func (s *Server) accountProfile(w http.ResponseWriter, r *http.Request, u model.User) error {
	var in struct {
		Avatar string `json:"avatar"`
	}
	if err := decodeLimit(w, r, &in, 400<<10); err != nil {
		return err
	}
	avatar, err := normalizeAvatar(in.Avatar)
	if err != nil {
		return err
	}
	_, err = s.Service.DB.Exec(r.Context(), `UPDATE users SET avatar=$2 WHERE id=$1`, u.ID, avatar)
	if err != nil {
		return err
	}
	return respond(w, 200, map[string]string{"avatar": avatar})
}

// appendSignature runs at the sending boundary. The composer previews the footer
// separately so a retry or template insertion cannot append it a second time.
func appendSignature(text, rich string, settings mailSettings, include *bool) (string, string) {
	if !settings.SignatureEnabled || settings.Signature == "" || (include != nil && !*include) {
		return text, rich
	}
	signature := webmail.SafeHTML(settings.Signature)
	if rich == "" {
		rich = "<p>" + strings.ReplaceAll(html.EscapeString(text), "\n", "<br>") + "</p>"
	}
	return text + "\n\n-- \n" + webmail.PlainText(signature), webmail.SafeHTML(rich) + "<hr>" + signature
}
