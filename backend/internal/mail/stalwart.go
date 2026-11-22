package mail

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"postharbor/internal/model"
	"strings"
	"time"
)

// Stalwart implements the documented x:Tenant/x:Domain/x:Account JMAP API.
// It requires Enterprise tenancy. Older /api/principal releases are incompatible.
type Stalwart struct {
	URL, Token string
	Client     *http.Client
}

// NewStalwart sets bounded request times and refuses credential-bearing redirects.
func NewStalwart(url, token string) *Stalwart {
	return &Stalwart{strings.TrimRight(url, "/") + "/jmap/", token, &http.Client{
		Timeout:       12 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

// call checks both HTTP errors and JMAP method errors. Responses are never logged
// because a mail engine may include sensitive fields in its error descriptions.
func (s *Stalwart) call(ctx context.Context, method string, args map[string]any) (map[string]json.RawMessage, error) {
	payload, err := json.Marshal(map[string]any{
		"using":       []string{"urn:ietf:params:jmap:core", "urn:stalwart:jmap"},
		"methodCalls": []any{[]any{method, args, "c1"}},
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.URL, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+s.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.Client.Do(req)
	if err != nil {
		return nil, errors.New("mail provider request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("mail provider returned HTTP %d", resp.StatusCode)
	}
	var envelope struct {
		MethodResponses [][]json.RawMessage `json:"methodResponses"`
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&envelope); err != nil {
		return nil, errors.New("invalid mail provider response")
	}
	if len(envelope.MethodResponses) != 1 || len(envelope.MethodResponses[0]) != 3 {
		return nil, errors.New("missing JMAP response")
	}
	var returned, tag string
	json.Unmarshal(envelope.MethodResponses[0][0], &returned)
	json.Unmarshal(envelope.MethodResponses[0][2], &tag)
	if returned != method || tag != "c1" {
		return nil, errors.New("mail provider rejected operation; check API permissions and Enterprise license")
	}
	var result map[string]json.RawMessage
	if err = json.Unmarshal(envelope.MethodResponses[0][1], &result); err != nil {
		return nil, err
	}
	return result, nil
}

// find resolves a retry to an existing object, but only when our ownership marker
// matches. It never adopts unrelated, manually created mail-engine objects.
func (s *Stalwart) find(ctx context.Context, kind, text, field, value, markerField, marker string) (string, error) {
	r, err := s.call(ctx, "x:"+kind+"/query", map[string]any{"filter": map[string]any{"text": text}, "limit": 100})
	if err != nil {
		return "", err
	}
	var ids []string
	if err = json.Unmarshal(r["ids"], &ids); err != nil {
		return "", err
	}
	if len(ids) == 0 {
		return "", nil
	}
	r, err = s.call(ctx, "x:"+kind+"/get", map[string]any{"ids": ids})
	if err != nil {
		return "", err
	}
	var objects []map[string]any
	if err = json.Unmarshal(r["list"], &objects); err != nil {
		return "", err
	}
	for _, object := range objects {
		if object[field] == value {
			if markerField != "" && object[markerField] != marker {
				return "", errors.New("mail object exists outside this application's ownership")
			}
			id, _ := object["id"].(string)
			if id == "" {
				return "", errors.New("mail object has no identifier")
			}
			return id, nil
		}
	}
	return "", nil
}

// create validates the per-object result; JMAP can return HTTP 200 for a failure.
func (s *Stalwart) create(ctx context.Context, kind string, object map[string]any) (string, error) {
	r, err := s.call(ctx, "x:"+kind+"/set", map[string]any{"create": map[string]any{"new": object}})
	if err != nil {
		return "", err
	}
	var created map[string]struct {
		ID string `json:"id"`
	}
	json.Unmarshal(r["created"], &created)
	if created["new"].ID == "" {
		return "", errors.New("mail provider could not create object; check configuration, quotas, and license")
	}
	return created["new"].ID, nil
}

// EnsureTenant maps the stable application ID to one native Enterprise tenant.
func (s *Stalwart) EnsureTenant(ctx context.Context, t model.Tenant) (string, error) {
	name := "postharbor-" + t.ID
	if id, err := s.find(ctx, "Tenant", name, "name", name, "", ""); id != "" || err != nil {
		return id, err
	}
	return s.create(ctx, "Tenant", map[string]any{
		"name": name,
		"quotas": map[string]int64{
			"maxAccounts":  int64(t.MaxMailboxes),
			"maxDiskQuota": int64(t.QuotaMB) * 1024 * 1024,
		},
	})
}

// EnsureDomain preserves tenant ownership and asks Stalwart to generate DKIM.
func (s *Stalwart) EnsureDomain(ctx context.Context, t model.Tenant, d model.Domain) (string, error) {
	marker := "postharbor:" + d.ID
	if id, err := s.find(ctx, "Domain", d.Name, "name", d.Name, "description", marker); id != "" || err != nil {
		return id, err
	}
	return s.create(ctx, "Domain", map[string]any{
		"name":           d.Name,
		"memberTenantId": t.ProviderID,
		"description":    marker,
		"dkimManagement": map[string]string{"@type": "Automatic"},
	})
}

// EnsureMailbox uses a bcrypt credential supplied by the service. The clear-text
// password is never sent to this adapter or stored in the application database.
func (s *Stalwart) EnsureMailbox(ctx context.Context, t model.Tenant, d model.Domain, m model.Mailbox, hash string) (string, error) {
	local := strings.SplitN(m.Address, "@", 2)[0]
	if id, err := s.find(ctx, "Account", local, "emailAddress", m.Address, "externalId", m.ID); id != "" || err != nil {
		return id, err
	}
	return s.create(ctx, "Account", map[string]any{
		"@type": "User", "name": local,
		"domainId": d.ProviderID, "memberTenantId": t.ProviderID,
		"externalId": m.ID, "description": m.Name,
		"roles":       map[string]string{"@type": "User"},
		"quotas":      map[string]int64{"maxDiskQuota": int64(m.QuotaMB) * 1024 * 1024},
		"credentials": passwordCredentials(hash),
	})
}

// passwordCredentials encodes a Stalwart List<Credential> as a numbered object.
// Configuration lists are NOT JSON arrays; standard JMAP method arguments still are.
// See https://stalw.art/docs/configuration/object-encoding/.
func passwordCredentials(hash string) map[string]any {
	return map[string]any{"0": map[string]string{"@type": "Password", "secret": hash}}
}

// ResetPassword replaces credentials deliberately, revoking app passwords too.
// The UI and API docs explain this behavior before the administrator confirms.
func (s *Stalwart) ResetPassword(ctx context.Context, id, hash string) error {
	r, err := s.call(ctx, "x:Account/set", map[string]any{
		"update": map[string]any{id: map[string]any{"credentials": passwordCredentials(hash)}},
	})
	if err != nil {
		return err
	}
	var updated map[string]json.RawMessage
	json.Unmarshal(r["updated"], &updated)
	if _, ok := updated[id]; !ok {
		return errors.New("mail provider could not reset credentials")
	}
	return nil
}

// DeleteMailbox treats a previously deleted ID as success, allowing safe retries.
func (s *Stalwart) DeleteMailbox(ctx context.Context, id string) error {
	r, err := s.call(ctx, "x:Account/set", map[string]any{"destroy": []string{id}})
	if err != nil {
		return err
	}
	var destroyed []string
	json.Unmarshal(r["destroyed"], &destroyed)
	for _, v := range destroyed {
		if v == id {
			return nil
		}
	}
	var failed map[string]struct {
		Type string `json:"type"`
	}
	json.Unmarshal(r["notDestroyed"], &failed)
	if failed[id].Type == "notFound" {
		return nil
	}
	return errors.New("mail provider could not delete mailbox")
}

// DomainDNS returns the engine-generated zone, including its real DKIM public key.
func (s *Stalwart) DomainDNS(ctx context.Context, id string) (string, error) {
	r, err := s.call(ctx, "x:Domain/get", map[string]any{"ids": []string{id}, "properties": []string{"id", "dnsZoneFile"}})
	if err != nil {
		return "", err
	}
	var list []struct {
		Zone string `json:"dnsZoneFile"`
	}
	if err = json.Unmarshal(r["list"], &list); err != nil {
		return "", err
	}
	if len(list) != 1 {
		return "", errors.New("domain DNS is unavailable")
	}
	return list[0].Zone, nil
}
