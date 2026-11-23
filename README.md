# Postharbor

A small, understandable email-hosting control panel for your own Ubuntu VPS.

**React + TypeScript frontend · Go API · PostgreSQL · Stalwart integration**

Postharbor gives businesses separate administrator workspaces for domains and
mailboxes. It has a responsive glassmorphism interface, light/dark themes, and an
installable Progressive Web App (PWA). It is designed to start on a 2-core, 8 GB RAM
VPS with five mailboxes, rather than requiring a cluster of services.

**The dashboard manages domains and mailboxes. The React `/mail` interface reads,
composes and replies to email.** Local mode uses Mailpit captures; live mode uses
mailbox-authenticated Stalwart JMAP. Free Community hosting supports one business;
Enterprise supports native multi-business tenants. See [native VPS hosting](docs/NATIVE_HOSTING.md)
for the Git + Nginx + systemd setup without Docker. Browser installation creates a
PWA, not an App Store application.

## What works

- Platform-owner login and separate business-administrator logins.
- Multiple businesses with tenant-scoped domains, mailboxes, and activity logs.
- Business creation with an initial administrator, mailbox limit, and storage allowance.
- Domain ownership verification using a random DNS TXT challenge.
- Engine-generated DNS zone retrieval and a basic MX routing check.
- Mailbox creation, retry after interrupted provisioning, credential reset, and confirmed deletion.
- Global mailbox limit (five by default), business mailbox limits, and allocated storage limits.
- HTTP-only sessions, same-origin/CSRF protection, bcrypt passwords, and login throttling.
- Responsive React screens, persistent light/dark preference, search, and accessible dialogs.
- Combined Conversations queue, full-width email reading, and compact formatting/emoji popovers.
- Private contacts and reusable contact groups, starred/archive views, and basic rich-text editing with safe HTML paste.
- Local end-user webmail with mailbox login, Inbox/Sent, conversation reading, inline compose/reply, file/photo attachments, saved filter chips, and full-screen mobile conversations.
- PWA manifest, real PNG icons, install prompt where supported, iOS instructions, and a privacy-preserving offline notice.
- Local simulation mode, optional Mailpit email capture, Docker deployment files, tests, CI, and documented extension points.

The live adapter targets Stalwart's **JMAP management API** (`x:Tenant`, `x:Domain`,
`x:Account`). Native tenant isolation requires **Stalwart Enterprise**. The explicit Community adapter supports one business without native tenants. Older
Stalwart releases using `/api/principal` are not compatible with this adapter.
Our MIT license does not grant a Stalwart Enterprise subscription.

## Run locally without Docker

Docker is optional. On macOS with Homebrew, install the native tools once:

```sh
brew install python go node@24 postgresql@16 mailpit
export PATH="$(brew --prefix node@24)/bin:$(brew --prefix postgresql@16)/bin:$PATH"
```

From this project directory:

```sh
python3 scripts/native_demo.py
```

This starts its own local PostgreSQL database, Go API, built React UI, and Mailpit,
then creates demo accounts and a captured email conversation.

| Screen | URL | Default login |
| --- | --- | --- |
| End-user webmail | http://localhost:8080/mail | `alex@harbor.test` / `local-mailbox-password` |
| Administration | http://localhost:8080 | `owner@example.test` / `local-development-password` |
| Mailpit diagnostics, showing all captures | http://localhost:8025 | No login; local diagnostic use only |

In webmail, choose **Compose**, send to `hello@harbor.test`, then sign out and
sign in as `hello@harbor.test` with the same demo password to receive and reply.
See [the webmail walkthrough](docs/WEBMAIL.md) for the complete flow.
Press **Ctrl+C** to stop; data stays in the ignored `.local-demo/` directory.

For React hot reload, stop that command and use:

```sh
python3 scripts/native_demo.py --dev
```

