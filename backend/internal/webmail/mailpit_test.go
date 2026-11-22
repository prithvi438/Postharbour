package webmail

import "testing"

// TestExactMailboxVisibility covers To/Cc/Bcc without confusing display names or address substrings.
func TestExactMailboxVisibility(t *testing.T) {
	m := Summary{From: Address{Address: "sender@studio.test"},
		To: []Address{{Name: "alex@studio.test", Address: "someone@else.test"}},
		Cc: []Address{{Address: "cc@studio.test"}}, Bcc: []Address{{Address: "hidden@studio.test"}}}
	for _, address := range []string{"sender@studio.test", "CC@STUDIO.TEST", "hidden@studio.test", "someone@else.test"} {
		if !m.VisibleTo(address) {
			t.Fatalf("expected visibility for %s", address)
		}
	}
	for _, address := range []string{"alex@studio.test", "sender@studio.test.evil", "studio.test"} {
		if m.VisibleTo(address) {
			t.Fatalf("leaked visibility to %s", address)
		}
	}
	if m.ReceivedBy("sender@studio.test") {
		t.Fatal("sender alone does not imply inbox membership")
	}
}
