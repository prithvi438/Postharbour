package webmail

import "strings"

// SubjectKey treats repeated reply prefixes as one topic; forwards remain distinct.
func SubjectKey(subject string) string {
	s := strings.TrimSpace(subject)
	for len(s) >= 3 && strings.EqualFold(s[:3], "re:") {
		s = strings.TrimSpace(s[3:])
	}
	return strings.ToLower(s)
}

// WithPerson matches exact visible addresses. Group emails may appear under each
// visible recipient; hidden recipients are never added to the correspondent list.
func WithPerson(m Summary, owner, peer string) bool {
	if !strings.EqualFold(m.From.Address, owner) {
		return strings.EqualFold(m.From.Address, peer)
	}
	for _, to := range m.To {
		if strings.EqualFold(to.Address, peer) {
			return true
		}
	}
	return false
}
