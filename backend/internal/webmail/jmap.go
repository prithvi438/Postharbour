package webmail

// This adapter uses each mailbox's own JMAP credentials. The administrator's
// provisioning token is never used to read messages or submit outgoing mail.
import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// Store is the small mail contract shared by local captures and real mailboxes.
type Store interface {
	List(context.Context) ([]Summary, error)
	Detail(context.Context, Summary) (Detail, error)
	Download(context.Context, string, string) ([]byte, error)
	Conversation(context.Context, []Summary, string) (Conversation, error)
	Send(context.Context, Address, []string, string, string, string, []Upload, ...string) (string, error)
}

// Credentials are encrypted inside an expiring server-side session, never cookies.
type Credentials struct {
	Username    string `json:"username"`
	Password    string `json:"password"`
	Account     string `json:"account"`
	UploadURL   string `json:"upload_url"`
	DownloadURL string `json:"download_url"`
}

// JMAP is request-scoped: no credentials or mailbox content are shared between users.
type JMAP struct {
	Base        string
	Credentials Credentials
	http        *http.Client
}

// NewJMAP pins the server origin and refuses redirects that could expose credentials.
func NewJMAP(base string, credentials Credentials) *JMAP {
	return &JMAP{Base: strings.TrimRight(base, "/"), Credentials: credentials, http: &http.Client{
		Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("mail redirect refused") },
	}}
}

// request allows discovery URLs only on the configured HTTPS origin.
func (c *JMAP) request(ctx context.Context, method, target, contentType string, data []byte) ([]byte, error) {
	base, _ := url.Parse(c.Base)
	u, err := url.Parse(target)
	if err != nil || u.Scheme != base.Scheme || u.Host != base.Host || u.User != nil {
		return nil, errors.New("invalid mail endpoint")
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(c.Credentials.Username, c.Credentials.Password)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	client := c.http
	// RFC discovery commonly redirects to /jmap/session. Follow one GET only
	// on the pinned origin; uploads, downloads and API calls still refuse redirects.
	if method == "GET" && target == c.Base+"/.well-known/jmap" {
		discovery := *c.http
		discovery.CheckRedirect = func(next *http.Request, via []*http.Request) error {
			if len(via) > 1 || next.Method != "GET" || next.URL.Scheme != base.Scheme || next.URL.Host != base.Host || next.URL.User != nil {
				return errors.New("unsafe discovery redirect")
			}
			return nil
		}
		client = &discovery
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, errors.New("mail server unavailable")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("mail server returned HTTP %d", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, (16<<20)+1))
	if err != nil {
		return nil, err
	}
	if len(body) > 16<<20 {
		return nil, errors.New("mail response too large")
	}
	return body, nil
}

// Authenticate asks the engine to validate the mailbox password and identify its account.
func (c *JMAP) Authenticate(ctx context.Context) error {
	data, err := c.request(ctx, "GET", c.Base+"/.well-known/jmap", "", nil)
	if err != nil {
		return err
	}
	var session struct {
		PrimaryAccounts map[string]string `json:"primaryAccounts"`
		UploadURL       string            `json:"uploadUrl"`
		DownloadURL     string            `json:"downloadUrl"`
		Accounts        map[string]struct {
			IsReadOnly bool `json:"isReadOnly"`
		} `json:"accounts"`
	}
	if err = json.Unmarshal(data, &session); err != nil {
		return err
	}
	id := session.PrimaryAccounts["urn:ietf:params:jmap:mail"]
	account, ok := session.Accounts[id]
	if id == "" || !ok || account.IsReadOnly {
		return errors.New("no writable mail account")
	}
	c.Credentials.Account = id
	c.Credentials.UploadURL = session.UploadURL
	c.Credentials.DownloadURL = session.DownloadURL
	return nil
}

// call rejects both HTTP failures and JMAP method-level failures.
func (c *JMAP) call(ctx context.Context, method string, args map[string]any) (map[string]json.RawMessage, error) {
	args["accountId"] = c.Credentials.Account
	body, _ := json.Marshal(map[string]any{"using": []string{"urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail", "urn:ietf:params:jmap:submission"}, "methodCalls": []any{[]any{method, args, "c1"}}})
	data, err := c.request(ctx, "POST", c.Base+"/jmap/", "application/json", body)
	if err != nil {
		return nil, err
	}
	var envelope struct {
		Responses [][]json.RawMessage `json:"methodResponses"`
	}
	if json.Unmarshal(data, &envelope) != nil || len(envelope.Responses) < 1 || len(envelope.Responses[0]) != 3 {
		return nil, errors.New("invalid JMAP response")
	}
	var name, tag string
	json.Unmarshal(envelope.Responses[0][0], &name)
	json.Unmarshal(envelope.Responses[0][2], &tag)
	if name != method || tag != "c1" {
		return nil, errors.New("mail operation rejected")
	}
	var result map[string]json.RawMessage
	if err = json.Unmarshal(envelope.Responses[0][1], &result); err != nil {
		return nil, err
	}
	return result, nil
}

type jmapAddress struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}
type jmapPart struct {
	PartID string `json:"partId"`
	BlobID string `json:"blobId"`
	Name   string `json:"name"`
	Type   string `json:"type"`
	Size   int64  `json:"size"`
}
type jmapEmail struct {
	ID                string   `json:"id"`
	ThreadID          string   `json:"threadId"`
	MessageID         []string `json:"messageId"`
	From, To, Cc, Bcc []jmapAddress
	Subject           string          `json:"subject"`
	Preview           string          `json:"preview"`
	ReceivedAt        string          `json:"receivedAt"`
	Keywords          map[string]bool `json:"keywords"`
	MailboxIDs        map[string]bool `json:"mailboxIds"`
	HasAttachment     bool            `json:"hasAttachment"`
	Attachments       []jmapPart      `json:"attachments"`
	TextBody          []jmapPart      `json:"textBody"`
	HTMLBody          []jmapPart      `json:"htmlBody"`
	BodyValues        map[string]struct {
		Value       string `json:"value"`
		IsTruncated bool   `json:"isTruncated"`
	} `json:"bodyValues"`
}

