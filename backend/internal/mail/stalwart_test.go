package mail

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"postharbor/internal/model"
	"testing"
)

// TestJMAPFailures ensures HTTP success cannot hide a per-object protocol failure.
func TestJMAPFailures(t *testing.T) {
	for _, body := range []string{
		`{"methodResponses":[["error",{"type":"forbidden"},"c1"]]}`,
		`{"methodResponses":[["x:Account/set",{"notCreated":{"new":{"type":"invalidProperties"}}},"c1"]]}`,
		`{"methodResponses":[]}`,
	} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer test-token" {
					t.Error("missing authorization")
				}
				w.Header().Set("Content-Type", "application/json")
				w.Write([]byte(body))
			}))
			defer server.Close()
			adapter := &Stalwart{URL: server.URL, Token: "test-token", Client: server.Client()}
			if _, err := adapter.create(context.Background(), "Account", map[string]any{"name": "alice"}); err == nil {
				t.Fatal("accepted failed JMAP operation")
			}
		})
	}
}

// TestMailboxRetryAdoptsOnlyOwnedObject protects against adopting another account.
func TestMailboxRetryAdoptsOnlyOwnedObject(t *testing.T) {
	for _, owned := range []bool{true, false} {
		t.Run(map[bool]string{true: "owned", false: "foreign"}[owned], func(t *testing.T) {
			calls := 0
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request struct {
					Calls [][]json.RawMessage `json:"methodCalls"`
				}
				json.NewDecoder(r.Body).Decode(&request)
				var method string
				json.Unmarshal(request.Calls[0][0], &method)
				calls++
				var result any
				switch method {
				case "x:Account/query":
					result = map[string]any{"ids": []string{"existing"}}
				case "x:Account/get":
					marker := "app-id"
					if !owned {
						marker = "somebody-else"
					}
					result = map[string]any{"list": []any{map[string]any{"id": "existing", "emailAddress": "alice@example.com", "externalId": marker}}}
				default:
					t.Errorf("unexpected create on retry: %s", method)
				}
				json.NewEncoder(w).Encode(map[string]any{"methodResponses": []any{[]any{method, result, "c1"}}})
			}))
			defer server.Close()
			s := &Stalwart{URL: server.URL, Token: "test", Client: server.Client()}
			id, err := s.EnsureMailbox(context.Background(), model.Tenant{}, model.Domain{}, model.Mailbox{ID: "app-id", Address: "alice@example.com"}, "hash")
			if owned && (err != nil || id != "existing") {
				t.Fatalf("retry failed: %s %v", id, err)
			}
			if !owned && err == nil {
				t.Fatal("adopted foreign object")
			}
			if calls != 2 {
				t.Fatalf("expected lookup only, got %d calls", calls)
			}
		})
	}
}

// TestMailboxPayload verifies the tenant boundary and quota sent to the mail engine.
func TestMailboxPayload(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Calls [][]json.RawMessage `json:"methodCalls"`
		}
		json.NewDecoder(r.Body).Decode(&request)
		var method string
		json.Unmarshal(request.Calls[0][0], &method)
		var result any = map[string]any{"ids": []string{}}
		if method == "x:Account/set" {
			var args struct {
				Create map[string]map[string]any `json:"create"`
			}
			json.Unmarshal(request.Calls[0][1], &args)
			obj := args.Create["new"]
			if obj["memberTenantId"] != "remote-tenant" || obj["domainId"] != "remote-domain" || obj["roles"].(map[string]any)["@type"] != "User" {
				t.Errorf("incorrect isolation: %v", obj)
			}
			if obj["quotas"].(map[string]any)["maxDiskQuota"] != float64(5120*1024*1024) {
				t.Error("quota not converted to bytes")
			}
			credentials, ok := obj["credentials"].(map[string]any)
			if !ok {
				t.Fatal("Stalwart configuration lists must be numbered JSON objects")
			}
			first := credentials["0"].(map[string]any)
			if first["@type"] != "Password" || first["secret"] != "$2a$hash" {
				t.Error("incorrect credential encoding")
			}
			result = map[string]any{"created": map[string]any{"new": map[string]string{"id": "new-id"}}}
		}
		json.NewEncoder(w).Encode(map[string]any{"methodResponses": []any{[]any{method, result, "c1"}}})
	}))
	defer server.Close()
	s := &Stalwart{URL: server.URL, Token: "test", Client: server.Client()}
	id, err := s.EnsureMailbox(context.Background(), model.Tenant{ProviderID: "remote-tenant"}, model.Domain{ProviderID: "remote-domain"}, model.Mailbox{ID: "app-id", Address: "alice@example.com", QuotaMB: 5120}, "$2a$hash")
	if err != nil || id != "new-id" {
		t.Fatalf("create: %s %v", id, err)
	}
}
