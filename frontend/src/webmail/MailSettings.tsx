import { useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { PhotoPicker } from '../components/ProfilePhoto';
import { cleanHTML, RichEditor } from './RichEditor';
import { htmlText, importTemplate, type MailSettings as Settings } from './settings';

/** A private settings workspace with one explicit save and the parent's navigation
 * guard. Templates and the signature share the same safe rich-text editor as mail. */
export function MailSettings({
  value,
  name,
  onSave,
  onDirty,
  onBusy,
}: {
  value: Settings;
  name: string;
  onSave: (next: Settings) => Promise<Settings>;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [selected, setSelected] = useState(value.templates[0]?.id || '');
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const template = draft.templates.find((t) => t.id === selected);
  function change(next: Settings) {
    setDraft(next);
    onDirty(true);
    setNotice('');
  }
  function templateChange(patch: Partial<NonNullable<typeof template>>) {
    change({
      ...draft,
      templates: draft.templates.map((t) => (t.id === selected ? { ...t, ...patch } : t)),
    });
  }
  function changingBusy(value: boolean) {
    setBusy(value);
    onBusy(value);
  }
  async function save() {
    changingBusy(true);
    setError('');
    try {
      const saved = await onSave(draft);
      setDraft(saved);
      onDirty(false);
      setNotice('Mailbox settings saved.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      changingBusy(false);
    }
  }
  async function importFile(file?: File) {
    if (!file) return;
    changingBusy(true);
    setError('');
    try {
      const html = await importTemplate(file);
      templateChange({ html });
      setVersion((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      changingBusy(false);
    }
  }
  return (
    <section className="wm-mail-surface glass wm-settings-surface">
      <header className="wm-settings-heading">
        <div>
          <span className="wm-kicker">MAKE IT YOURS</span>
          <h1>Mailbox settings</h1>
        </div>
        <button className="button primary" disabled={busy} onClick={() => void save()}>
          <Save size={18} /> {busy ? 'Working…' : 'Save settings'}
        </button>
      </header>
      {error && (
        <p className="wm-alert" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="wm-notice" role="status">
          {notice}
        </p>
      )}
      <fieldset disabled={busy} className="wm-settings-fields">
        <section className="wm-setting-card">
          <h2>Your profile photo</h2>
          <p className="muted">
            Shown in your Postharbor mailbox. Other email providers choose their own sender avatars.
          </p>
          <PhotoPicker
            value={draft.avatar}
            name={name}
            onChange={(avatar) => change({ ...draft, avatar })}
            onBusyChange={changingBusy}
          />
        </section>
        <section className="wm-setting-card">
          <h2>Default signature</h2>
          <p className="muted">
            Your professional footer for new emails, replies and forwards sent from Postharbor.
          </p>
          <label className="wm-check">
            <input
              type="checkbox"
              checked={draft.signature_enabled}
              onChange={(e) => change({ ...draft, signature_enabled: e.target.checked })}
            />{' '}
            Add my signature automatically
          </label>
          <RichEditor
            text={htmlText(draft.signature)}
            html={draft.signature}
            disabled={busy}
            onChange={(_, signature) => change({ ...draft, signature })}
          />
        </section>
        <section className="wm-setting-card">
          <div className="wm-settings-heading">
            <div>
              <h2>Email templates</h2>
              <p className="muted">
                Save up to 30 reusable messages. Paste from Word, insert HTML, or import a file.
              </p>
            </div>
            <button
              type="button"
              className="button secondary"
              disabled={draft.templates.length >= 30}
              onClick={() => {
                const id = crypto.randomUUID();
                change({
                  ...draft,
                  templates: [
                    ...draft.templates,
                    { id, name: 'Untitled template', subject: '', html: '' },
                  ],
                });
                setSelected(id);
              }}
            >
              <Plus size={18} />
              New template
            </button>
          </div>
          <div className="wm-template-tabs" aria-label="Saved templates">
            {draft.templates.map((t) => (
              <button
                type="button"
                key={t.id}
                aria-pressed={t.id === selected}
                onClick={() => setSelected(t.id)}
              >
                {t.name || 'Untitled template'}
              </button>
            ))}
          </div>
          {template ? (
            <div className="wm-template-form">
              <label>
                Template name
                <input
                  value={template.name}
                  maxLength={120}
                  onChange={(e) => templateChange({ name: e.target.value })}
                />
              </label>
              <label>
                Default subject
                <input
                  value={template.subject}
                  maxLength={200}
                  onChange={(e) => templateChange({ subject: e.target.value })}
                />
              </label>
              <label>
                Import HTML, text or Word template
                <input
                  type="file"
                  accept=".html,.htm,.txt,.docx"
                  onChange={(e) => {
                    void importFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              <RichEditor
                key={`${template.id}:${version}`}
                text={htmlText(template.html)}
                html={template.html}
                disabled={busy}
                onChange={(_, html) => templateChange({ html })}
              />
              <details>
                <summary>Template preview</summary>
                <div
                  className="wm-formatted"
                  dangerouslySetInnerHTML={{ __html: cleanHTML(template.html) }}
                />
              </details>
              <small>
                Basic formatting and tables are preserved. Scripts, images, links and custom styles
                are removed. Maximum import: 1 MiB; saved HTML: 50 KB.
              </small>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  change({ ...draft, templates: draft.templates.filter((t) => t.id !== selected) });
                  setSelected('');
                }}
              >
                <Trash2 size={16} />
                Delete template
              </button>
            </div>
          ) : (
            <p className="muted">Create or select a template to edit it.</p>
          )}
        </section>
      </fieldset>
    </section>
  );
}
