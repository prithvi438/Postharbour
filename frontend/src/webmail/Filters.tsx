import { useState, type FormEvent } from 'react';
import { Check, LoaderCircle, Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Modal } from '../components/ui';
import { mailAPI } from './api';
import type { MailFilter } from './types';

export const builtinFilters: MailFilter[] = [
  { id: 'all', name: 'All', from: '', to: '', subject: '', has_attachments: false, unread: false },
  {
    id: 'unread',
    name: 'Unread',
    from: '',
    to: '',
    subject: '',
    has_attachments: false,
    unread: true,
  },
  {
    id: 'attachments',
    name: 'Attachments',
    from: '',
    to: '',
    subject: '',
    has_attachments: true,
    unread: false,
  },
];

/** Exactly one view chip is active; custom conditions within it combine with AND. */
export function FilterChips({
  filters,
  selected,
  onSelect,
  onEdit,
}: {
  filters: MailFilter[];
  selected: string;
  onSelect: (id: string) => void;
  onEdit: (filter: MailFilter | null) => void;
}) {
  const current = filters.find((filter) => filter.id === selected);
  return (
    <div className="wm-filter-area">
      <div className="wm-filter-chips" aria-label="Mail filters">
        {[...builtinFilters, ...filters].map((filter) => (
          <button
            key={filter.id}
            title={filter.name}
            aria-pressed={selected === filter.id}
            className={selected === filter.id ? 'active' : ''}
            onClick={() => onSelect(filter.id)}
          >
            {selected === filter.id && <Check size={13} />}
            <span>{filter.name}</span>
          </button>
        ))}
      </div>
      <div className="wm-filter-actions">
        {current && (
          <button
            className="icon-button"
            aria-label={`Edit filter ${current.name}`}
            title="Edit selected filter"
            onClick={() => onEdit(current)}
          >
            <Pencil size={16} />
          </button>
        )}
        <button
          className="icon-button"
          aria-label="Create filter"
          title="Create filter"
          onClick={() => onEdit(null)}
          disabled={filters.length >= 20}
        >
          <Plus size={18} />
        </button>
      </div>
    </div>
  );
}

/** Filter persistence is scoped by the server's mailbox session, never browser storage. */
export function FilterEditor({
  initial,
  onClose,
  onSaved,
  onDeleted,
}: {
  initial: MailFilter | null;
  onClose: () => void;
  onSaved: (filter: MailFilter) => void;
  onDeleted: (id: string) => void;
}) {
  const [value, setValue] = useState<MailFilter>(
    initial || { ...builtinFilters[0], id: '', name: '' },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const { id, ...body } = value;
    try {
      const result = await mailAPI<MailFilter>(
        id ? `/filters/${encodeURIComponent(id)}` : '/filters',
        id ? 'PUT' : 'POST',
        { ...body, name: body.name.trim() },
      );
      onSaved(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!initial || busy) return;
    setBusy(true);
    setError('');
    try {
      await mailAPI(`/filters/${encodeURIComponent(initial.id)}`, 'DELETE');
      onDeleted(initial.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={initial ? 'Edit your filter' : 'Create a filter'}
      subtitle="A saved view for the mail you want to find."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="wm-filter-form" onSubmit={(event) => void save(event)}>
        <fieldset disabled={busy}>
          <label>
            Filter name
            <input
              required
              maxLength={40}
              value={value.name}
              onChange={(event) => setValue({ ...value, name: event.target.value })}
              placeholder="For example, Studio files"
            />
          </label>
          {(['from', 'to', 'subject'] as const).map((field) => (
            <label key={field}>
              {field === 'from'
                ? 'From contains'
                : field === 'to'
                  ? 'To contains'
                  : 'Subject contains'}
              <input
                maxLength={200}
                value={value[field]}
                onChange={(event) => setValue({ ...value, [field]: event.target.value })}
                placeholder={
                  field === 'subject' ? 'Project, invoice, weekend…' : 'Name or email address'
                }
              />
            </label>
          ))}
          <div className="wm-filter-checks">
            <label>
              <input
                type="checkbox"
                checked={value.has_attachments}
                onChange={(event) => setValue({ ...value, has_attachments: event.target.checked })}
              />
              Has attachments
            </label>
            <label>
              <input
                type="checkbox"
                checked={value.unread}
                onChange={(event) => setValue({ ...value, unread: event.target.checked })}
              />
              Unread only
            </label>
          </div>
        </fieldset>
        <p className="wm-filter-explanation">
          <SlidersHorizontal size={16} />
          All selected conditions must match. Filters change the view; they never move or delete
          email.
        </p>
        {error && (
          <p role="alert" className="wm-alert">
            {error}
          </p>
        )}
        {confirmDelete ? (
          <div className="wm-delete-filter">
            <p>Delete this filter? Your messages will stay.</p>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
            >
              Keep filter
            </button>
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              Delete filter
            </button>
          </div>
        ) : (
          <div className="wm-filter-footer">
            {initial && (
              <button
                type="button"
                className="icon-button"
                aria-label="Delete filter"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={18} />
              </button>
            )}
            <button className="button primary" disabled={busy}>
              {busy && <LoaderCircle className="spin" size={17} />}Save filter
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}
