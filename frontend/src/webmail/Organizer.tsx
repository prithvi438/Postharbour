import { useState } from 'react';
export interface Contact {
  id: string;
  name: string;
  email: string;
}
export interface ContactGroup {
  id: string;
  name: string;
  members: string[];
}
export interface Organizer {
  revision: number;
  contacts: Contact[];
  groups: ContactGroup[];
  flags: Record<string, { starred?: boolean; archived?: boolean }>;
}
export const emptyOrganizer: Organizer = { revision: 0, contacts: [], groups: [], flags: {} };
/** Expand groups through current contacts, deduplicating recipients before sending. */
export function groupEmails(data: Organizer, ids: string[]) {
  return [...new Set(data.contacts.filter((c) => ids.includes(c.id)).map((c) => c.email))];
}
/** The address book shares mailbox authentication and persists independently of captures. */
export function Contacts({
  data,
  save,
  compose,
  busy,
}: {
  data: Organizer;
  save: (next: Organizer) => Promise<boolean>;
  compose: (to: string) => void;
  busy: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [group, setGroup] = useState('');
  const [editing, setEditing] = useState('');
  const chosen = data.contacts.filter((c) => selected.includes(c.id));
  return (
    <section className="wm-address-book">
      <h2>Contacts</h2>
      <p>People you write to. Select up to 10 to compose or create a group.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const saved = await save({
            ...data,
            contacts: [
              ...data.contacts.filter((c) => c.id !== editing),
              { id: editing || crypto.randomUUID(), name, email },
            ],
          });
          if (saved) {
            setName('');
            setEmail('');
            setEditing('');
          }
        }}
      >
        <input
          aria-label="Contact name"
          placeholder="Name"
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          aria-label="Contact email"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <button className="button primary" disabled={busy}>
          {editing ? 'Save changes' : 'Add contact'}
        </button>
      </form>
      <div className="wm-contact-actions">
        <button
          className="button secondary"
          disabled={!chosen.length || chosen.length > 10}
          onClick={() => compose(groupEmails(data, selected).join(', '))}
        >
          Compose to selected ({chosen.length})
        </button>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const saved = await save({
            ...data,
            groups: [
              ...data.groups,
              { id: crypto.randomUUID(), name: group, members: chosen.map((c) => c.id) },
            ],
          });
          if (saved) setGroup('');
        }}
      >
        <input
          aria-label="Group name"
          placeholder="Name a group of selected contacts"
          required
          maxLength={120}
          value={group}
          onChange={(e) => setGroup(e.target.value)}
        />
        <button
          className="button secondary"
          disabled={busy || !chosen.length || chosen.length > 10}
        >
          Create group
        </button>
      </form>
      <div className="wm-contact-list">
        {data.contacts.map((c) => (
          <div className="wm-contact" key={c.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked ? [...selected, c.id] : selected.filter((id) => id !== c.id),
                  )
                }
              />
              <span>
                <strong>{c.name}</strong>
                <small>{c.email}</small>
              </span>
            </label>
            <button className="text-button" onClick={() => compose(c.email)}>
              Compose
            </button>
            <button
              className="text-button"
              onClick={() => {
                setEditing(c.id);
                setName(c.name);
                setEmail(c.email);
              }}
            >
              Edit
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void save({
                  ...data,
                  contacts: data.contacts.filter((x) => x.id !== c.id),
                  groups: data.groups
                    .map((g) => ({ ...g, members: g.members.filter((id) => id !== c.id) }))
                    .filter((g) => g.members.length),
                })
              }
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <h3>Contact groups</h3>
      {data.groups.map((g) => (
        <div className="wm-contact" key={g.id}>
          <span>
            <strong>{g.name}</strong>
            <small>{g.members.length} contacts</small>
          </span>
          <button
            className="text-button"
            onClick={() => compose(groupEmails(data, g.members).join(', '))}
          >
            Compose
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              void save({
                ...data,
                groups: data.groups.map((x) =>
                  x.id === g.id ? { ...x, members: chosen.map((c) => c.id) } : x,
                ),
              })
            }
            title="Replace members with selected contacts"
            hidden={!chosen.length || chosen.length > 10}
          >
            Use selected
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void save({ ...data, groups: data.groups.filter((x) => x.id !== g.id) })}
          >
            Remove
          </button>
        </div>
      ))}
    </section>
  );
}
