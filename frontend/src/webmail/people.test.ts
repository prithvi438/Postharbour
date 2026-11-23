import { describe, it, expect } from 'vitest';
import { people, subjects } from './people';
import type { MailSummary } from './types';
const message = (
  id: string,
  from: string,
  to: string[],
  subject: string,
  date: string,
): MailSummary => ({
  id,
  from: { name: '', address: from },
  to: to.map((address) => ({ name: '', address })),
  subject,
  date,
  read: false,
  snippet: '',
  attachments: 0,
});
describe('person conversation navigation', () => {
  it('combines both directions case-insensitively and chooses the latest topic', () => {
    const rows = [
      message('1', 'friend@test.com', ['me@test.com'], 'Old', '2026-01-01'),
      message('2', 'me@test.com', ['FRIEND@test.com'], 'New', '2026-01-03'),
      message('3', 'friend@test.com', ['me@test.com'], 'Re: Old', '2026-01-02'),
    ];
    const result = people(rows, 'me@test.com');
    expect(result).toHaveLength(1);
    expect(result[0].latest.id).toBe('2');
    expect(result[0].unread).toBe(2);
    expect(subjects(result[0].messages).map((t) => [t.key, t.count])).toEqual([
      ['new', 1],
      ['old', 2],
    ]);
  });
  it('keeps group recipients separate and never keys people by display name', () => {
    const rows = [message('1', 'me@test.com', ['a@test.com', 'b@test.com'], 'Group', '2026-01-01')];
    expect(people(rows, 'me@test.com').map((p) => p.address)).toEqual(['a@test.com', 'b@test.com']);
  });
});
