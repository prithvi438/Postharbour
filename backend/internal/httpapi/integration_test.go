package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"postharbor/internal/config"
	"postharbor/internal/httpapi"
	"postharbor/internal/mail"
	"postharbor/internal/model"
	"postharbor/internal/service"
	"postharbor/internal/store"
	"sync"
	"testing"
)

// emptyDNS makes ownership verification deterministic and never contacts the internet.
type emptyDNS struct{}

func (emptyDNS) LookupTXT(context.Context, string) ([]string, error) { return nil, nil }
func (emptyDNS) LookupMX(context.Context, string) ([]*net.MX, error) { return nil, nil }

type client struct {
	handler http.Handler
	cookie  *http.Cookie
	csrf    string
}

// request drives the real middleware/handlers through an in-memory HTTP exchange.
func (c client) request(method, path string, body any) *httptest.ResponseRecorder {
	data, _ := json.Marshal(body)
	r := httptest.NewRequest(method, path, bytes.NewReader(data))
	r.RemoteAddr = "127.0.0.1:1234"
	r.Header.Set("Origin", "http://localhost:5173")
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-CSRF-Token", c.csrf)
	if c.cookie != nil {
		r.AddCookie(c.cookie)
	}
	w := httptest.NewRecorder()
	c.handler.ServeHTTP(w, r)
	return w
}

// login returns an authenticated test client and asserts cookie security properties.
func login(t *testing.T, h http.Handler, email, password string) client {
	t.Helper()
	c := client{handler: h}
	w := c.request("POST", "/api/login", map[string]string{"email": email, "password": password})
	want(t, w, 200)
	var result struct {
		CSRF string `json:"csrf"`
	}
	json.Unmarshal(w.Body.Bytes(), &result)
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatal("session cookie is not protected")
	}
	c.cookie = cookies[0]
	c.csrf = result.CSRF
	return c
}

// want gives failed integration assertions the HTTP error body for diagnosis.
func want(t *testing.T, w *httptest.ResponseRecorder, status int) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("want %d, got %d: %s", status, w.Code, w.Body.String())
	}
}

// setup creates and later drops an isolated schema, never truncating existing tables.
func setup(t *testing.T, providers ...mail.Provider) (http.Handler, *store.DB) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL integration tests")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "test_" + store.ID()
	if _, err = admin.Exec(ctx, `CREATE SCHEMA `+pgx.Identifier{schema}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := store.Open(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db.Close()
		admin.Exec(ctx, `DROP SCHEMA `+pgx.Identifier{schema}.Sanitize()+` CASCADE`)
		admin.Close(ctx)
	})
	cfg := config.Config{Origin: "http://localhost:5173", Mode: "simulation", MaxMailboxes: 5, BootstrapEmail: "owner@example.test", BootstrapPassword: "test-owner-password", MailHost: "mail.example.test"}
	svc := &service.Service{DB: db, Mail: mail.Simulation{}, DNS: emptyDNS{}, Config: cfg}
	if len(providers) > 0 {
		svc.Mail = providers[0]
	}
	if err = svc.Bootstrap(ctx); err != nil {
		t.Fatal(err)
	}
	return httpapi.New(svc), db
}

// flakyProvider represents a mail-engine outage without replacing real database work.
type flakyProvider struct {
	mail.Simulation
	calls int
}

// EnsureMailbox fails once so the test can verify durable pending-state recovery.
func (p *flakyProvider) EnsureMailbox(ctx context.Context, tenant model.Tenant, domain model.Domain, mailbox model.Mailbox, hash string) (string, error) {
	p.calls++
	if p.calls == 1 {
		return "", errors.New("simulated provider outage")
	}
	return p.Simulation.EnsureMailbox(ctx, tenant, domain, mailbox, hash)
}

