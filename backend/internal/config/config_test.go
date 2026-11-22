package config

import "testing"

// TestPublicConfigurationFailsClosed keeps local shortcuts off public deployments.
func TestPublicConfigurationFailsClosed(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://test")
	t.Setenv("MAIL_PROVIDER", "simulation")
	for _, origin := range []string{"http://public.example.com", "https://public.example.com", "http://localhost:5173/"} {
		t.Setenv("APP_ORIGIN", origin)
		if _, err := Load(); err == nil {
			t.Fatalf("accepted %s", origin)
		}
	}
	t.Setenv("APP_ORIGIN", "http://localhost:5173")
	if _, err := Load(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MAIL_PROVIDER", "stalwart")
	t.Setenv("APP_ORIGIN", "https://panel.example.com")
	t.Setenv("STALWART_URL", "http://mail.example.com")
	t.Setenv("STALWART_TOKEN", "test")
	if _, err := Load(); err == nil {
		t.Fatal("accepted plaintext provider credentials")
	}
}

// TestCaptureURLStaysLocal prevents the demo integration from forwarding calls to arbitrary hosts.
func TestCaptureURLStaysLocal(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://test")
	t.Setenv("MAIL_PROVIDER", "simulation")
	t.Setenv("APP_ORIGIN", "http://localhost:5173")
	for _, address := range []string{"http://public.example.com:8025", "http://user:secret@localhost:8025", "http://localhost:8025/path", "http://localhost:8025?query=yes"} {
		t.Setenv("MAILPIT_URL", address)
		if _, err := Load(); err == nil {
			t.Fatalf("accepted unsafe capture URL %s", address)
		}
	}
	for _, address := range []string{"http://127.0.0.1:8025", "http://localhost:8025", "http://mailpit:8025"} {
		t.Setenv("MAILPIT_URL", address)
		if _, err := Load(); err != nil {
			t.Fatal(err)
		}
	}
}

// TestLiveSettings rejects accidental edition typos and invalid session secrets.
func TestLiveSettings(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://test")
	t.Setenv("APP_ORIGIN", "https://panel.example.com")
	t.Setenv("MAIL_PROVIDER", "stalwart")
	t.Setenv("STALWART_URL", "https://mail.example.com")
	t.Setenv("STALWART_TOKEN", "test-token")
	t.Setenv("STALWART_EDITION", "community")
	t.Setenv("WEBMAIL_SESSION_KEY", "short")
	if _, err := Load(); err == nil {
		t.Fatal("accepted invalid session key")
	}
	t.Setenv("WEBMAIL_SESSION_KEY", "abababababababababababababababababababababababababababababababab")
	if _, err := Load(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("STALWART_EDITION", "comunity")
	if _, err := Load(); err == nil {
		t.Fatal("accepted invalid edition")
	}
}
