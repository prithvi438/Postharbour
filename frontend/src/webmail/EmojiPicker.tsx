import { useEffect, useState } from 'react';
type Emoji = { emoji: string; name: string; group: string };
/** Load the bundled Unicode catalog only when opened; search includes tone variants. */
export function EmojiPicker({
  onPick,
  disabled,
}: {
  onPick: (emoji: string) => void;
  disabled: boolean;
}) {
  const [items, setItems] = useState<Emoji[]>([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [limit, setLimit] = useState(120);
  useEffect(() => {
    let active = true;
    import('./emoji-data.json')
      .then((data) => {
        if (active) setItems(data.default);
      })
      .catch(() => {
        if (active) setError('Could not load emojis. Close and reopen to retry.');
      });
    return () => {
      active = false;
    };
  }, []);
  const matches = items.filter(
    (e) =>
      (!group || e.group === group) &&
      (!query || `${e.name} ${e.emoji}`.toLowerCase().includes(query.toLowerCase())),
  );
  return (
    <div className="wm-emoji-picker">
      <input
        autoFocus
        aria-label="Search emojis"
        placeholder="Search emojis, flags, skin tones…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(120);
        }}
      />
      <select
        aria-label="Emoji category"
        value={group}
        onChange={(e) => {
          setGroup(e.target.value);
          setLimit(120);
        }}
      >
        <option value="">All categories</option>
        {[...new Set(items.map((e) => e.group))].map((g) => (
          <option key={g}>{g}</option>
        ))}
      </select>
      {error && <p role="alert">{error}</p>}
      {!items.length && !error && <p role="status">Loading emojis…</p>}
      <div className="wm-emoji-grid">
        {matches.slice(0, limit).map((e) => (
          <button
            type="button"
            disabled={disabled}
            key={e.emoji}
            title={e.name}
            aria-label={e.name}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(e.emoji)}
          >
            {e.emoji}
          </button>
        ))}
      </div>
      {!!items.length && <small>{matches.length} emojis · appearance depends on your device</small>}
      {matches.length > limit && (
        <button type="button" onClick={() => setLimit(limit + 120)}>
          Show more
        </button>
      )}
    </div>
  );
}