Open **http://localhost:5173/mail** for webmail or **http://localhost:5173** for
administration in this mode. The launcher does not load Docker's
`.env` or need system services. See [the native setup guide](docs/NATIVE_DEVELOPMENT.md)
for Ubuntu/Linux, dependency versions, data/logs, and startup troubleshooting.

## Alternative: preview with Docker

Start Docker Desktop/Engine, then run this from the project directory with Python 3:

```sh
python3 scripts/local_demo.py
```

This creates `.env` only if missing, starts the built React dashboard and database,
adds a demo business with two simulated mailboxes, and sends a sample email plus
an automatically generated reply into a local **Mailpit** catcher. No domain,
DNS change, Stalwart installation, or mail license is needed for this demo.

- **Dashboard:** http://localhost:8080 — `owner@example.test` / `local-development-password` with the default `.env`.
- **End-user webmail:** http://localhost:8080/mail — `alex@harbor.test` / `local-mailbox-password`.
- **Captured test email:** http://localhost:8025 — inspect the HTML, plain text, attachment, and reply.
- **Send another conversation:** `python3 scripts/send_demo_mail.py`.
- **Stop and retain data:** `docker compose --profile demo down`.

The React `/mail` interface has separate mailbox sign-in and displays messages
for the signed-in address. Mailpit's original viewer remains a shared diagnostic
tool. Local capture does not test Stalwart authentication, IMAP delivery, or public
email delivery. Creating a mailbox in the dashboard does not itself send a message.

See the [local testing walkthrough](docs/LOCAL_TESTING.md) for custom messages,
business-admin credentials, responsive UI checks, hot reload, and troubleshooting.

## Start locally with Docker

Install Docker Engine/Desktop and the Docker Compose plugin. From this directory:

```sh
cp .env.example .env
docker compose up --build -d
docker compose logs -f app
```

Open **http://localhost:8080**. Use the exact hostname configured in `APP_ORIGIN`;
`localhost` and `127.0.0.1` are different origins for CSRF protection.

Local-only owner credentials from `.env.example`:

| Field | Value |
| --- | --- |
| Email | `owner@example.test` |
| Password | `local-development-password` |

These defaults are for an isolated development environment. They must be replaced
before deployment. The first startup creates the owner; later startups never
overwrite an existing account's password.

The default provider is **simulation**. Creating a mailbox in simulation only
creates application records; it never sends email. Public origins cannot use this
mode. Simulated domain verification is explicitly limited to `.test` domains.

To populate a local example through the real API:

```sh
python3 scripts/seed_demo.py
```

This creates **Harbor Studio**, `harbor.test`, and two simulated mailboxes. Its
business administrator is `admin@harbor.test` / `local-business-password`.
The script sets both demo mailbox passwords to `local-mailbox-password` for
webmail, including on repeat runs, and revokes their existing mailbox sessions.
It also signs the owner out; sign in again in your browser. Running it again does
not duplicate the business, domain, or mailboxes.

Stop without removing data:

```sh
docker compose down
```

Database files live in a named volume. **Do not use `down -v` unless you intend to
permanently erase that environment's application database.**

## Start development with hot reload

For the complete Docker-free setup, use `python3 scripts/native_demo.py --dev`
as described above. The manual process below is an alternative for developers
who prefer managing each dependency separately.

Prerequisites: Go 1.25 or newer (CI uses 1.27), Node.js 22.12 or newer, npm,
PostgreSQL 16+, and optionally Python 3 for demo seeding/icon generation.

Start PostgreSQL:

```sh
cp .env.example .env
docker compose up -d db
```

In terminal 1, start the API from the repository root:

```sh
export DATABASE_URL='postgres://postharbor:local-database-password@localhost:5433/postharbor?sslmode=disable'
export APP_ORIGIN='http://localhost:5173'
export BOOTSTRAP_EMAIL='owner@example.test'
export BOOTSTRAP_PASSWORD='local-development-password'
export MAIL_PROVIDER='simulation'
export MAILPIT_URL='http://127.0.0.1:8025'
cd backend
go mod download
go run ./cmd/server
```

