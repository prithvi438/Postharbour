import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { DNSInfo, Domain, Mailbox, Session, Tenant } from '../lib/types';
import { AsyncForm, CopyValue, Field, Modal } from './ui';

/** ActionDialog enumerates supported mutations; unrelated UI states cannot mix. */
export type ActionDialog =
  | { kind: 'business' }
  | { kind: 'domain' }
  | { kind: 'mailbox' }
  | { kind: 'dns'; domain: Domain }
  | { kind: 'reset' | 'retry' | 'delete'; mailbox: Mailbox };
interface Props {
  action: ActionDialog;
  tenant?: Tenant;
  domains: Domain[];
  session: Session;
  close: () => void;
  mutate: (path: string, method: string, body?: unknown) => Promise<void>;
}

/** ResourceDialogs shares field and submit components rather than duplicating forms. */
export function ResourceDialogs({ action, tenant, domains, session, close, mutate }: Props) {
  const base = `/tenants/${tenant?.id}`;
  if (action.kind === 'dns')
    return (
      <DNSDialog
        domain={action.domain}
        base={base}
        session={session}
        close={close}
        mutate={mutate}
      />
    );
  if (action.kind === 'business')
    return (
      <Modal
        title="Create a business"
        subtitle="A separate workspace, with its own administrator."
        onClose={close}
      >
        <AsyncForm
          label="Create business"
          onSubmit={async (data) => {
            await mutate('/tenants', 'POST', {
              name: data.get('name'),
              admin_name: data.get('admin_name'),
              admin_email: data.get('admin_email'),
              password: data.get('password'),
              max_mailboxes: Number(data.get('max_mailboxes')),
              quota_mb: Number(data.get('quota_mb')),
            });
            close();
          }}
        >
          <Field label="Business name">
            <input name="name" placeholder="Acme Studio" required maxLength={100} />
          </Field>
          <div className="form-grid">
            <Field label="Administrator name">
              <input name="admin_name" required maxLength={100} />
            </Field>
            <Field label="Administrator email">
              <input name="admin_email" type="email" autoComplete="off" required />
            </Field>
          </div>
          <PasswordField />
          <div className="form-grid">
            <Field label="Mailbox limit">
              <input
                name="max_mailboxes"
                type="number"
                defaultValue={session.max_mailboxes}
                min={1}
                max={session.max_mailboxes}
                required
              />
            </Field>
            <Field label="Storage allocation (MiB)">
              <input
                name="quota_mb"
                type="number"
                defaultValue={25600}
                min={100}
                max={102400}
                required
              />
            </Field>
          </div>
          <p className="notice">
            This creates a dashboard login. Share the initial password securely; the administrator
            can change it in Settings.
          </p>
        </AsyncForm>
      </Modal>
    );
  if (action.kind === 'domain')
    return (
      <Modal
        title="Connect a domain"
        subtitle="Start with a domain you own. Your website can stay where it is."
        onClose={close}
      >
        <AsyncForm
          label="Add domain"
          onSubmit={async (data) => {
            await mutate(`${base}/domains`, 'POST', { name: data.get('name') });
            close();
          }}
        >
          <Field
            label="Domain name"
            hint={
              session.mode === 'simulation'
                ? 'For a local walkthrough, use a reserved name such as studio.test.'
                : 'No https://, www prefix, or path is needed.'
            }
          >
            <input
              name="name"
              placeholder={session.mode === 'simulation' ? 'studio.test' : 'yourbusiness.com'}
              required
              autoCapitalize="none"
              maxLength={253}
            />
          </Field>
          <p className="notice">
            We’ll give you a DNS TXT record to verify ownership before provisioning email.
          </p>
        </AsyncForm>
      </Modal>
    );
  if (action.kind === 'mailbox')
    return (
      <Modal
        title="Create a mailbox"
        subtitle="Give someone a home at your domain."
        onClose={close}
      >
        <AsyncForm
          label="Create mailbox"
          onSubmit={async (data) => {
            await mutate(`${base}/mailboxes`, 'POST', {
              domain_id: data.get('domain_id'),
              local_part: data.get('local_part'),
              name: data.get('name'),
              password: data.get('password'),
              quota_mb: Number(data.get('quota_mb')),
            });
            close();
          }}
        >
          <Field label="Display name">
            <input name="name" placeholder="Alex Morgan" required maxLength={100} />
          </Field>
          <div className="form-grid">
            <Field label="Email name">
              <input
                name="local_part"
                placeholder="alex"
                pattern="[a-z0-9]+([._+\-][a-z0-9]+)*"
                maxLength={64}
                autoCapitalize="none"
                required
              />
            </Field>
            <Field label="Domain">
              <select name="domain_id" required>
                {domains
                  .filter((d) => d.status === 'active')
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      @{d.name}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <PasswordField />
          <Field
            label="Mailbox quota (MiB)"
            hint="5120 MiB = 5 GiB. This is allocated capacity, not actual usage."
          >
            <input
              name="quota_mb"
              type="number"
              defaultValue={5120}
              min={100}
              max={Math.min(102400, tenant?.quota_mb ?? 102400)}
              required
            />
          </Field>
          {session.mode === 'simulation' && (
            <p className="notice">
              Simulation creates a management record only. It cannot send or receive email.
            </p>
          )}
        </AsyncForm>
      </Modal>
    );
  const mailbox = action.mailbox;
  const deleting = action.kind === 'delete';
  return (
    <Modal
      title={
        deleting
          ? 'Delete this mailbox?'
          : action.kind === 'retry'
            ? 'Retry provisioning'
            : 'Reset mailbox credentials'
      }
      subtitle={mailbox.address}
      onClose={close}
    >
      <AsyncForm
        label={
          deleting
            ? 'Permanently delete mailbox'
            : action.kind === 'retry'
              ? 'Retry provisioning'
              : 'Reset credentials'
        }
        danger={deleting}
        onSubmit={async (data) => {
          const suffix =
            action.kind === 'retry' ? '/provision' : action.kind === 'reset' ? '/password' : '';
          await mutate(
            `${base}/mailboxes/${mailbox.id}${suffix}`,
            deleting ? 'DELETE' : 'POST',
            deleting ? { confirm: data.get('confirm') } : { password: data.get('password') },
          );
          close();
        }}
      >
        {deleting ? (
          <>
            <p className="notice danger-note">
              This permanently removes the mailbox and its messages from the mail server. Make a
              backup first.
            </p>
            <Field label="Type the complete email address to confirm">
              <input name="confirm" autoComplete="off" required />
            </Field>
          </>
        ) : (
          <>
            <PasswordField />
            <p className="notice">
              {action.kind === 'retry'
                ? 'Use the original password. If the previous request already created the account, retrying will keep its existing credentials.'
                : 'This replaces the mail account’s credentials, including app passwords and passkeys. The user will need to sign in again.'}
            </p>
          </>
        )}
      </AsyncForm>
    </Modal>
  );
}

/** PasswordField keeps password guidance and browser autocomplete consistent. */
function PasswordField() {
  return (
    <Field
      label="Initial / new password"
      hint="Use 12–72 ASCII characters, or 12–72 UTF-8 bytes. We never store mailbox passwords in the dashboard database."
    >
      <input
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        maxLength={72}
        required
      />
    </Field>
  );
}

/** DNSDialog fetches actual provider records, with an explicit simulation alternative. */
function DNSDialog({
  domain,
  base,
  session,
  close,
  mutate,
}: {
  domain: Domain;
  base: string;
  session: Session;
  close: () => void;
  mutate: Props['mutate'];
}) {
  const [info, setInfo] = useState<DNSInfo | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [verified, setVerified] = useState(domain.status === 'active');
  useEffect(() => {
    let cancelled = false;
    api<DNSInfo>(`${base}/domains/${domain.id}/dns`)
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [base, domain.id, revision]);
  return (
    <Modal
      title={`Connect ${domain.name}`}
      subtitle="Verify ownership, then configure delivery."
      onClose={close}
    >
      <p className="notice">
        Need help with your DNS provider?{' '}
        <a href="/docs" target="_blank" rel="noreferrer">
          Open the illustrated domain setup guide ↗
        </a>
      </p>
      <div className="dns-step">
        <span className="eyebrow">1 · PROVE OWNERSHIP</span>
        <p>Add this TXT record at your DNS provider.</p>
        <Field label="Record name">
          <CopyValue value={`_postharbor.${domain.name}`} />
        </Field>
        <Field label="TXT value">
          <CopyValue value={domain.verification_token} />
        </Field>
      </div>
      <AsyncForm
        label={verified ? 'Recheck ownership' : 'Verify ownership'}
        onSubmit={async (data) => {
          await mutate(`${base}/domains/${domain.id}/verify`, 'POST', {
            simulate: data.get('simulate') === 'on',
          });
          setVerified(true);
          setError('');
          setRevision((r) => r + 1);
        }}
      >
        {session.mode === 'simulation' && domain.name.endsWith('.test') && (
          <label className="checkbox">
            <input type="checkbox" name="simulate" /> Simulate ownership for this local .test domain
          </label>
        )}
      </AsyncForm>
      {verified && (
        <p role="status" className="success-message">
          Domain provisioned{session.mode === 'simulation' ? ' in simulation' : ''}. Delivery still
          depends on the records below.
        </p>
      )}
      <div className="dns-step">
        <span className="eyebrow">2 · CONFIGURE EMAIL</span>
        <p>
          Use the mail server’s generated zone for MX, SPF, DKIM, and DMARC. Merge SPF with existing
          senders; do not create a second SPF record.
        </p>
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {info ? (
          <>
            <Field label="Expected MX host">
              <CopyValue value={info.mx_host} />
            </Field>
            <p className="muted">
              MX {info.mx_matches ? 'includes the expected host' : 'not confirmed'} · This does not
              verify deliverability.
            </p>
            {info.zone ? (
              <pre className="dns-zone">{info.zone}</pre>
            ) : (
              <p className="notice">
                Verify the domain first to retrieve its real DNS zone and DKIM public key.
              </p>
            )}
          </>
        ) : (
          <p className="muted">Loading DNS guidance…</p>
        )}
      </div>
    </Modal>
  );
}
