package webmail

import (
	"html"
	"regexp"
	"strings"
)

var markupToken = regexp.MustCompile(`<[^>]*>`)
var formattingTag = regexp.MustCompile(`^<(/?)(b|strong|i|em|u|s|p|div|br|ul|ol|li|h1|h2|h3|blockquote|table|thead|tbody|tfoot|tr|td|th|hr)(?:\s[^>]*|/?)>$`)

// SafeHTML rebuilds formatting using an attribute-free allowlist. Everything else
// becomes escaped text: no scripts, URLs, styles, embedded objects or remote images.
func SafeHTML(input string) string {
	var out strings.Builder
	cursor := 0
	for _, loc := range markupToken.FindAllStringIndex(input, -1) {
		out.WriteString(html.EscapeString(html.UnescapeString(input[cursor:loc[0]])))
		tag := strings.ToLower(input[loc[0]:loc[1]])
		if parts := formattingTag.FindStringSubmatch(tag); parts != nil {
			// Reconstruct the tag; no sender-provided attribute reaches the browser.
			out.WriteString("<" + parts[1] + parts[2] + ">")
		}
		cursor = loc[1]
	}
	out.WriteString(html.EscapeString(html.UnescapeString(input[cursor:])))
	return out.String()
}
