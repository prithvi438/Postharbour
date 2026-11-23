import { useEffect, useState, type ReactNode } from 'react';
import { BookOpen, ExternalLink, Printer, RefreshCw, ArrowRight, Download } from 'lucide-react';
import { api } from '../lib/api';
import type { DNSInfo, Domain, Page, Session, Tenant } from '../lib/types';
import { Brand, CopyValue } from '../components/ui';
import type { ActionDialog } from '../components/ResourceDialogs';
import { useTheme } from '../hooks/useTheme';
import { customerMailRecords, mailRecords, recordPurpose, relativeName } from './dnsRecords';
import './documentation.css';

const sources = {
  hostinger: 'https://www.hostinger.com/support/1583249-how-to-manage-dns-records-at-hostinger/',
  txt: 'https://www.hostinger.com/support/1583664-how-to-manage-txt-records-at-hostinger/',
  mx: 'https://www.hostinger.com/support/4443666-how-to-manage-mx-records-at-hostinger/',
  cloudflare: 'https://developers.cloudflare.com/dns/manage-dns-records/how-to/email-records/',
};
const chapters = [
  ['before', 'Before you begin'],
  ['accounts', 'Accounts & passwords'],
  ['ownership', 'Connect your domain'],
  ['records', 'Understand the records'],
  ['provider', 'DNS provider walkthrough'],
  ['mailboxes', 'Create mailboxes & switch'],
  ['verify', 'Test delivery'],
  ['help', 'Troubleshooting'],
] as const;
interface Props {
  session?: Session;
  tenant?: Tenant;
  domains?: Domain[];
  open?: (action: ActionDialog) => void;
  navigate?: (page: Page) => void;
}

/** Public instructions and authenticated, tenant-scoped values share this one guide.
 * No credentials are included in screenshots, public assets or browser storage. */
