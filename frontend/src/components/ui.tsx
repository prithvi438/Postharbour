import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Copy, LoaderCircle, X, Mail } from 'lucide-react';

/** Brand is reused on sign-in, navigation, and mobile headers. */
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Mail size={23} />
      </span>
      <span>
        postharbor<span className="brand-period">.</span>
      </span>
    </div>
  );
}

/** Badge uses text plus color, keeping provisioning states accessible. */
export function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status === 'active' ? 'success' : 'warning'}`}>
      {status === 'active' ? 'Provisioned' : status === 'deleting' ? 'Deletion pending' : 'Pending'}
    </span>
  );
}

/** Empty is a reusable first-run/no-results view with an optional next action. */
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Mail size={26} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

/** Modal uses the native dialog: focus trapping, Escape, and background inertness. */
export function Modal({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="modal"
    >
      <div className="modal-heading">
        <div>
          <h2 id="dialog-title">{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

/** AsyncForm owns submit/error/busy behavior once for all resource forms. */
export function AsyncForm({
  children,
  onSubmit,
  label = 'Save changes',
  danger = false,
}: {
  children: ReactNode;
  onSubmit: (data: FormData) => Promise<void>;
  label?: string;
  danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await onSubmit(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="form">
      <fieldset disabled={busy}>{children}</fieldset>
      {error && (
        <div role="alert" className="error-message">
          {error}
        </div>
      )}
      <button className={`button ${danger ? 'danger' : 'primary'}`} disabled={busy} type="submit">
        {busy && <LoaderCircle size={17} className="spin" />}
        {busy ? 'Working…' : label}
      </button>
    </form>
  );
}

/** Field gives every native form control a consistent, programmatic label. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

/** CopyValue reports permission failures instead of pretending copying succeeded. */
export function CopyValue({ value }: { value: string }) {
  const [result, setResult] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setResult('Copied');
    } catch {
      setResult('Select and copy the text manually');
    }
  }
  return (
    <div className="copy-value">
      <code>{value}</code>
      <button type="button" className="icon-button" aria-label="Copy value" onClick={copy}>
        {result === 'Copied' ? <Check size={16} /> : <Copy size={16} />}
      </button>
      {result && <small role="status">{result}</small>}
    </div>
  );
}