In terminal 2:

```sh
cd frontend
npm ci
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` to the Go API at port 8080, so
there is no cross-origin authentication workaround. Do not also run the Docker
`app` service on port 8080 while starting the Go development server.

Seed this development origin if wanted:

```sh
BASE_URL=http://localhost:5173 python3 scripts/seed_demo.py
```

The Go application reads environment variables, **not `.env` files automatically**.
Docker Compose loads the root `.env`. When running Go directly, export variables
as shown above. An existing local PostgreSQL installation also works: create an
empty database and set `DATABASE_URL` to its connection URL.
For `/mail`, start a local Mailpit process as described in
[NATIVE_DEVELOPMENT.md](docs/NATIVE_DEVELOPMENT.md), or use
`docker compose --profile demo up -d mailpit`. Leave `MAILPIT_URL` unset when
you only want the administration dashboard.

## First-run workflow

1. Sign in as the platform owner and choose **New business**.
2. Give the business an administrator and limits. Share its initial password securely.
3. Choose the business in the workspace selector and add a domain.
4. Open **DNS & setup**, publish the TXT challenge, and verify ownership. In local
   simulation, a reserved `.test` domain has an explicit simulation checkbox.
5. For live mail, copy the generated records to the domain's DNS provider. Keep
   existing senders in SPF; don't publish multiple SPF records.
6. Create a mailbox. A default 5120 MiB quota means 5 GiB of allocated capacity.
7. Connect an IMAP/SMTP client using the Settings instructions, or configure
   `WEBMAIL_URL` for your separately deployed webmail client.
8. Test real inbound/outbound delivery before handing the account to its user.

"Provisioned" means the management operation succeeded. It does **not** mean DNS
authentication, SMTP connectivity, inbox placement, or live delivery has passed.
An MX check is deliberately labeled as a basic routing check.

## Project map

```text
frontend/
  index.html                  Browser entry point and PWA metadata
  public/                     Manifest, icons, initial theme, offline notice
  src/main.tsx                React mount and production service-worker registration
  src/App.tsx                 Session, navigation, business selection, shared data
  src/webmail/                Mailbox login, Inbox/Sent, reader, composer, mail API transport
  src/pages/                  Login and business workspace screens
  src/components/             Reusable forms, dialogs, buttons, status views
  src/hooks/                  Theme and install-capability behavior
  src/lib/                    Shared API transport and TypeScript models
  src/styles.css              Design tokens, themes, responsive breakpoints
  vite.config.ts              Dev proxy, tests, generated service worker
backend/
  cmd/server/                 Startup and graceful shutdown
  internal/config/            Environment validation
  internal/httpapi/           Routes, sessions, HTTP security and input decoding
  internal/service/           Authorization, validation, quotas, provisioning rules
  internal/model/             Public record types, with no secret fields
  internal/store/              Database pool, migrations, query helpers, audit writes
  internal/mail/               Simulation and Stalwart adapters
  internal/webmail/            Local Mailpit message capture adapter
deploy/                       HTTPS reverse-proxy configuration
scripts/                      Local demo startup, data seeding, SMTP samples, icon generation
docs/                         Architecture, API, deployment, PWA, testing, operations
```

Begin with [the architecture walkthrough](docs/ARCHITECTURE.md). Each package,
component, and named function includes a purpose comment. Repeated transport,
validation, form, session, and provisioning behavior is centralized.

## Tests and production build

```sh
cd frontend
npm ci
npm test
npm run build

cd ../backend
go test ./...
go vet ./...
go build -o ../bin/postharbor ./cmd/server
```

Integration tests need a real PostgreSQL database. They use a random schema and
drop only that schema afterward:

```sh
docker compose exec db sh -c 'createdb -U "$POSTGRES_USER" postharbor_test'
cd backend
export TEST_DATABASE_URL='postgres://postharbor:local-database-password@localhost:5433/postharbor_test?sslmode=disable'
go test -race ./...
```

