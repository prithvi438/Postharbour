# Deploy on an Ubuntu VPS

## What will run

- Go serves the compiled React dashboard and its API.
- PostgreSQL stores management data; it does not store messages for this application.
- Caddy terminates HTTPS for the dashboard.
- A separately configured Stalwart Enterprise deployment handles mail.

Your 2-core / 8 GB RAM / 100 GB NVMe server is a reasonable starting point for five
lightly used mailboxes. Start with 5 GiB per mailbox, monitor actual usage, and leave
room for indexes, logs, temporary files, and upgrades. PostgreSQL/app/Caddy limits in
Compose are starting guardrails, not a guarantee that the entire server fits under
every workload. Measure Stalwart's memory and adjust its caches as appropriate.

## 1. Prepare Ubuntu and networking

Use a supported Ubuntu LTS release and install Docker Engine plus Compose from
[Docker's official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).
You do not need Node or Go on the VPS when using the Docker build.

Choose separate hostnames, for example:

- `panel.yourdomain.com` — the Postharbor dashboard.
- `mail.yourdomain.com` — the mail engine's public SMTP/IMAP identity.
- An optional private/admin hostname for Stalwart's HTTPS management API.

Before promising mail delivery, check:

1. Static public IP; your VPS provider lets you set PTR/reverse DNS.
2. TCP 25 inbound for reception and outbound for direct delivery. An outbound SMTP
   relay is an alternative for outbound restrictions, not for blocked inbound SMTP.
3. TCP 465 for authenticated submission and 993 for IMAP. Open additional protocols
   only when you configure them. Dashboard HTTPS needs 443; Caddy commonly needs 80
   for certificate challenges.
4. Forward DNS for the mail hostname matches its PTR. Publish working IPv6 only if
   you have configured IPv6 routing, firewall, and reverse DNS correctly.
5. Domain DNS control for TXT ownership, MX, SPF, DKIM, and DMARC.

Preserve SSH access when modifying firewalls. Docker-published ports can interact
with UFW differently from ordinary host services; inspect the actual externally
reachable ports. This Compose configuration binds database and API ports to loopback.

## 2. Set up and validate Stalwart

Follow the [official installation guide](https://www.stalwart.email/docs/install/).
Use a version that exposes the documented JMAP management API at `/jmap/` with the
`urn:stalwart:jmap` capability and `x:Tenant`, `x:Domain`, `x:Account` objects.

**This project does not install or configure Stalwart automatically.** This avoids
guessing mail-storage, TLS, relay, or license settings for your existing VPS.
The adapter follows the official schema consulted in November 2026; record and
pin the exact Stalwart version/image digest that passes your acceptance tests.
Do not assume compatibility with older `/api/principal` releases.

Activate an Enterprise license for native tenants. Create a backend-only API token
with the management permissions it needs: tenant query/get/create; domain
query/get/create; account query/get/create/update/destroy. Token creation and
permission configuration vary by release; use that release's administration UI.

Stalwart also requires the caller to hold the permissions of accounts it manages.
A key narrowed to management methods alone may therefore fail to create ordinary
User-role accounts. Include the corresponding User permissions as required by the
[API key documentation](https://www.stalw.art/docs/auth/authentication/api-key/),
and verify effective permissions during the live acceptance test.

The adapter must reach a trusted HTTPS endpoint. Never use insecure TLS verification
or expose the management token in React. Stalwart's HTTPS listener and Caddy cannot
both bind the same IP/port 443. Either use your existing reverse proxy for both
hostnames, bind Stalwart management HTTPS to another private port with a trusted
certificate, or use separate IPs. SMTP/IMAP should connect to Stalwart's own listeners,
not the dashboard HTTP proxy.

Configure Stalwart independently for server hostname, storage, TLS, no open relay,
spam handling, outbound sender authorization, submission limits, and backups.
Postharbor creates tenant/domain/account objects; it does not configure those
server-wide settings or sending-rate policies.

## 3. Configure a fresh production environment

Use a new checkout/directory and a **separate database/Compose project** from local
simulation. Existing simulated provider IDs cannot be converted merely by changing
an environment variable; startup intentionally rejects that mismatch.

```sh
cp .env.example .env
chmod 600 .env
```

Edit `.env` with your actual values:

```dotenv
POSTGRES_USER=postharbor
POSTGRES_PASSWORD=REPLACE_WITH_A_RANDOM_URL_SAFE_SECRET
POSTGRES_DB=postharbor
POSTGRES_PORT=5433
APP_DOMAIN=panel.yourdomain.com
APP_ORIGIN=https://panel.yourdomain.com
BOOTSTRAP_EMAIL=you@your-existing-email-domain.com
BOOTSTRAP_PASSWORD=REPLACE_WITH_A_UNIQUE_12_TO_72_BYTE_PASSWORD
MAIL_PROVIDER=stalwart
MAX_MAILBOXES=5
MAIL_HOST=mail.yourdomain.com
STALWART_URL=https://your-stalwart-management-host
STALWART_TOKEN=REPLACE_WITH_BACKEND_ONLY_API_TOKEN
WEBMAIL_URL=
```

Do not include a trailing slash in `APP_ORIGIN`. `STALWART_URL` is the base URL;
the adapter adds `/jmap/`. Use a URL-safe database password, such as the output of
`openssl rand -hex 32`, because Compose inserts it into a PostgreSQL URL. If you
already have a webmail application, set its HTTPS URL in `WEBMAIL_URL`.
The built-in `/mail` screen is currently a local Mailpit sandbox, disabled for
live-provider mode. It does not replace this production mail-client setup.
Keep `MAILPIT_URL` unset in production and do not deploy the local Mailpit viewer.

Do not commit `.env`, backup files, database dumps, API tokens, or mailbox data.
Remove `BOOTSTRAP_PASSWORD` from `.env` after first boot; an empty value is accepted
when the owner already exists. It is not an administrator password reset mechanism.

## 4. Build and start

Ensure `panel.yourdomain.com` resolves to the VPS, then run:

```sh
docker compose -p postharbor-prod -f compose.yml -f compose.prod.yml up --build -d
docker compose -p postharbor-prod -f compose.yml -f compose.prod.yml ps
docker compose -p postharbor-prod -f compose.yml -f compose.prod.yml logs --tail=100 app caddy
```

Use the same `-p` and `-f` arguments for later commands. They determine the project,
network, volume names, and services. If an existing web server owns ports 80/443,
integrate its reverse proxy instead of starting the supplied Caddy service.

Open the HTTPS dashboard. Create a business, verify a domain, and retrieve the
native DNS zone. For a domain already receiving email elsewhere, provision/migrate
mailboxes before switching MX. Keep TXT ownership records available for retries.

## 5. Live acceptance test — required before customer use

The code was tested with PostgreSQL and simulated/mocked provider boundaries;
real Stalwart delivery was not available for development-time validation.

On a disposable test domain, verify all of the following against your exact release:

1. Business creation creates one native Tenant with account/storage limits.
2. Domain verification creates one Domain linked to that Tenant; generated DNS
   includes a usable DKIM key and the intended mail hostname.
3. Mailbox creation creates a User in that tenant/domain with the requested byte
   quota. Authenticate via IMAPS and authenticated SMTP using its initial password.
4. Interrupt/retry provisioning: exactly one remote object remains. If the original
   request succeeded remotely, the password is unchanged on retry.
5. Reset credentials: the new credential works; prior app credentials are revoked
   according to the configured server's session behavior. Check long-lived clients.
6. Tenant A cannot view/manage Tenant B through Postharbor or access its messages
   through Stalwart. Test two actual mailbox users, not only admin UI visibility.
7. Send/receive to an external mailbox you control, inspect SPF/DKIM/DMARC, inspect
   queue failures, and confirm the server cannot act as an unauthenticated relay.
8. Delete a disposable mailbox with exact confirmation; check removal in both stores.
9. Test backup restoration and PWA installation on actual Android/iOS devices.

If a contract differs, adjust only `internal/mail/stalwart.go`, its contract tests,
and this version compatibility documentation. Do not weaken isolation to make an
incompatible Community/older deployment appear to work.

## Production maintenance

See [OPERATIONS.md](OPERATIONS.md). Monitor disk space, container memory, SMTP queue
depth, rejection rates, and backups. Keep host/container dependencies patched and
pin tested image digests for reproducibility before a public release. Add MFA,
support/recovery workflows, and stronger abuse controls before running an open
reseller or public signup service.
