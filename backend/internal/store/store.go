// Package store owns PostgreSQL connections, migrations, and small SQL helpers.
// Business decisions stay in httpapi; mail protocol details stay in mail.
package store

import (
	"context"
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"io/fs"
	"sort"
)

//go:embed migrations/*.sql
var migrations embed.FS

// DB wraps a modest connection pool suitable for the initial two-core VPS.
type DB struct{ *pgxpool.Pool }

// Querier lets the same read helpers work inside and outside a transaction.
type Querier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

// Open verifies database connectivity and applies ordered, transactional migrations.
func Open(ctx context.Context, url string) (*DB, error) {
	c, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	c.MaxConns = 8
	c.MinConns = 1
	p, err := pgxpool.NewWithConfig(ctx, c)
	if err != nil {
		return nil, err
	}
	db := &DB{p}
	if err = p.Ping(ctx); err == nil {
		err = db.migrate(ctx)
	}
	if err != nil {
		p.Close()
		return nil, err
	}
	return db, nil
}

// migrate uses a transaction-scoped advisory lock so concurrent starts are safe.
func (db *DB) migrate(ctx context.Context) error {
	return db.Locked(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)`); err != nil {
			return err
		}
		names, err := fs.Glob(migrations, "migrations/*.sql")
		if err != nil {
			return err
		}
		sort.Strings(names)
		for _, name := range names {
			var exists bool
			if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE name=$1)`, name).Scan(&exists); err != nil {
				return err
			}
			if exists {
				continue
			}
			data, err := migrations.ReadFile(name)
			if err != nil {
				return err
			}
			if _, err = tx.Exec(ctx, string(data)); err != nil {
				return fmt.Errorf("migration %s: %w", name, err)
			}
			if _, err = tx.Exec(ctx, `INSERT INTO schema_migrations(name) VALUES($1)`, name); err != nil {
				return err
			}
		}
		return nil
	})
}

// Locked serializes provisioning changes across API processes, protecting quotas.
// This is intentionally simple for five mailboxes. Never use this lock for reads.
func (db *DB) Locked(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(71624001)`); err != nil {
		return err
	}
	if err = fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// List decodes row_to_json results, avoiding repetitive field-by-field scans.
// SQL and its parameters always come from application code, never user SQL.
func List[T any](ctx context.Context, q Querier, sql string, args ...any) ([]T, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []T{}
	for rows.Next() {
		var data []byte
		var item T
		if err = rows.Scan(&data); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(data, &item); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

// One converts an empty, scoped query into pgx.ErrNoRows without leaking existence.
func One[T any](ctx context.Context, q Querier, sql string, args ...any) (T, error) {
	items, err := List[T](ctx, q, sql, args...)
	var empty T
	if err != nil {
		return empty, err
	}
	if len(items) == 0 {
		return empty, pgx.ErrNoRows
	}
	return items[0], nil
}

// ID produces an unpredictable identifier for records and verification challenges.
func ID() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// Audit appends a non-secret action record in the caller's transaction.
func Audit(ctx context.Context, q Querier, tenant, actor, action, target string) error {
	_, err := q.Exec(ctx, `INSERT INTO audit_events(tenant_id,actor,action,target) VALUES($1,$2,$3,$4)`, tenant, actor, action, target)
	return err
}
