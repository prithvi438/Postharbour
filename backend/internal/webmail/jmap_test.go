package webmail

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestSessionEncryption proves database ciphertext cannot be copied to another
// session, read with a rotated key, or modified without detection.
func TestSessionEncryption(t *testing.T) {
	key := strings.Repeat("ab", 32)
	original := Credentials{Username: "info@example.com", Password: "private-password", Account: "a"}
	sealed, err := SealCredentials(key, "session-a", original)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sealed, original.Password) {
		t.Fatal("plaintext credential leaked")
	}
	decoded, err := OpenCredentials(key, "session-a", sealed)
	if err != nil || decoded != original {
		t.Fatal("round trip failed", err)
	}
	for _, input := range []struct{ key, session, value string }{{key, "session-b", sealed}, {strings.Repeat("cd", 32), "session-a", sealed}, {key, "session-a", sealed[:len(sealed)-4] + "AAAA"}} {
		if _, err := OpenCredentials(input.key, input.session, input.value); err == nil {
			t.Fatal("accepted altered session")
		}
	}
}

// TestLiveMailboxMembership covers Bcc/aliases and forged From headers: engine
// account ownership and folder roles decide access, not untrusted email headers.
func TestLiveMailboxMembership(t *testing.T) {
	c := NewJMAP("https://mail.example.com", Credentials{Username: "info@example.com"})
	m := c.summary(jmapEmail{ID: "1", From: []jmapAddress{{Email: "info@example.com"}}, MailboxIDs: map[string]bool{"in": true}}, map[string]string{"inbox": "in", "sent": "out"})
	if !m.ReceivedBy("info@example.com") || !m.VisibleTo("info@example.com") || m.SentBy("info@example.com") || m.VisibleTo("other@example.com") {
		t.Fatal("incorrect account/folder isolation")
	}
}

// TestJMAPRejectsForeignDiscovery keeps discovered attachment URLs from becoming
// credential-bearing SSRF, including a host on the same port with a different name.
func TestJMAPRejectsForeignDiscovery(t *testing.T) {
	c := NewJMAP("https://mail.example.com", Credentials{Username: "u", Password: "p"})
	for _, target := range []string{"https://evil.example/upload", "http://mail.example.com/upload", "https://user@mail.example.com/upload"} {
		if _, err := c.request(context.Background(), "POST", target, "text/plain", []byte("hello")); err == nil {
			t.Fatalf("accepted %s", target)
		}
	}
}

// TestJMAPSubmissionAcceptsAdditionalResult covers the implicit Email/set result
// returned after a successful submission with onSuccessUpdateEmail.
func TestJMAPSubmissionAcceptsAdditionalResult(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, password, ok := r.BasicAuth()
		if !ok || user != "info@example.com" || password != "secret" {
			t.Error("missing mailbox authentication")
		}
		json.NewEncoder(w).Encode(map[string]any{"methodResponses": []any{[]any{"EmailSubmission/set", map[string]any{"created": map[string]any{"send": map[string]string{"id": "s"}}}, "c1"}, []any{"Email/set", map[string]any{"updated": map[string]any{"email": nil}}, "c1"}}})
	}))
	defer server.Close()
	c := NewJMAP(server.URL, Credentials{Username: "info@example.com", Password: "secret", Account: "a"})
	c.http = server.Client()
	result, err := c.call(context.Background(), "EmailSubmission/set", map[string]any{})
	if err != nil || len(result["created"]) == 0 {
		t.Fatal("submission result rejected", err)
	}
}
