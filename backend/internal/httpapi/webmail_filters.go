package httpapi

import (
	"net/http"
	"postharbor/internal/service"
	"postharbor/internal/store"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// mailFilter is a saved, per-mailbox view. Nonempty criteria are combined with
// AND by the browser over already-authorized metadata; no mail is mutated.
type mailFilter struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	From           string `json:"from"`
	To             string `json:"to"`
	Subject        string `json:"subject"`
	HasAttachments bool   `json:"has_attachments"`
	Unread         bool   `json:"unread"`
}

// filterInput validates readable names and bounded substring criteria once.
func filterInput(w http.ResponseWriter, r *http.Request) (mailFilter, error) {
	var input mailFilter
	if err := decode(w, r, &input); err != nil {
		return input, err
	}
	input.Name = strings.TrimSpace(input.Name)
	input.From = strings.TrimSpace(input.From)
	input.To = strings.TrimSpace(input.To)
	input.Subject = strings.TrimSpace(input.Subject)
	if utf8.RuneCountInString(input.Name) < 1 || utf8.RuneCountInString(input.Name) > 40 || strings.ContainsFunc(input.Name, unicode.IsControl) {
		return input, &service.Error{Status: 400, Message: "Name the filter using 1 to 40 characters"}
	}
	for _, value := range []string{input.From, input.To, input.Subject} {
		if utf8.RuneCountInString(value) > 200 || strings.ContainsFunc(value, unicode.IsControl) {
			return input, &service.Error{Status: 400, Message: "Filter criteria must be single lines of at most 200 characters"}
		}
	}
	return input, nil
}

// webmailFilters returns only this signed-in mailbox's persisted chips.
func (s *Server) webmailFilters(w http.ResponseWriter, r *http.Request, u mailboxUser) error {
	filters, err := store.List[mailFilter](r.Context(), s.Service.DB, `SELECT row_to_json(f) FROM (SELECT id,name,from_text AS "from",to_text AS "to",subject,has_attachments,unread FROM webmail_filters WHERE mailbox_id=$1 ORDER BY created_at,id) f`, u.ID)
	if err != nil {
		return err
	}
	return respond(w, 200, map[string]any{"filters": filters})
}

// createWebmailFilter serializes the small per-account quota check with insertion.
func (s *Server) createWebmailFilter(w http.ResponseWriter, r *http.Request, u mailboxUser) error {
	input, err := filterInput(w, r)
	if err != nil {
		return err
	}
	input.ID = store.ID()
	err = s.Service.DB.Locked(r.Context(), func(tx pgx.Tx) error {
		var count int
		if err := tx.QueryRow(r.Context(), `SELECT count(*) FROM webmail_filters WHERE mailbox_id=$1`, u.ID).Scan(&count); err != nil {
			return err
		}
		if count >= 20 {
			return &service.Error{Status: 409, Message: "Keep up to 20 saved filters per mailbox"}
		}
		_, err := tx.Exec(r.Context(), `INSERT INTO webmail_filters(id,mailbox_id,name,from_text,to_text,subject,has_attachments,unread) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, input.ID, u.ID, input.Name, input.From, input.To, input.Subject, input.HasAttachments, input.Unread)
		return err
	})
	if err != nil {
		return err
	}
	return respond(w, 201, input)
}

// updateWebmailFilter uses the session mailbox as part of the write predicate.
func (s *Server) updateWebmailFilter(w http.ResponseWriter, r *http.Request, u mailboxUser) error {
	input, err := filterInput(w, r)
	if err != nil {
		return err
	}
	input.ID = r.PathValue("filter")
	result, err := s.Service.DB.Exec(r.Context(), `UPDATE webmail_filters SET name=$3,from_text=$4,to_text=$5,subject=$6,has_attachments=$7,unread=$8 WHERE id=$1 AND mailbox_id=$2`, input.ID, u.ID, input.Name, input.From, input.To, input.Subject, input.HasAttachments, input.Unread)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return &service.Error{Status: 404, Message: "Filter not found"}
	}
	return respond(w, 200, input)
}

// deleteWebmailFilter removes a saved view, never any captured messages.
func (s *Server) deleteWebmailFilter(w http.ResponseWriter, r *http.Request, u mailboxUser) error {
	result, err := s.Service.DB.Exec(r.Context(), `DELETE FROM webmail_filters WHERE id=$1 AND mailbox_id=$2`, r.PathValue("filter"), u.ID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return &service.Error{Status: 404, Message: "Filter not found"}
	}
	return respond(w, 200, map[string]bool{"ok": true})
}
