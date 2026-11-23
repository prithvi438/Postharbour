package httpapi_test

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"postharbor/internal/config"
	"postharbor/internal/httpapi"
	"postharbor/internal/mail"
	"postharbor/internal/model"
	"postharbor/internal/service"
	"postharbor/internal/webmail"
	"strings"
	"sync"
	"testing"
)

// TestWebmailIsolationAndCompose exercises mailbox auth against real PostgreSQL
// with a capture-only Mailpit contract server. No external mail is contacted.
func TestWebmailIsolationAndCompose(t *testing.T) {
	_, db := setup(t)
	var mu sync.Mutex
	var sent map[string]any
	var outage bool
	detailReads := map[string]int{}
	address := func(email string) map[string]string {
		return map[string]string{"Name": "Test person", "Address": email}
	}
	fixture := func(id, from string, to ...string) map[string]any {
		recipients := []map[string]string{}
		for _, a := range to {
			recipients = append(recipients, address(a))
		}
		return map[string]any{"ID": id, "From": address(from), "To": recipients, "Subject": "Message " + id, "Snippet": "Plain preview", "Created": "2026-11-22T10:00:00Z", "Attachments": 1}
	}
	captures := []map[string]any{
		fixture("incoming", "customer@outside.test", "alex@studio.test"),
		fixture("sent", "alex@studio.test", "hello@studio.test"),
		fixture("private", "other@private.test", "secret@private.test"),
		fixture("shared", "team@outside.test", "alex@studio.test", "hello@studio.test"),
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if outage {
			http.Error(w, "unavailable", 503)
			return
		}
		switch {
		case r.URL.Path == "/api/v1/messages":
			json.NewEncoder(w).Encode(map[string]any{"messages": captures})
		case r.URL.Path == "/api/v1/send":
			json.NewDecoder(r.Body).Decode(&sent)
			json.NewEncoder(w).Encode(map[string]any{"ID": "new-message"})
		case strings.HasSuffix(r.URL.Path, "/headers"):
			id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/v1/message/"), "/headers")
			detailReads[id+"/headers"]++
			fields := map[string][]string{"Message-Id": {"<" + id + "@studio.test>"}}
			if id == "sent" {
				fields["In-Reply-To"] = []string{"<incoming@studio.test>"}
			}
			json.NewEncoder(w).Encode(fields)
		case strings.HasSuffix(r.URL.Path, "/part/1.2"):
			w.Write([]byte("attachment body"))
		case strings.HasSuffix(r.URL.Path, "/part/1.3"):
			w.Write([]byte("\x89PNG\r\n\x1a\n"))
		case strings.HasPrefix(r.URL.Path, "/api/v1/message/"):
			id := strings.TrimPrefix(r.URL.Path, "/api/v1/message/")
			detailReads[id]++
			json.NewEncoder(w).Encode(map[string]any{"Text": "Hello, world!", "HTML": "<script>bad()</script>", "MessageID": "original@studio.test", "Attachments": []map[string]any{{"PartID": "1.2", "FileName": "sample.txt", "Size": 15, "ContentType": "image/png"}, {"PartID": "1.3", "FileName": "photo.png", "Size": 8, "ContentType": "image/png"}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	cfg := config.Config{Origin: "http://localhost:5173", Mode: "simulation", MaxMailboxes: 5, MailpitURL: upstream.URL}
	svc := &service.Service{DB: db, Mail: mail.Simulation{}, DNS: emptyDNS{}, Config: cfg}
	h := httpapi.New(svc)
	owner := login(t, h, "owner@example.test", "test-owner-password")
	w := owner.request("POST", "/api/tenants", map[string]any{"name": "Webmail business", "admin_name": "Admin", "admin_email": "admin@studio.test", "password": "business-password", "max_mailboxes": 3, "quota_mb": 3000})
	want(t, w, 201)
	var tenant model.Tenant
	json.Unmarshal(w.Body.Bytes(), &tenant)
	base := "/api/tenants/" + tenant.ID
	w = owner.request("POST", base+"/domains", map[string]string{"name": "studio.test"})
	want(t, w, 201)
	var domain model.Domain
	json.Unmarshal(w.Body.Bytes(), &domain)
	want(t, owner.request("POST", base+"/domains/"+domain.ID+"/verify", map[string]bool{"simulate": true}), 200)
	boxes := map[string]model.Mailbox{}
	for _, local := range []string{"alex", "hello"} {
		w = owner.request("POST", base+"/mailboxes", map[string]any{"domain_id": domain.ID, "local_part": local, "name": local, "password": "mailbox-password", "quota_mb": 500})
		want(t, w, 201)
		var box model.Mailbox
		json.Unmarshal(w.Body.Bytes(), &box)
		boxes[local] = box
	}
	anonymous := client{handler: h}
	want(t, anonymous.request("GET", "/api/webmail/messages", nil), 401)
	want(t, owner.request("GET", "/api/webmail/messages", nil), 401)
	want(t, anonymous.request("POST", "/api/webmail/login", map[string]string{"email": "alex@studio.test", "password": "wrong-password"}), 401)
	mailLogin := func(email, password string) client {
		t.Helper()
		c := client{handler: h}
		w := c.request("POST", "/api/webmail/login", map[string]string{"email": email, "password": password})
		want(t, w, 200)
		var data struct {
			CSRF string `json:"csrf"`
		}
		json.Unmarshal(w.Body.Bytes(), &data)
		cookies := w.Result().Cookies()
		if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].Path != "/api/webmail" || cookies[0].SameSite != http.SameSiteStrictMode {
			t.Fatal("mailbox cookie is not protected")
		}
		c.cookie = cookies[0]
		c.csrf = data.CSRF
		return c
	}
	alex := mailLogin("alex@studio.test", "mailbox-password")
	hello := mailLogin("hello@studio.test", "mailbox-password")
	want(t, alex.request("GET", "/api/tenants", nil), 401)
	want(t, alex.request("GET", "/api/webmail/session", nil), 200)
	list := func(c client, folder string) []webmail.Summary {
		t.Helper()
		w := c.request("GET", "/api/webmail/messages?folder="+folder, nil)
		want(t, w, 200)
		var result struct {
			Messages []webmail.Summary `json:"messages"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result.Messages
	}
	if len(list(alex, "inbox")) != 2 || len(list(alex, "sent")) != 1 {
		t.Fatal("message scope is incorrect")
	}
	want(t, alex.request("GET", "/api/webmail/messages/private", nil), 404)
	want(t, alex.request("GET", "/api/webmail/messages/private/attachments/1.2", nil), 404)
	want(t, alex.request("GET", "/api/webmail/messages/private/attachments/1.3/preview", nil), 404)
	want(t, alex.request("GET", "/api/webmail/messages/private/conversation", nil), 404)
	mu.Lock()
	privateReads := detailReads["private"]
	mu.Unlock()
	if privateReads != 0 {
		t.Fatal("unauthorized message was fetched upstream")
	}
	w = alex.request("GET", "/api/webmail/messages/incoming", nil)
	want(t, w, 200)
	if strings.Contains(w.Body.String(), "script") || !strings.Contains(w.Body.String(), "Hello, world!") {
		t.Fatal("detail did not safely expose text only")
	}
	w = alex.request("GET", "/api/webmail/messages/incoming/attachments/1.2", nil)
	want(t, w, 200)
	if w.Header().Get("Content-Type") != "application/octet-stream" || !strings.Contains(w.Header().Get("Content-Disposition"), "attachment;") {
		t.Fatal("attachment was not forced to download")
	}
	want(t, alex.request("GET", "/api/webmail/messages/incoming/attachments/not-a-part", nil), 404)
	// The file declares image/png but contains text: its label cannot enable preview.
	want(t, alex.request("GET", "/api/webmail/messages/incoming/attachments/1.2/preview", nil), 415)
	w = alex.request("GET", "/api/webmail/messages/incoming/attachments/1.3/preview", nil)
	want(t, w, 200)
	if w.Header().Get("Content-Type") != "image/png" || w.Header().Get("X-Content-Type-Options") != "nosniff" || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("image preview headers unsafe")
	}
	w = alex.request("GET", "/api/webmail/messages/incoming/conversation", nil)
	want(t, w, 200)
	var conversation webmail.Conversation
	json.Unmarshal(w.Body.Bytes(), &conversation)
	if len(conversation.Messages) != 2 {
		t.Fatalf("reply membership incorrect: %s", w.Body.String())
	}
	mu.Lock()
	privateHeaders := detailReads["private/headers"]
	mu.Unlock()
	if privateHeaders != 0 {
		t.Fatal("private message headers fetched during threading")
	}
	noCSRF := alex
	noCSRF.csrf = "wrong"
	want(t, noCSRF.request("POST", "/api/webmail/messages/shared/read", nil), 403)
	want(t, alex.request("POST", "/api/webmail/messages/shared/read", nil), 200)
	for _, m := range list(alex, "inbox") {
		if m.ID == "shared" && !m.Read {
			t.Fatal("read state missing")
		}
	}
	for _, m := range list(hello, "inbox") {
		if m.ID == "shared" && m.Read {
			t.Fatal("read state leaked between users")
		}
	}
	message := map[string]string{"to": "hello@studio.test", "subject": "Local message", "text": "A captured message"}
	want(t, noCSRF.request("POST", "/api/webmail/send", message), 403)
	want(t, alex.request("POST", "/api/webmail/send", message), 200)
	mu.Lock()
	sender := sent["From"].(map[string]any)["Email"]
	mu.Unlock()
	if sender != "alex@studio.test" {
		t.Fatal("authenticated sender not enforced")
	}
	attached := map[string]any{"to": "hello@studio.test", "subject": "A photo", "text": "", "attachments": []map[string]string{{"name": "photo.png", "content_type": "image/png", "content_base64": base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\n"))}}}
	want(t, alex.request("POST", "/api/webmail/send", attached), 200)
	mu.Lock()
	attachment := sent["Attachments"].([]any)[0].(map[string]any)
	mu.Unlock()
	if attachment["Filename"] != "photo.png" {
		t.Fatal("upload not included in capture")
	}
	attached["attachments"] = []map[string]string{{"name": "bad.txt", "content_base64": "!notbase64!"}}
	want(t, alex.request("POST", "/api/webmail/send", attached), 400)
	attached["attachments"] = []map[string]string{{"name": "large.bin", "content_base64": base64.StdEncoding.EncodeToString(make([]byte, webmail.MaxUploadBytes+1))}}
	want(t, alex.request("POST", "/api/webmail/send", attached), 413)
	message["from"] = "spoof@studio.test"
	want(t, alex.request("POST", "/api/webmail/send", message), 400)
	delete(message, "from")
	message["to"] = "person@example.com"
	want(t, alex.request("POST", "/api/webmail/send", message), 400)
	message["to"] = "hello@studio.test"
	message["reply_to"] = "private"
	want(t, alex.request("POST", "/api/webmail/send", message), 404)
	message["reply_to"] = "incoming"
	want(t, alex.request("POST", "/api/webmail/send", message), 200)
	mu.Lock()
	reference := sent["Headers"].(map[string]any)["In-Reply-To"]
	mu.Unlock()
	if reference != "<original@studio.test>" {
		t.Fatal("reply reference missing")
	}
	// Settings persist per mailbox, enforce CSRF and reject a stale revision.
	settings := map[string]any{"revision": 0, "avatar": "", "signature": "<p>Easyhai signature</p>", "signature_enabled": true, "templates": []map[string]string{{"id": "welcome", "name": "Welcome", "subject": "Hello", "html": "<p onclick=bad()>Welcome</p>"}}}
	want(t, owner.request("GET", "/api/webmail/settings", nil), 401)
	want(t, noCSRF.request("PUT", "/api/webmail/settings", settings), 403)
	want(t, alex.request("PUT", "/api/webmail/settings", settings), 200)
	want(t, alex.request("PUT", "/api/webmail/settings", settings), 409)
	w = alex.request("GET", "/api/webmail/settings", nil)
	if strings.Contains(w.Body.String(), "onclick") || !strings.Contains(w.Body.String(), "Welcome") {
		t.Fatal("settings sanitization failed")
	}
	w = hello.request("GET", "/api/webmail/settings", nil)
	if strings.Contains(w.Body.String(), "Easyhai signature") {
		t.Fatal("settings crossed mailbox boundary")
	}
	want(t, alex.request("POST", "/api/webmail/send", map[string]string{"to": "hello@studio.test", "subject": "Signed", "text": "Hello"}), 200)
	mu.Lock()
	signed := sent["Text"].(string)
	mu.Unlock()
	if strings.Count(signed, "Easyhai signature") != 1 {
		t.Fatal("saved signature was not added exactly once")
	}
	want(t, alex.request("POST", "/api/webmail/send", map[string]any{"to": "hello@studio.test", "subject": "Unsigned", "text": "Hello", "include_signature": false}), 200)
	mu.Lock()
	unsigned := sent["Text"].(string)
	mu.Unlock()
	if strings.Contains(unsigned, "Easyhai signature") {
		t.Fatal("per-message signature opt-out ignored")
	}
	w = alex.request("GET", "/api/webmail/people?peer=customer%40outside.test&subject=Re%3A%20message%20incoming", nil)
	want(t, w, 200)
	var personThread webmail.Conversation
	json.Unmarshal(w.Body.Bytes(), &personThread)
	if len(personThread.Messages) != 1 || personThread.Messages[0].ID != "incoming" {
		t.Fatal("person subject grouping incorrect")
	}
	w = alex.request("GET", "/api/webmail/people?peer=other%40private.test&subject=Message%20private", nil)
	want(t, w, 200)
	json.Unmarshal(w.Body.Bytes(), &personThread)
	if len(personThread.Messages) != 0 {
		t.Fatal("person grouping leaked another mailbox")
	}
	want(t, owner.request("PUT", "/api/account/profile", map[string]string{"avatar": "data:image/svg+xml;base64,PHN2Zz4="}), 400)
	want(t, owner.request("PUT", "/api/account/profile", map[string]string{"avatar": ""}), 200)
	// Saved view writes are scoped by the cookie's mailbox, never a browser owner ID.

	// Address books, groups, and flags persist privately with optimistic revision checks.
	book := map[string]any{"revision": 0, "contacts": []map[string]any{{"id": "c1", "name": "Team", "email": "hello@studio.test"}}, "groups": []map[string]any{{"id": "g1", "name": "Club", "members": []string{"c1"}}}, "flags": map[string]any{"incoming": map[string]bool{"starred": true, "archived": true}}}
	want(t, alex.request("PUT", "/api/webmail/organizer", book), 200)
	want(t, alex.request("PUT", "/api/webmail/organizer", book), 409)
	w = hello.request("GET", "/api/webmail/organizer", nil)
	want(t, w, 200)
	if strings.Contains(w.Body.String(), "Club") {
		t.Fatal("address book leaked")
	}
	book["revision"] = 1
	want(t, alex.request("PUT", "/api/webmail/organizer", book), 200)
	book["revision"] = 2
	book["groups"] = []map[string]any{{"id": "g2", "name": "Invalid", "members": []string{"foreign"}}}
	want(t, alex.request("PUT", "/api/webmail/organizer", book), 400)
	filter := map[string]any{"name": "Photos from Alex", "from": "alex@studio.test", "to": "", "subject": "", "has_attachments": true, "unread": false}
	want(t, noCSRF.request("POST", "/api/webmail/filters", filter), 403)
	w = alex.request("POST", "/api/webmail/filters", filter)
	want(t, w, 201)
	var saved struct {
		ID string `json:"id"`
	}
	json.Unmarshal(w.Body.Bytes(), &saved)
	w = hello.request("GET", "/api/webmail/filters", nil)
	want(t, w, 200)
	if strings.Contains(w.Body.String(), saved.ID) {
		t.Fatal("saved filter leaked")
	}
	want(t, hello.request("PUT", "/api/webmail/filters/"+saved.ID, filter), 404)
	want(t, hello.request("DELETE", "/api/webmail/filters/"+saved.ID, nil), 404)
	filter["name"] = "Renamed photos"
	want(t, alex.request("PUT", "/api/webmail/filters/"+saved.ID, filter), 200)
	w = alex.request("GET", "/api/webmail/filters", nil)
	want(t, w, 200)
	if !strings.Contains(w.Body.String(), "Renamed photos") {
		t.Fatal("filter update missing")
	}
	for i := 1; i < 20; i++ {
		want(t, alex.request("POST", "/api/webmail/filters", filter), 201)
	}
	want(t, alex.request("POST", "/api/webmail/filters", filter), 409)
	want(t, alex.request("DELETE", "/api/webmail/filters/"+saved.ID, nil), 200)
	want(t, alex.request("DELETE", "/api/webmail/filters/"+saved.ID, nil), 404)
	filter["name"] = " "
	want(t, alex.request("POST", "/api/webmail/filters", filter), 400)
	mu.Lock()
	outage = true
	mu.Unlock()
	want(t, alex.request("GET", "/api/webmail/messages", nil), 503)
	mu.Lock()
	outage = false
	mu.Unlock()
	want(t, owner.request("POST", base+"/mailboxes/"+boxes["alex"].ID+"/password", map[string]string{"password": "new-mailbox-password"}), 200)
	want(t, alex.request("GET", "/api/webmail/session", nil), 401)
	want(t, anonymous.request("POST", "/api/webmail/login", map[string]string{"email": "alex@studio.test", "password": "mailbox-password"}), 401)
	alex = mailLogin("alex@studio.test", "new-mailbox-password")
	want(t, owner.request("DELETE", base+"/mailboxes/"+boxes["alex"].ID, map[string]string{"confirm": "alex@studio.test"}), 200)
	want(t, alex.request("GET", "/api/webmail/session", nil), 401)
	cfg.Mode = "stalwart"
	live := client{handler: httpapi.New(&service.Service{DB: db, Config: cfg})}
	// Live webmail now exists, but stays unavailable until its encryption key is configured.
	want(t, live.request("POST", "/api/webmail/login", map[string]string{"email": "hello@studio.test", "password": "mailbox-password"}), 503)
}

// TestWebmailDisabledByDefault proves the normal admin server does not implicitly expose captures.
func TestWebmailDisabledByDefault(t *testing.T) {
	h := httpapi.New(&service.Service{Config: config.Config{Mode: "simulation", Origin: "http://localhost:5173"}})
	want(t, (client{handler: h}).request("GET", "/api/webmail/session", nil), 503)
}
