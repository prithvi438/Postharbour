import { useState } from 'react';
import { PhotoPicker } from '../components/ProfilePhoto';
import {
  Activity,
  ArrowUpRight,
  Building2,
  Check,
  Circle,
  Globe2,
  KeyRound,
  Mail,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { AuditEvent, Domain, Mailbox, Page, Session, Tenant } from '../lib/types';
import { storageLabel } from '../lib/types';
import { AsyncForm, Badge, CopyValue, Empty, Field } from '../components/ui';
import type { ActionDialog } from '../components/ResourceDialogs';
import { api } from '../lib/api';

interface Props {
  page: Page;
  tenant: Tenant;
  domains: Domain[];
  mailboxes: Mailbox[];
  events: AuditEvent[];
  session: Session;
  search: string;
  setSearch: (value: string) => void;
  open: (action: ActionDialog) => void;
  navigate: (page: Page) => void;
  onPasswordChanged: () => void;
  onProfileChanged: (avatar: string) => void;
}

/** Workspace renders a focused page using already tenant-scoped API results. */
export function Workspace(props: Props) {
  const { page, tenant, domains, mailboxes, events, session, search, setSearch, open, navigate } =
    props;
  const readyDomains = domains.filter((d) => d.status === 'active');
  const allocated = mailboxes.reduce((total, box) => total + box.quota_mb, 0);
  if (page === 'settings')
    return (
      <Settings
        session={session}
        onPasswordChanged={props.onPasswordChanged}
        onProfileChanged={props.onProfileChanged}
      />
    );
  if (page === 'overview')
    return (
      <>
        <section className="hero glass">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="little-line" /> YOUR WORKSPACE, CONNECTED
            </span>
            <h2>
              Email that feels
              <br />
              like your business<span>.</span>
            </h2>
            <p>Your domains. Your people. One simple place to bring them together.</p>
            <button
              className="button primary"
              onClick={() => open({ kind: readyDomains.length ? 'mailbox' : 'domain' })}
            >
              <Plus size={17} />
              {readyDomains.length ? 'Create a mailbox' : 'Connect your first domain'}
            </button>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="floating-mail">
              <Mail size={58} strokeWidth={1.2} />
              <span>YOUR EMAIL, AT HOME</span>
            </div>
            <div className="art-dot dot-one" />
            <div className="art-dot dot-two" />
          </div>
        </section>
        <div className="stats-grid">
          <Stat
            icon={<Globe2 size={21} />}
            label="Connected domains"
            value={String(readyDomains.length)}
            detail={`${domains.length} total · ownership verified`}
          />
          <Stat
            icon={<Mail size={21} />}
            label="Mailboxes"
            value={String(mailboxes.length)}
            detail={`of ${tenant.max_mailboxes} available in this business`}
          />
          <Stat
            icon={<Building2 size={21} />}
            label="Allocated storage"
            value={storageLabel(allocated)}
            detail={`of ${storageLabel(tenant.quota_mb)} business allowance`}
          />
        </div>
        <div className="overview-grid">
          <section className="glass panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">MAKE IT YOURS</span>
                <h3>Your launch checklist</h3>
              </div>
              <span className="count-pill">
                {1 +
                  Number(readyDomains.length > 0) +
                  Number(mailboxes.some((m) => m.status === 'active'))}{' '}
                / 3
              </span>
            </div>
            <Checklist
              done
              title="Create your business"
              text={`${tenant.name} has its own workspace.`}
            />
            <Checklist
              done={readyDomains.length > 0}
              title="Connect a domain"
              text="Verify ownership and configure your email DNS."
              onClick={() => navigate('domains')}
            />
            <Checklist
              done={mailboxes.some((m) => m.status === 'active')}
              title="Welcome your first mailbox"
              text="Create an address and connect a mail client."
              onClick={() => navigate('mailboxes')}
            />
          </section>
          <section className="glass panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">THE LATEST</span>
                <h3>Workspace activity</h3>
              </div>
              <button className="text-button" onClick={() => navigate('activity')}>
                View all <ArrowUpRight size={15} />
              </button>
            </div>
            {events.length ? (
              <ActivityList events={events.slice(0, 4)} />
            ) : (
              <p className="muted">Your activity will appear here as you get set up.</p>
            )}
          </section>
        </div>
        <div className="quiet-note">
          <ShieldCheck size={18} />
          <span>
            {session.mode === 'simulation'
              ? 'Local workspace · Mail delivery is simulated. No real messages are sent.'
              : 'Provisioning is connected to Stalwart. Validate DNS and test delivery before inviting users.'}
          </span>
        </div>
      </>
    );
  if (page === 'domains') {
    const filtered = domains.filter((d) => d.name.includes(search.toLowerCase()));
    return (
      <section className="glass panel">
        <ListHeader
          title="Your domains"
          subtitle="Give every business its own address."
          search={search}
          setSearch={setSearch}
          action={() => open({ kind: 'domain' })}
          actionLabel="Add domain"
        />
        {filtered.length ? (
          <div className="domain-grid">
            {filtered.map((d) => (
              <article className="domain-card" key={d.id}>
                <div className="domain-top">
                  <span className="resource-icon">
                    <Globe2 size={24} />
                  </span>
                  <Badge status={d.status} />
                </div>
                <h3>{d.name}</h3>
                <p>{d.verified ? 'Ownership verified' : 'Waiting for ownership verification'}</p>
                <div className="domain-meta">
                  <span>{mailboxes.filter((m) => m.domain_id === d.id).length} mailboxes</span>
                  <button className="text-button" onClick={() => open({ kind: 'dns', domain: d })}>
                    DNS & setup <ArrowUpRight size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title={search ? 'No matching domains' : 'Your next address starts here'}
            action={
              !search && (
                <button className="button secondary" onClick={() => open({ kind: 'domain' })}>
                  <Plus size={16} />
                  Connect a domain
                </button>
              )
            }
          >
            {search
              ? 'Try a different search.'
              : 'Add a domain you own, then follow the DNS verification steps.'}
          </Empty>
        )}
      </section>
    );
  }
  if (page === 'mailboxes') {
    const filtered = mailboxes.filter((m) =>
      `${m.address} ${m.name}`.toLowerCase().includes(search.toLowerCase()),
    );
    return (
      <section className="glass panel">
        <ListHeader
          title="Your mailboxes"
          subtitle="A place for everyone on your team."
          search={search}
          setSearch={setSearch}
          action={() => open({ kind: 'mailbox' })}
          actionLabel="Create mailbox"
          disabled={!readyDomains.length}
        />
        {!readyDomains.length && (
          <p className="notice">Connect and verify a domain before creating a mailbox.</p>
        )}
        {filtered.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Mailbox</th>
                  <th>Status</th>
                  <th>Allocation</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="person">
                        <span className="avatar">{m.name.slice(0, 2).toUpperCase()}</span>
                        <div>
                          <strong>{m.name}</strong>
                          <span>{m.address}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge status={m.status} />
                    </td>
                    <td>{storageLabel(m.quota_mb)}</td>
                    <td>
                      <div className="row-actions">
                        {m.status === 'pending' ? (
                          <button
                            className="icon-button"
                            title="Retry provisioning"
                            aria-label={`Retry ${m.address}`}
                            onClick={() => open({ kind: 'retry', mailbox: m })}
                          >
                            <RefreshCw size={17} />
                          </button>
                        ) : (
                          <>
                            <button
                              className="icon-button"
                              disabled={m.status !== 'active'}
                              title="Reset credentials"
                              aria-label={`Reset credentials for ${m.address}`}
                              onClick={() => open({ kind: 'reset', mailbox: m })}
                            >
                              <KeyRound size={17} />
                            </button>
                            <button
                              className="icon-button danger-icon"
                              title="Delete mailbox"
                              aria-label={`Delete ${m.address}`}
                              onClick={() => open({ kind: 'delete', mailbox: m })}
                            >
                              <Trash2 size={17} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title={search ? 'No matching mailboxes' : 'Make room for your team'}>
            {search
              ? 'Try a different name or email address.'
              : 'Your created mailboxes will appear here. Start with your first team member.'}
          </Empty>
        )}
        <div className="allocation">
          <span>
            {storageLabel(allocated)} allocated of {storageLabel(tenant.quota_mb)}
          </span>
          <progress
            max={tenant.quota_mb}
            value={allocated}
            aria-label="Allocated mailbox capacity"
          />
          <small>Allocated capacity, not live disk usage.</small>
        </div>
      </section>
    );
  }
  return (
    <section className="glass panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">A CLEAR RECORD</span>
          <h3>Activity log</h3>
          <p className="muted">The latest 100 administrator actions for this business.</p>
        </div>
        <Activity size={23} />
      </div>
      {events.length ? (
        <ActivityList events={events} />
      ) : (
        <Empty title="Nothing to report yet">
          Domain and mailbox changes will be recorded here.
        </Empty>
      )}
    </section>
  );
}

/** Stat displays real aggregate values; there are no fabricated usage charts. */
function Stat({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="glass stat">
      <div>
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

/** Checklist turns onboarding state into a concise, actionable next step. */
function Checklist({
  done,
  title,
  text,
  onClick,
}: {
  done: boolean;
  title: string;
  text: string;
  onClick?: () => void;
}) {
  return (
    <div className={`checklist-item ${done ? 'done' : ''}`}>
      <span className="check-icon">{done ? <Check size={16} /> : <Circle size={16} />}</span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
      {onClick && (
        <button className="icon-button" aria-label={title} onClick={onClick}>
          <ArrowUpRight size={18} />
        </button>
      )}
    </div>
  );
}

/** ListHeader shares search and creation controls between resource screens. */
function ListHeader({
  title,
  subtitle,
  search,
  setSearch,
  action,
  actionLabel,
  disabled,
}: {
  title: string;
  subtitle: string;
  search: string;
  setSearch: (s: string) => void;
  action: () => void;
  actionLabel: string;
  disabled?: boolean;
}) {
  return (
    <>
      <div className="section-heading">
        <div>
          <h3>{title}</h3>
          <p className="muted">{subtitle}</p>
        </div>
        <button className="button primary" disabled={disabled} onClick={action}>
          <Plus size={17} />
          {actionLabel}
        </button>
      </div>
      <label className="search">
        <Search size={18} />
        <input
          type="search"
          aria-label={`Search ${title.toLowerCase()}`}
          placeholder="Search by name…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
    </>
  );
}

/** ActivityList formats immutable audit events without exposing sensitive payloads. */
function ActivityList({ events }: { events: AuditEvent[] }) {
  return (
    <ol className="activity-list">
      {events.map((event) => (
        <li key={event.id}>
          <span className="activity-icon">
            <Activity size={16} />
          </span>
          <div>
            <strong>{event.action.replaceAll('.', ' · ').replaceAll('_', ' ')}</strong>
            <p>{event.target}</p>
            <small>{event.actor}</small>
          </div>
          <time dateTime={event.created_at}>
            {new Date(event.created_at).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
        </li>
      ))}
    </ol>
  );
}

/** Settings explains mail-client access and supports a real administrator password change. */
function Settings({
  session,
  onPasswordChanged,
  onProfileChanged,
}: {
  session: Session;
  onPasswordChanged: () => void;
  onProfileChanged: (avatar: string) => void;
}) {
  return (
    <div className="settings-grid">
      <AdminPhoto session={session} onSaved={onProfileChanged} />
      <section className="glass panel">
        <span className="eyebrow">ACCOUNT SECURITY</span>
        <h3>Change your password</h3>
        <p className="muted">
          For {session.user.email}. Changing it signs out all dashboard sessions.
        </p>
        <AsyncForm
          label="Update password & sign out"
          onSubmit={async (data) => {
            await api('/account/password', 'POST', {
              current_password: data.get('current'),
              new_password: data.get('next'),
            });
            onPasswordChanged();
          }}
        >
          <Field label="Current password">
            <input name="current" type="password" autoComplete="current-password" required />
          </Field>
          <Field label="New password" hint="12–72 bytes. Use a unique password.">
            <input
              name="next"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={72}
              required
            />
          </Field>
        </AsyncForm>
      </section>
      <section className="glass panel">
        <span className="eyebrow">YOUR EMAIL, EVERYWHERE</span>
        <h3>Connect a mail client</h3>
        <p className="muted">
          Use the full mailbox address as the username, and its separate mailbox password.
        </p>
        <Field label="Server hostname">
          <CopyValue value={session.mail_host} />
        </Field>
        <dl className="connection-list">
          <div>
            <dt>Incoming IMAP</dt>
            <dd>993 · SSL/TLS</dd>
          </div>
          <div>
            <dt>Outgoing SMTP</dt>
            <dd>465 · SSL/TLS · Authentication required</dd>
          </div>
        </dl>
        {session.webmail_url ? (
          <a
            className="button secondary"
            href={session.webmail_url}
            target="_blank"
            rel="noreferrer"
          >
            Open webmail <ArrowUpRight size={16} />
          </a>
        ) : (
          <p className="notice">
            A webmail URL has not been configured. Your platform owner can connect one; this
            dashboard manages accounts and does not read messages.
          </p>
        )}
        {session.mode === 'simulation' && (
          <p className="notice">
            These connections become usable after deploying a real Stalwart mail server.
          </p>
        )}
      </section>
    </div>
  );
}

/** The dashboard photo belongs to this administrator, independently of mailboxes. */
function AdminPhoto({ session, onSaved }: { session: Session; onSaved: (avatar: string) => void }) {
  const [avatar, setAvatar] = useState(session.user.avatar || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save() {
    setBusy(true);
    setMessage('');
    try {
      const result = await api<{ avatar: string }>('/account/profile', 'PUT', { avatar });
      setAvatar(result.avatar);
      onSaved(result.avatar);
      setMessage('Profile photo saved.');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="glass panel">
      <span className="eyebrow">YOUR PROFILE</span>
      <h3>Administrator photo</h3>
      <PhotoPicker
        value={avatar}
        name={session.user.name}
        disabled={busy}
        onChange={setAvatar}
        onBusyChange={setBusy}
      />
      <button className="button primary" disabled={busy} onClick={() => void save()}>
        Save profile photo
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
