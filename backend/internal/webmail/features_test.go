package webmail

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// TestUploadValidation checks decoded byte limits and untrusted metadata before send.
func TestUploadValidation(t *testing.T) {
	files := []Upload{{Name: `C:\fakepath\photo.png`, ContentType: "image/png", ContentBase64: base64.StdEncoding.EncodeToString([]byte("file bytes"))}}
	if err := ValidateUploads(files); err != nil || files[0].Name != "photo.png" {
		t.Fatalf("normalization: %v, %+v", err, files)
	}
	for _, file := range []Upload{
		{Name: "bad\nname", ContentBase64: ""}, {Name: ".."}, {Name: "fine", ContentType: "image/png\r\nBad: x"},
		{Name: "fine", ContentType: "nonsense"}, {Name: "fine", ContentBase64: "not base64!"},
	} {
		if ValidateUploads([]Upload{file}) == nil {
			t.Fatalf("invalid file accepted: %+v", file)
		}
	}
	if ValidateUploads(make([]Upload, 11)) == nil {
		t.Fatal("file count not bounded")
	}
	data := base64.StdEncoding.EncodeToString(make([]byte, MaxUploadBytes))
	if err := ValidateUploads([]Upload{{Name: "maximum.bin", ContentBase64: data}}); err != nil {
		t.Fatal(err)
	}
	if err := ValidateUploads([]Upload{{Name: "maximum.bin", ContentBase64: data}, {Name: "extra", ContentBase64: "YQ=="}}); !errors.Is(err, ErrUploadSize) {
		t.Fatalf("aggregate decoded limit: %v", err)
	}
	if PreviewType([]byte("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")) != "" || PreviewType([]byte("<html>not a photo</html>")) != "" {
		t.Fatal("active content allowed inline")
	}
	if PreviewType([]byte("\x89PNG\r\n\x1a\n")) != "image/png" {
		t.Fatal("PNG not recognized")
	}
}

// TestConversationReferences verifies reply graph membership, ordering, bounded
// immutable-header caching, and a real send-payload attachment contract.
func TestConversationReferences(t *testing.T) {
	var mu sync.Mutex
	headerReads := 0
	var payload map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/v1/send" {
			json.NewDecoder(r.Body).Decode(&payload)
			json.NewEncoder(w).Encode(map[string]string{"ID": "captured"})
			return
		}
		id := strings.TrimPrefix(r.URL.Path, "/api/v1/message/")
		if strings.HasSuffix(id, "/headers") {
			mu.Lock()
			headerReads++
			mu.Unlock()
			id = strings.TrimSuffix(id, "/headers")
			fields := map[string][]string{"Message-Id": {"<" + id + "@test>"}}
			if id == "reply" {
				fields["In-Reply-To"] = []string{"<root@test>"}
			}
			if id == "next" {
				fields["References"] = []string{"<root@test> <reply@test>"}
			}
			json.NewEncoder(w).Encode(fields)
			return
		}
		text := "Message " + id
		if id == "root" {
			text = strings.Repeat("a", 100_100)
		}
		json.NewEncoder(w).Encode(map[string]any{"Text": text, "MessageID": id + "@test", "Attachments": []any{}})
	}))
	defer upstream.Close()
	c := New(upstream.URL)
	visible := []Summary{
		{ID: "next", Subject: "Same subject", Date: "2026-11-22T03:00:00Z"},
		{ID: "unrelated", Subject: "Same subject", Date: "2026-11-22T02:30:00Z"},
		{ID: "reply", Subject: "Changed subject", Date: "2026-11-22T02:00:00Z"},
		{ID: "root", Subject: "Same subject", Date: "2026-11-22T01:00:00Z"},
	}
	c.pruneMetadata(visible)
	thread, err := c.Conversation(context.Background(), visible, "reply")
	if err != nil {
		t.Fatal(err)
	}
	if len(thread.Messages) != 3 || thread.Messages[0].ID != "root" || thread.Messages[2].ID != "next" {
		t.Fatalf("wrong thread: %+v", thread)
	}
	if !thread.Messages[0].TextTruncated || len(thread.Messages[0].Text) != 100_000 {
		t.Fatal("display body not bounded")
	}
	_, err = c.Conversation(context.Background(), visible, "root")
	if err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	count := headerReads
	mu.Unlock()
	if count != 4 {
		t.Fatalf("headers fetched repeatedly: %d", count)
	}
	c.pruneMetadata(visible[:1])
	if len(c.metadata) != 1 {
		t.Fatal("removed capture references retained")
	}
	files := []Upload{{Name: "note.txt", ContentType: "text/plain", ContentBase64: "aGVsbG8="}}
	id, err := c.Send(context.Background(), Address{Address: "alex@harbor.test"}, []string{"hello@harbor.test"}, "Attachment", "", "root@test", files)
	if err != nil {
		t.Fatal(err)
	}
	if id != "captured" {
		t.Fatalf("send returned wrong capture ID: %s", id)
	}
	file := payload["Attachments"].([]any)[0].(map[string]any)
	if file["Content"] != "aGVsbG8=" || file["Filename"] != "note.txt" || file["ContentType"] != "text/plain" {
		t.Fatalf("invalid Mailpit attachment payload: %+v", file)
	}
}
