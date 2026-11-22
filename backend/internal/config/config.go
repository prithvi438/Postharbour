// Package config reads and validates environment variables once, at startup.
package config

import (
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// Config is passed explicitly into components instead of using global settings.
type Config struct {
	Address, DatabaseURL, Origin, StaticDir, Mode    string
	BootstrapEmail, BootstrapPassword                string
	MailHost, WebmailURL, StalwartURL, StalwartToken string
	MailpitURL                                       string
	StalwartEdition, WebmailSessionKey               string
	SecureCookies                                    bool
	MaxMailboxes                                     int
}

// Load rejects dangerous or incomplete deployments before the server listens.
// Simulated mail is intentionally restricted to development origins.
func Load() (Config, error) {
	c := Config{
		Address: env("HTTP_ADDR", "127.0.0.1:8080"), DatabaseURL: os.Getenv("DATABASE_URL"),
		Origin: env("APP_ORIGIN", "http://localhost:5173"), StaticDir: env("STATIC_DIR", "../frontend/dist"),
		Mode: env("MAIL_PROVIDER", "simulation"), BootstrapEmail: strings.ToLower(os.Getenv("BOOTSTRAP_EMAIL")),
		BootstrapPassword: os.Getenv("BOOTSTRAP_PASSWORD"), MailHost: env("MAIL_HOST", "mail.example.com"),
		WebmailURL: os.Getenv("WEBMAIL_URL"), StalwartURL: os.Getenv("STALWART_URL"), StalwartToken: os.Getenv("STALWART_TOKEN"),
		StalwartEdition: env("STALWART_EDITION", "enterprise"), WebmailSessionKey: os.Getenv("WEBMAIL_SESSION_KEY"),
		MailpitURL: strings.TrimRight(os.Getenv("MAILPIT_URL"), "/"),
	}
	var err error
	c.MaxMailboxes, err = strconv.Atoi(env("MAX_MAILBOXES", "5"))
	if err != nil || c.MaxMailboxes < 1 {
		return c, fmt.Errorf("MAX_MAILBOXES must be positive")
	}
	u, err := url.Parse(c.Origin)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || (u.Scheme != "http" && u.Scheme != "https") {
		return c, fmt.Errorf("APP_ORIGIN must be an http(s) origin without a path or trailing slash")
	}
	local := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"
	c.SecureCookies = u.Scheme == "https"
	if !local && !c.SecureCookies {
		return c, fmt.Errorf("public deployments require HTTPS")
	}
	if c.DatabaseURL == "" {
		return c, fmt.Errorf("DATABASE_URL is required")
	}
	if c.Mode != "simulation" && c.Mode != "stalwart" {
		return c, fmt.Errorf("MAIL_PROVIDER must be simulation or stalwart")
	}
	if c.Mode == "simulation" && !local {
		return c, fmt.Errorf("simulation is only allowed on localhost")
	}
	if c.StalwartEdition != "enterprise" && c.StalwartEdition != "community" {
		return c, fmt.Errorf("STALWART_EDITION must be enterprise or community")
	}
	if c.WebmailSessionKey != "" {
		key, e := hex.DecodeString(c.WebmailSessionKey)
		if e != nil || len(key) != 32 {
			return c, fmt.Errorf("WEBMAIL_SESSION_KEY must be 64 hexadecimal characters")
		}
	}
	if c.Mode == "stalwart" {
		s, e := url.Parse(c.StalwartURL)
		if e != nil || s.Scheme != "https" || s.Host == "" || s.User != nil || s.RawQuery != "" || s.Fragment != "" || c.StalwartToken == "" {
			return c, fmt.Errorf("Stalwart requires an HTTPS URL and STALWART_TOKEN")
		}
	}
	if c.WebmailURL != "" {
		w, e := url.Parse(c.WebmailURL)
		if e != nil || w.Scheme != "https" || w.Host == "" || w.User != nil {
			return c, fmt.Errorf("WEBMAIL_URL must use HTTPS")
		}
	}
	// The capture viewer is an explicitly enabled local development integration.
	if c.MailpitURL != "" {
		m, e := url.Parse(c.MailpitURL)
		if e != nil || (m.Scheme != "http" && m.Scheme != "https") || m.User != nil || m.Path != "" || m.RawQuery != "" || m.Fragment != "" || (m.Hostname() != "localhost" && m.Hostname() != "127.0.0.1" && m.Hostname() != "mailpit") {
			return c, fmt.Errorf("MAILPIT_URL must point to localhost, 127.0.0.1, or the mailpit development container")
		}
	}
	return c, nil
}

// env supplies a documented default only when the variable is unset or empty.
func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
