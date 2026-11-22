# Operations and recovery

## Data you must preserve

There are two independent data sets:

1. **Postharbor PostgreSQL**: tenants, administrator password hashes, domain proofs,
   mailbox metadata/remote IDs, sessions, and audit records.
2. **Stalwart storage/configuration**: actual messages, account data, queues, DKIM
   keys, encryption keys if used, and the server's supported database/blob stores.

A Postharbor database dump does **not** back up email messages. Follow Stalwart's
backup guidance for the storage backend you choose. Preserve key material needed
to decrypt encrypted backups/messages. Caddy's data volume contains its certificate
state; the root `.env` contains secrets and must be backed up securely too.

## PostgreSQL backup

From the production project directory, an example restricted backup is:

```sh
mkdir -p backups
chmod 700 backups
umask 077
docker compose -p postharbor-prod -f compose.yml -f compose.prod.yml exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "backups/postharbor-$(date +%Y%m%d-%H%M%S).dump"
```

Confirm the command succeeded and the dump is nonempty. Encrypt and copy it to a
different machine/provider; a second file on the same VPS is not an off-server
backup. Set retention deliberately, and alert when a scheduled backup fails.

## Test a restore

Restore into a fresh, isolated database, never over the only production copy:

```sh
docker compose exec db sh -c 'createdb -U "$POSTGRES_USER" postharbor_restore'
docker compose exec -T db sh -c 'pg_restore --exit-on-error -U "$POSTGRES_USER" -d postharbor_restore' \
  < backups/YOUR_BACKUP.dump
```

For production, use the same production Compose flags as the backup command.
Before exposing a restored application, clear restored `sessions` in that isolated
database to invalidate copied cookies. Check tenant/resource mappings against the
matching Stalwart backup. Restoring only one side to an older point can orphan or
misrepresent mail accounts; reconcile before enabling mutations.

## Pending operations

The UI deliberately keeps pending records when remote provisioning is uncertain.

| State | Action |
| --- | --- |
| Business pending | Check Stalwart API/license; use Retry provisioning |
| Domain ownership unverified | Check exact TXT challenge, authoritative DNS, propagation |
| Domain verified but pending | Check Stalwart permissions/config; retry verification |
| Mailbox pending | Check engine/quota; retry with the original password |
| Mailbox deletion pending | Retry deletion; remote not-found is treated as success |

Do not manually remove pending rows just to clear the UI: the remote account may
already exist. Match stable IDs/ownership markers in Stalwart before any manual
reconciliation. Unprovisioned/abandoned domain reservations currently need operator
review; there is no domain reassignment or deletion UI in this release.

## Password recovery

Dashboard administrators can change their password in Settings when they know the
current one. There is no public email-based recovery flow in this release.
An owner with server/database access can use the recovery CLI documented below;
it updates only the specified dashboard user and revokes that user's sessions.
It does not reset mailbox passwords or change tenant membership.

```sh
cd backend
# DATABASE_URL must already point to the intended application database.
go run ./cmd/admin -email owner@example.com
```

The command prompts on the terminal without echoing the new password. Review the
target database/environment before running. You need a Go toolchain for this
operator-only recovery command; it is not exposed through the web API.

## Configuration changes and updates

`BOOTSTRAP_PASSWORD` only creates the first owner, and will not reset an existing
account. `MAX_MAILBOXES` is a global creation limit; lowering it does not delete
existing accounts. Business and mailbox quota editing is not yet implemented.

Back up both stores, review release notes, run tests against the target version,
then rebuild/restart. Migrations run in filename order under an advisory lock and
record successful application in `schema_migrations`. Add a new migration rather
than editing one already applied. Rollbacks need a tested backup/forward migration,
not an assumption that an older application understands a newer schema.

The mail API token, SMTP credentials, and request bodies must not appear in logs.
Current app logs intentionally include safe startup/HTTP error categories only.
Use the Stalwart admin tools for detailed mail queue/protocol diagnostics.

## Common problems

- **403 origin rejected:** open the exact `APP_ORIGIN`, including port. Use HTTPS
  origin with Caddy; do not open the backend's loopback URL as a production user.
- **403 session verification:** refresh to load the current CSRF token. Sign in again
  if another login revoked your session.
- **502 provisioning:** verify the management API generation, certificate, token
  permissions, Enterprise license, and remote quotas. A pending record may exist.
- **Provider mismatch on startup:** use separate databases for simulation and live mail.
- **Missing frontend:** build `frontend` and set `STATIC_DIR` relative to the process's
  working directory, or use the provided Docker build.
- **Install button shows instructions:** the browser has not offered a prompt, does
  not support it, or the page is not in a secure context. See [PWA.md](PWA.md).
- **Rate limited behind Caddy:** login limits deliberately use the socket peer, not
  untrusted forwarded IP headers. All proxied clients share 20 attempts/minute on
  this small deployment. Add a carefully trusted proxy/IP policy when scaling.
- **Mail doesn't arrive:** Postharbor's provisioned state is not delivery validation.
  Inspect Stalwart logs/queues, provider port blocks, MX, PTR, and authentication.
