# HTTP API

Base path: `/api`. JSON responses are objects/arrays; errors are
`{"error":"Human-readable message"}`. All writes require `Content-Type:
application/json` and an `Origin` exactly matching `APP_ORIGIN`. Authenticated writes
also require `X-CSRF-Token`, obtained from login/session. Cookies are same-origin.

## Routes

| Method | Path | Purpose / permission |
| --- | --- | --- |
| GET | `/healthz` (outside `/api`) | Database readiness, no credentials |
| POST | `/login` | Dashboard login; rate limited |
| GET | `/session` | Current user, CSRF, safe frontend configuration |
| POST | `/logout` | Revoke current session |
| POST | `/account/password` | Change own password; revoke all own sessions |
| GET | `/tenants` | Owner: all businesses; business admin: own business |
| POST | `/tenants` | Owner: create business and initial admin |
| POST | `/tenants/{tenant}/provision` | Retry native tenant creation |
| GET | `/tenants/{tenant}/domains` | List authorized business's domains |
| POST | `/tenants/{tenant}/domains` | Reserve a domain and issue TXT challenge |
| POST | `/tenants/{tenant}/domains/{id}/verify` | Verify ownership and provision |
| GET | `/tenants/{tenant}/domains/{id}/dns` | DNS challenge, native zone, MX check |
| GET | `/tenants/{tenant}/mailboxes` | List authorized mailbox metadata |
| POST | `/tenants/{tenant}/mailboxes` | Reserve quota and provision a mailbox |
| POST | `/tenants/{tenant}/mailboxes/{id}/provision` | Retry pending mailbox creation |
| POST | `/tenants/{tenant}/mailboxes/{id}/password` | Replace mailbox credentials |
| DELETE | `/tenants/{tenant}/mailboxes/{id}` | Permanently delete mailbox/messages |
| GET | `/tenants/{tenant}/audit` | Latest 100 business-scoped actions |

Every tenant path is independently authorized. Guessing an ID does not confer
access. An inaccessible resource returns 404. Do not add a tenant ID from the
browser to a query without going through the service's authorization boundary.

## Request examples

Login:

```json
{"email":"owner@example.test","password":"local-development-password"}
```

Response sets the session cookie and returns `{"csrf":"random-session-value"}`.
React next fetches `/session`, which includes `user`, `csrf`, `mode`, `mail_host`,
`webmail_url`, and `max_mailboxes`. Role values are `platform_admin` / `tenant_admin`.

Create business:

```json
{
  "name": "Example Studio",
  "admin_name": "Example Administrator",
  "admin_email": "admin@example.test",
  "password": "a-unique-long-password",
  "max_mailboxes": 5,
  "quota_mb": 25600
}
```

Create domain: `{"name":"example.com"}`. The response contains a
`verification_token`. Publish it verbatim at `_postharbor.example.com` as TXT.
Verify with `{"simulate":false}`. Only local simulation and `.test` domains accept
`{"simulate":true}`. At most 20 domain reservations are allowed per business.

Create mailbox:

```json
{
  "domain_id": "ID_FROM_DOMAIN_RESPONSE",
  "local_part": "alex",
  "name": "Alex Morgan",
  "password": "a-unique-mailbox-password",
  "quota_mb": 5120
}
```

Mailbox names support lowercase letters, digits, and single separators `.`, `_`,
`+`, `-` between alphanumeric segments. The local part is limited to 64 characters.
Domains accept ASCII/Punycode DNS names. All quota values are **MiB** (1,048,576 bytes).
Per-mailbox limits range from 100 to 102400 MiB and must fit the business allowance.

Retry provisioning or reset credentials: `{"password":"a-unique-mailbox-password"}`.
Retries preserve a successfully created account's original password. A credential
reset in live mode replaces the complete Stalwart credential list, revoking app
passwords and passkeys as well; the UI warns before submission. In simulation,
resetting a password replaces the local bcrypt hash and revokes mailbox sessions.

Delete: `{"confirm":"alex@example.com"}`. In live mode this permanently deletes
the mailbox's mail-engine data. A pending account without a known provider ID must first finish
provisioning; this prevents silently orphaning a remotely-created account.
Simulation deletion removes the account and its mailbox sessions/read state, but
does not purge separate Mailpit captures. Clear captures before reusing a test address.

Change dashboard password:

