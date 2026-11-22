package webmail

import (
	"strings"
	"testing"
)

func TestSafeFormatting(t *testing.T) {
	got := SafeHTML(`<p onclick="evil()">Hello <b>team</b><img src="https://tracker.test/x"><script>alert(1)</script>&lt;img src=x onerror=evil()&gt;</p>`)
	if !strings.Contains(got, "<b>team</b>") || strings.Contains(got, "<script") || strings.Contains(got, "<img") || strings.Contains(got, "onclick=") {
		t.Fatal(got)
	}
	table := SafeHTML(`<table style="position:fixed"><tr><td onclick="evil()">Cell</td></tr></table>`)
	if table != `<table><tr><td>Cell</td></tr></table>` {
		t.Fatal(table)
	}
}
