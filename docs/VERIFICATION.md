# Verification record

Checked locally on 22 November 2026, on macOS ARM64 with a temporary PostgreSQL 16
instance. No customer domains or real mail accounts were provisioned.

## Passed

- Go compilation, `go vet ./...`, and `go test -race -p 1 ./...`.
- PostgreSQL integration tests: migrations, bootstrap, session/CSRF/origin behavior,
  cross-tenant denial, domain verification, concurrent quota enforcement, mailbox
  lifecycle, audit isolation, and durable retry after a provider failure.
- Stalwart TLS/JMAP contract tests, including per-object failure responses,
  ownership-marker matching, tenant/quota fields, and numbered credential encoding.
- React tests: API cache/CSRF handling, session expiry, native-install dismissal,
  install-event handling, and stale-response rejection when changing businesses.
- TypeScript production build and Prettier formatting checks.
- Production HTTP smoke checks for the compiled Go server: HTML, static assets,
  health, manifest, all referenced PNG icons, service worker, CSP, and no-store API headers.
- Combined development/production Compose configuration validation.
- Frontend production-dependency audit: no reported vulnerabilities at check time.
- Local browser sign-in, authenticated settings/workspace data, and dark-theme
  sign-in visual inspection using a simulated business.
- Local mock-email workflow using the checksum-verified native Mailpit v1.34.0
  binary on loopback: SMTP submission and API-confirmed capture of the original,
  generated reply, and a custom single-message example. Verified original HTML,
  plain text, and `demo-note.txt` attachment. No public mail was sent.
- Demo script syntax, invalid-address/port/header rejection, optional Mailpit
  Compose profile validation, and readable failure when Docker is stopped.
  Native dashboard health/pages and idempotent demo-account seeding passed again.
- Docker-free launcher on macOS: first-run private PostgreSQL initialization,
  Go/React builds, authenticated demo seeding, captured email/reply, and automatic
  shutdown using `--check`. The data directory and DB password permissions were
  confirmed as 0700 and 0600 respectively.
- Native `--dev --no-seed`: Vite page and API proxy, email persistence across
  restart, duplicate-launch rejection, and Ctrl+C cleanup of all owned services.
- Native restart recovery: cleanly stopped the confirmed orphan database using
  its project data directory, then passed `--check --no-seed` with existing data.
  All five demo ports were available afterward; PostgreSQL removed its runtime
  PID file and both database/captured-mail files were retained. Five regression
  tests passed for terminal hangup/interrupt/termination, repeated shutdown
  signals, owned-process cleanup and lock release, refusal of live listeners,
  accurate socket errors, and immediate restart after TCP TIME_WAIT.
- Intentional native Mailpit startup failure: the launcher reported the failed
  service and stopped its PostgreSQL/API children; all five demo ports were closed.
- Local webmail: Go race tests with PostgreSQL for separate mailbox sessions,
  admin/mailbox separation, exact address scoping, message/attachment denial,
  CSRF, forced sender, .test-only recipients, reply authorization, reset/delete
  session revocation, unavailable-catcher errors, and live-mode rejection.
- Webmail React tests for compose/reply, failed-send draft preservation, discard
  confirmation, search, inert message markup, and stale-response/session guards.
  All nine frontend tests, TypeScript build, and formatting checks passed.
- Actual Mailpit integration through `scripts/check_webmail.py`: Alex sends to
  Hello, Hello reads and replies, both folders update, and logout revokes the
  session. Authenticated attachment download returned the sample file with forced
  download headers. The updated API ran on a temporary port alongside the user's
  existing native services.
- Browser inspection of the new `/mail` login, dark inbox/reader, light compose
  window, and a message sent using the browser form. Its success notice and Sent
  entry were observed, and the capture was verified in Mailpit.
- Extended conversation backend: Go race tests with PostgreSQL passed for
  file/photo validation and size limits, authorized raster previews, actual
  reply-header threading, header-cache bounds, and mailbox-scoped saved-filter
  creation/update/deletion. `go vet` passed; affected tests were rerun after the
  send response gained its captured-message ID.
- Updated real Mailpit smoke check: document and generated PNG bytes survived
  send/download unchanged; the PNG preview had the expected image type; replies
  returned in one chronological conversation; saved filters remained account
  scoped and could be edited/deleted. Send returned the exact capture ID needed
  to keep a newly sent conversation open. Only disposable test rules were deleted.
- Updated frontend suite: all 14 tests passed, including attachment-only sends,
  photo selection/removal and size limits, failed-send draft/file preservation,
  saved-filter CRUD and criteria, inline compose navigation guards, and keeping a
  newly sent conversation open. A regression check covers an in-flight reply
  surviving a failed conversation refresh and retry. TypeScript build and
  formatting checks passed.
- Browser checks against the latest build: desktop conversation cards, document
  downloads/photo previews, inline reply and new-message panes. A message sent
  through the browser remained open as its new conversation. At the emulated
  iPhone 16 Pro Max viewport (440 × 956), the conversation filled the viewport
  with its own back header and bottom reply bar; the dashboard header left no gap.

- Contacts/editor update: all 16 frontend tests passed, including compact replies,
  saved contacts, group expansion, star/archive persistence through the API client,
  and hostile HTML stripping. The production TypeScript/Vite build passed.
  Go race tests with PostgreSQL passed, including organizer isolation, stale
  revisions and invalid group references. The real Mailpit smoke check verified
  formatted HTML survived capture and scripts were stripped, alongside the
  existing file/photo/reply checks. Temporary QA API stopped afterward.

- Compact-tools/expanded-reader update: production build, frontend tests for
  on-demand tools, Unicode emoji search, combined queue deduplication, expanded
  draft preservation, forwarding, and table sanitization passed. Backend
  formatting tests preserve safe table structure while stripping attributes.
  The Unicode 17 catalog contains 3,944 fully-qualified sequences, bundled with
  its license and loaded separately from the initial UI bundle.

- Popover/layout fix: all 23 frontend tests and the production build passed.
  Regression checks cover viewport bounds at desktop/mobile/keyboard-reduced
  sizes, flipping below a top-edge trigger, and rendering outside the scroll pane.
  Browser accessibility inspection confirmed the sandbox label moved into the
  sidebar and the theme action precedes Install mail app. The visual check was
  interrupted by ongoing browser use; full popover screenshots remain unverified.

## Not verified here

- Docker image build/start: the local Docker daemon was unavailable. Compose syntax
  was validated, and the corresponding native Go/React builds were run successfully.
  The full `scripts/local_demo.py` Docker orchestration therefore remains unverified;
  its seeding and SMTP-capture steps were checked against native local services.
- Live Stalwart Enterprise provisioning, IMAP/SMTP authentication, DNS publication,
  message delivery, and server-specific credential revocation. Follow the live
  acceptance test in DEPLOYMENT.md with your exact engine version and license.
- The new rich editor and contacts layout have not had a browser visual pass;
  real mobile selection, keyboard, formatting and undo need device checks.
- Real Android/iOS home-screen installation, software-keyboard behavior, and full
  physical phone/tablet visual inspection.
  The PWA resources and hook behavior were checked; device/browser behavior still
  needs the manual tests in PWA.md.
- Production backup restoration, external penetration testing, high-load benchmarks,
  and availability/failover testing.
- Native launcher execution on Linux/WSL; the documented native workflow was
  exercised on macOS with Go 1.27.4, Node 26, PostgreSQL 16, and Mailpit 1.34.0.

This record describes observed checks, not a production certification. Development
uses a visible simulation mode and never claims that simulated mailboxes deliver mail.
