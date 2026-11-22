# Security boundaries

Postharbor is an initial self-hosted control panel. It is not independently audited
and does not implement every control required by a public email-hosting business.

Implemented boundaries include tenant-scoped authorization and SQL queries,
tenant/domain foreign keys, native Stalwart tenant mapping, opaque hashed sessions,
bcrypt password hashes, CSRF and Origin validation, bounded JSON requests, login
throttling, parameterized SQL, HTTPS-required public configuration, and no private
PWA response caching. The simulation provider is restricted to local origins.

The Go process and PostgreSQL application role are trusted. Database row-level
security is not configured. The Stalwart token can manage multiple tenants and is
therefore highly sensitive. A compromise of this backend can affect all hosted
businesses. Restrict management API access, protect secrets/backups, and keep the
application and mail engine patched.

Administrator MFA, distributed abuse controls, public signup/recovery, and a formal
security audit remain future work. A single VPS has no automatic failover. Sending
limits, authenticated SMTP authorization, spam handling, and open-relay prevention
must be configured in Stalwart; dashboard limits do not replace those controls.

## Local webmail and Mailpit

The `/mail` interface is a local development sandbox, enabled only with the
simulation provider and an explicit `MAILPIT_URL`. It is not the production
Stalwart mail-client boundary. Native and Docker demo launchers keep its services
on loopback; do not expose this setup to public users.

Mailbox authentication is separate from administrator authentication:

- Simulation credentials are bcrypt hashes associated with a mailbox. Plaintext
  mailbox passwords are not stored. Live mailbox credentials remain in Stalwart.
- Mailbox sessions use independent random tokens, hashed in PostgreSQL, and an
  HttpOnly, SameSite=Strict cookie scoped to `/api/webmail`. Secure is enabled for
  HTTPS origins. Sessions expire after 12 hours; a new mailbox login revokes the
  prior login. Password resets and deletion revoke the mailbox sessions.
- Every webmail route checks the current active mailbox. Writes also require the
  configured Origin and that mailbox session's CSRF token. An administrator
  cookie or administrator CSRF token cannot substitute for mailbox authentication.
- Message lists, individual reads, read-state updates, replies, and attachment
  downloads/previews authorize the signed-in address on the server. Attachment
  endpoints additionally require the requested MIME part to belong to that message.
- Conversation membership does not bypass mailbox authorization: each returned
  message must be visible to the caller even if reply headers reference another
  mailbox's captures. Saved-filter CRUD is likewise scoped to the session's mailbox.
- Sending uses the authenticated mailbox as sender and accepts only `.test`
  recipients. The app submits to Mailpit's capture API, never its release/relay
  endpoints. Keep relay and forwarding disabled in the local catcher.

Incoming HTML is rebuilt with an attribute-free formatting allowlist on the server
and sanitized again in the React reader. Scripts, URLs, embeds, styles and remote
images are excluded. Plain text and metadata are escaped by React. Downloaded attachments are served as attachments with
`application/octet-stream`, `nosniff`, and a restrictive sandbox CSP. Message
responses are `no-store`; neither the service worker nor browser localStorage
stores messages, credentials, or drafts. Downloads intentionally create files
on the user's device and should be handled as untrusted attachments.

File uploads are limited to 10 attachments and 5 MiB of decoded data per message,
with an 8 MiB request cap specifically for send. Metadata, base64, and decoded
sizes are validated on the server. These limits do not constitute malware scanning.
Inline attachment previews are limited to byte-identified JPEG/PNG/GIF/WebP images;
HTML and SVG documents remain downloads. Neither a claimed MIME type nor a filename
extension is sufficient to authorize an inline preview. Draft previews use
in-memory data URLs for the supported raster MIME types; they do not persist
selected files in browser storage or publish them to an external service.

**The original Mailpit viewer on port 8025 is an unauthenticated developer tool
with access to all captured mail.** It does not enforce Postharbor mailbox or
tenant isolation. Loopback access and trusted local users are assumptions of this
demo. Captured sender/recipient headers may also come from scripts or other local
tools; Sent is not an authenticated submission audit trail. Deleting a simulated
mailbox does not delete these captures. Clear relevant captures before reusing
an address, or the new account can see retained messages for that same address.

The native `.local-demo/` directory contains private database state, a local
database credential, and captured mail. It is excluded from Git and the Docker
build context. Protect it and any backups. Re-running the demo seed resets the
two documented demo mailbox passwords and invalidates their sessions; never use
these known demo credentials for real accounts. See [WEBMAIL.md](docs/WEBMAIL.md)
for remaining feature and retention limits.

## Reporting a vulnerability

Contact the repository maintainer privately before publishing details that expose
users. Use GitHub's private vulnerability reporting if the maintainer enables it.
Include affected versions, impact, and a minimal reproduction using disposable data.
Do not attach real tokens, passwords, database dumps, customer messages, or mailbox
contents. This repository does not invent a security contact address on an
unregistered domain; maintainers should add their verified contact before release.