Without `TEST_DATABASE_URL`, database tests explicitly skip. CI always supplies it.
See [TESTING.md](docs/TESTING.md) for coverage and the manual mail/PWA checks.
See [VERIFICATION.md](docs/VERIFICATION.md) for the checks actually completed and
the remaining deployment/device verification limits.

To serve the production build locally, stop Vite/the development API, keep the
database running, set the same exported variables but change
`APP_ORIGIN=http://localhost:8080` and `STATIC_DIR=frontend/dist`, then run
`./bin/postharbor` **from the repository root**. The Go server serves both API and
compiled React assets. This is the appropriate local build for PWA testing.

## Installing the app on a phone

- Android Chromium browsers: the footer's **Install app** button uses the browser's
  install prompt when available. Browser eligibility determines when it is offered.
- iPhone/iPad: the button explains **Safari → Share → Add to Home Screen → Add**.
  JavaScript cannot force the same native install prompt on iOS.
- Desktop: supported browsers may show an install button in the address bar too.
- An installed app hides the install action when standalone mode is detected.

Use HTTPS for real-device installation. `http://192.168...` is not equivalent to
localhost. The application requires a network connection for administration; its
service worker never caches authenticated API responses or credentials.

## Deploying on your Ubuntu VPS

Follow [DEPLOYMENT.md](docs/DEPLOYMENT.md) before switching to live mail. It covers
Stalwart compatibility/licensing, HTTPS, DNS, ports, reverse DNS, and the 8 GB / 100
GB VPS budget. [OPERATIONS.md](docs/OPERATIONS.md) covers backups, restores, pending
operations, and updates.

## Current scope and limitations

This is an initial self-hosted release, not a claim of a completed commercial SaaS.
There is no billing/reseller hierarchy, dashboard MFA, self-service signup, email
password recovery, push notifications, live Stalwart webmail, automated DNS
provider integration, domain/business deletion, alias editor, or live storage meter.
Existing limits cannot yet be edited in the dashboard. Business administrators
operate through Postharbor; it does not create native Stalwart administrator logins.

The `/mail` reader/composer is a local `.test` sandbox backed by Mailpit. It is
disabled for live-provider operation. See [WEBMAIL.md](docs/WEBMAIL.md) for its
authentication boundary, supported actions, and current limits.
Its chat-style presentation still uses email subjects, addresses, and reply
headers. Saved filters are personal views of captured mail, not automatic
forwarding/deletion rules. This interface does not claim Gmail feature parity.

Pending provisioning is retried explicitly, not by a background job that stores
passwords. A live Stalwart server and Enterprise license were not available during
development; the adapter has protocol-contract tests, but must pass the documented
live acceptance test against your exact Stalwart release before production use.

Single-server deployment is a single point of failure. Configure off-server
backups and sending/abuse limits in Stalwart. Add dashboard MFA and stronger abuse
controls before opening a public hosting service to unrelated customers.

## Reuse and contribution

This project is [MIT licensed](LICENSE). You may fork, modify, and redistribute the
application under that license. Dependencies and Stalwart retain their own licenses.
See [CONTRIBUTING.md](CONTRIBUTING.md) for coding conventions and extension steps,
and [SECURITY.md](SECURITY.md) for the trust boundaries and reporting guidance.

### People, signatures and templates

Conversations now group sent and received mail by correspondent, with newest-first
subject tabs inside each person's chat. Mailbox **Settings** provides a private profile
photo, an automatic rich signature, and reusable templates (including HTML and Word
`.docx` import). Templates are available in Compose and Reply. Dashboard **Settings**
has a separate administrator photo. See [native hosting](docs/NATIVE_HOSTING.md#conversations-and-personal-preferences)
for usage, privacy boundaries and size limits, and [API documentation](docs/API.md)
for the authenticated endpoints and storage contract.
