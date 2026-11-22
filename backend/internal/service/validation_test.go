package service

import "testing"

// TestNormalizeDomain checks the boundary where user text becomes a DNS query.
func TestNormalizeDomain(t *testing.T) {
	for _, value := range []string{"https://example.com", "../example.com", "a..com", "-a.com", "127.0.0.1", "a.com/path", "localhost"} {
		if _, err := NormalizeDomain(value); err == nil {
			t.Errorf("accepted invalid domain %q", value)
		}
	}
	if got, err := NormalizeDomain(" Example.COM. "); err != nil || got != "example.com" {
		t.Fatalf("normalization: %q %v", got, err)
	}
}

// TestPasswordPolicy checks bcrypt's byte limit, including multibyte passwords.
func TestPasswordPolicy(t *testing.T) {
	for _, password := range []string{"short", string(make([]byte, 73))} {
		if _, err := PasswordHash(password); err == nil {
			t.Fatal("accepted invalid password length")
		}
	}
	if _, err := PasswordHash("a-long-test-password"); err != nil {
		t.Fatal(err)
	}
}
