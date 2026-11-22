# Testing and release checks

## Automated tests

`go test ./...` covers domain/password validation, unsafe configuration rejection,
JMAP error handling, mailbox ownership recovery, and tenant/quota payload contracts.

With `TEST_DATABASE_URL`, the same command also exercises PostgreSQL migrations,
bootstrap, login/cookies/CSRF, tenant-scoped reads and writes, ownership verification,
concurrent quota reservations, mailbox reset/deletion, audit scoping, and session
revocation after a dashboard password change. Tests create a randomly named schema;
they do not truncate existing application tables. Use a dedicated test database.

`go test -race ./...` adds Go's race detector. `go vet ./...` performs static checks.
CI runs both with PostgreSQL. Failed compilation due to a host resource issue is
not a passing test; rerun after correcting the issue.

`npm test` checks the shared API client's cookie/CSRF/no-cache behavior and the PWA
hook's unsupported-browser fallback, native prompt dismissal, and installation
event. A React workspace test also rejects delayed results from a previously selected
business. `npm run build` type-checks all TypeScript and produces the actual PWA assets.

`python3 -m unittest discover -s scripts -p 'test_native_demo.py' -v` checks the
native launcher's signal handling, cleanup ownership, lock release, and port
availability checks. It uses temporary test processes and loopback sockets;
it does not start PostgreSQL or touch `.local-demo/`.

The Stalwart tests use a local TLS HTTP server and realistic JMAP envelopes.
They prove our client sends/handles the intended contract; they do **not** prove a
particular real Stalwart release/license configuration accepts that contract.

## A local walkthrough

For a single-command dashboard preview plus captured email/attachment/reply,
use [the Docker-free launcher](NATIVE_DEVELOPMENT.md) or the optional Docker path
in [LOCAL_TESTING.md](LOCAL_TESTING.md). `python3 scripts/native_demo.py --check`
builds, starts, seeds, verifies capture, then stops the native services; it keeps
the local database and captured messages. It also invokes
`scripts/check_webmail.py` to exercise Alex/Hello login, compose with document/photo
attachments, byte-exact download, image preview, Sent/Inbox, read state, reply,
conversation grouping, saved-filter CRUD, and logout against actual local captures.
It adds two captured messages and removes only its own temporary test filter.
The same script can
be run while the demo is already running; use `BASE_URL` for a non-default origin.
It adds two test captures and revokes the demo mailbox sessions. The Mailpit demo tests local SMTP
capture separately from simulated account provisioning; it does not replace
the live Stalwart acceptance checks below.

Run `scripts/seed_demo.py` against simulation, then:

1. Sign in as the owner. Inspect business selection, domains, and two mailboxes.
2. Add another `.test` domain. Check pending status, DNS instructions, and explicit
   simulated verification.
3. Create another mailbox within quota. Search its name/address.
4. Reset a disposable mailbox credential. Confirm deletion requires its full address.
5. Log in as the demo business administrator. Confirm only its business is shown.
6. Change the dashboard password and verify the old session no longer works.
7. Test light/dark mode and all layouts at mobile/tablet/desktop widths.
8. Build/serve production assets for install and offline testing, rather than
   inferring PWA correctness from a Vite development page.

For end-user mail, follow [WEBMAIL.md](WEBMAIL.md): sign in at `/mail` as Alex,
compose to Hello, inspect Sent, sign in as Hello, open the received message, and
reply. Check that an unrelated mailbox cannot read the message or download its
attachments by copying an ID. Test failed sends with Mailpit unavailable, and
confirm draft text and selected files remain available for retry. Reloading
discards in-memory drafts. These are local webmail acceptance checks, not
public-delivery checks.

For conversation and attachment changes, also check:

1. Send a small document and raster photo, download the document, and preview the
   image as the recipient. Try an SVG or HTML attachment: it must not render as
   active inline content.
2. Reject more than 10 attachments or more than 5 MiB of total file data before
   capture. Verify server rejection as well as the browser's friendly validation.
3. Reply more than once and inspect chronological sent/received cards. An unrelated
   message with a similar subject must not become part of the conversation just
   because the subjects match.
4. Create two named filter chips, edit/delete one, sign out and back in, then
   confirm persistence and mailbox isolation. Check combined criteria and search.
5. At phone widths, open a conversation and Compose: the app header/list should
   disappear, Back should restore the list, and the keyboard should not hide the
   send controls. Attempt navigation with an unsent draft and verify its guard.

## Before deploying real email

Complete [DEPLOYMENT.md's live acceptance test](DEPLOYMENT.md#5-live-acceptance-test--required-before-customer-use).
That includes real SMTP/IMAP login, message delivery, per-tenant isolation in the
mail engine, credential reset behavior, generated DNS, and backup recovery.

Inspect the service worker's Cache Storage after authenticated use: there must be
no API responses, sessions, or mailbox data. Test installation on actual Android
and iOS devices and keep any untested device/browser behavior listed in release notes.
