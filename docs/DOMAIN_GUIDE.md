# Maintaining the customer domain guide

## Where customers find it

- Dashboard → Documentation (`/#documentation`): explanatory guide plus exact DNS
  values for the selected domain in the current business.
- `/docs`: the same guide, publicly accessible without login or tenant data.
- Domains → DNS & setup → illustrated setup guide: opens the public guide in a
  separate tab so a customer can keep their current DNS records visible.
- Print / save PDF: browser print layout for sharing or paper use. A signed-in print
  may include the selected domain's public DNS values; it never includes passwords.
- Download DNS notes: selected domain's ownership challenge and original generated
  zone in a text file. It is review material, not an automatically imported DNS backup.

## Content and responsibilities

The guide distinguishes a dashboard account, mailbox account, DNS provider account,
public ownership tokens, DKIM public keys, and operator-only secrets. It explains
MX, SPF, DKIM, DMARC, name/host conventions, TTL, subdomain zones, existing email
migration, IMAP/SMTP settings, and external send/receive checks. Customers publish
records at their authoritative DNS provider; Postharbor does not edit provider DNS.
The operator handles the shared mail hostname, A/AAAA, PTR, certificates and ports.
The current free single-business engine configuration does not become a hosted
multi-business product merely by adding this documentation.

The public guide contains only illustrative domain names and the shared explanatory
content. The authenticated guide derives the mail hostname from `/api/session`, and
records from the existing tenant-scoped `/api/tenants/{tenant}/domains/{id}/dns` API.
There are no new backend endpoints, secrets, dependencies or database migrations.

## Source structure and validation

- `Documentation.tsx`: reusable public/authenticated content, numbered chapters,
  provider screenshots, scoped records, downloads and print action.
- `dnsRecords.ts`: display parser for explicit-owner TXT/MX lines in the generated
  BIND zone. Handles TTL, IN, comments and multi-line quoted TXT chunks. It joins
  TXT chunks without spaces; ambiguous/unsupported syntax is not converted.
- `documentation.css`: dashboard-theme styles, responsive tables and print rules.
- `frontend/public/docs/ATTRIBUTION.md`: screenshot origins and copyright notice.

Do not invent default DKIM selectors, public keys or SPF authorization. Always keep
original zone output available because its additional record types or syntax may
not have cards. Preserve the distinction between ownership/provisioning, a partial
MX match, and actual delivery/authentication testing. A matching MX alone is not
proof that every mail setting is correct.

Tests cover public/private separation, stale domain-response isolation, DKIM chunk
preservation and rejection of ambiguous zone records. Run `npm test` and
`npm run build` from `frontend`. Review `/docs` in light/dark themes and at narrow
widths when changing layout, and check the print preview before changing print CSS.

## Provider references

Reviewed 23 November 2026. Use official sources when updating provider instructions:

- [Hostinger DNS management](https://www.hostinger.com/support/1583249-how-to-manage-dns-records-at-hostinger/)
- [Hostinger TXT records](https://www.hostinger.com/support/1583664-how-to-manage-txt-records-at-hostinger/)
- [Hostinger MX records](https://www.hostinger.com/support/4443666-how-to-manage-mx-records-at-hostinger/)
- [Cloudflare email records](https://developers.cloudflare.com/dns/manage-dns-records/how-to/email-records/)

Hostinger screenshot sample values belong to Hostinger Email. The guide explicitly
instructs customers to use their own Postharbor values. Update image captions and
attribution when replacing screenshots; do not publish real customer account pages
or passwords. Third-party screenshots retain their original copyright and are not
relicensed as Postharbor source code.

The record cards deliberately exclude shared mail-host SPF and optional TLSA,
MTA-STS, reporting and discovery records from the customer's core checklist. Those
remain visible in the original zone for operator review. Generated DMARC suggestions
are explicitly labeled for review because the engine may suggest `p=reject` and a
report address that has not been created. Existing published DNS is not inferred
from the generated zone; only the existing API's partial MX match is displayed.
