import type { MailAddress, MailSummary } from './types';

export interface PersonConversation {
  address: string;
  name: string;
  messages: MailSummary[];
  latest: MailSummary;
  unread: number;
}
export interface SubjectConversation {
  key: string;
  label: string;
  latest: MailSummary;
  count: number;
}
/** Match the API's topic normalization; forwarded messages remain separate topics. */
export function subjectKey(subject: string) {
  return subject
    .trim()
    .replace(/^(?:re:\s*)+/i, '')
    .trim()
    .toLowerCase();
}
/** Outgoing group messages appear under each visible recipient. Incoming messages
 * use the actual sender, never a display name or a private Bcc recipient. */
export function correspondents(message: MailSummary, owner: string): MailAddress[] {
  const mine = message.from.address.toLowerCase() === owner.toLowerCase();
  if (!mine) return [message.from];
  const other = message.to.filter((a) => a.address.toLowerCase() !== owner.toLowerCase());
  return other.length ? other : message.to;
}
/** Build one newest-first card per normalized address from inbox and sent metadata. */
export function people(messages: MailSummary[], owner: string): PersonConversation[] {
  const groups = new Map<string, PersonConversation>();
  const sorted = [...messages].sort(
    (a, b) => Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id),
  );
  for (const message of sorted)
    for (const person of correspondents(message, owner)) {
      const address = person.address.toLowerCase();
      let group = groups.get(address);
      if (!group) {
        group = { address, name: person.name || address, messages: [], latest: message, unread: 0 };
        groups.set(address, group);
      }
      if (group.name === address && person.name) group.name = person.name;
      if (group.messages.some((m) => m.id === message.id)) continue;
      group.messages.push(message);
      if (!message.read && message.from.address.toLowerCase() !== owner.toLowerCase())
        group.unread++;
    }
  return [...groups.values()];
}
/** A topic chip points at its latest email; opening a person always selects the first. */
export function subjects(messages: MailSummary[]): SubjectConversation[] {
  const topics = new Map<string, SubjectConversation>();
  for (const message of messages) {
    const key = subjectKey(message.subject),
      previous = topics.get(key);
    if (previous) previous.count++;
    else
      topics.set(key, {
        key,
        label: message.subject.trim().replace(/^(?:re:\s*)+/i, '') || '(No subject)',
        latest: message,
        count: 1,
      });
  }
  return [...topics.values()];
}
