package httpapi

import (
	"net/http"
	"postharbor/internal/service"
	"postharbor/internal/webmail"
	"sort"
	"strings"
)

// webmailPersonConversation groups already-authorized emails by person and subject.
// This is a display grouping; original message IDs and reply headers are unchanged.
func (s *Server) webmailPersonConversation(w http.ResponseWriter, r *http.Request, u mailboxUser) error {
	peer := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("peer")))
	subject := webmail.SubjectKey(r.URL.Query().Get("subject"))
	if !service.ValidEmail(peer) || len(subject) > 1000 {
		return &service.Error{Status: 400, Message: "Choose an email address and subject"}
	}
	list, err := s.mailList(r, u)
	if err != nil {
		return err
	}
	matches := []webmail.Summary{}
	for _, m := range list {
		if m.VisibleTo(u.Address) && webmail.WithPerson(m, u.Address, peer) && webmail.SubjectKey(m.Subject) == subject {
			matches = append(matches, m)
		}
	}
	sort.Slice(matches, func(i, j int) bool {
		if matches[i].Date == matches[j].Date {
			return matches[i].ID < matches[j].ID
		}
		return matches[i].Date < matches[j].Date
	})
	out := webmail.Conversation{Messages: []webmail.Detail{}, Truncated: len(matches) > 50}
	if len(matches) > 50 {
		matches = matches[len(matches)-50:]
	}
	for _, m := range matches {
		d, e := u.mail.Detail(r.Context(), m)
		if e != nil {
			return captureUnavailable()
		}
		out.Messages = append(out.Messages, d)
	}
	return respond(w, 200, out)
}
