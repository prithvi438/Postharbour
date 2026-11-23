import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Conversation } from './Conversation';
import type { MailDetail } from './types';

it('keeps controls and selected text independent of card expansion and exposes a keyboard button', () => {
  const message = {
    id: 'one',
    from: { name: 'Friend', address: 'friend@example.com' },
    to: [{ name: '', address: 'me@example.com' }],
    subject: 'Project update',
    date: '2026-11-23T00:00:00Z',
    read: true,
    snippet: '',
    attachments: 1,
    text: 'Select this message text',
    message_id: 'one@example.com',
    text_truncated: false,
    attachment_list: [{ id: 'file', name: 'plan.txt', size: 30, content_type: 'text/plain' }],
  } satisfies MailDetail;
  const expand = vi.fn(),
    reply = vi.fn();
  render(
    <Conversation
      messages={[message]}
      address="me@example.com"
      truncated={false}
      composing={false}
      onExpand={expand}
      onReply={reply}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  expect(reply).toHaveBeenCalledWith(message);
  expect(expand).not.toHaveBeenCalled();
  const download = screen.getByRole('link', { name: /plan.txt/ });
  // Prevent jsdom navigation while preserving the event path through the card.
  download.addEventListener('click', (event) => event.preventDefault());
  fireEvent.click(download);
  expect(expand).not.toHaveBeenCalled();
  const selection = vi
    .spyOn(window, 'getSelection')
    .mockReturnValue({ toString: () => 'selected text' } as Selection);
  fireEvent.click(screen.getByText('Select this message text'));
  expect(expand).not.toHaveBeenCalled();
  selection.mockRestore();
  fireEvent.click(
    screen.getByRole('button', { name: 'Expand email: Project update from friend@example.com' }),
  );
  expect(expand).toHaveBeenCalledExactlyOnceWith(message);
});
