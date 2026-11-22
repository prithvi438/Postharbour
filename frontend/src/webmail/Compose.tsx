import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ImagePlus, LoaderCircle, Paperclip, Send, X } from 'lucide-react';
import { RichEditor } from './RichEditor';
import { groupEmails, type Organizer } from './Organizer';
import { mailAPI } from './api';
import { isPhoto } from './presentation';
import type { Draft, UploadAttachment } from './types';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 10;

/** FileReader preserves binary data without unsafe binary-string conversions. */
function readAttachment(file: File): Promise<UploadAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error(`Could not read ${file.name}. Please select it again.`));
    reader.onload = () =>
      resolve({
        name: file.name,
        content_type: file.type || 'application/octet-stream',
        content_base64: String(reader.result).split(',')[1],
      });
    reader.readAsDataURL(file);
  });
}
/** Count decoded bytes, including padding, for consistent client/server limits. */
export function attachmentBytes(file: UploadAttachment) {
  return (
    Math.floor((file.content_base64.length * 3) / 4) -
    (file.content_base64.endsWith('==') ? 2 : file.content_base64.endsWith('=') ? 1 : 0)
  );
}

/** Inline composer shares the reader pane. The parent owns drafts and navigation
 * guards, so switching folders/messages cannot silently lose text or selected files. */