// TestProviderFailureLeavesRetryableReservation verifies that failed remote calls
// cannot silently drop records, bypass capacity accounting, or duplicate mailboxes.
func TestProviderFailureLeavesRetryableReservation(t *testing.T) {
	h, _ := setup(t, &flakyProvider{})
	owner := login(t, h, "owner@example.test", "test-owner-password")
	w := owner.request("POST", "/api/tenants", map[string]any{"name": "Retry business", "admin_name": "Admin", "admin_email": "retry@example.test", "password": "business-password", "max_mailboxes": 1, "quota_mb": 1000})
	want(t, w, 201)
	var tenant model.Tenant
	json.Unmarshal(w.Body.Bytes(), &tenant)
	base := "/api/tenants/" + tenant.ID
	w = owner.request("POST", base+"/domains", map[string]string{"name": "retry.test"})
	want(t, w, 201)
	var domain model.Domain
	json.Unmarshal(w.Body.Bytes(), &domain)
	want(t, owner.request("POST", base+"/domains/"+domain.ID+"/verify", map[string]bool{"simulate": true}), 200)
	payload := map[string]any{"domain_id": domain.ID, "local_part": "alex", "name": "Alex", "password": "mailbox-password", "quota_mb": 500}
	want(t, owner.request("POST", base+"/mailboxes", payload), 502)
	w = owner.request("GET", base+"/mailboxes", nil)
	want(t, w, 200)
	var list []model.Mailbox
	json.Unmarshal(w.Body.Bytes(), &list)
	if len(list) != 1 || list[0].Status != "pending" {
		t.Fatal("failed operation did not leave a durable pending record")
	}
	payload["local_part"] = "another"
	want(t, owner.request("POST", base+"/mailboxes", payload), 409)
	want(t, owner.request("POST", base+"/mailboxes/"+list[0].ID+"/provision", map[string]string{"password": "mailbox-password"}), 200)
	w = owner.request("GET", base+"/mailboxes", nil)
	json.Unmarshal(w.Body.Bytes(), &list)
	if len(list) != 1 || list[0].Status != "active" {
		t.Fatal("retry did not complete the original record")
	}
}

