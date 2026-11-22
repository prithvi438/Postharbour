// Command admin is an operator-only recovery tool for dashboard passwords.
// It is intentionally not reachable over HTTP and never changes mailbox credentials.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"github.com/jackc/pgx/v5"
	"golang.org/x/term"
	"os"
	"postharbor/internal/service"
	"postharbor/internal/store"
	"strings"
	"time"
)

// main returns a nonzero exit code if recovery does not complete atomically.
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// run reads the replacement secret without echo and revokes existing sessions.
func run() error {
	email := flag.String("email", "", "Dashboard administrator email to recover")
	flag.Parse()
	address := strings.ToLower(strings.TrimSpace(*email))
	dsn := os.Getenv("DATABASE_URL")
	if !service.ValidEmail(address) || dsn == "" {
		return errors.New("set DATABASE_URL and provide -email with an existing administrator address")
	}
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		return errors.New("run this recovery command from an interactive terminal")
	}
	fmt.Fprint(os.Stderr, "New dashboard password (hidden): ")
	password, err := term.ReadPassword(int(os.Stdin.Fd()))
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return err
	}
	fmt.Fprint(os.Stderr, "Confirm new password (hidden): ")
	confirmation, err := term.ReadPassword(int(os.Stdin.Fd()))
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return err
	}
	if string(password) != string(confirmation) {
		return errors.New("passwords do not match")
	}
	hash, err := service.PasswordHash(string(password))
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	db, err := store.Open(ctx, dsn)
	if err != nil {
		return err
	}
	defer db.Close()
	err = db.Locked(ctx, func(tx pgx.Tx) error {
		var id, tenant string
		if e := tx.QueryRow(ctx, `SELECT id,COALESCE(tenant_id,'') FROM users WHERE email=$1`, address).Scan(&id, &tenant); e != nil {
			return errors.New("dashboard administrator not found")
		}
		if _, e := tx.Exec(ctx, `UPDATE users SET password_hash=$2 WHERE id=$1`, id, hash); e != nil {
			return e
		}
		if _, e := tx.Exec(ctx, `DELETE FROM sessions WHERE user_id=$1`, id); e != nil {
			return e
		}
		return store.Audit(ctx, tx, tenant, "server-recovery", "administrator.password_recovered", address)
	})
	if err != nil {
		return err
	}
	fmt.Println("Dashboard password updated; previous sessions revoked.")
	return nil
}