export function Compose({
  draft,
  organizer,
  sender,
  onChange,
  onClose,
  onSent,
  onBusyChange,
}: {
  draft: Draft;
  organizer?: Organizer;
  sender: string;
  onChange: (draft: Draft) => void;
  onClose: () => void;
  onSent: (id?: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [toolsTarget, setToolsTarget] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState('');
  const active = useRef(true);
  const section = useRef<HTMLElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const attachments = draft.attachments || [];
  const totalBytes = attachments.reduce((sum, file) => sum + attachmentBytes(file), 0);
  useEffect(() => {
    active.current = true;
    section.current?.scrollIntoView?.({ block: 'nearest' });
    const field = section.current?.querySelector<HTMLElement>(
      draft.reply_to ? '[contenteditable]' : 'input:not([type=file])',
    );
    field?.focus({ preventScroll: true });
    return () => {
      active.current = false;
    };
  }, []);
  /** Reading and sending share a busy boundary to protect against navigation races. */
  function changeBusy(value: boolean) {
    setBusy(value);
    onBusyChange(value);
  }
  async function attach(selected: FileList | null) {
    if (!selected || !selected.length || busy) return;
    const added = Array.from(selected);
    if (
      added.length + attachments.length > MAX_FILES ||
      totalBytes + added.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES
    ) {
      setError('Attach up to 10 files with a combined size of 5 MiB.');
      return;
    }
    changeBusy(true);
    setError('');
    try {
      const converted = await Promise.all(added.map(readAttachment));
      if (active.current) onChange({ ...draft, attachments: [...attachments, ...converted] });
    } catch (err) {
      if (active.current) setError((err as Error).message);
    } finally {
      if (active.current) changeBusy(false);
    }
  }
  /** Failed sends retain all text/files; server validation remains authoritative. */
  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const recipients = draft.to.split(',').map((value) => value.trim().toLowerCase());
    if (
      !recipients.length ||
      recipients.length > 10 ||
      recipients.some((value) => !/^[^\s@]+@[^\s@]+\.test$/.test(value))
    ) {
      setError('Enter up to 10 .test recipients, separated by commas.');
      return;
    }
    if (!draft.text.trim() && !attachments.length) {
      setError('Write a message or attach a file.');
      return;
    }
    if (
      new TextEncoder().encode(draft.subject).length > 200 ||
      new TextEncoder().encode(draft.text).length > 7000
    ) {
      setError('Keep the subject under 200 bytes and the message under 7,000 bytes.');
      return;
    }
    changeBusy(true);
    setError('');
    try {
      const result = await mailAPI<{ ok: boolean; id?: string }>('/send', 'POST', {
        ...draft,
        to: recipients.join(', '),
        attachments,
      });
      if (active.current) {
        changeBusy(false);
        onSent(result.id);
      }
    } catch (err) {
      if (active.current) {
        setError((err as Error).message);
        changeBusy(false);
      }
    }
  }
  return (
    <section
      ref={section}
      className={`wm-inline-compose ${draft.reply_to ? 'wm-reply-compose' : ''}`}
      aria-label={draft.reply_to ? 'Reply composer' : 'New message composer'}
    >
      {!draft.reply_to && (
        <header className="wm-compose-header">
          <div>
            <span className="wm-kicker">
              {draft.reply_to ? 'KEEP THE CONVERSATION GOING' : 'A NEW CONVERSATION'}
            </span>
            <h2>{draft.reply_to ? 'Your reply' : 'New message'}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close compose"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
      )}
      {draft.reply_to && (
        <button className="text-button wm-reply-close" disabled={busy} onClick={onClose}>
          Cancel reply
        </button>
      )}
      <form onSubmit={(event) => void send(event)}>
        <fieldset disabled={busy}>
          {!draft.reply_to && (
            <>
              <div className="wm-compose-from">
                <span>From</span>
                <strong>{sender}</strong>
              </div>
              <label className="wm-compose-line">
                <span>To</span>
                <input
                  required
                  placeholder="hello@harbor.test"
                  value={draft.to}
                  list="mail-recipients"
                  onChange={(event) => {
                    const value = event.target.value;
                    const parts = value.split(',');
                    const query = parts.pop()?.trim();
                    const group = organizer?.groups.find((g) => 'Group: ' + g.name === query);
                    onChange({
                      ...draft,
                      to:
                        group && organizer
                          ? [
                              ...new Set([
                                ...parts.map((p) => p.trim()).filter(Boolean),
                                ...groupEmails(organizer, group.members),
                              ]),
                            ].join(', ')
                          : value,
                    });
                  }}
                />
              </label>
              <label className="wm-compose-line">
                <span>Subject</span>
                <input
                  required
                  maxLength={200}
                  placeholder="Give your message a subject"
                  value={draft.subject}
                  onChange={(event) => onChange({ ...draft, subject: event.target.value })}
                />
              </label>
            </>
          )}
          <datalist id="mail-recipients">
            {organizer?.contacts.map((c) => (
              <option key={c.id} value={c.email}>
                {c.name}
              </option>
            ))}
            {organizer?.groups.map((g) => (
              <option key={g.id} value={'Group: ' + g.name}>
                {g.members.length} contacts
              </option>
            ))}
          </datalist>
          <div className="wm-message-label">
            <span className="wm-sr-only">Message</span>
            <RichEditor
              toolsTarget={toolsTarget}
              text={draft.text}
              html={draft.html}
              disabled={busy}
              onChange={(text, html) => onChange({ ...draft, text, html })}
            />
          </div>
          <input
            className="wm-sr-only"
            ref={files}
            type="file"
            multiple
            aria-label="Attach files"
            onChange={(event) => {
              void attach(event.target.files);
              event.target.value = '';
            }}
          />
          <input
            className="wm-sr-only"
            ref={photos}
            type="file"
            multiple
            accept="image/*"
            aria-label="Attach photos"
            onChange={(event) => {
              void attach(event.target.files);
              event.target.value = '';
            }}
          />
          {attachments.length > 0 && (
            <div className="wm-draft-files" aria-label="Selected attachments">
              {attachments.map((file, index) => (
                <div className="wm-draft-file" key={`${file.name}-${index}`}>
                  {isPhoto(file.content_type) ? (
                    <img
                      src={`data:${file.content_type};base64,${file.content_base64}`}
                      alt={`Preview of ${file.name}`}
                    />
                  ) : (
                    <Paperclip size={23} />
                  )}
                  <span>
                    <strong>{file.name}</strong>
                    <small>{Math.max(1, Math.ceil(attachmentBytes(file) / 1024))} KB</small>
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() =>
                      onChange({ ...draft, attachments: attachments.filter((_, i) => i !== index) })
                    }
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </fieldset>
        {error && (
          <p className="wm-alert" role="alert">
            {error}
          </p>
        )}
        <footer>
          <div className="wm-attach-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Choose files"
              title="Attach files"
              disabled={busy}
              onClick={() => files.current?.click()}
            >
              <Paperclip size={20} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Choose photos"
              title="Attach photos"
              disabled={busy}
              onClick={() => photos.current?.click()}
            >
              <ImagePlus size={21} />
            </button>
            <div ref={setToolsTarget} className="wm-editor-tools-slot" />
            <span>
              {attachments.length
                ? `${attachments.length} files · ${(totalBytes / 1024 / 1024).toFixed(1)} / 5 MiB`
                : 'Files & photos · up to 5 MiB'}
            </span>
          </div>
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? <LoaderCircle size={18} className="spin" /> : <Send size={18} />}
            {busy ? 'Working…' : 'Send message'}
          </button>
        </footer>
      </form>
    </section>
  );
}
