-- Dashboard users and mailboxes are deliberately different entities.
CREATE TABLE tenants (
 id text PRIMARY KEY, name text NOT NULL,
 max_mailboxes integer NOT NULL CHECK (max_mailboxes > 0),
 quota_mb integer NOT NULL CHECK (quota_mb > 0),
 provider_id text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'pending',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
 id text PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL,
 password_hash text NOT NULL,
 role text NOT NULL CHECK (role IN ('platform_admin','tenant_admin')),
 tenant_id text REFERENCES tenants(id),
 CHECK ((role = 'platform_admin' AND tenant_id IS NULL) OR (role = 'tenant_admin' AND tenant_id IS NOT NULL))
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 csrf text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE domains (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id), name text NOT NULL UNIQUE,
 verification_token text NOT NULL, verified boolean NOT NULL DEFAULT false,
 provider_id text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'pending',
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (id, tenant_id)
);
CREATE TABLE mailboxes (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id), domain_id text NOT NULL,
 address text NOT NULL UNIQUE, name text NOT NULL, quota_mb integer NOT NULL CHECK (quota_mb > 0),
 provider_id text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'pending',
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (domain_id, tenant_id) REFERENCES domains(id, tenant_id)
);
CREATE INDEX domains_tenant ON domains(tenant_id);
CREATE INDEX mailboxes_tenant ON mailboxes(tenant_id);
CREATE TABLE audit_events (
 id bigserial PRIMARY KEY, tenant_id text NOT NULL DEFAULT '', actor text NOT NULL,
 action text NOT NULL, target text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_tenant_time ON audit_events(tenant_id, created_at DESC);