```json
{"current_password":"the-current-password","new_password":"a-new-unique-password"}
```

## Status/error semantics

- 200: read or action succeeded. 201: resource created and provisioned where applicable.
- 400: invalid payload, password policy, or deletion confirmation.
- 401: session missing/expired or incorrect login.
- 403: origin/CSRF failure or owner-only permission failure.
- 404: resource absent or outside your tenant.
- 409: duplicate registration, pending prerequisite, failed DNS proof, or capacity limit.
- 413: local webmail send request or decoded attachment total exceeds its limit.
- 415: request is not JSON. 429: login limit exceeded.
- 502: mail provider operation failed. **Refresh the list before creating again:**
  a pending resource may have been committed. Use its explicit retry operation.

Resource status is `pending`, `active`, or (mailboxes only) `deleting`. Domain
`verified` is separate from `status`. The DNS endpoint's `mx_matches` does not
validate SPF/DKIM/DMARC or guarantee delivery. Mailbox JSON never includes a password.

The API is intended for a small installation: list endpoints are unpaginated,
audit is capped at 100 entries, one admin belongs to one tenant, and mutations are
serialized. Introduce pagination and more granular locks before large-scale use.

## Local webmail API

These routes use the same `/api` base, but a **separate mailbox cookie and CSRF
token**. Administrator sessions do not grant webmail access. They are available
only with `MAIL_PROVIDER=simulation` and an explicit `MAILPIT_URL`. See
[WEBMAIL.md](WEBMAIL.md) for setup and the local-only trust boundary.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/webmail/login` | Sign in using an active simulated mailbox's email/password |
| GET | `/webmail/session` | Return mailbox `user`, mailbox `csrf`, and `mode` |
| POST | `/webmail/logout` | Revoke the mailbox session |
| GET | `/webmail/messages?folder=inbox` | List messages addressed to the signed-in mailbox |
| GET | `/webmail/messages?folder=sent` | List captures whose sender matches the signed-in mailbox |
| GET | `/webmail/messages/{id}` | Read an authorized message's text and attachment metadata |
| GET | `/webmail/messages/{id}/conversation` | Read the authorized messages related by email reply headers, oldest first |
| POST | `/webmail/messages/{id}/read` | Mark the authorized message read for this mailbox |
| GET | `/webmail/messages/{id}/attachments/{attachment}` | Download an attachment from an authorized message |
| GET | `/webmail/messages/{id}/attachments/{attachment}/preview` | Preview an authorized attachment only when its bytes are a supported raster image |
| POST | `/webmail/send` | Submit a local `.test` message with the signed-in mailbox as sender |
| GET | `/webmail/filters` | List this mailbox's saved filter views |
| POST | `/webmail/filters` | Create a saved filter for this mailbox |
| PUT | `/webmail/filters/{id}` | Replace the criteria/name of an owned saved filter |
| DELETE | `/webmail/filters/{id}` | Delete an owned saved filter, without deleting any messages |

Login:

```json
{"email":"alex@harbor.test","password":"local-mailbox-password"}
```

The login response returns `{"csrf":"mailbox-session-token"}` and sets the
mailbox cookie. The session response contains `user: {id,address,name}`, `csrf`,
and `mode: "simulation"`. Include the mailbox token as `X-CSRF-Token` for writes;
the dashboard's CSRF token is not interchangeable with it.

Compose:

```json
{
  "to": "hello@harbor.test",
  "subject": "Hello from Alex",
  "text": "This message was composed in the local mail interface.",
  "attachments": [
    {"name":"hello.txt","content_type":"text/plain","content_base64":"SGVsbG8h"}
  ]
}
```

For a reply, add `"reply_to":"AUTHORIZED_MESSAGE_ID"`; this is the Postharbor
message identifier from the message list, not a caller-supplied sender or arbitrary
RFC message header. The server verifies access to that original message. A
successful submission returns `{"ok":true,"id":"CAPTURED_MESSAGE_ID"}` so the
UI can open the newly started conversation. This means capture in the local
test environment, not public delivery.

The UI and API's `to` string accept up to ten
comma-separated `.test` addresses. Subjects must be single-line and at most 200
UTF-8 bytes. Message text is limited to 7,000 UTF-8 bytes; it may be empty when
at least one attachment is present. The
authenticated sender must also use a `.test` address. There is no `from` input.

`attachments` is optional. Each item contains a file `name`, `content_type`, and
standard base64 `content_base64` payload. A message accepts at most 10 files with
5 MiB of combined decoded bytes. The send endpoint alone accepts an 8 MiB JSON
request; other JSON routes keep the standard smaller request cap. The server
checks file metadata, base64 encoding, and decoded sizes before calling Mailpit.
Filenames have directory prefixes removed, cannot contain control characters,
and must be 1–180 UTF-8 bytes after normalization. MIME values are parsed and
normalized; the server detects a type when the input type is empty.
The browser's client-side limits are convenience checks, not the security boundary.

Lists return `{"messages":[...]}`. Each summary includes `id`, `from`, `to`,
`subject`, `snippet`, `date`, `read`, and the numeric `attachments` count. Addresses
are `{name,address}` objects. Message details add `text`, `message_id`, and
`attachment_list: [{id,name,size,content_type}]`. Search is a client-side filter of the loaded
folder. The server independently scopes list, detail, read, reply, and attachment
access to the signed-in mailbox, regardless of browser filtering.
The local adapter reads the newest 200 Mailpit captures. Upstream payloads and
attachment downloads are bounded to 8 MiB.

Conversation responses are `{"messages":[MESSAGE_DETAILS...],"truncated":false}` in chronological
order. They follow real Message-ID/In-Reply-To/References relationships within the
retained captures, rather than merging messages solely by their subjects. Only
messages visible to the authenticated mailbox may be returned, even when a
referenced message exists in another mailbox's capture history.
The response contains at most the newest 50 connected messages. When earlier
connected messages are omitted, `truncated` is true. Message text is capped at
100 kB per returned body and `text_truncated` indicates that truncation. Thread
metadata is fetched with bounded concurrency and cached only for retained capture
IDs; message bodies are not cached by this lookup.

The preview endpoint verifies ownership and the MIME part like a download, then
checks the bytes for JPEG, PNG, GIF, or WebP. It does not trust a filename or
caller-provided MIME type to authorize HTML/SVG rendering. Unsupported preview
types return 415. These files stay
downloadable through the regular attachment endpoint.

### Saved filter views

Create or replace a filter with:

```json
{
  "name": "Studio files",
  "from": "hello@harbor.test",
  "to": "",
  "subject": "",
  "has_attachments": true,
  "unread": false
}
```

List returns `{"filters":[...]}`. Create returns 201 and update returns 200, each
with a filter object including its `id`; delete returns 200 with `{"ok":true}`.
The server derives ownership from the
mailbox session, not a payload field. A mailbox can store 20 filters. Names are
required and limited to 40 characters; sender/recipient/subject criteria are
limited to 200 characters each.

The UI applies a selected filter to the already-authorized loaded folder. Text
matching is case-insensitive and all nonempty/true criteria combine with AND.
From/To criteria match displayed address/name strings; the To criterion does not
inspect hidden Cc/Bcc recipients.
Unchecked flags and empty strings impose no restriction. These routes persist
personal views; they do not implement server-side automatic forwarding, deleting,
labeling, or message-moving rules.
Creating a twenty-first filter returns 409. Foreign or missing filter IDs return
404 for update/delete; a client-supplied filter ID never changes ownership.

Send `text` plus optional `html` (up to 50 KB). HTML is rebuilt with an
attribute-free formatting allowlist. Details include sanitized `html` when
available. Subjects remain plain text. Authenticated responses are not cached.
An unavailable Mailpit service is reported as a service error so the composer can
retain text for retry; the UI must never treat a failed submission as sent.

### Address book and message organization

`GET /api/webmail/organizer` returns `{revision, contacts, groups, flags}`.
`PUT /api/webmail/organizer` replaces the signed-in mailbox's organizer and returns
its next revision. Use the revision from GET; stale updates return 409. The PUT
limit is 256 KiB, independently of message-upload limits.

Contacts: `{id, name, email}` (up to 500). Groups: `{id, name, members: [contactID]}`
(up to 50; each contains 1–10 distinct contacts in that organizer). Flags are a
map of capture IDs to `{starred, archived}` (up to 1,000). Flags never authorize
message access or change Mailpit's global state. Deleting a mailbox cascades its
organizer. Empty collections are returned as arrays/objects, not null.
