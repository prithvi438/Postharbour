import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mailAPI } from './api';
import { Webmail } from './Webmail';
import type { MailDetail, MailSummary } from './types';

vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  mailAPI: vi.fn(),
}));

const message: MailSummary = {
  id: 'm1',
  from: { name: 'Studio team', address: 'hello@harbor.test' },
  to: [{ name: 'Alex', address: 'alex@harbor.test' }],
  subject: 'A little hello',
  snippet: 'Welcome to the studio',
  date: '2026-11-22T09:00:00Z',
  read: true,
  attachments: 0,
};
const detail: MailDetail = {
  ...message,
  text: 'Private message body',
  message_id: 'original@harbor.test',
  attachment_list: [],
};

/** Only the browser's dialog implementation is replaced; real form/state logic runs. */
beforeEach(() => {
  vi.mocked(mailAPI).mockReset();
  history.replaceState(null, '', '/mail');
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

/** A deterministic local mailbox server, with optional response overrides per test. */
function mockMailbox(
  override?: (path: string, method?: string, body?: unknown) => Promise<unknown> | undefined,
) {
  vi.mocked(mailAPI).mockImplementation(async (path, method, body) => {
    const replacement = override?.(path, method, body);
    if (replacement) return replacement;
    if (path === '/session')
      return {
        user: { id: 'alex', name: 'Alex Morgan', address: 'alex@harbor.test' },
        csrf: 'csrf',
        mode: 'simulation',
      };
    if (path === '/messages?folder=inbox') return { messages: [message] };
    if (path === '/messages?folder=sent') return { messages: [] };
    if (path === '/messages/m1/conversation') return { messages: [detail], truncated: false };
    if (path === '/organizer')
      return Promise.resolve({ revision: 0, contacts: [], groups: [], flags: {} });
    if (path === '/filters') return { filters: [] };
    return { ok: true };
  });
}

describe('mailbox experience', () => {
  it('preserves a failed reply, confirms draft dismissal, and sends the original reply reference', async () => {
    let failSend = true;
    mockMailbox((path) => {
      if (path === '/send' && failSend)
        return Promise.reject(new Error('Mail catcher unavailable'));
    });
    render(<Webmail />);
    fireEvent.click(await screen.findByRole('button', { name: /Studio team.*A little hello/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reply' }));
    expect(screen.queryByRole('textbox', { name: 'To' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Subject' })).not.toBeInTheDocument();
    fireEvent.input(screen.getByRole('textbox', { name: 'Message' }), {
      target: { textContent: 'Thank you, team!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reply' }));
    expect(screen.getByText('Discard this draft? It hasn’t been sent.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep writing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Mail catcher unavailable');
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveTextContent('Thank you, team!');
    failSend = false;
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Message sent to the local sandbox.');
    expect(mailAPI).toHaveBeenCalledWith('/send', 'POST', {
      to: 'hello@harbor.test',
      subject: 'Re: A little hello',
      text: 'Thank you, team!',
      html: 'Thank you, team!',
      reply_to: 'm1',
      attachments: [],
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('never restores a delayed private message after signing out', async () => {
    let finish!: (value: { messages: MailDetail[] }) => void;
    const pending = new Promise<{ messages: MailDetail[] }>((resolve) => {
      finish = resolve;
    });
    mockMailbox((path) => (path === '/messages/m1/conversation' ? pending : undefined));
    render(<Webmail />);
    fireEvent.click(await screen.findByRole('button', { name: /Studio team.*A little hello/ }));
    await screen.findByText('Opening your conversation…');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out of mailbox' }));
    await screen.findByRole('heading', { name: 'Welcome to your mail.' });
    await act(async () => finish({ messages: [detail] }));
    await waitFor(() => expect(screen.queryByText('Private message body')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Reply' })).not.toBeInTheDocument();
  });

  it('renders incoming content as text and searches only the loaded mailbox', async () => {
    mockMailbox((path) =>
      path === '/messages/m1/conversation'
        ? Promise.resolve({ messages: [{ ...detail, text: '<img src=x onerror=alert(1)>Hello' }] })
        : undefined,
    );
    render(<Webmail />);
    fireEvent.click(await screen.findByRole('button', { name: /Studio team.*A little hello/ }));
    await screen.findByText('<img src=x onerror=alert(1)>Hello');
    expect(document.querySelector('.wm-chat-text img')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search mail' }), {
      target: { value: 'not in this mailbox' },
    });
    expect(screen.getByRole('heading', { name: 'No matching messages' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Studio team.*A little hello/ }),
    ).not.toBeInTheDocument();
  });
});

it('composes in the reader pane, preserves attached files after failure, and guards navigation', async () => {
  let fail = true;
  mockMailbox((path) =>
    path === '/send' && fail ? Promise.reject(new Error('Try again later')) : undefined,
  );
  render(<Webmail />);
  fireEvent.click(await screen.findByRole('button', { name: 'Compose' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const workspace = screen.getByRole('region', { name: 'Conversation workspace' });
  expect(workspace).toContainElement(screen.getByRole('region', { name: 'New message composer' }));
  expect(document.body).toHaveClass('wm-pane-open');
  fireEvent.change(screen.getByRole('combobox', { name: 'To' }), {
    target: { value: 'hello@harbor.test' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Subject' }), {
    target: { value: 'The project files' },
  });
  const file = new File(['Local attachment contents'], 'notes.txt', { type: 'text/plain' });
  fireEvent.change(screen.getByLabelText('Attach files'), { target: { files: [file] } });
  await screen.findByRole('button', { name: 'Remove notes.txt' });
  fireEvent.click(screen.getByRole('button', { name: 'Back to messages' }));
  await screen.findByRole('dialog', { name: 'Keep your draft?' });
  fireEvent.click(screen.getByRole('button', { name: 'Keep writing' }));
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByText('Try again later');
  expect(screen.getByRole('button', { name: 'Remove notes.txt' })).toBeInTheDocument();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByText('Message sent to the local sandbox.');
  expect(mailAPI).toHaveBeenLastCalledWith('/messages?folder=sent');
  const send = vi.mocked(mailAPI).mock.calls.find(([path]) => path === '/send');
  expect(send?.[2]).toEqual({
    to: 'hello@harbor.test',
    subject: 'The project files',
    text: '',
    attachments: [
      {
        name: 'notes.txt',
        content_type: 'text/plain',
        content_base64: btoa('Local attachment contents'),
      },
    ],
  });
  expect(document.body).not.toHaveClass('wm-pane-open');
});

it('previews and removes photos, rejects oversized files, and confirms browser-back draft loss', async () => {
  mockMailbox();
  render(<Webmail />);
  fireEvent.click(await screen.findByRole('button', { name: 'Compose' }));
  fireEvent.change(screen.getByLabelText('Attach photos'), {
    target: { files: [new File(['png-data'], 'photo.png', { type: 'image/png' })] },
  });
  expect(await screen.findByAltText('Preview of photo.png')).toHaveAttribute(
    'src',
    'data:image/png;base64,' + btoa('png-data'),
  );
  fireEvent.change(screen.getByLabelText('Attach files'), {
    target: { files: [new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.bin')] },
  });
  await screen.findByText('Attach up to 10 files with a combined size of 5 MiB.');
  expect(screen.queryByRole('button', { name: 'Remove large.bin' })).not.toBeInTheDocument();
  fireEvent(window, new PopStateEvent('popstate'));
  await screen.findByRole('dialog', { name: 'Keep your draft?' });
  fireEvent.click(screen.getByRole('button', { name: 'Keep writing' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove photo.png' }));
  expect(screen.queryByAltText('Preview of photo.png')).not.toBeInTheDocument();
});

it('loads saved chips, combines conditions with search, and saves/edits/deletes views through the API', async () => {
  const saved = {
    id: 'filter-1',
    name: 'Studio files',
    from: 'hello',
    to: '',
    subject: '',
    has_attachments: true,
    unread: false,
  };
  mockMailbox((path, method, body) => {
    if (path === '/filters' && method === 'POST')
      return Promise.resolve({ ...(body as object), id: 'filter-2' });
    if (path === '/organizer')
      return Promise.resolve({ revision: 0, contacts: [], groups: [], flags: {} });
    if (path === '/filters') return Promise.resolve({ filters: [saved] });
    if (path === '/filters/filter-2' && method === 'PUT')
      return Promise.resolve({ ...(body as object), id: 'filter-2' });
  });
  render(<Webmail />);
  fireEvent.click(await screen.findByRole('button', { name: 'Studio files' }));
  expect(screen.getByRole('heading', { name: 'No matching messages' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create filter' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Filter name' }), {
    target: { value: 'From Studio' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'From contains' }), {
    target: { value: 'HELLO' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save filter' }));
  await screen.findByRole('button', { name: 'From Studio' });
  expect(screen.getByRole('button', { name: /Studio team.*A little hello/ })).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Search mail' }), {
    target: { value: 'not here' },
  });
  expect(screen.getByRole('heading', { name: 'No matching messages' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit filter From Studio' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Filter name' }), {
    target: { value: 'Updated Studio' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save filter' }));
  await screen.findByRole('button', { name: 'Updated Studio' });
  fireEvent.click(screen.getByRole('button', { name: 'Edit filter Updated Studio' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete filter' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete filter' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Updated Studio' })).not.toBeInTheDocument(),
  );
  expect(mailAPI).toHaveBeenCalledWith('/filters/filter-2', 'DELETE');
});

it('keeps a newly sent message open as a conversation using the returned capture ID', async () => {
  const sentMessage: MailDetail = {
    ...detail,
    id: 'new-capture',
    from: { name: 'Alex', address: 'alex@harbor.test' },
    to: [{ name: 'Studio', address: 'hello@harbor.test' }],
    subject: 'A new chat',
    text: 'Hello from the reader pane.',
  };
  mockMailbox((path) => {
    if (path === '/send') return Promise.resolve({ ok: true, id: 'new-capture' });
    if (path === '/messages/new-capture/conversation')
      return Promise.resolve({ messages: [sentMessage] });
  });
  render(<Webmail />);
  fireEvent.click(await screen.findByRole('button', { name: 'Compose' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'To' }), {
    target: { value: 'hello@harbor.test' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Subject' }), {
    target: { value: 'A new chat' },
  });
  fireEvent.input(screen.getByRole('textbox', { name: 'Message' }), {
    target: { textContent: sentMessage.text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByText(sentMessage.text);
  expect(screen.queryByRole('region', { name: 'New message composer' })).not.toBeInTheDocument();
  expect(document.body).toHaveClass('wm-pane-open');
  expect(mailAPI).toHaveBeenCalledWith('/messages/new-capture/conversation');
});

it('preserves an in-flight reply when a conversation refresh fails and is retried', async () => {
  let failRefresh = false;
  let finishSend!: (value: { ok: boolean; id: string }) => void;
  const sending = new Promise<{ ok: boolean; id: string }>((resolve) => {
    finishSend = resolve;
  });
  mockMailbox((path) => {
    if (path === '/messages/m1/conversation' && failRefresh)
      return Promise.reject(new Error('Conversation refresh failed'));
    if (path === '/send') return sending;
  });
  render(<Webmail />);
  fireEvent.click(await screen.findByRole('button', { name: /Studio team.*A little hello/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Reply' }));
  fireEvent.input(screen.getByRole('textbox', { name: 'Message' }), {
    target: { textContent: 'Keep this reply safe.' },
  });
  failRefresh = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh messages' }));
  await screen.findByText('Conversation refresh failed');
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveTextContent(
    'Keep this reply safe.',
  );
  failRefresh = false;
  await act(async () => finishSend({ ok: true, id: 'reply-new' }));
  await screen.findByText('Message sent to the local sandbox.');
  expect(screen.queryByRole('region', { name: 'Reply composer' })).not.toBeInTheDocument();
});

it('saves contacts, expands groups into recipients, and keeps archive/star state', async () => {
  let book = {
    revision: 0,
    contacts: [{ id: 'c1', name: 'Studio', email: 'hello@harbor.test' }],
    groups: [{ id: 'g1', name: 'Team', members: ['c1'] }],
    flags: {} as Record<string, { starred?: boolean; archived?: boolean }>,
  };
  mockMailbox((path, method, body) => {
    if (path === '/organizer') {
      if (method === 'PUT') book = { ...(body as typeof book), revision: book.revision + 1 };
      return Promise.resolve(book);
    }
  });
  render(<Webmail />);
  fireEvent.click(await screen.findByRole('button', { name: 'Contacts' }));
  await screen.findByText('Studio');
  fireEvent.change(screen.getByLabelText('Contact name'), { target: { value: 'Alex' } });
  fireEvent.change(screen.getByLabelText('Contact email'), {
    target: { value: 'alex@harbor.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
  await screen.findByText('Alex');
  expect(book.contacts).toHaveLength(2);
  fireEvent.click(screen.getAllByRole('button', { name: 'Compose' })[0]);
  fireEvent.change(screen.getByRole('combobox', { name: 'To' }), {
    target: { value: 'Group: Team' },
  });
  expect(screen.getByRole('combobox', { name: 'To' })).toHaveValue('hello@harbor.test');
  fireEvent.click(screen.getByRole('button', { name: 'Close compose' }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
  fireEvent.click(screen.getByRole('button', { name: /Inbox/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Studio team.*A little hello/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Star email' }));
  await screen.findByRole('button', { name: 'Unstar email' });
  fireEvent.click(screen.getAllByRole('button', { name: 'Archive' }).at(-1)!);
  await screen.findByRole('button', { name: 'Unarchive' });
  expect(book.flags.m1).toEqual({ starred: true, archived: true });
});

it('opens tools only on demand and searches the bundled emoji catalog', async () => {
  mockMailbox();
  render(<Webmail />);
  fireEvent.click(await screen.findByRole('button', { name: 'Compose' }));
  expect(screen.queryByRole('button', { name: 'Bold' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Formatting options' }));
  expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument();
  expect(
    screen.getByRole('dialog', { name: 'Formatting options' }).closest('.wm-pane-scroll'),
  ).toBeNull();
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Formatting options' }), { key: 'Escape' });
  expect(screen.queryByRole('button', { name: 'Bold' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Choose emoji' }));
  await screen.findByRole('option', { name: 'Flags' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Search emojis' }), {
    target: { value: 'flag: India' },
  });
  expect(await screen.findByRole('button', { name: 'flag: India' })).toBeInTheDocument();
});

it('combines and sorts sent/received mail, expands one message, and preserves a reply while collapsing', async () => {
  const outgoing = {
    ...message,
    id: 'm2',
    from: { name: 'Alex', address: 'alex@harbor.test' },
    to: [message.from],
    subject: 'A newer outgoing email',
    date: '2026-11-22T10:00:00Z',
  };
  mockMailbox((path) =>
    path === '/messages?folder=sent'
      ? Promise.resolve({ messages: [outgoing, message] })
      : undefined,
  );
  render(<Webmail />);
  expect(
    await screen.findByRole('button', { name: /To: Studio team.*A newer outgoing email/ }),
  ).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /Studio team.*A little hello/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /Studio team.*A little hello/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Expand email' }));
  expect(document.querySelector('.wm-app')).toHaveClass('wm-expanded');
  fireEvent.click(await screen.findByRole('button', { name: 'Reply' }));
  fireEvent.input(screen.getByRole('textbox', { name: 'Message' }), {
    target: { textContent: 'Preserved draft' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Collapse email' }));
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveTextContent('Preserved draft');
  expect(document.querySelector('.wm-app')).not.toHaveClass('wm-expanded');
});

it('forwards visible content into an editable new-message draft', async () => {
  mockMailbox();
  render(<Webmail />);
  fireEvent.click(await screen.findByRole('button', { name: /Studio team.*A little hello/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Forward' }));
  expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveValue('Fwd: A little hello');
  expect(screen.getByRole('combobox', { name: 'To' })).toHaveValue('');
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveTextContent(
    'Private message body',
  );
});