// mailboxes resolves role IDs without assuming engine-specific mailbox names.
func (c *JMAP) mailboxes(ctx context.Context) (map[string]string, error) {
	r, err := c.call(ctx, "Mailbox/get", map[string]any{"properties": []string{"id", "role"}})
	if err != nil {
		return nil, err
	}
	var list []struct{ ID, Role string }
	if err = json.Unmarshal(r["list"], &list); err != nil {
		return nil, err
	}
	roles := map[string]string{}
	for _, v := range list {
		if v.Role != "" {
			roles[v.Role] = v.ID
		}
	}
	return roles, nil
}
func convertAddresses(in []jmapAddress) []Address {
	out := make([]Address, 0, len(in))
	for _, a := range in {
		out = append(out, Address{Name: a.Name, Address: a.Email})
	}
	return out
}
func (c *JMAP) summary(m jmapEmail, roles map[string]string) Summary {
	from := Address{}
	if len(m.From) > 0 {
		from = Address{Name: m.From[0].Name, Address: m.From[0].Email}
	}
	out := Summary{ID: m.ID, From: from, To: convertAddresses(m.To), Subject: m.Subject, Snippet: m.Preview, Date: m.ReceivedAt, Read: m.Keywords["$seen"], ThreadID: m.ThreadID, MailboxOwner: c.Credentials.Username, InInbox: m.MailboxIDs[roles["inbox"]], InSent: m.MailboxIDs[roles["sent"]]}
	if m.HasAttachment {
		out.Attachments = 1
	}
	if len(m.MessageID) > 0 {
		out.MessageID = m.MessageID[0]
	}
	return out
}

// List returns only the authenticated account's newest 200 non-draft messages.
func (c *JMAP) List(ctx context.Context) ([]Summary, error) {
	roles, err := c.mailboxes(ctx)
	if err != nil {
		return nil, err
	}
	r, err := c.call(ctx, "Email/query", map[string]any{"filter": map[string]any{"notKeyword": "$draft"}, "sort": []map[string]any{{"property": "receivedAt", "isAscending": false}}, "limit": 200})
	if err != nil {
		return nil, err
	}
	var ids []string
	if err = json.Unmarshal(r["ids"], &ids); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return []Summary{}, nil
	}
	r, err = c.call(ctx, "Email/get", map[string]any{"ids": ids, "properties": []string{"id", "threadId", "messageId", "from", "to", "subject", "preview", "receivedAt", "keywords", "mailboxIds", "hasAttachment"}})
	if err != nil {
		return nil, err
	}
	var list []jmapEmail
	if err = json.Unmarshal(r["list"], &list); err != nil {
		return nil, err
	}
	out := make([]Summary, 0, len(list))
	for _, m := range list {
		out = append(out, c.summary(m, roles))
	}
	return out, nil
}

