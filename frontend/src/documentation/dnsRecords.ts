/** A display-only record from the provider's BIND zone. This never publishes DNS. */
export interface GuideRecord {
  name: string;
  type: string;
  value: string;
  priority?: string;
  ttl: string;
}

/** Convert an absolute owner to a provider's relative Host field. For a subdomain
 * zone managed at its parent, users must retain the subdomain suffix instead. */
export function relativeName(name: string, zone: string): string {
  const owner = name.replace(/\.$/, '');
  const domain = zone.replace(/\.$/, '');
  if (owner.toLowerCase() === domain.toLowerCase() || owner === '@') return '@';
  return owner.toLowerCase().endsWith('.' + domain.toLowerCase())
    ? owner.slice(0, -domain.length - 1)
    : owner;
}

/** Read common explicit-owner TXT/MX records without guessing missing values.
 * Quoted TXT chunks are joined without spaces, as DNS requires. Directives,
 * inherited owners and unfamiliar syntax remain available in the original zone. */
export function mailRecords(zone: string): GuideRecord[] {
  const records: GuideRecord[] = [];
  let line = '',
    quoted = false,
    escaped = false,
    comment = false,
    depth = 0;
  const lines: string[] = [];
  for (const char of zone + '\n') {
    if (comment) {
      if (char !== '\n') continue;
      comment = false;
    }
    if (escaped) {
      line += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      line += char;
      escaped = true;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (!quoted) {
      if (char === ';') {
        comment = true;
        continue;
      }
      if (char === '(') {
        depth++;
        line += ' ';
        continue;
      }
      if (char === ')') {
        depth--;
        line += ' ';
        continue;
      }
      if (char === '\n') {
        if (depth === 0) {
          lines.push(line);
          line = '';
        } else line += ' ';
        continue;
      }
    }
    line += char;
  }
  if (quoted || depth !== 0) return [];
  for (const entry of lines) {
    // Do not interpret implicit owners, $ORIGIN or other DNS directives.
    const match = entry.match(/^(\S+)\s+(?:(\d+)\s+)?(?:IN\s+)?(TXT|MX)\s+(.+)$/i);
    if (!match || match[1].startsWith('$')) continue;
    const [, name, ttl, kind, data] = match;
    const type = kind.toUpperCase();
    if (type === 'MX') {
      const mx = data.trim().match(/^(\d+)\s+([\w.-]+)\.?$/);
      if (mx)
        records.push({
          name,
          type,
          ttl: ttl || 'Provider default',
          priority: mx[1],
          value: mx[2].replace(/\.$/, ''),
        });
    } else {
      const chunks = data.match(/"(?:\\.|[^"\\])*"/g);
      if (!chunks || data.replace(/"(?:\\.|[^"\\])*"/g, '').trim()) continue;
      // Avoid silently corrupting DNS decimal escapes or uncommon escaped data.
      if (chunks.some((chunk) => /\\(?!["\\])/.test(chunk))) continue;
      const value = chunks.map((chunk) => chunk.slice(1, -1).replace(/\\(["\\])/g, '$1')).join('');
      records.push({ name, type, ttl: ttl || 'Provider default', value });
    }
  }
  return records;
}

/** Friendly purpose labels leave unknown provider records visibly unclassified. */
export function recordPurpose(record: GuideRecord): string {
  if (record.type === 'MX') return 'Incoming mail';
  if (/^v=spf1\b/i.test(record.value)) return 'SPF · allowed senders';
  if (record.name.toLowerCase().includes('._domainkey')) return 'DKIM · public signing key';
  if (/^v=DMARC1\b/i.test(record.value)) return 'DMARC · authentication policy';
  return 'Provider TXT record';
}

/** The generated zone can contain server-level SPF and optional discovery/security
 * records. Keep customer cards focused on this domain's core mail configuration. */
export function customerMailRecords(records: GuideRecord[], domain: string): GuideRecord[] {
  const root = domain.replace(/\.$/, '').toLowerCase();
  return records.filter((record) => {
    const name = record.name.replace(/\.$/, '').toLowerCase();
    const apex = name === root || name === '@';
    return (
      (apex && record.type === 'MX') ||
      (apex && /^v=spf1\b/i.test(record.value)) ||
      (name === '_dmarc.' + root && /^v=DMARC1\b/i.test(record.value)) ||
      name.endsWith('._domainkey.' + root)
    );
  });
}
