package httpapi

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
	"strings"
	"testing"
)

// Signature retries start from the unchanged draft; opt-out must work for replies too.
func TestSignatureBoundary(t *testing.T) {
	settings := mailSettings{SignatureEnabled: true, Signature: "<p><b>Alex</b><br>Easyhai</p>"}
	text, rich := appendSignature("Hello <team>", "", settings, nil)
	if !strings.Contains(text, "Alex\nEasyhai") || !strings.Contains(rich, "Hello &lt;team&gt;") || strings.Count(rich, "Easyhai") != 1 {
		t.Fatalf("bad signature: %q %q", text, rich)
	}
	no := false
	text, rich = appendSignature("Hello", "", settings, &no)
	if text != "Hello" || rich != "" {
		t.Fatal("signature opt-out ignored")
	}
}
func TestAvatarValidation(t *testing.T) {
	for _, input := range []string{"data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,ZmFrZQ=="} {
		if _, err := normalizeAvatar(input); err == nil {
			t.Fatal("accepted unsafe photo")
		}
	}
	var buf bytes.Buffer
	png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 16, 16)))
	if _, err := normalizeAvatar("data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())); err != nil {
		t.Fatal(err)
	}
	buf.Reset()
	png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 513, 1)))
	if _, err := normalizeAvatar("data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())); err == nil {
		t.Fatal("accepted oversized dimensions")
	}
}
