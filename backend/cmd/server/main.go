// Command server wires the application and handles graceful operating-system shutdown.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"postharbor/internal/config"
	"postharbor/internal/httpapi"
	"postharbor/internal/mail"
	"postharbor/internal/service"
	"postharbor/internal/store"
	"syscall"
	"time"
)

// main keeps startup order explicit: validate, connect, bootstrap, then listen.
func main() {
	if err := run(); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

// run returns startup failures and drains in-flight requests during shutdown.
func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	startup, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	db, err := store.Open(startup, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()
	var provider mail.Provider = mail.Simulation{}
	if cfg.Mode == "stalwart" {
		live := mail.NewStalwart(cfg.StalwartURL, cfg.StalwartToken)
		live.Community = cfg.StalwartEdition == "community"
		provider = live
	}
	svc := &service.Service{DB: db, Mail: provider, DNS: net.DefaultResolver, Config: cfg}
	if err = svc.Bootstrap(startup); err != nil {
		return err
	}
	server := &http.Server{Addr: cfg.Address, Handler: httpapi.New(svc), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 35 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	result := make(chan error, 1)
	go func() {
		slog.Info("Postharbor listening", "address", cfg.Address, "mail_provider", cfg.Mode)
		result <- server.ListenAndServe()
	}()
	select {
	case err = <-result:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdown, done := context.WithTimeout(context.Background(), 15*time.Second)
		defer done()
		return server.Shutdown(shutdown)
	}
}
