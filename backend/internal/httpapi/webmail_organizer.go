package httpapi

import (
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"net/http"
	"postharbor/internal/service"
	"strings"
)

type contact struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}
type contactGroup struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Members []string `json:"members"`
}
type messageFlags struct {
	Starred  bool `json:"starred"`
	Archived bool `json:"archived"`
}
type organizer struct {
	Revision int                     `json:"revision"`
	Contacts []contact               `json:"contacts"`
	Groups   []contactGroup          `json:"groups"`
	Flags    map[string]messageFlags `json:"flags"`
}

// webmailOrganizer reads or atomically replaces this mailbox's private address book.
// Revision checks prevent a second tab from silently overwriting newer changes.
func (s *Server) webmailOrganizer(w http.ResponseWriter, r *http.Request, u mailboxUser) error {
	if r.Method == "GET" {
		var data []byte
		var revision int
		err := s.Service.DB.QueryRow(r.Context(), `SELECT data,revision FROM webmail_organizer WHERE mailbox_id=$1`, u.ID).Scan(&data, &revision)
		if err == pgx.ErrNoRows {
			return respond(w, 200, organizer{Contacts: []contact{}, Groups: []contactGroup{}, Flags: map[string]messageFlags{}})
		}
		if err != nil {
			return err
		}
		var out organizer
		if err = json.Unmarshal(data, &out); err != nil {
			return err
		}
		out.Revision = revision
		return respond(w, 200, out)
	}
	var in organizer
	if err := decodeLimit(w, r, &in, 256<<10); err != nil {
		return err
	}
	bad := func() error {
		return &service.Error{Status: 400, Message: "Use unique contacts (up to 500), groups (up to 50, with 1–10 contacts), and valid email addresses"}
	}
	if in.Revision < 0 || len(in.Contacts) > 500 || len(in.Groups) > 50 || len(in.Flags) > 1000 {
		return bad()
	}
	if in.Contacts == nil {
		in.Contacts = []contact{}
	}
	if in.Groups == nil {
		in.Groups = []contactGroup{}
	}
	if in.Flags == nil {
		in.Flags = map[string]messageFlags{}
	}
	ids := map[string]bool{}
	for i := range in.Contacts {
		c := &in.Contacts[i]
		c.Email = strings.ToLower(strings.TrimSpace(c.Email))
		c.Name = strings.TrimSpace(c.Name)
		if c.ID == "" || len(c.ID) > 80 || ids[c.ID] || len(c.Name) > 120 || c.Name == "" || !service.ValidEmail(c.Email) {
			return bad()
		}
		ids[c.ID] = true
	}
	groups := map[string]bool{}
	for _, g := range in.Groups {
		if g.ID == "" || len(g.ID) > 80 || groups[g.ID] || strings.TrimSpace(g.Name) == "" || len(g.Name) > 120 || len(g.Members) < 1 || len(g.Members) > 10 {
			return bad()
		}
		groups[g.ID] = true
		members := map[string]bool{}
		for _, id := range g.Members {
			if !ids[id] || members[id] {
				return bad()
			}
			members[id] = true
		}
	}
	for id := range in.Flags {
		if id == "" || len(id) > 200 {
			return bad()
		}
	}
	// Flags contain no bodies and grant no access; every message API still checks ownership.
	data, err := json.Marshal(in)
	if err != nil {
		return err
	}
	result, err := s.Service.DB.Exec(r.Context(), `INSERT INTO webmail_organizer(mailbox_id,revision,data) SELECT $1,1,$2 WHERE $3=0 ON CONFLICT(mailbox_id) DO UPDATE SET data=$2,revision=webmail_organizer.revision+1 WHERE webmail_organizer.revision=$3`, u.ID, data, in.Revision)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		// Existing rows with revision >0 use a separate conditional update.
		result, err = s.Service.DB.Exec(r.Context(), `UPDATE webmail_organizer SET data=$2,revision=revision+1 WHERE mailbox_id=$1 AND revision=$3`, u.ID, data, in.Revision)
		if err != nil {
			return err
		}
		if result.RowsAffected() == 0 {
			return &service.Error{Status: 409, Message: "Contacts changed in another tab. Refresh before editing again"}
		}
	}
	in.Revision++
	return respond(w, 200, in)
}
