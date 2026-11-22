# Local UI and mock email testing

This setup lets you try the application without pointing a domain at your laptop.
**For a completely Docker-free setup, follow [NATIVE_DEVELOPMENT.md](NATIVE_DEVELOPMENT.md).**
It provides the same dashboard and test-message viewer with native processes,
including a single-command React hot-reload mode. The Docker setup below is optional.

All sample addresses use `.test`. Choose the screen for your task:

| What you want to inspect | Where | What it tests |
| --- | --- | --- |
| React interface, themes, businesses, domains, mailbox settings | Postharbor, http://localhost:8080 | The real Go API and PostgreSQL, with simulated mail-engine provisioning |
| End-user conversations, Inbox/Sent, inline Compose/Reply, files/photos, and filter chips | Postharbor Mail, http://localhost:8080/mail | Mailbox login and per-address access to local captured messages |
| All captured email, HTML/source inspection | Mailpit, http://localhost:8025 | Shared local diagnostics, including script-generated samples |

The admin dashboard at `/` manages accounts. **The end-user interface at `/mail`
reads and sends local test email.** It uses separate mailbox login and the Go API
filters messages by the signed-in address. Mailpit at port 8025 shows every
captured message in one shared diagnostic viewer. This demo does not test live
Stalwart authentication, IMAP inboxes, engine quotas, or internet delivery.

## 1. Start the optional Docker demo

Prerequisites: Docker Desktop/Engine running with Docker Compose v2, and Python 3.
You do not need Go, Node.js, a registered domain, or a Stalwart license for this path.
An internet connection is needed on the first run to download/build the images.

In a terminal opened in the project directory:

```sh
python3 scripts/local_demo.py
```

The equivalent shortcut is `make demo` if Make is installed. The script:

1. Checks Docker is running and creates `.env` from `.env.example` only if missing.
2. Refuses a live mail provider or a non-local application origin.
3. Builds and starts PostgreSQL, Postharbor, and the optional `demo` Mailpit service.
4. Waits for startup, then creates **Harbor Studio**, `harbor.test`, and two mailboxes.
5. Sends an email from `alex@harbor.test` to `hello@harbor.test`, then generates a reply.
6. Queries Mailpit to verify both messages were captured before reporting success.

The first build takes longer; later builds reuse Docker's cache. Existing `.env`
settings and database records are preserved. The seed operation is idempotent,
but each run deliberately adds a new email conversation. Mailpit retains the most
recent 200 messages. Demo setup signs out any existing owner browser session.
It also resets `alex@harbor.test` and `hello@harbor.test` to the documented local
mailbox password and revokes those mailbox sessions. The helper uses
`compose.demo.yml` to configure the app's internal Mailpit connection.

## 2. Sign in and inspect the React UI

Open **http://localhost:8080**. Default local accounts:

| Role | Email | Password |
| --- | --- | --- |
| Platform owner | `owner@example.test` | `local-development-password` |
| Harbor Studio administrator | `admin@harbor.test` | `local-business-password` |

These are disposable local credentials from the example configuration. If you
already changed them, use your current credentials. The mailbox password
`local-mailbox-password` is used at `/mail`; it is not an administrator login.

Try this sequence:

1. Sign in as the owner and select **Harbor Studio**.
2. Inspect Overview, Domains, Mailboxes, Activity, and Settings.
3. Add another `.test` domain, open **DNS & setup**, and explicitly simulate ownership verification.
4. Create a mailbox, search for it, and inspect reset/delete dialogs. The global limit is five mailboxes by default.
5. Sign out and sign in as the business administrator to inspect its restricted workspace.
6. Toggle light/dark mode. In browser responsive/device tools, try widths of 390, 768, and 1440 pixels.

The Docker build serves production PWA assets. Try the Install control in a
supported desktop browser. Responsive browser emulation checks layout; it does
not prove Android/iOS installation. A real phone cannot access your computer via
its own `localhost`; device testing needs a reachable HTTPS origin. See [PWA.md](PWA.md).

## 3. Send and receive through the new mail UI

Open **http://localhost:8080/mail** and sign in as `alex@harbor.test` with
`local-mailbox-password`.

1. Inspect **Inbox** and **Sent**. The seeded conversation has a message in each direction.
2. Choose **Compose** to open the editor in the conversation pane. Address it to
   `hello@harbor.test`, enter a subject/body, and attach a small document and photo.
