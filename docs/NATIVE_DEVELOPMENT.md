# Run locally without Docker

Postharbor can run directly on macOS or Linux. The native launcher starts
PostgreSQL, the Go API, the React dashboard, and Mailpit as ordinary local
processes. It never calls Docker or starts system-wide background services.
Run it as your normal user, not with `sudo`. On Windows, use a Linux/WSL environment.

## 1. Install prerequisites once

Required: Python 3, Go 1.25+, Node.js 22.12+ with npm, PostgreSQL 16+, and Mailpit
1.34+. The first run needs internet access for npm packages and Go modules.

### macOS with Homebrew

If Homebrew is already installed:

```sh
brew install python go node@24 postgresql@16 mailpit
export PATH="$(brew --prefix node@24)/bin:$(brew --prefix postgresql@16)/bin:$PATH"
```

The `export` makes the selected Node and PostgreSQL commands available in this
terminal. Repeat it in new terminals, or add the same line to your shell's
configuration file. Do not run `brew services start`: the launcher starts its
own isolated services. A separately running PostgreSQL service on port 5432 is
fine; this demo uses port 55432.

Check the selected versions:

```sh
node --version
go version
postgres --version
mailpit version
```

If an older Node installation from nvm takes precedence, run the `export PATH`
line after nvm initializes. A Node 20 default does not meet this project's requirement.