// Detail keeps the existing safe-HTML rendering boundary for internet mail too.
func (c *JMAP) Detail(ctx context.Context, summary Summary) (Detail, error) {
	r, err := c.call(ctx, "Email/get", map[string]any{"ids": []string{summary.ID}, "properties": []string{"id", "messageId", "textBody", "htmlBody", "bodyValues", "attachments"}, "fetchTextBodyValues": true, "fetchHTMLBodyValues": true, "maxBodyValueBytes": 100000})
	if err != nil {
		return Detail{}, err
	}
	var list []jmapEmail
	if json.Unmarshal(r["list"], &list) != nil || len(list) != 1 {
		return Detail{}, errors.New("message not found")
	}
	m := list[0]
	out := Detail{Summary: summary, AttachmentList: []Attachment{}}
	if len(m.MessageID) > 0 {
		out.MessageID = m.MessageID[0]
	}
	for _, part := range m.TextBody {
		v := m.BodyValues[part.PartID]
		out.Text += v.Value
		out.TextTruncated = out.TextTruncated || v.IsTruncated
	}
	for _, part := range m.HTMLBody {
		out.HTML += m.BodyValues[part.PartID].Value
	}
	if len(out.Text) > 100000 {
		out.Text = strings.ToValidUTF8(out.Text[:100000], "")
		out.TextTruncated = true
	}
	if len(out.HTML) > 100000 {
		out.HTML = ""
	}
	out.HTML = SafeHTML(out.HTML)
	for _, a := range m.Attachments {
		out.AttachmentList = append(out.AttachmentList, Attachment{ID: a.BlobID, Name: a.Name, Size: a.Size, ContentType: a.Type})
	}
	out.Attachments = len(out.AttachmentList)
	return out, nil
}

// templateURL substitutes escaped values only; request still pins the HTTPS origin.
func (c *JMAP) templateURL(template string, values map[string]string) string {
	for k, v := range values {
		template = strings.ReplaceAll(template, "{"+k+"}", url.PathEscape(v))
	}
	return template
}

// Download is called only after the API verifies the blob belongs to the message.
func (c *JMAP) Download(ctx context.Context, id, blob string) ([]byte, error) {
	target := c.templateURL(c.Credentials.DownloadURL, map[string]string{"accountId": c.Credentials.Account, "blobId": blob, "name": "attachment", "type": "application/octet-stream"})
	return c.request(ctx, "GET", target, "", nil)
}

// Conversation joins engine thread IDs, never unrelated messages with the same subject.
func (c *JMAP) Conversation(ctx context.Context, list []Summary, id string) (Conversation, error) {
	thread := ""
	for _, m := range list {
		if m.ID == id {
			thread = m.ThreadID
		}
	}
	if thread == "" {
		return Conversation{}, errors.New("conversation not found")
	}
	matches := []Summary{}
	for _, m := range list {
		if m.ThreadID == thread {
			matches = append(matches, m)
		}
	}
	sort.Slice(matches, func(i, j int) bool { return matches[i].Date < matches[j].Date })
	out := Conversation{Messages: []Detail{}, Truncated: len(matches) > 50}
	if len(matches) > 50 {
		matches = matches[len(matches)-50:]
	}
	for _, m := range matches {
		d, err := c.Detail(ctx, m)
		if err != nil {
			return Conversation{}, err
		}
		out.Messages = append(out.Messages, d)
	}
	return out, nil
}

// MarkRead synchronizes the read flag with other IMAP/JMAP clients.
func (c *JMAP) MarkRead(ctx context.Context, id string) error {
	r, err := c.call(ctx, "Email/set", map[string]any{"update": map[string]any{id: map[string]any{"keywords/$seen": true}}})
	if err != nil {
		return err
	}
	var updated map[string]json.RawMessage
	json.Unmarshal(r["updated"], &updated)
	if _, ok := updated[id]; !ok {
		return errors.New("read update rejected")
	}
	return nil
}

