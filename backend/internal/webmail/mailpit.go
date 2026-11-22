// Package webmail adapts Mailpit's capture API to the local mailbox experience.
// It never calls Mailpit's release/relay endpoints and exposes only allowlisted HTML formatting.
package webmail

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Address is the safe name/address pair shared with the React mail reader.
type Address struct {
	Name    string `json:"name"`
	Address string `json:"address"`
}

// Summary contains list metadata. Read is populated from the caller's database state.
type Summary struct {
	ID          string    `json:"id"`
	From        Address   `json:"from"`
	To          []Address `json:"to"`
	Subject     string    `json:"subject"`
	Snippet     string    `json:"snippet"`
	Date        string    `json:"date"`
	Read        bool      `json:"read"`
	Attachments int       `json:"attachments"`
	Cc          []Address `json:"-"`
	Bcc         []Address `json:"-"`
	MessageID   string    `json:"-"`
}

// Attachment exposes metadata only; actual downloads are separately authorized.
type Attachment struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Size        int64  `json:"size"`
	ContentType string `json:"content_type"`
}

// Detail includes sanitized formatting but never hidden recipients.
type Detail struct {
	Summary
	Text           string       `json:"text"`
	HTML           string       `json:"html,omitempty"`
	MessageID      string       `json:"message_id"`
	TextTruncated  bool         `json:"text_truncated"`
	AttachmentList []Attachment `json:"attachment_list"`
}

// ReceivedBy checks actual address membership, not a substring or display name.
func (m Summary) ReceivedBy(address string) bool {
	for _, group := range [][]Address{m.To, m.Cc, m.Bcc} {
		for _, recipient := range group {
			if strings.EqualFold(recipient.Address, address) {
				return true
			}
		}
	}
	return false
}

// VisibleTo is reused for message reads, read-state changes, and attachment access.
func (m Summary) VisibleTo(address string) bool {
	return strings.EqualFold(m.From.Address, address) || m.ReceivedBy(address)
}

// Client accepts only a configured base URL; browser input never selects upstream hosts.
type Client struct {
	base       string
	http       *http.Client
	metadataMu sync.Mutex
	metadata   map[string]threadMetadata
	retained   map[string]bool
}

// New disables redirects and environment proxies to keep capture traffic local.
func New(base string) *Client {
	return &Client{base: strings.TrimRight(base, "/"), metadata: make(map[string]threadMetadata), http: &http.Client{Timeout: 10 * time.Second,
		Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirect refused") }}}
}

// request centralizes status checking and an 8 MiB upstream response limit.
func (c *Client) request(ctx context.Context, method, path string, body any) ([]byte, error) {
	var input io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		input = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, input)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("capture service returned %d", res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, (8<<20)+1))
	if err != nil {
		return nil, err
	}
	if len(data) > 8<<20 {
		return nil, errors.New("capture response too large")
	}
	return data, nil
}

// List loads the newest 200 captures; authorization happens before any are returned.
// This matches the bundled demo's 200-message retention policy.
func (c *Client) List(ctx context.Context) ([]Summary, error) {
	data, err := c.request(ctx, "GET", "/api/v1/messages?limit=200", nil)
	if err != nil {
		return nil, err
	}
	var result struct {
		Messages []struct {
			ID, MessageID, Subject, Snippet, Created string
			From                                     Address
			To, Cc, Bcc                              []Address
			Attachments                              int
		} `json:"messages"`
	}
	if err = json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	if len(result.Messages) > 200 {
		result.Messages = result.Messages[:200]
	}
	out := make([]Summary, 0, len(result.Messages))
	for _, m := range result.Messages {
		to := m.To
		if to == nil {
			to = []Address{}
		}
		out = append(out, Summary{ID: m.ID, MessageID: m.MessageID, From: m.From, To: to, Cc: m.Cc, Bcc: m.Bcc, Subject: m.Subject, Snippet: m.Snippet, Date: m.Created, Attachments: m.Attachments})
	}
	c.pruneMetadata(out)
	return out, nil
}

// Detail fetches an already-authorized message, returning text and attachment metadata.
func (c *Client) Detail(ctx context.Context, summary Summary) (Detail, error) {
	data, err := c.request(ctx, "GET", "/api/v1/message/"+url.PathEscape(summary.ID), nil)
	if err != nil {
		return Detail{}, err
	}
	var raw struct {
		Text, HTML, MessageID string
		Attachments           []struct {
			PartID, FileName, ContentType string
			Size                          int64
		}
	}
	if err = json.Unmarshal(data, &raw); err != nil {
		return Detail{}, err
	}
	if len(raw.HTML) > 100_000 {
		raw.HTML = ""
	}
	out := Detail{Summary: summary, Text: raw.Text, HTML: SafeHTML(raw.HTML), MessageID: raw.MessageID, AttachmentList: []Attachment{}}
	if len(out.Text) > 100_000 {
		out.Text = strings.ToValidUTF8(out.Text[:100_000], "")
		out.TextTruncated = true
	}
	if strings.TrimSpace(out.Text) == "" && out.HTML == "" && len(raw.Attachments) == 0 {
		out.Text = "This email has no readable body."
	}
	for _, a := range raw.Attachments {
		out.AttachmentList = append(out.AttachmentList, Attachment{ID: a.PartID, Name: a.FileName, Size: a.Size, ContentType: a.ContentType})
	}
	return out, nil
}

// Download fetches a previously authorized MIME part, bounded to the same 8 MiB cap.
func (c *Client) Download(ctx context.Context, id, part string) ([]byte, error) {
	return c.request(ctx, "GET", "/api/v1/message/"+url.PathEscape(id)+"/part/"+url.PathEscape(part), nil)
}

// Send captures text through Mailpit's send API. The caller supplies a validated sender.
func (c *Client) Send(ctx context.Context, from Address, to []string, subject, text, replyID string, attachments []Upload, richHTML ...string) (string, error) {
	recipients := make([]map[string]string, 0, len(to))
	for _, address := range to {
		recipients = append(recipients, map[string]string{"Email": address})
	}
	payload := map[string]any{"From": map[string]string{"Email": from.Address, "Name": from.Name}, "To": recipients, "Subject": subject, "Text": text}
	if len(richHTML) > 0 {
		payload["HTML"] = SafeHTML(richHTML[0])
	}
	if len(attachments) > 0 {
		files := make([]map[string]string, 0, len(attachments))
		for _, file := range attachments {
			files = append(files, map[string]string{"Filename": file.Name, "ContentType": file.ContentType, "Content": file.ContentBase64})
		}
		payload["Attachments"] = files
	}
	if replyID != "" && !strings.ContainsAny(replyID, "\r\n") {
		reference := "<" + strings.Trim(replyID, "<>") + ">"
		payload["Headers"] = map[string]string{"In-Reply-To": reference, "References": reference}
	}
	data, err := c.request(ctx, "POST", "/api/v1/send", payload)
	if err != nil {
		return "", err
	}
	var result struct{ ID string }
	if err = json.Unmarshal(data, &result); err != nil {
		return "", err
	}
	if result.ID == "" {
		return "", errors.New("capture response omitted message ID")
	}
	return result.ID, nil
}