3. Choose **Send message**, then open **Sent** to inspect your submitted message.
4. Sign out and sign in as `hello@harbor.test` with `local-mailbox-password`.
5. Open the message in **Inbox**, choose **Reply**, write a response, and send it.
6. Sign back in as Alex to read the reply. Use **Refresh messages** if needed.
7. Try **Search mail**, **Unread**/**Attachments** chips, and a saved sender filter.
8. On a narrow screen, open the conversation: it should fill the viewport without
   reserving space for the main app header. Use Back to return to the list.

The server sets the sender from your authenticated mailbox. Up to ten comma-separated `.test`
recipients, a subject, plain text, and up to 10 files/photos are supported, with
5 MiB total file data per message. Safe raster photos can be previewed, and
attachments can be downloaded. Drafts and selected files stay in memory,
so they are not kept after a page reload. See [WEBMAIL.md](WEBMAIL.md).

### Optional: inspect Mailpit diagnostics

Open **http://localhost:8025**. No login is required for this local catcher.

You should see two subjects containing the same `[Local demo ...]` identifier:

- `alex@harbor.test` → `hello@harbor.test`: the original message with `demo-note.txt` attached.
- `hello@harbor.test` → `alex@harbor.test`: an automatic sample reply with reply headers.

Open each message to inspect sender, recipient, HTML, plain text, source headers,
and the attachment. Both directions appear in this one capture list, not in
separate real inbox/sent folders. The reply comes from our script, not a human or
an auto-responder in the mail server.

Generate another conversation:

```sh
python3 scripts/send_demo_mail.py
```

Try a different fictional sender and custom content:

```sh
python3 scripts/send_demo_mail.py \
  --from customer@outside.test \
  --to hello@harbor.test \
  --subject 'A new customer enquiry' \
  --body 'Hello! This is a local incoming-mail example.'
```

Add `--no-reply` to capture just one message. Run `--help` for all options. Addresses
must end in `.test`, and SMTP/HTTP connections are fixed to loopback. Every run
adds a unique subject marker and checks Mailpit's stored messages. It never
clears previous messages. Use Mailpit's delete controls to remove test captures.

For another local application submitting test mail, the settings are:

| Setting | Value |
| --- | --- |
| SMTP host when running on your computer | `127.0.0.1` |
| SMTP host from a container on this Compose network | `mailpit` |
| SMTP port | `1025` |
| Authentication | None |
| TLS | Off, for this loopback-only test setup |
| Viewer/API | `http://localhost:8025` |

No relay or forwarding is configured. Do not enable either for this mock test.
The management API itself has no SMTP notification-sending feature; the demo
script submits these samples independently of the dashboard.

## 4. Stop, resume, or inspect logs

```sh
# Stop everything, preserving the database and captured email.
docker compose --profile demo down

# Resume existing data without seeding another conversation.
docker compose -f compose.yml -f compose.demo.yml --profile demo up -d --wait

# Inspect startup errors.
docker compose --profile demo logs --tail=50
```

`make demo-stop` is the same stop command. Do not add `-v` unless you intend to
erase the database and Mailpit volumes. The optional Mailpit service does not
start during ordinary `docker compose up` or production deployment.

## Hot reload or a native Mailpit process

For React changes, follow [README's development instructions](../README.md#start-development-with-hot-reload)
to run Go on port 8080 and Vite on port 5173. Start only the Docker dependencies:

```sh
docker compose --profile demo up -d db mailpit
```

Do not run the Docker `app` service at the same time as the native Go API on port
8080. Open **http://localhost:5173**, set `APP_ORIGIN` to that exact origin for Go,
and seed with `BASE_URL=http://localhost:5173 python3 scripts/seed_demo.py`.
Export `MAILPIT_URL=http://127.0.0.1:8025` before starting Go and open
**http://localhost:5173/mail** for the end-user UI. The mail script and diagnostic
viewer still use ports 1025 and 8025.

If you already use native PostgreSQL/Go instead of Docker, install a standalone
[Mailpit binary](https://mailpit.axllent.org/docs/install/), then run it in another terminal:

```sh
mailpit --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025 \
  --disable-version-check --allowed-hosts localhost,127.0.0.1
```

Run `python3 scripts/send_demo_mail.py` as usual. Stop native Mailpit with Ctrl+C.
Without `--database`, this native command uses temporary storage that is removed
on exit; the Docker demo instead uses a persistent named volume.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Docker is not ready / cannot connect to daemon | Open Docker Desktop and wait until its engine is running; on Linux, start Docker Engine. |
| Port already allocated | Stop your other local instance using 8080, 5433, 8025, or 1025. Avoid running both Docker and native Go on 8080. |
| Not enough disk space during build | Free disk space for the container images and build cache; do not delete database volumes as a shortcut. |
| Origin/CSRF rejected | Open the exact `APP_ORIGIN`; `localhost` and `127.0.0.1` are different origins. |
| Demo seeding cannot sign in | Use the current owner's password as `BOOTSTRAP_PASSWORD`; an existing database is never reset by changing `.env`. |
| UI signed out after seeding | Sign in again. The seed script uses the owner session and logs out when done. |
| No test email | Run `python3 scripts/send_demo_mail.py`; creating a mailbox alone does not send a message. |
| Webmail unavailable | Restart the backend with `MAIL_PROVIDER=simulation` and the correct `MAILPIT_URL`; the demo launchers configure this automatically. |
| Mailbox login fails after upgrading an old demo | Run the seed step again to provision the two known demo mailbox credentials. |
| Mailpit list empty after a native restart | The native command above is temporary; use Docker's named volume for persistence. |

Official references: [Mailpit Docker setup](https://mailpit.axllent.org/docs/install/docker/),
[SMTP submission](https://mailpit.axllent.org/docs/usage/sending-messages/),
and [the capture API](https://mailpit.axllent.org/docs/api-v1/).