// Send creates a draft, submits it as this mailbox, and moves it to Sent only on
// successful submission. An accepted submission is queued, not a delivery receipt.
func (c *JMAP) Send(ctx context.Context, from Address, to []string, subject, text, replyID string, files []Upload, richHTML ...string) (string, error) {
	if !strings.EqualFold(from.Address, c.Credentials.Username) {
		return "", errors.New("sender mismatch")
	}
	roles, err := c.mailboxes(ctx)
	if err != nil {
		return "", err
	}
	if roles["drafts"] == "" || roles["sent"] == "" {
		return "", errors.New("drafts or sent folder missing")
	}
	r, err := c.call(ctx, "Identity/get", map[string]any{})
	if err != nil {
		return "", err
	}
	var identities []struct{ ID, Email string }
	json.Unmarshal(r["list"], &identities)
	identity := ""
	for _, i := range identities {
		if strings.EqualFold(i.Email, from.Address) {
			identity = i.ID
		}
	}
	if identity == "" {
		return "", errors.New("sending identity unavailable")
	}
	recipients := []jmapAddress{}
	envelopeTo := []map[string]string{}
	for _, address := range to {
		recipients = append(recipients, jmapAddress{Email: address})
		envelopeTo = append(envelopeTo, map[string]string{"email": address})
	}
	email := map[string]any{"mailboxIds": map[string]bool{roles["drafts"]: true}, "keywords": map[string]bool{"$draft": true, "$seen": true}, "from": []jmapAddress{{Name: from.Name, Email: from.Address}}, "to": recipients, "subject": subject, "textBody": []map[string]string{{"partId": "text", "type": "text/plain"}}}
	values := map[string]any{"text": map[string]string{"value": text}}
	if len(richHTML) > 0 && richHTML[0] != "" {
		email["htmlBody"] = []map[string]string{{"partId": "html", "type": "text/html"}}
		values["html"] = map[string]string{"value": SafeHTML(richHTML[0])}
	}
	email["bodyValues"] = values
	if replyID != "" {
		email["inReplyTo"] = []string{messageID(replyID)}
		email["references"] = []string{messageID(replyID)}
	}
	attachments := []map[string]any{}
	for _, file := range files {
		raw, err := base64.StdEncoding.DecodeString(file.ContentBase64)
		if err != nil {
			return "", err
		}
		target := c.templateURL(c.Credentials.UploadURL, map[string]string{"accountId": c.Credentials.Account})
		data, err := c.request(ctx, "POST", target, file.ContentType, raw)
		if err != nil {
			return "", err
		}
		var blob struct {
			BlobID string `json:"blobId"`
			Size   int64  `json:"size"`
		}
		if json.Unmarshal(data, &blob) != nil || blob.BlobID == "" {
			return "", errors.New("attachment upload failed")
		}
		attachments = append(attachments, map[string]any{"blobId": blob.BlobID, "type": file.ContentType, "name": file.Name, "size": blob.Size, "disposition": "attachment"})
	}
	if len(attachments) > 0 {
		email["attachments"] = attachments
	}
	r, err = c.call(ctx, "Email/set", map[string]any{"create": map[string]any{"draft": email}})
	if err != nil {
		return "", err
	}
	var created map[string]struct{ ID string }
	json.Unmarshal(r["created"], &created)
	id := created["draft"].ID
	if id == "" {
		return "", errors.New("draft creation failed")
	}
	r, err = c.call(ctx, "EmailSubmission/set", map[string]any{"create": map[string]any{"send": map[string]any{"emailId": id, "identityId": identity, "envelope": map[string]any{"mailFrom": map[string]string{"email": from.Address}, "rcptTo": envelopeTo}}}, "onSuccessUpdateEmail": map[string]any{"#send": map[string]any{"mailboxIds": map[string]bool{roles["sent"]: true}, "keywords/$draft": nil, "keywords/$seen": true}}})
	if err != nil {
		return "", err
	}
	created = nil
	json.Unmarshal(r["created"], &created)
	if created["send"].ID == "" {
		return "", errors.New("message submission rejected")
	}
	return id, nil
}