Official formulae: [Node 24](https://formulae.brew.sh/formula/node@24),
[PostgreSQL 16](https://formulae.brew.sh/formula/postgresql@16),
[Go](https://formulae.brew.sh/formula/go), and [Mailpit](https://formulae.brew.sh/formula/mailpit).

### Ubuntu/Linux

Install Python 3 and PostgreSQL 16+ using your distribution's packages. The
[PostgreSQL Ubuntu instructions](https://www.postgresql.org/download/linux/ubuntu/)
explain the official repository if your Ubuntu version does not include the
required PostgreSQL version. Install a supported [Go release](https://go.dev/doc/install),
[Node.js release](https://nodejs.org/en/download), and
[Mailpit binary](https://mailpit.axllent.org/docs/install/) for your architecture.

On a typical PostgreSQL 16 package installation, expose its server binaries with:

```sh
export PG_BIN=/usr/lib/postgresql/16/bin
```

Use the matching directory if you installed a different major version. Ensure
`go`, `node`, `npm`, and `mailpit` are on `PATH`, then use the same launcher below.
These are local-development instructions, not a public Ubuntu production setup.

## 2. Start the UI and test email

From the project directory:

```sh
python3 scripts/native_demo.py
```

Or use `make native`. Leave this terminal open. The launcher:

1. Checks dependencies and rejects occupied ports.
2. Installs frontend packages if absent, builds React, and compiles the Go API.
3. Creates a private PostgreSQL cluster in `.local-demo/postgres` on first use.
4. Uses a random local DB password and SCRAM authentication, with loopback-only TCP access.
5. Starts Mailpit and Postharbor, then waits for their readiness checks.
6. Seeds Harbor Studio, its `.test` domain, and two simulated mailbox records.
7. Sends an email, attachment, and generated reply into Mailpit, verifying capture.

Open:

| Screen | Address |
| --- | --- |
| End-user webmail: Inbox, Sent, Compose, Reply | http://localhost:8080/mail |
| React dashboard and production PWA assets | http://localhost:8080 |
| Mailpit diagnostics: all captured test messages | http://localhost:8025 |

Default local dashboard accounts:

| Role | Email | Password |
| --- | --- | --- |
| Platform owner | `owner@example.test` | `local-development-password` |
| Harbor Studio admin | `admin@harbor.test` | `local-business-password` |

Open `/mail` and sign in with **`alex@harbor.test` / `local-mailbox-password`**.
The second demo mailbox is **`hello@harbor.test`**, with the same password.
These mailbox logins are separate from the administrator accounts above.

These are development credentials. Existing administrator passwords are never
overwritten. Demo seeding resets the two named demo mailbox passwords to
`local-mailbox-password` and revokes their mailbox sessions; use `--no-seed` to
preserve changes to those demo credentials and avoid another generated conversation.
The `.env` used by Docker is **not** loaded: the native launcher supplies its own
simulation-only settings. Its database is separate from Docker and any earlier
temporary demo database, so accounts created there do not appear automatically.

**Ctrl+C stops the processes and keeps your data.** Run the same command to resume.
For a restart without seeding or signing out your current browser session:

```sh
python3 scripts/native_demo.py --no-seed
```

## 3. Develop React with hot reload

Stop the first launcher, then run:

```sh
python3 scripts/native_demo.py --dev
```

Or use `make native-dev`. Open **http://localhost:5173/mail** for webmail or
**http://localhost:5173** for administration. Vite automatically
refreshes React edits and proxies API requests to Go on port 8080. It uses a
strict port so it cannot silently move to an origin the API would reject.

The Go binary is rebuilt when the launcher starts; restart the launcher after
Go changes. PWA/service-worker checks should use the default built mode on 8080;
the development server does not register a production service worker.

After modifying dependencies or pulling a changed lockfile, reinstall them:

```sh
python3 scripts/native_demo.py --dev --install
```

## 4. Send more test messages

In `/mail`, select **Compose**, enter `hello@harbor.test`, a subject, and a message,
then choose **Send message**. Open **Sent** to see your submission. Sign out and sign in
as `hello@harbor.test` to open the message in **Inbox** and choose **Reply**.
Both demo mailbox passwords are `local-mailbox-password`.

Compose opens in the conversation pane; Reply is inline beneath the conversation.
Add files or photos with the attachment controls (up to 10 files, 5 MiB combined).
Create saved filter chips above the list to reuse sender/recipient/subject criteria.
On mobile, conversations and new messages occupy the full viewport with their own
Back control. See [WEBMAIL.md](WEBMAIL.md) for the limits and complete walkthrough.

The server fixes the sender to your signed-in address and only accepts `.test`
recipients. This keeps the experience local; no domain or public mail setup is needed.

While the launcher is running, open another terminal in the project directory:

```sh
python3 scripts/send_demo_mail.py
```

For a custom incoming example:

```sh
python3 scripts/send_demo_mail.py \
  --from customer@outside.test \
  --to hello@harbor.test \
  --subject 'Testing without Docker' \
  --body 'Hello from my local computer.'
```

The script's sample reply is automatic; replies composed in `/mail` are written
and sent by you. Add `--no-reply` to the script for one generated message.
Postharbor's webmail authenticates mailbox users and filters each address on the
server. Mailpit at port 8025 remains an all-messages diagnostic viewer, not a
set of IMAP inboxes. No live Stalwart authentication or public delivery is involved.
See [WEBMAIL.md](WEBMAIL.md) for the supported flow and limitations.

## Data, logs, and troubleshooting

All generated state lives under `.local-demo/`, which is excluded from Git and
Docker build context. It contains the database, private DB password, captured
email, compiled API, launcher lock, and service logs. Do not publish this folder.
Do not delete it while services run; deleting it later erases local demo data.

Ports: PostgreSQL 55432, API 8080, Mailpit HTTP 8025 / SMTP 1025, and optional
Vite 5173. The launcher does not attach to or stop an unrelated process on these
ports. Use the other application's terminal to stop it before retrying.
The port check allows normal TCP cleanup from recently closed connections, so
that cleanup alone does not prevent an immediate restart.

- **Missing command:** install the dependency and check `PATH`; set `PG_BIN` for a
  PostgreSQL bin directory, or `GO_BIN` / `MAILPIT_BIN` to explicit executable paths.
- **Owner login fails after a password change:** start with
  `NATIVE_OWNER_PASSWORD='your-current-local-password' python3 scripts/native_demo.py`,
  or use `--no-seed` and sign in with your current credentials.
- **Startup failed:** inspect `.local-demo/api.log`, `postgres.log`, `mailpit.log`,
  and, in development mode, `vite.log`. The launcher stops its started services
  when a later startup step fails.
- **A PostgreSQL major version changed:** use the original major version with
  `PG_BIN` or follow PostgreSQL's migration procedure. Existing data is never
  automatically deleted or upgraded.
- **Terminal was forcibly killed:** its child process groups may still run.
  Inspect the above ports/processes before restarting. Do not delete a running
  database or kill unrelated PostgreSQL instances. Normal terminal closure
  (`SIGHUP`) now uses the same cleanup as Ctrl+C; repeated shutdown signals are
  ignored while cleanup finishes. An uncatchable kill or system crash still
  requires inspection.
- **Dashboard signed out after a restart:** normal seeding uses and revokes the
  owner's session. Sign in again, or restart using `--no-seed`.
- **Mailbox signed out after seeding:** the demo mailbox passwords are reset and
  sessions revoked. Sign in again with `local-mailbox-password`, or use `--no-seed`.
- **Webmail unavailable in a manual launch:** set `MAIL_PROVIDER=simulation` and
  `MAILPIT_URL=http://127.0.0.1:8025`, and start Mailpit. The native launcher does
  this automatically. A changed backend needs a launcher restart.

### Recover an occupied PostgreSQL port

If startup reports **Local port 55432 is in use**, first check its owner:

```sh
lsof -nP -iTCP:55432 -sTCP:LISTEN
pg_ctl -D "$PWD/.local-demo/postgres" status
```

Run these commands from the project directory, with the PostgreSQL tools on
`PATH` as described above. If `PG_BIN` is configured, use `"$PG_BIN/pg_ctl"`
instead of `pg_ctl`. The PID reported by both commands must match, and the
PostgreSQL command must use this project's `.local-demo/postgres` directory.
If the launcher is still running, use Ctrl+C in its terminal and let shutdown
finish. If it has exited but its database remains, stop only that database:

```sh
pg_ctl -D "$PWD/.local-demo/postgres" -m fast -w -t 30 stop
python3 scripts/native_demo.py --no-seed
```

This performs a clean PostgreSQL shutdown and keeps your database and captured
mail. `--no-seed` also preserves existing demo passwords and sessions. Do not
delete `postmaster.pid`, remove `.local-demo/`, or stop every PostgreSQL process
to resolve a port conflict. A different process on the port needs its own
application's shutdown procedure.

For a startup/seed/SMTP smoke check that shuts down automatically:

```sh
python3 scripts/native_demo.py --check
```

This check preserves local data, adds sample conversations, and exercises the
webmail send/receive/reply API after seeding. To check webmail against an already
running server, use `python3 scripts/check_webmail.py`; it signs out the demo
mailbox sessions when finished. See
[LOCAL_TESTING.md](LOCAL_TESTING.md) for responsive layout and message-inspection
walkthroughs, and [DEPLOYMENT.md](DEPLOYMENT.md) for the separate live-mail setup.