export function Documentation({ session, tenant, domains = [], open, navigate }: Props) {
  const [selected, setSelected] = useState('');
  const scopedDomains = domains.filter((d) => d.tenant_id === tenant?.id);
  const domain = scopedDomains.find((d) => d.id === selected) || scopedDomains[0];
  const host = session?.mail_host;
  return (
    <article className="setup-guide" aria-label="Domain setup documentation">
      <header className="guide-hero glass">
        <div>
          <span className="eyebrow">
            <BookOpen size={17} /> POSTHARBOR DOCUMENTATION
          </span>
          <h2>
            Your domain.
            <br />
            Your email. Step by step.
          </h2>
          <p>
            A practical guide for the person connecting a business domain. Follow the steps in
            order, from your first login to your first delivered email.
          </p>
        </div>
        <div className="guide-actions">
          <button className="button secondary" onClick={() => window.print()}>
            <Printer size={17} /> Print / save PDF
          </button>
          {!session && (
            <a className="button primary" href="/#documentation">
              Sign in for your records <ArrowRight size={17} />
            </a>
          )}
        </div>
      </header>
      <nav className="guide-contents" aria-label="Guide chapters">
        {chapters.map(([id, title], i) => (
          <button
            key={id}
            onClick={() =>
              document
                .getElementById(`guide-${id}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          >
            <span>{i + 1}</span>
            {title}
          </button>
        ))}
      </nav>
      <Section id="before" number="01" title="Before you begin" place="Prepare">
        <p>
          You need a domain you control, access to its active DNS provider, and a Postharbor
          business administrator account. Your platform operator creates your business and gives you
          that login.
        </p>
        <div className="guide-two">
          <Callout title="Keep your website where it is">
            Connecting email usually changes mail records only. Keep your website’s A, AAAA, CNAME
            and nameserver settings. Export or screenshot your existing DNS before editing.
          </Callout>
          <Callout title="Already receiving business email?">
            Create all required mailboxes and plan migration before switching MX. DNS changes do not
            move old messages, contacts or passwords. Keep the old service available during the
            transition.
          </Callout>
        </div>
        <p>
          The DNS provider is the service named by your domain’s authoritative nameservers. It may
          differ from the company where you bought the domain. For example, a domain purchased at
          Hostinger can use Cloudflare DNS.
        </p>
        <p className="guide-note">
          Hosted customers do not need a VPS, SSH access, or a mail-server API key. The operator
          manages server IPs, TLS certificates, reverse DNS (PTR), mail ports and mail-engine
          access. The current free deployment supports one business; separate business isolation
          requires an operator-supported deployment before inviting other businesses.
        </p>
        {session?.mode === 'simulation' && (
          <p className="notice">
            This workspace is a local simulation. Use a .test domain and simulated verification. It
            cannot deliver internet email, and its sample values must not be published in public
            DNS.
          </p>
        )}
      </Section>
      <Section id="accounts" number="02" title="Know your accounts and passwords" place="Prepare">
        <div className="guide-table-wrap">
          <table className="guide-table">
            <thead>
              <tr>
                <th>What you need</th>
                <th>What it does</th>
                <th>Where to get or create it</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Business admin login</td>
                <td>Manage domains, mailbox accounts and quotas.</td>
                <td>
                  Your Postharbor operator supplies it. Change your password in dashboard Settings.
                </td>
              </tr>
              <tr>
                <td>DNS provider login</td>
                <td>Publish the records proving ownership and routing mail.</td>
                <td>
                  Use your existing provider account, including its two-factor sign-in. You do not
                  enter this password into Postharbor.
                </td>
              </tr>
              <tr>
                <td>Mailbox address + password</td>
                <td>Read and send mail in Postharbor Mail or an email app.</td>
                <td>
                  Create under Mailboxes after the domain is provisioned. Each mailbox gets its own
                  password.
                </td>
              </tr>
              <tr>
                <td>Ownership TXT token</td>
                <td>Prove you control this domain.</td>
                <td>
                  Generated when you add your domain. Copy it into DNS. It is public verification
                  data, not a login password.
                </td>
              </tr>
              <tr>
                <td>DKIM public key</td>
                <td>Let recipients check signatures made by the mail server.</td>
                <td>
                  Generated by Postharbor’s mail engine. Publish only the supplied public value; the
                  private signing key stays on the server.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Use a unique mailbox password of 12–72 UTF-8 bytes (12–72 plain ASCII characters). Save it
          in a password manager and share it privately with its user. An admin login does not
          automatically create an inbox. Lost mailbox passwords can be reset by the business
          administrator; email apps must then sign in again.
        </p>
      </Section>
      <Section
        id="ownership"
        number="03"
        title="Add the domain and prove ownership"
        place="In Postharbor → At your DNS provider → Back in Postharbor"
      >
        <ol>
          <li>
            Select your business, open <strong>Domains</strong>, then{' '}
            <strong>Connect a domain</strong>. Enter the domain only, such as{' '}
            <code>example.com</code>, without https:// or a path.
          </li>
          <li>
            Open its <strong>DNS &amp; setup</strong> panel. Copy the ownership TXT name and value.
          </li>
          <li>
            At your DNS provider, create a TXT record with that name and value. Save it and allow
            DNS caches time to refresh.
          </li>
          <li>
            Back in <strong>DNS &amp; setup</strong>, click <strong>Verify ownership</strong>.
            Successful verification provisions the domain and makes its generated mail records
            available.
          </li>
        </ol>
        {open && tenant && (
          <button className="button secondary" onClick={() => open({ kind: 'domain' })}>
            Connect a domain <ArrowRight size={16} />
          </button>
        )}
        {domain && tenant && session ? (
          <div className="guide-personalized">
            <label className="field">
              <span>Your domain in {tenant.name}</span>
              <select
                aria-label="Guide domain"
                value={domain.id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {scopedDomains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <DomainValues
              key={`${tenant.id}:${domain.id}`}
              domain={domain}
              tenant={tenant}
              session={session}
            />
            {open && (
              <button className="button primary" onClick={() => open({ kind: 'dns', domain })}>
                Open DNS &amp; setup <ArrowRight size={16} />
              </button>
            )}
          </div>
        ) : (
          <p className="notice">
            {session
              ? 'Add a domain to this business to see your exact records here.'
              : 'This public guide uses example names only. Sign in and open Documentation to see the verification token and generated records for your own domain.'}
          </p>
        )}
      </Section>
      <Section
        id="records"
        number="04"
        title="What each DNS record is for"
        place="At your DNS provider"
      >
        <p>
          DNS records are public instructions for other systems. They are not usernames or
          passwords. Use the exact generated values for your selected domain; DKIM keys and
          ownership tokens differ between domains.
        </p>
        <div className="guide-table-wrap">
          <table className="guide-table">
            <thead>
              <tr>
                <th>Type / name</th>
                <th>Purpose</th>
                <th>What to enter</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>TXT · _postharbor</td>
                <td>Domain ownership.</td>
                <td>
                  The verification token from DNS &amp; setup. Keep it available for rechecks.
                </td>
              </tr>
              <tr>
                <td>MX · @</td>
                <td>Where incoming mail goes.</td>
                <td>
                  The generated mail hostname and priority.{' '}
                  {host ? (
                    <>
                      Your configured host is <code>{host}</code>.
                    </>
                  ) : (
                    'Your dashboard shows the configured host.'
                  )}{' '}
                  Enter a hostname, without https://, a path, or a port.
                </td>
              </tr>
              <tr>
                <td>TXT · @ · SPF</td>
                <td>Which servers may send for this domain.</td>
                <td>
                  The value starting <code>v=spf1</code>. If one already exists, merge authorized
                  senders into that single record. Ask your operator to review the merge; do not add
                  a second SPF record or remove senders you still use.
                </td>
              </tr>
              <tr>
                <td>TXT · selector._domainkey</td>
                <td>DKIM public signing key.</td>
                <td>
                  Every generated DKIM selector and its full TXT value. Preserve the key characters.
                  A zone can show one TXT value as several quoted chunks; join the chunks without
                  spaces in a single value field.
                </td>
              </tr>
              <tr>
                <td>TXT · _dmarc</td>
                <td>How receivers handle mail failing aligned authentication.</td>
                <td>
                  Use the operator-approved policy. A new setup often begins with{' '}
                  <code>v=DMARC1; p=none</code> for monitoring, then tightens after testing. Do not
                  overwrite an existing stricter policy without review. Optional report addresses
                  must be working mailboxes.
                </td>
              </tr>
              <tr>
                <td>A / AAAA · mail server host</td>
                <td>Resolve the mail hostname to its server IP.</td>
                <td>
                  The operator manages the shared host. Customers using that existing host usually
                  need no new A record. A custom host needs operator setup, correct IPs and a valid
                  TLS certificate first.
                </td>
              </tr>
              <tr>
                <td>PTR · server IP</td>
                <td>Reverse lookup from sending IP to mail hostname.</td>
                <td>
                  The operator sets this in the VPS/IP provider’s reverse-DNS panel. It is not a TXT
                  record in your domain editor.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Callout title="Host / Name is not the same as Value">
          In the DNS zone for example.com, @ means example.com, _postharbor means
          _postharbor.example.com, and selector._domainkey means selector._domainkey.example.com.
          Providers often append the domain automatically. Avoid entering example.com twice. If
          configuring team.example.com in the parent example.com zone, use team for its MX/SPF,
          _postharbor.team for ownership, and selector._domainkey.team for DKIM.
        </Callout>
        <p>
          <strong>TTL</strong> is how long DNS answers can stay cached. A provider default is fine;
          if supported, 300 seconds can help during setup. Lowering TTL now does not clear answers
          already cached with an older TTL. Updates may take up to 24–48 hours to be visible
          everywhere.
        </p>
      </Section>
      <Section
        id="provider"
        number="05"
        title="Add the records at your DNS provider"
        place="Outside Postharbor"
      >
        <h4>Hostinger walkthrough</h4>
        <p>
          Use this path when Hostinger is your active DNS provider. The screenshots show field
          locations, not values to copy. In particular, Hostinger’s sample SPF and MX belong to
          Hostinger Email; use your Postharbor records instead.
        </p>
        <ol>
          <li>
            Sign in to hPanel. Open <strong>Domains → DNS</strong>, select the domain, and open{' '}
            <strong>DNS records</strong>. Another layout uses{' '}
            <strong>Domains → Manage → DNS / Nameservers</strong>.
          </li>
        </ol>
        <Screenshot
          src="/docs/hostinger-dns.jpg"
          alt="Hostinger Domains sidebar with DNS highlighted"
          source={sources.hostinger}
          caption="Find the DNS editor for your domain."
        />
        <ol start={2}>
          <li>
            For ownership, SPF, DKIM and DMARC, select <strong>TXT</strong>. Fill{' '}
            <strong>Name</strong>, <strong>TXT value</strong> and <strong>TTL</strong>. Add each
            needed record; edit the existing SPF/DMARC record when appropriate.
          </li>
        </ol>
        <Screenshot
          src="/docs/hostinger-txt.jpg"
          alt="Hostinger TXT record form: Type, Name, TXT value, TTL and Add Record"
          source={sources.txt}
          caption="TXT field locations. Ignore the example SPF printed in this screenshot; copy your domain’s generated value."
        />
        <ol start={3}>
          <li>
            When mailboxes are ready for the switch, select <strong>MX</strong>. Enter the Name,
            Mail server, Priority and TTL from your generated records, then save. Lower MX numbers
            are tried first; priority is not a percentage.
          </li>
        </ol>
        <Screenshot
          src="/docs/hostinger-mx.png"
          alt="Hostinger MX record form with mail server, priority and TTL fields"
          source={sources.mx}
          caption="MX field locations. Use the Postharbor hostname and generated priority, not Hostinger Email defaults."
        />
        <ol start={4}>
          <li>
            Check the saved record list. For bulk entry, confirm each row’s Type before saving. Do
            not reset the zone, change nameservers, or import with “Replace” to connect email.
          </li>
        </ol>
        <p>
          Provider screens can change. These screenshots come from Hostinger’s public help pages;
          use the source links for its current interface.
        </p>
        <h4>Cloudflare</h4>
        <p>
          Open your domain’s <strong>DNS → Records → Add record</strong>. Choose TXT or MX, then map
          Name, Content / Mail server, TTL and MX priority to the same Postharbor values. A
          mail-server A/AAAA record managed in Cloudflare must be <strong>DNS only</strong> (grey
          cloud). A shared mail hostname outside your zone is managed by the operator. Review any
          existing Cloudflare Email Routing setup before changing MX.
        </p>
        <p>
          <a href={sources.cloudflare} target="_blank" rel="noreferrer">
            Cloudflare’s official email DNS instructions <ExternalLink size={14} />
          </a>
        </p>
        <h4>Other providers</h4>
        <p>
          Look for DNS management, Zone editor or Advanced DNS. The labels may be Host instead of
          Name, and Content or Points to instead of Value. The underlying TXT and MX data is the
          same. If the provider rejects a long DKIM value, ask its support how to enter a
          multi-string TXT record; never shorten the key.
        </p>
      </Section>
      <Section
        id="mailboxes"
        number="06"
        title="Create mailboxes, then switch incoming mail"
        place="In Postharbor → At your DNS provider"
      >
        <ol>
          <li>
            After your domain shows <strong>Provisioned</strong>, open{' '}
            <strong>Mailboxes → Create mailbox</strong>. Set the display name, email name, domain,
            unique password and quota. Example: info + example.com creates info@example.com.
          </li>
          <li>
            Create every address that must receive mail, and confirm you can sign in to each
            required mailbox. Adding a domain alone does not create addresses or a catch-all.
          </li>
          <li>
            Publish SPF and DKIM and agree the DMARC policy with your operator. Arrange migration of
            existing messages separately.
          </li>
          <li>
            At the agreed switch time, replace the previous provider’s MX records with the
            Postharbor MX set. Unplanned old MX records can still receive messages; keeping both
            providers’ MX is not mailbox synchronization.
          </li>
          <li>
            Keep monitoring both services during propagation, then complete the tests below before
            retiring the old service.
          </li>
        </ol>
        {navigate && (
          <button className="button secondary" onClick={() => navigate('mailboxes')}>
            Open Mailboxes <ArrowRight size={16} />
          </button>
        )}
        <h4>Connect a phone or desktop email app</h4>
        <p>
          Use the <strong>full mailbox address</strong> as the username and that mailbox’s password.
          The server hostname is{' '}
          {host ? <code>{host}</code> : 'shown in dashboard Settings → Connect a mail client'}.
          Incoming IMAP: <strong>993, SSL/TLS</strong>. Outgoing SMTP:{' '}
          <strong>465, SSL/TLS, authentication required</strong>. The username and password are the
          same for both. Webmail is available from <strong>Open webmail</strong> in the dashboard.
        </p>
      </Section>
      <Section
        id="verify"
        number="07"
        title="Check that it really works"
        place="In Postharbor + An external mailbox"
      >
        <ol>
          <li>
            Reopen <strong>DNS &amp; setup</strong>. Ownership must verify. The MX indicator should
            include the expected host. This is a partial routing check, not a complete DNS or
            deliverability audit.
          </li>
          <li>
            From an external account you control, send a new message to the new mailbox. Confirm it
            arrives in Postharbor Mail.
          </li>
          <li>
            Reply from Postharbor. Check the external inbox and spam folder. Then send a separate
            new outgoing message as well.
          </li>
          <li>
            Inspect the external message’s authentication results (Gmail: message menu → Show
            original). Confirm SPF and DKIM pass and DMARC passes through an aligned SPF or DKIM
            result. Ask your operator to investigate failures.
          </li>
          <li>
            Test an attachment and a phone/desktop client if you plan to use one. Correct DNS alone
            does not guarantee inbox placement; reputation, message content and server configuration
            also matter.
          </li>
        </ol>
        <details>
          <summary>Optional DNS checks for a technical administrator</summary>
          <p>
            Replace example.com and the selector with your actual values. Run from a terminal with
            dig installed. These are read-only queries.
          </p>
          <pre className="dns-zone">{`dig +short NS example.com\ndig +short TXT _postharbor.example.com\ndig +short MX example.com\ndig +short TXT example.com\ndig +short TXT SELECTOR._domainkey.example.com\ndig +short TXT _dmarc.example.com`}</pre>
        </details>
      </Section>
      <Section id="help" number="08" title="If something does not work" place="Troubleshooting">
        <div className="guide-table-wrap">
          <table className="guide-table">
            <thead>
              <tr>
                <th>What you see</th>
                <th>What to check next</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Ownership not found</td>
                <td>
                  Confirm active nameservers, the exact token, and the saved name. Check for a
                  doubled domain suffix. Wait for caches and retry Verify ownership.
                </td>
              </tr>
              <tr>
                <td>Verified, but still pending</td>
                <td>
                  The operator should check mail-engine provisioning. Retry verification after the
                  provider issue is fixed.
                </td>
              </tr>
              <tr>
                <td>No generated records</td>
                <td>
                  Verify first, then reload records. In simulation, real DKIM keys are unavailable.
                  Do not substitute a sample key.
                </td>
              </tr>
              <tr>
                <td>Incoming mail missing or bouncing</td>
                <td>
                  Confirm the exact recipient exists and is provisioned, inspect all MX records and
                  the bounce. The operator checks server reachability, storage quota and logs.
                </td>
              </tr>
              <tr>
                <td>Outgoing mail fails / goes to spam</td>
                <td>
                  Check SPF duplication, DKIM selector/key and DMARC alignment. The operator checks
                  PTR, TLS, outbound port 25, queues and IP reputation.
                </td>
              </tr>
              <tr>
                <td>Website affected</td>
                <td>
                  Compare A/AAAA/CNAME and nameservers with your backup. Restore only the
                  accidentally changed website records with your provider’s help.
                </td>
              </tr>
              <tr>
                <td>Email app cannot sign in</td>
                <td>
                  Use the mailbox password, full email username, server hostname and TLS ports
                  above. Do not use the dashboard administrator password.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          When contacting your Postharbor operator, include the domain, affected address, time with
          timezone, error or bounce text, and a screenshot of the relevant DNS rows. Never include
          passwords, two-factor codes, API tokens or DKIM private keys.
        </p>
      </Section>
      <footer className="guide-footer">
        <p>
          Provider instructions reviewed 23 November 2026. Screenshots © Hostinger, shown with
          source attribution for setup guidance. All example domains are illustrative.
        </p>
        <p>
          <a href={sources.hostinger} target="_blank" rel="noreferrer">
            Hostinger DNS guide
          </a>{' '}
          ·{' '}
          <a href={sources.txt} target="_blank" rel="noreferrer">
            TXT records
          </a>{' '}
          ·{' '}
          <a href={sources.mx} target="_blank" rel="noreferrer">
            MX records
          </a>{' '}
          ·{' '}
          <a href={sources.cloudflare} target="_blank" rel="noreferrer">
            Cloudflare email records
          </a>
        </p>
      </footer>
    </article>
  );
}

/** This keyed component cannot retain another domain's generated DNS response. */
function DomainValues({
  domain,
  tenant,
  session,
}: {
  domain: Domain;
  tenant: Tenant;
  session: Session;
}) {
  const [info, setInfo] = useState<DNSInfo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setInfo(null);
    api<DNSInfo>(`/tenants/${tenant.id}/domains/${domain.id}/dns`)
      .then((value) => {
        if (!cancelled) setInfo(value);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [domain.id, tenant.id, revision]);
  const records =
    session.mode === 'simulation'
      ? []
      : customerMailRecords(mailRecords(info?.zone || ''), domain.name);
  const ownership = `_postharbor.${domain.name}`;
  /** Download only DNS data visible in this signed-in domain, never account secrets. */
  function download() {
    const blob = new Blob(
      [
        `Postharbor DNS setup: ${domain.name}\n\nOwnership TXT name: ${ownership}\nOwnership TXT value: ${domain.verification_token}\n\nGenerated provider zone (review before publishing; do not replace your whole DNS zone):\n${info?.zone || 'Not available yet. Verify ownership first.'}\n\nGuide: ${location.origin}/docs\n`,
      ],
      { type: 'text/plain;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = `postharbor-${domain.name}-dns.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="guide-live-records">
      <h4>Your ownership record</h4>
      <p>
        TXT · Name in the {domain.name} zone: <code>_postharbor</code> · TTL: provider default.
      </p>
      <span>Full DNS name</span>
      <CopyValue value={ownership} />
      <span>Exact TXT value</span>
      <CopyValue value={domain.verification_token} />
      <div className="guide-actions">
        <button
          className="button secondary"
          disabled={loading}
          onClick={() => setRevision((r) => r + 1)}
        >
          <RefreshCw size={16} /> {loading ? 'Loading records…' : 'Reload records'}
        </button>
        <button className="button secondary" onClick={download}>
          <Download size={16} /> Download DNS notes
        </button>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error} Retry with Reload records. Ownership details above are still available.
        </p>
      )}
      {info && (
        <>
          <p className="guide-note">
            MX {info.mx_matches ? 'includes the expected host' : 'not confirmed'}:{' '}
            <code>{info.mx_host}</code>. {info.note}
          </p>
          {records.length > 0 && (
            <>
              <h4>Generated mail records to review</h4>
              <p>
                Names below assume you are editing the {domain.name} DNS zone. Review existing
                SPF/DMARC and plan the MX switch before saving.
              </p>
              <div className="guide-record-grid">
                {records.map((r, i) => (
                  <section className="guide-record" key={i}>
                    <h5>{recordPurpose(r)}</h5>
                    {/^v=DMARC1\b/i.test(r.value) && (
                      <p className="notice">
                        This is the mail engine’s suggested policy, not a check of your current DNS.
                        Review it with your operator before publishing: p=reject can block
                        unauthenticated mail, and any report mailbox must exist. For a new rollout,
                        discuss starting with p=none. Preserve an existing policy unless you have
                        agreed to change it.
                      </p>
                    )}
                    {/^v=spf1\b/i.test(r.value) && (
                      <p className="guide-note">
                        If your DNS already has an SPF record, merge required senders into that one
                        record with your operator. Do not add a duplicate.
                      </p>
                    )}
                    <p>
                      <strong>{r.type}</strong> · TTL: {r.ttl}
                      {r.priority !== undefined && (
                        <>
                          {' '}
                          · Priority: <strong>{r.priority}</strong>
                        </>
                      )}
                    </p>
                    <span>Name / Host</span>
                    <CopyValue value={relativeName(r.name, domain.name)} />
                    <small>Full / original name: {r.name}</small>
                    <span>{r.type === 'MX' ? 'Mail server' : 'TXT value'}</span>
                    <CopyValue value={r.value} />
                  </section>
                ))}
              </div>
            </>
          )}
          {info.zone && session.mode !== 'simulation' ? (
            <details>
              <summary>Original generated zone — including any additional provider records</summary>
              <p>
                The cards show this domain’s core MX, SPF, DKIM and DMARC entries. Server-host SPF,
                TLSA/DANE, MTA-STS, reporting and auto-discovery records need operator review. Their
                services, certificate renewal and report mailboxes must be ready first. Consult this
                original output with your operator for additional records. Do not import it with a
                “replace all records” option.
              </p>
              <pre className="dns-zone">{info.zone}</pre>
            </details>
          ) : (
            <p className="notice">
              {session.mode === 'simulation'
                ? 'Simulation does not generate real mail DNS records. Do not publish these demo values.'
                : 'Verify ownership in DNS & setup, then reload to retrieve the generated zone and real DKIM public keys.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Consistent numbered chapters make the same guide usable on screen and in print. */
function Section({
  id,
  number,
  title,
  place,
  children,
}: {
  id: string;
  number: string;
  title: string;
  place: string;
  children: ReactNode;
}) {
  return (
    <section className="guide-section glass" id={`guide-${id}`}>
      <header>
        <span className="guide-step-number">{number}</span>
        <div>
          <span className="eyebrow">{place}</span>
          <h3>{title}</h3>
        </div>
      </header>
      {children}
    </section>
  );
}
function Callout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="guide-callout">
      <h4>{title}</h4>
      <p>{children}</p>
    </aside>
  );
}
/** Local copies keep screenshots available without sending customer visits to a CDN. */
function Screenshot({
  src,
  alt,
  source,
  caption,
}: {
  src: string;
  alt: string;
  source: string;
  caption: string;
}) {
  return (
    <figure className="guide-screenshot">
      <a href={src} target="_blank" rel="noreferrer" aria-label={`Enlarge: ${alt}`}>
        <img src={src} alt={alt} loading="eager" />
      </a>
      <figcaption>
        {caption}{' '}
        <a href={source} target="_blank" rel="noreferrer">
          Source: Hostinger ↗
        </a>{' '}
        · Tap image to enlarge.
      </figcaption>
    </figure>
  );
}
/** /docs is intentionally public and never fetches tenant records or login data. */
export function PublicDocumentation() {
  const { theme, toggleTheme } = useTheme();
  return (
    <main className="public-guide">
      <div className="public-guide-nav">
        <a href="/" aria-label="Postharbor dashboard">
          <Brand />
        </a>
        <button className="button secondary" onClick={toggleTheme}>
          Use {theme === 'dark' ? 'light' : 'dark'} mode
        </button>
      </div>
      <Documentation />
    </main>
  );
}