// TestTenantIsolationAndLifecycle exercises real PostgreSQL constraints, HTTP auth,
// CSRF, domain ownership, mailbox creation, quotas, credentials, and audit scoping.
func TestTenantIsolationAndLifecycle(t *testing.T) {
	h, db := setup(t)
	anonymous := client{handler: h}
	want(t, anonymous.request("GET", "/api/tenants", nil), 401)
	owner := login(t, h, "owner@example.test", "test-owner-password")
	create := func(name, email string) model.Tenant {
		w := owner.request("POST", "/api/tenants", map[string]any{"name": name, "admin_name": name + " Admin", "admin_email": email, "password": "business-password", "max_mailboxes": 2, "quota_mb": 1000})
		want(t, w, 201)
		var result model.Tenant
		json.Unmarshal(w.Body.Bytes(), &result)
		return result
	}
	a, b := create("Business A", "a@example.test"), create("Business B", "b@example.test")
	adminA := login(t, h, "a@example.test", "business-password")
	adminB := login(t, h, "b@example.test", "business-password")
	w := adminA.request("GET", "/api/tenants", nil)
	want(t, w, 200)
	var tenants []model.Tenant
	json.Unmarshal(w.Body.Bytes(), &tenants)
	if len(tenants) != 1 || tenants[0].ID != a.ID {
		t.Fatal("tenant list leaked")
	}
	want(t, adminA.request("POST", "/api/tenants", map[string]any{}), 403)
	want(t, adminA.request("GET", "/api/tenants/"+b.ID+"/domains", nil), 404)
	base := "/api/tenants/" + a.ID
	noCSRF := adminA
	noCSRF.csrf = "wrong"
	want(t, noCSRF.request("POST", base+"/domains", map[string]string{"name": "bad.test"}), 403)
	w = adminA.request("POST", base+"/domains", map[string]string{"name": "studio.test"})
	want(t, w, 201)
	var d model.Domain
	json.Unmarshal(w.Body.Bytes(), &d)
	want(t, adminB.request("GET", base+"/domains/"+d.ID+"/dns", nil), 404)
	want(t, adminB.request("GET", "/api/tenants/"+b.ID+"/domains/"+d.ID+"/dns", nil), 404)
	want(t, adminB.request("POST", "/api/tenants/"+b.ID+"/domains", map[string]string{"name": "studio.test"}), 409)
	want(t, adminA.request("POST", base+"/domains/"+d.ID+"/verify", map[string]bool{"simulate": false}), 409)
	box := map[string]any{"domain_id": d.ID, "local_part": "alex", "name": "Alex", "password": "mailbox-password", "quota_mb": 600}
	want(t, adminA.request("POST", base+"/mailboxes", box), 409)
	want(t, adminA.request("POST", base+"/domains/"+d.ID+"/verify", map[string]bool{"simulate": true}), 200)
	// Two requests compete for 1000 MiB. Exactly one 600 MiB allocation may commit.
	responses := make(chan *httptest.ResponseRecorder, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			payload := map[string]any{"domain_id": d.ID, "local_part": fmt.Sprintf("user%d", i), "name": "User", "password": "mailbox-password", "quota_mb": 600}
			responses <- adminA.request("POST", base+"/mailboxes", payload)
		}(i)
	}
	wg.Wait()
	close(responses)
	success, limited := 0, 0
	var m model.Mailbox
	for response := range responses {
		if response.Code == 201 {
			success++
			json.Unmarshal(response.Body.Bytes(), &m)
		} else if response.Code == 409 {
			limited++
		} else {
			t.Fatal(response.Body.String())
		}
	}
	if success != 1 || limited != 1 {
		t.Fatalf("quota race: %d success, %d limited", success, limited)
	}
	want(t, adminB.request("POST", "/api/tenants/"+b.ID+"/mailboxes/"+m.ID+"/password", map[string]string{"password": "new-mailbox-password"}), 404)
	want(t, adminA.request("POST", base+"/mailboxes/"+m.ID+"/password", map[string]string{"password": "new-mailbox-password"}), 200)
	want(t, adminA.request("DELETE", base+"/mailboxes/"+m.ID, map[string]string{"confirm": "wrong"}), 400)
	want(t, adminA.request("DELETE", base+"/mailboxes/"+m.ID, map[string]string{"confirm": m.Address}), 200)
	var events string
	db.QueryRow(context.Background(), `SELECT COALESCE(json_agg(a)::text,'[]') FROM audit_events a`).Scan(&events)
	if bytes.Contains([]byte(events), []byte("mailbox-password")) {
		t.Fatal("credential leaked into audit")
	}
	w = adminB.request("GET", "/api/tenants/"+b.ID+"/audit", nil)
	want(t, w, 200)
	if bytes.Contains(w.Body.Bytes(), []byte("studio.test")) {
		t.Fatal("audit leaked another tenant")
	}
	want(t, adminA.request("POST", "/api/account/password", map[string]string{"current_password": "business-password", "new_password": "updated-business-password"}), 200)
	want(t, adminA.request("GET", "/api/session", nil), 401)
	login(t, h, "a@example.test", "updated-business-password")
}

// TestOriginAndJSONRejects checks the public login route before any cookie exists.
func TestOriginAndJSONRejects(t *testing.T) {
	h, _ := setup(t)
	r := httptest.NewRequest("POST", "/api/login", bytes.NewBufferString(`{}`))
	r.Header.Set("Origin", "https://evil.example")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	want(t, w, 403)
	c := client{handler: h}
	want(t, c.request("POST", "/api/login", map[string]string{"email": "nobody@example.com", "password": "test-password", "role": "platform_admin"}), 400)
}

// TestCommunityBusinessLimit serializes competing creation requests even when
// neither request has observed an existing business before entering the service.
func TestCommunityBusinessLimit(t *testing.T) {
	_, db := setup(t)
	svc := &service.Service{DB: db, Mail: mail.Simulation{}, Config: config.Config{Mode: "stalwart", StalwartEdition: "community", MaxMailboxes: 5}}
	owner := model.User{Role: "platform_admin", Email: "owner@example.test"}
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			_, err := svc.CreateTenant(context.Background(), owner, service.TenantInput{Name: fmt.Sprintf("Business %d", index), AdminName: "Admin", AdminEmail: fmt.Sprintf("admin%d@example.test", index), Password: "test-community-password", MaxMailboxes: 5, QuotaMB: 5120})
			results <- err
		}(i)
	}
	wg.Wait()
	close(results)
	successes, conflicts := 0, 0
	for err := range results {
		if err == nil {
			successes++
			continue
		}
		var problem *service.Error
		if errors.As(err, &problem) && problem.Status == 409 {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("want one business and one conflict, got %d/%d", successes, conflicts)
	}
}
