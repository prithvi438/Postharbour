# Native VPS hosting

This deployment uses Git, Nginx + Certbot, systemd, PostgreSQL 16, and Stalwart
Community 1.1.1. Docker is not required. The dashboard and webmail live at
`https://postharbor.easyhai.in` and `/mail`; the initial mailbox is `info@easyhai.in`.

## What runs where

- `/var/www/postharbor/repository`: Git source checkout (branch `main`).
- `/var/www/postharbor/releases`: separately built, versioned releases.
- `/var/www/postharbor/current`: active release symlink.
- `/etc/postharbor/app.env`: private configuration, readable only by root/service group.
- `/var/lib/postgresql/16/main`: PostgreSQL management data.
- `/var/lib/stalwart`: real mail, accounts, keys and mail-engine settings.
- `/etc/stalwart`: engine bootstrap file and environment. Recovery mode must be off.
- `/etc/nginx/sites-available/postharbor.easyhai.in`: only this site's reverse proxy.
- `/root/postharbor-access.json`: generated deployment credentials; never commit it.

The Go app listens at `127.0.0.1:8180`, PostgreSQL at loopback port 5432, and
Stalwart HTTP at `127.0.0.1:8085`. Nginx owns public HTTPS. SMTP reception uses 25,
authenticated TLS submission 465, and TLS IMAP 993. JMAP is proxied over HTTPS only
for the server itself; browser clients call the Go API, not the management API.

## Community versus Enterprise

Set `MAIL_PROVIDER=stalwart` and `STALWART_EDITION=community` for one business.
This is an enforced server-side limit, including concurrent creation requests.
Community does not create or pretend to provide native Stalwart tenants. All its
managed domains belong to that single business. Enterprise remains the default
for existing multi-business installations. Switching editions in an existing
database requires a deliberate migration; changing an environment value is refused.

`STALWART_URL` must be HTTPS and `STALWART_TOKEN` stays on the backend.
`WEBMAIL_SESSION_KEY` must be 32 random bytes encoded as 64 hexadecimal characters
(`openssl rand -hex 32`). Its presence enables live `/mail`. Mailbox credentials
are checked against Stalwart and encrypted with AES-256-GCM in expiring PostgreSQL
sessions. The cookie contains only a random token. Logout/password reset revokes
sessions; rotating the encryption key invalidates existing live mailbox sessions.
The provisioning administrator token is never used to read or send mailbox mail.

## Update from Git

Commit and push local changes to `main`, then connect to the VPS and run:

```sh
ssh root@postharbor.easyhai.in
bash /var/www/postharbor/repository/deploy/native/update.sh
```

The command fetches Git, builds a new release as the dedicated service user, runs
frontend/backend tests (including PostgreSQL integration tests in isolated schemas), activates the release, restarts only Postharbor, and checks
its health. If health fails it restores the previous binary release. Database
migrations are not rolled back: review migration compatibility before downgrading.
Pass an already fetched commit hash to deploy a specific version. No billing or
other site's process is restarted.

```sh
systemctl status postharbor stalwart postgresql
journalctl -u postharbor -n 100 --no-pager
curl --fail https://postharbor.easyhai.in/healthz
```

Keep the current and previous release. Remove older release directories only after
checking their names against `readlink /var/www/postharbor/current` and ensuring a
backup exists. Each release contains build dependencies, so monitor disk usage.

## DNS and delivery

Hostinger must publish MX, SPF, both generated DKIM TXT records, DMARC, and the
Postharbor ownership TXT challenge. Keep the existing Hostinger SPF include if
Hostinger still sends messages for the domain; there must be exactly one SPF record.
Set the VPS PTR to `postharbor.easyhai.in`, matching its A record and SMTP greeting.
Do not change the apex website A record or the billing subdomain.

The generated mail-engine zone includes optional services this deployment does
not expose. Do not blindly import TLSA, POP3, CalDAV, JMAP discovery or MTA-STS
records. Publish only records for services actually configured and tested.
Start DMARC with `p=none`; tighten it after real external messages pass alignment.
A successful API submission means queued mail, not proof that a recipient received it.

## Live mailbox behavior and limits

The existing React reader, composer, attachments/photos, contacts, filters and
conversation view use the real mailbox's JMAP account. Inbox/Sent use actual folder
membership, including Bcc and alias deliveries. Read status is synchronized to the
mail engine. Rendering retains the HTML sanitizer and disables remote images.

The reader currently loads the latest 200 non-draft messages and up to 50 messages
per conversation. This is an initial small-mailbox limit, not an unlimited archive.
Sending supports up to ten recipients and ten attachments totaling 5 MiB. Contacts,
star/archive flags and saved filters remain Postharbor-only preferences; archiving
in this UI does not move a message in an external IMAP client. Draft recovery after
a failed live submission is available through another IMAP/JMAP client; this UI
does not yet list engine drafts. Avoid retrying a timed-out send until checking Sent.

## Backups and recovery

Back up PostgreSQL, Stalwart's data/configuration, private app configuration and TLS
material together to encrypted off-server storage. Test restoration before relying
on this service for important mail. Do not copy a running RocksDB directory as a
consistent backup: use the engine's supported backup tools or stop Stalwart during
a filesystem snapshot. Keep backup encryption keys separately. Monitor disk space,
mail queue, failed logins, certificate renewal and delivery failures.

See the official [Stalwart native installation guide](https://stalw.art/docs/install/platform/linux/)
and [tenant licensing documentation](https://stalw.art/docs/auth/authorization/tenants/).

## Renew the SMTP/IMAP certificate

Certbot renews the Nginx certificate automatically. Install the included deploy hook
so the same renewed certificate reaches Stalwart's SMTP/IMAP listeners:

```sh
install -m 700 /var/www/postharbor/repository/deploy/native/renew-mail-certificate.py \
  /etc/letsencrypt/renewal-hooks/deploy/postharbor-mail
```

The hook reads the private app environment and `engine_certificate_id` from
`/root/postharbor-access.json`, updates that existing certificate through the
loopback management API, and restarts Stalwart. Active mail-client connections
will reconnect during that restart. It ignores renewals for other domains.
