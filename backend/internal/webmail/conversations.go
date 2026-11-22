package webmail

import (
	"context"
	"encoding/json"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// threadMetadata stores only immutable email references, never message bodies.
type threadMetadata struct {
	MessageID  string
	References []string
}

// Conversation is an authorized chronological slice, bounded for a small VPS.
type Conversation struct {
	Messages  []Detail `json:"messages"`
	Truncated bool     `json:"truncated"`
}

var referencePattern = regexp.MustCompile(`<([^<>\r\n]+)>`)

// messageID normalizes angle brackets without conflating unrelated or empty IDs.
func messageID(value string) string {
	value = strings.Trim(strings.TrimSpace(value), "<>")
	if len(value) == 0 || len(value) > 998 || strings.ContainsAny(value, " \t\r\n") {
		return ""
	}
	return value
}

// pruneMetadata keeps at most the latest capture window's 200 header records.
func (c *Client) pruneMetadata(list []Summary) {
	c.metadataMu.Lock()
	defer c.metadataMu.Unlock()
	c.retained = make(map[string]bool, len(list))
	for _, item := range list {
		c.retained[item.ID] = true
	}
	for id := range c.metadata {
		if !c.retained[id] {
			delete(c.metadata, id)
		}
	}
}

// headers loads a capture's references once. Redirects/proxies are disabled by
// the common transport, and the caller has already checked mailbox membership.
func (c *Client) headers(ctx context.Context, item Summary) (threadMetadata, error) {
	c.metadataMu.Lock()
	cached, ok := c.metadata[item.ID]
	c.metadataMu.Unlock()
	if ok {
		return cached, nil
	}
	data, err := c.request(ctx, "GET", "/api/v1/message/"+url.PathEscape(item.ID)+"/headers", nil)
	if err != nil {
		return threadMetadata{}, err
	}
	var fields map[string][]string
	if err = json.Unmarshal(data, &fields); err != nil {
		return threadMetadata{}, err
	}
	result := threadMetadata{MessageID: messageID(item.MessageID)}
	for key, values := range fields {
		switch strings.ToLower(key) {
		case "message-id":
			if len(values) > 0 && messageID(values[0]) != "" {
				result.MessageID = messageID(values[0])
			}
		case "in-reply-to", "references":
			for _, value := range values {
				for _, match := range referencePattern.FindAllStringSubmatch(value, 100) {
					if id := messageID(match[1]); id != "" && len(result.References) < 100 {
						result.References = append(result.References, id)
					}
				}
			}
		}
	}
	// A message without an RFC ID remains its own conversation, not an empty-ID group.
	if result.MessageID == "" {
		result.MessageID = "capture:" + item.ID
	}
	c.metadataMu.Lock()
	if c.retained == nil || c.retained[item.ID] {
		if len(c.metadata) >= 200 {
			for id := range c.metadata {
				delete(c.metadata, id)
				break
			}
		}
		c.metadata[item.ID] = result
	}
	c.metadataMu.Unlock()
	return result, nil
}

// Conversation connects actual reply references across already-authorized messages.
// Only first-time header reads are parallelized, with six workers. Polling folder
// lists never fetches headers, and body content is fetched only for this thread.
func (c *Client) Conversation(ctx context.Context, visible []Summary, anchor string) (Conversation, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	metadata := make([]threadMetadata, len(visible))
	jobs := make(chan int)
	var workers sync.WaitGroup
	var once sync.Once
	var firstError error
	for i := 0; i < 6; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range jobs {
				m, err := c.headers(ctx, visible[index])
				if err != nil {
					once.Do(func() { firstError = err; cancel() })
					continue
				}
				metadata[index] = m
			}
		}()
	}
	for i := range visible {
		select {
		case jobs <- i:
		case <-ctx.Done():
		}
	}
	close(jobs)
	workers.Wait()
	if firstError != nil {
		return Conversation{}, firstError
	}
	if err := ctx.Err(); err != nil {
		return Conversation{}, err
	}

	// Union-find preserves transitive replies even when an older root was pruned.
	parents := map[string]string{}
	var root func(string) string
	root = func(id string) string {
		parent, ok := parents[id]
		if !ok {
			parents[id] = id
			return id
		}
		if parent != id {
			parents[id] = root(parent)
		}
		return parents[id]
	}
	anchorID := ""
	for i, m := range metadata {
		if visible[i].ID == anchor {
			anchorID = m.MessageID
		}
		for _, ref := range m.References {
			parents[root(ref)] = root(m.MessageID)
		}
	}
	connected := []Summary{}
	for i, m := range metadata {
		if root(m.MessageID) == root(anchorID) {
			connected = append(connected, visible[i])
		}
	}
	sort.SliceStable(connected, func(i, j int) bool {
		a, _ := time.Parse(time.RFC3339Nano, connected[i].Date)
		b, _ := time.Parse(time.RFC3339Nano, connected[j].Date)
		if a.Equal(b) {
			return connected[i].ID < connected[j].ID
		}
		return a.Before(b)
	})
	out := Conversation{Messages: []Detail{}, Truncated: len(connected) > 50}
	if out.Truncated {
		connected = connected[len(connected)-50:]
	}
	for _, item := range connected {
		detail, err := c.Detail(ctx, item)
		if err != nil {
			return Conversation{}, err
		}
		out.Messages = append(out.Messages, detail)
	}
	return out, nil
}
