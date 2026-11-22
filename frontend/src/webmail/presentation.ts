import type { Draft, MailFilter, MailSummary } from './types';

/** Initials avoid disclosing sender information to remote avatar services. */
export function initials(name: string) {
  return name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}
/** Dates follow the reader's locale; malformed imported dates are omitted. */
export function messageDate(value: string, full = false) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(
        undefined,
        full ? { dateStyle: 'medium', timeStyle: 'short' } : { month: 'short', day: 'numeric' },
      );
}
/** Conditions combine with AND; search remains a separate list constraint. */
export function matchesFilter(message: MailSummary, filter: MailFilter | undefined) {
  if (!filter) return true;
  const includes = (value: string, query: string) =>
    value.toLowerCase().includes(query.trim().toLowerCase());
  return (
    includes(`${message.from.name} ${message.from.address}`, filter.from) &&
    includes(message.to.map((to) => `${to.name} ${to.address}`).join(' '), filter.to) &&
    includes(message.subject, filter.subject) &&
    (!filter.has_attachments || message.attachments > 0) &&
    (!filter.unread || !message.read)
  );
}
/** Prefilled reply headers alone do not count as an unsaved reply. */
export function draftHasContent(draft: Draft | null) {
  return Boolean(
    draft &&
    (draft.text || draft.attachments?.length || (!draft.reply_to && (draft.to || draft.subject))),
  );
}
/** Only these raster MIME types qualify for photo previews. */
export function isPhoto(contentType = '') {
  return ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(contentType.toLowerCase());
}
