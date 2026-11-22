import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Star,
  Archive,
  Maximize2,
  Minimize2,
  Users,
  Check,
  Download,
  Inbox,
  LoaderCircle,
  LogOut,
  Mail,
  MessageCircle,
  Moon,
  Paperclip,
  PenLine,
  RefreshCw,
  Search,
  Send,
  Sun,
  X,
} from 'lucide-react';
import { Brand, Modal } from '../components/ui';
import { useTheme } from '../hooks/useTheme';
import { useInstall } from '../hooks/useInstall';
import { mailAPI, MailError, setMailToken } from './api';
import { Contacts, emptyOrganizer, type Organizer } from './Organizer';
import { Compose } from './Compose';
import { Conversation } from './Conversation';
import { builtinFilters, FilterChips, FilterEditor } from './Filters';
import { MailSignIn } from './MailSignIn';
import { draftHasContent, initials, matchesFilter, messageDate } from './presentation';
import type { Draft, Folder, MailDetail, MailFilter, MailSession, MailSummary } from './types';
import './webmail.css';

/** The mailbox owns private state and request generations. Neither messages nor
 * drafts are written to local storage or the service worker's offline cache. */
export function Webmail() {
  const [session, setSession] = useState<MailSession | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState('');
  const [organizer, setOrganizer] = useState<Organizer>(emptyOrganizer);
  const [organizerReady, setOrganizerReady] = useState(false);
  const [organizerBusy, setOrganizerBusy] = useState(false);
  const [view, setView] = useState<'conversations' | 'mail' | 'starred' | 'archive' | 'contacts'>(
    'conversations',
  );
  const [expanded, setExpanded] = useState(false);
  const [composeID, setComposeID] = useState(0);
  const [folder, setFolder] = useState<Folder>('inbox');
  const [mail, setMail] = useState<Record<Folder, MailSummary[]>>({ inbox: [], sent: [] });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [thread, setThread] = useState<MailDetail[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [filters, setFilters] = useState<MailFilter[]>([]);
  const [filterID, setFilterID] = useState('all');
  const [filterEditor, setFilterEditor] = useState<MailFilter | null | undefined>(undefined);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const epoch = useRef(0);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const selectedRef = useRef('');
  const paneRef = useRef(false);
  const closingHistory = useRef(false);
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);
  const active = useRef(true);
  const conversationLoader = useRef<(id: string, quiet?: boolean) => Promise<void>>(async () => {});
  const { theme, toggleTheme } = useTheme();
  const install = useInstall();
  const paneOpen = Boolean(selected || draft);
  paneRef.current = paneOpen;
  dirtyRef.current = draftHasContent(draft);

  /** Wipe all account-specific data immediately when authentication ends. */
  const clearSession = useCallback(() => {
    epoch.current++;
    listRequest.current++;
    detailRequest.current++;
    selectedRef.current = '';
    paneRef.current = false;
    dirtyRef.current = false;
    busyRef.current = false;
    setOrganizer(emptyOrganizer);
    setOrganizerReady(false);
    setOrganizerBusy(false);
    setView('conversations');
    setMailToken('');
    setSession(null);
    setExpanded(false);
    setMail({ inbox: [], sent: [] });
    setSelected('');
    setThread([]);
    setDraft(null);
    setError('');
    setDetailError('');
    setNotice('');
    setSearch('');
    setFolder('inbox');
    setLoading(false);
    setDetailLoading(false);
    setFilters([]);
    setFilterID('all');
    setFilterEditor(undefined);
    setPendingAction(null);
    if (history.state?.postharborMailPane) history.replaceState(null, '', location.pathname);
  }, []);
  const loadSession = useCallback(async () => {
    const current = epoch.current;
    setBootError('');
    try {
      const result = await mailAPI<MailSession>('/session');
      if (active.current && current === epoch.current) {
        setMailToken(result.csrf);
        setSession(result);
      }
    } catch (err) {
      if (
        active.current &&
        current === epoch.current &&
        !(err instanceof MailError && err.status === 401)
      )
        setBootError((err as Error).message);
    } finally {
      if (active.current && current === epoch.current) setBooting(false);
    }
  }, []);
  useEffect(() => {
    active.current = true;
    void loadSession();
    window.addEventListener('mail-session-expired', clearSession);
    return () => {
      active.current = false;
      epoch.current++;
      window.removeEventListener('mail-session-expired', clearSession);
    };
  }, [clearSession, loadSession]);

  /** A single guard covers compose, replies, folder changes, logout, and back. */
  function guard(action: () => void) {
    if (busyRef.current) {
      setNotice('Please wait for the current attachment or send operation.');
      return;
    }
    if (dirtyRef.current) setPendingAction(() => action);
    else action();
  }
  function enterPane() {
    if (!paneRef.current && !history.state?.postharborMailPane)
      history.pushState({ postharborMailPane: true }, '', '#conversation');
    paneRef.current = true;
  }
  function closePane() {
    setExpanded(false);
    paneRef.current = false;
    selectedRef.current = '';
    detailRequest.current++;
    dirtyRef.current = false;
    setSelected('');
    setThread([]);
    setDraft(null);
    setDetailError('');
    setDetailLoading(false);
    if (history.state?.postharborMailPane) {
      closingHistory.current = true;
      history.back();
    }
  }
  const closeRef = useRef(closePane);
  closeRef.current = closePane;
  const guardRef = useRef(guard);
  guardRef.current = guard;
  useEffect(() => {
    const back = () => {
      // A programmatic close may finish after a new pane opens; keep that pane.
      if (closingHistory.current) {
        closingHistory.current = false;
        if (paneRef.current) history.pushState({ postharborMailPane: true }, '', '#conversation');
        return;
      }
      if (!paneRef.current) return;
      if (dirtyRef.current || busyRef.current)
        history.pushState({ postharborMailPane: true }, '', '#conversation');
      guardRef.current(() => closeRef.current());
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || busyRef.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('popstate', back);
    window.addEventListener('beforeunload', unload);
    return () => {
      window.removeEventListener('popstate', back);
      window.removeEventListener('beforeunload', unload);
    };
  }, []);
  useEffect(() => {
    if (!paneOpen) return;
    document.body.classList.add('wm-pane-open');
    return () => document.body.classList.remove('wm-pane-open');
  }, [paneOpen]);

  /** Folder refreshes also update the open conversation, without replacing its draft. */
  const refresh = useCallback(
    async (quiet = false) => {
      if (!session) return;
      const current = ++listRequest.current;
      const owner = epoch.current;
      if (!quiet) setLoading(true);
      try {
        const [inbox, sent] = await Promise.all([
          mailAPI<{ messages: MailSummary[] }>('/messages?folder=inbox'),
          mailAPI<{ messages: MailSummary[] }>('/messages?folder=sent'),
        ]);
        if (!active.current || current !== listRequest.current || owner !== epoch.current) return;
        setMail({ inbox: inbox.messages, sent: sent.messages });
        setError('');
        if (selectedRef.current) void conversationLoader.current(selectedRef.current, true);
      } catch (err) {
        if (active.current && current === listRequest.current && owner === epoch.current)
          setError((err as Error).message);
      } finally {
        if (active.current && current === listRequest.current && owner === epoch.current)
          setLoading(false);
      }
    },
    [session],
  );
  useEffect(() => {
    if (!session) return;
    const owner = epoch.current;
    void refresh();
    void mailAPI<Organizer>('/organizer')
      .then((result) => {
        if (active.current && owner === epoch.current) {
          setOrganizer(result);
          setOrganizerReady(true);
        }
      })
      .catch((err) => {
        if (active.current && owner === epoch.current) setError(err.message);
      });
    void mailAPI<{ filters: MailFilter[] }>('/filters')
      .then((result) => {
        if (active.current && owner === epoch.current) setFilters(result.filters);
      })
      .catch((err) => {
        if (active.current && owner === epoch.current) setError((err as Error).message);
      });
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh(true);
    }, 15000);
    return () => {
      window.clearInterval(timer);
      listRequest.current++;
    };
  }, [refresh, session]);

  /** Conversation membership comes from the server's real email reply headers. */
  async function loadConversation(id: string, quiet = false) {
    const request = ++detailRequest.current;
    const owner = epoch.current;
    if (!quiet) {
      setThread([]);
      setDetailLoading(true);
    }
    try {
      const result = await mailAPI<{ messages: MailDetail[]; truncated?: boolean }>(
        `/messages/${encodeURIComponent(id)}/conversation`,
      );
      if (
        !active.current ||
        request !== detailRequest.current ||
        owner !== epoch.current ||
        selectedRef.current !== id
      )
        return;
      setThread(result.messages);
      setTruncated(Boolean(result.truncated));
      setDetailLoading(false);
      setDetailError('');
      const unread = result.messages.filter((item) => !item.read);
      // Sequential reads avoid a burst of up to 50 concurrent API/database calls.
      for (const message of unread) {
        if (!active.current || owner !== epoch.current || selectedRef.current !== id) return;
        await mailAPI(`/messages/${encodeURIComponent(message.id)}/read`, 'POST');
      }
      if (!active.current || owner !== epoch.current) return;
      const ids = new Set(unread.map((item) => item.id));
      setMail((previous) => ({
        inbox: previous.inbox.map((item) => (ids.has(item.id) ? { ...item, read: true } : item)),
        sent: previous.sent.map((item) => (ids.has(item.id) ? { ...item, read: true } : item)),
      }));
    } catch (err) {
      if (active.current && request === detailRequest.current && owner === epoch.current)
        setDetailError((err as Error).message);
    } finally {
      if (active.current && request === detailRequest.current && owner === epoch.current)
        setDetailLoading(false);
    }
  }
  conversationLoader.current = loadConversation;
  function openMessage(id: string) {
    guard(() => {
      enterPane();
      setDraft(null);
      selectedRef.current = id;
      setSelected(id);
      setDetailError('');
      void loadConversation(id);
    });
  }
  function compose(to = '') {
    guard(() => {
      setComposeID((id) => id + 1);
      enterPane();
      selectedRef.current = '';
      detailRequest.current++;
      setSelected('');
      setThread([]);
      setDetailError('');
      setDetailLoading(false);
      setDraft({ to, subject: '', text: '', attachments: [] });
    });
  }
  function changeFolder(next: Folder) {
    guard(() => {
      closePane();
      setView('mail');
      setFolder(next);
      setSearch('');
    });
  }
  function reply(message: MailDetail) {
    if (!session) return;
    guard(() => {
      setComposeID((id) => id + 1);
      setDraft({
        to:
          message.from.address.toLowerCase() === session.user.address.toLowerCase()
            ? message.to.map((to) => to.address).join(', ')
            : message.from.address,
        subject: /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`,
        text: '',
        reply_to: message.id,
        attachments: [],
      });
    });
  }
  /** Forward a visible email into an editable draft; attachments are explicitly reselected. */
  function forward(message: MailDetail) {
    guard(() => {
      setComposeID((id) => id + 1);
      setDraft({
        to: '',
        subject: /^fwd:/i.test(message.subject) ? message.subject : `Fwd: ${message.subject}`,
        text: `Forwarded email from ${message.from.address}\nSubject: ${message.subject}\n\n${message.text}`,
        html: message.html
          ? `<p>Forwarded email</p><blockquote>${message.html}</blockquote>`
          : undefined,
        attachments: [],
      });
      setNotice('Forward draft ready. Add any attachments you want to include.');
    });
  }
  async function logout() {
    setLoggingOut(true);
    try {
      await mailAPI('/logout', 'POST');
      clearSession();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoggingOut(false);
    }
  }
  const composeEpoch = epoch.current;
  function sent(id?: string) {
    if (composeEpoch !== epoch.current) return;
    const isReply = Boolean(draft?.reply_to);
    setView((previous) => (previous === 'conversations' ? 'conversations' : 'mail'));
    setDraft(null);
    dirtyRef.current = false;
    busyRef.current = false;
    setNotice(
      session?.mode === 'simulation'
        ? 'Message sent to the local sandbox.'
        : 'Message accepted for delivery.',
    );
    if (isReply && selectedRef.current) void loadConversation(selectedRef.current, true);
    else if (id) {
      selectedRef.current = id;
      setSelected(id);
      setFolder('sent');
      setSearch('');
      setFilterID('all');
      void loadConversation(id);
    } else {
      closePane();
      setFolder('sent');
      setSearch('');
      setFilterID('all');
    }
    void refresh(true);
  }
  async function saveOrganizer(next: Organizer) {
    if (organizerBusy || !organizerReady) return false;
    const owner = epoch.current;
    setOrganizerBusy(true);
    try {
      const result = await mailAPI<Organizer>('/organizer', 'PUT', next);
      if (owner === epoch.current) setOrganizer(result);
      return true;
    } catch (err) {
      if (owner === epoch.current) setError((err as Error).message);
      return false;
    } finally {
      if (owner === epoch.current) setOrganizerBusy(false);
    }
  }
  function flag(id: string, key: 'starred' | 'archived') {
    void saveOrganizer({
      ...organizer,
      flags: {
        ...organizer.flags,
        [id]: { ...organizer.flags[id], [key]: !organizer.flags[id]?.[key] },
      },
    });
  }
  const allMail = [...new Map([...mail.inbox, ...mail.sent].map((m) => [m.id, m])).values()].sort(
    (a, b) => Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id),
  );
  const viewMail =
    view === 'conversations'
      ? allMail.filter((m) => !organizer.flags[m.id]?.archived)
      : view === 'starred'
        ? allMail.filter((m) => organizer.flags[m.id]?.starred)
        : view === 'archive'
          ? allMail.filter((m) => organizer.flags[m.id]?.archived)
          : mail[folder].filter((m) => folder === 'sent' || !organizer.flags[m.id]?.archived);
  const selectedFilter = [...builtinFilters, ...filters].find((item) => item.id === filterID);
  const visible = viewMail.filter(
    (item) =>
      matchesFilter(item, selectedFilter) &&
      `${item.subject} ${item.from.name} ${item.from.address} ${item.to.map((to) => to.address).join(' ')} ${item.snippet}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const unread = mail.inbox.filter((item) => !item.read).length;
  const owner = epoch.current;
  const latest = expanded
    ? thread.find((message) => message.id === selected)
    : thread[thread.length - 1];
  const title =
    draft && !draft.reply_to ? 'New conversation' : thread[0]?.subject || 'Conversation';

  return (
    <div
      className={`wm-app ${session ? 'wm-authenticated' : 'wm-logged-out'} ${paneOpen ? 'wm-focus-mode' : ''} ${expanded && paneOpen ? 'wm-expanded' : ''}`}
    >
      {!session && (
        <header className="wm-topbar">
          <a
            href="/mail"
            className="wm-brand-link"
            aria-label="Postharbor Mail home"
            onClick={(event) => {
              if (paneOpen) {
                event.preventDefault();
                guard(closePane);
              }
            }}
          >
            <Brand />
            <span className="wm-brand-label">MAIL</span>
          </a>
          <div className="wm-top-actions">
            <span className="wm-sandbox">
              Your email <span>· Sign in to your mailbox</span>
            </span>
            <button
              className="icon-button"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              onClick={toggleTheme}
            >
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
        </header>
      )}
      {booting ? (
        <main className="wm-startup" role="status">
          <LoaderCircle className="spin" size={30} />
          <p>Opening your mailbox…</p>
        </main>
      ) : bootError ? (
        <main className="wm-startup">
          <p role="alert">{bootError}</p>
          <button className="button primary" onClick={() => void loadSession()}>
            Try again
          </button>
          <a href="/">Administrator dashboard</a>
        </main>
      ) : !session ? (
        <MailSignIn onLogin={loadSession} />
      ) : (
        <main className="wm-workspace">
          <aside className="wm-sidebar">
            <a
              href="/mail"
              className="wm-brand-link wm-sidebar-brand"
              aria-label="Postharbor Mail home"
              onClick={(event) => {
                event.preventDefault();
                guard(closePane);
              }}
            >
              <Brand />
              <span className="wm-brand-label">MAIL</span>
            </a>
            <div className="wm-workspace-title">
              <span className="wm-kicker">YOUR PERSONAL SPACE</span>
              <span className="wm-sandbox">
                {session?.mode === 'simulation' ? (
                  <>
                    Local mail sandbox <span>· .test addresses only</span>
                  </>
                ) : (
                  <>
                    Your email <span>· Secure mailbox</span>
                  </>
                )}
              </span>
              <h2>Mail, made simple.</h2>
            </div>
            <button className="wm-compose-button" onClick={() => compose()}>
              <PenLine size={20} />
              Compose
            </button>
            <nav aria-label="Mail folders">
              <button
                className={view === 'conversations' ? 'active' : ''}
                aria-current={view === 'conversations' ? 'page' : undefined}
                onClick={() =>
                  guard(() => {
                    closePane();
                    setView('conversations');
                    setSearch('');
                    setFilterID('all');
                  })
                }
              >
                <MessageCircle size={19} />
                <span>Conversations</span>
              </button>
              {(
                [
                  { key: 'inbox', label: 'Inbox', icon: Inbox },
                  { key: 'sent', label: 'Sent', icon: Send },
                ] as const
              ).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  className={view === 'mail' && folder === key ? 'active' : ''}
                  aria-current={view === 'mail' && folder === key ? 'page' : undefined}
                  onClick={() => changeFolder(key)}
                >
                  <Icon size={19} />
                  <span>{label}</span>
                  <span className="wm-folder-count">
                    {key === 'inbox' ? unread : mail.sent.length}
                  </span>
                </button>
              ))}
              {(
                [
                  { key: 'starred', label: 'Starred', icon: Star },
                  { key: 'archive', label: 'Archive', icon: Archive },
                  { key: 'contacts', label: 'Contacts', icon: Users },
                ] as const
              ).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  className={view === key ? 'active' : ''}
                  onClick={() =>
                    guard(() => {
                      closePane();
                      setView(key);
                      setSearch('');
                    })
                  }
                >
                  <Icon size={19} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
            <div className="wm-sidebar-note">
              <span className="wm-note-symbol">
                <MessageCircle size={24} />
              </span>
              <strong>Conversations, connected.</strong>
              <p>
                The familiarity of chat.
                <br />
                The freedom of email.
              </p>
            </div>
            <div className="wm-sidebar-footer">
              <div className="wm-sidebar-utilities">
                <button
                  className="wm-install wm-theme-switch"
                  aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                  onClick={toggleTheme}
                >
                  {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                  <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
                </button>
                {!install.installed && (
                  <button className="wm-install" onClick={() => void install.install()}>
                    <Download size={17} />
                    Install mail app
                  </button>
                )}
              </div>
              <a
                href="/"
                className="wm-admin-link"
                onClick={(event) => {
                  event.preventDefault();
                  guard(() => location.assign('/'));
                }}
              >
                Administrator dashboard
              </a>
              <div className="wm-profile">
                <span className="wm-avatar">
                  {initials(session.user.name || session.user.address)}
                </span>
                <div>
                  <strong>{session.user.name || session.user.address.split('@')[0]}</strong>
                  <span title={session.user.address}>{session.user.address}</span>
                </div>
                <button
                  className="icon-button"
                  aria-label="Sign out of mailbox"
                  disabled={loggingOut}
                  onClick={() => guard(() => void logout())}
                >
                  <LogOut size={17} />
                </button>
              </div>
            </div>
          </aside>
          {view === 'contacts' && !paneOpen ? (
            <section className="wm-mail-surface glass wm-contacts-surface">
              {error && (
                <p role="alert" className="wm-alert">
                  {error}
                </p>
              )}
              <Contacts
                data={organizer}
                save={saveOrganizer}
                compose={compose}
                busy={organizerBusy || !organizerReady}
              />
            </section>
          ) : (
            <section className={`wm-mail-surface glass ${paneOpen ? 'wm-has-selection' : ''}`}>
              <div className="wm-list">
                <div className="wm-list-heading">
                  <div>
                    <span className="wm-kicker">
                      {folder === 'inbox'
                        ? 'GOOD CONVERSATIONS START HERE'
                        : 'YOUR MESSAGES, DELIVERED'}
                    </span>
                    <h1>
                      {view === 'conversations'
                        ? 'Conversations'
                        : view === 'starred'
                          ? 'Starred'
                          : view === 'archive'
                            ? 'Archive'
                            : folder === 'inbox'
                              ? 'Your inbox'
                              : 'Sent mail'}
                      <span>{viewMail.length}</span>
                    </h1>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Refresh messages"
                    disabled={loading}
                    onClick={() => void refresh()}
                  >
                    <RefreshCw size={18} className={loading ? 'spin' : ''} />
                  </button>
                </div>
                <label className="wm-search">
                  <Search size={18} />
                  <input
                    aria-label="Search mail"
                    placeholder="Search mail"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  {search && (
                    <button
                      aria-label="Clear search"
                      className="icon-button"
                      onClick={() => setSearch('')}
                    >
                      <X size={15} />
                    </button>
                  )}
                </label>
                <FilterChips
                  filters={filters}
                  selected={filterID}
                  onSelect={setFilterID}
                  onEdit={setFilterEditor}
                />
                <div className="wm-list-label">
                  <span>
                    {search || filterID !== 'all'
                      ? `${visible.length} matching messages`
                      : folder === 'inbox'
                        ? `${unread} unread · All messages`
                        : 'Your sent conversations'}
                  </span>
                  <span>Newest first</span>
                </div>
                {error && (
                  <p className="wm-alert" role="alert">
                    {error}
                  </p>
                )}
                {notice && (
                  <p className="wm-notice" role="status">
                    <Check size={16} />
                    {notice}
                    <button
                      className="icon-button"
                      aria-label="Dismiss notification"
                      onClick={() => setNotice('')}
                    >
                      <X size={15} />
                    </button>
                  </p>
                )}
                <div
                  className="wm-message-list"
                  aria-label={`${folder === 'inbox' ? 'Inbox' : 'Sent'} messages`}
                >
                  {loading && mail[folder].length === 0 ? (
                    <div className="wm-list-empty" role="status">
                      <LoaderCircle className="spin" size={24} />
                      <p>Gathering your messages…</p>
                    </div>
                  ) : !visible.length ? (
                    <div className="wm-list-empty">
                      <Inbox size={32} strokeWidth={1.3} />
                      <h2>
                        {search || filterID !== 'all'
                          ? 'No matching messages'
                          : folder === 'sent'
                            ? 'Your first hello awaits.'
                            : 'A little peace and quiet.'}
                      </h2>
                      <p>
                        {search || filterID !== 'all'
                          ? 'Try another search or filter.'
                          : 'New conversations will appear here.'}
                      </p>
                      <button className="text-button" onClick={() => compose()}>
                        Write a message
                      </button>
                    </div>
                  ) : (
                    visible.map((item) => (
                      <button
                        key={item.id}
                        className={`wm-message-row ${selected === item.id ? 'selected' : ''} ${!item.read && item.from.address.toLowerCase() !== session.user.address.toLowerCase() ? 'unread' : ''}`}
                        aria-pressed={selected === item.id}
                        onClick={() => openMessage(item.id)}
                      >
                        <span className="wm-row-avatar">
                          {initials(
                            item.from.address.toLowerCase() === session.user.address.toLowerCase()
                              ? item.to[0]?.name || item.to[0]?.address || '?'
                              : item.from.name || item.from.address,
                          )}
                        </span>
                        <span className="wm-row-content">
                          <span className="wm-row-heading">
                            <strong>
                              {item.from.address.toLowerCase() ===
                              session.user.address.toLowerCase()
                                ? `To: ${item.to.map((to) => to.name || to.address).join(', ')}`
                                : item.from.name || item.from.address}
                            </strong>
                            <time dateTime={item.date}>{messageDate(item.date)}</time>
                          </span>
                          <span className="wm-row-subject">
                            {organizer.flags[item.id]?.starred && '★ '}
                            {item.subject || '(No subject)'}
                          </span>
                          <span className="wm-row-preview">
                            {item.snippet || 'Open this conversation'}
                            {item.attachments > 0 && (
                              <Paperclip size={14} aria-label="Has attachments" />
                            )}
                          </span>
                        </span>
                        {!item.read &&
                          item.from.address.toLowerCase() !==
                            session.user.address.toLowerCase() && (
                            <span className="wm-unread-dot" aria-label="Unread" />
                          )}
                      </button>
                    ))
                  )}
                </div>
                <div className="wm-list-footnote">Email that feels like a conversation.</div>
              </div>
              <section
                className={`wm-reader wm-conversation-pane ${!paneOpen ? 'wm-reader-empty' : ''}`}
                aria-label="Conversation workspace"
              >
                {!paneOpen ? (
                  <>
                    <div className="wm-empty-orbit">
                      <MessageCircle size={40} strokeWidth={1.3} />
                    </div>
                    <span className="wm-kicker">A LITTLE SPACE TO CONNECT</span>
                    <h2>
                      Your next conversation
                      <br />
                      starts here.
                    </h2>
                    <p>Open an email or compose something new.</p>
                    <button className="button secondary" onClick={() => compose()}>
                      <PenLine size={18} />
                      Start a conversation
                    </button>
                  </>
                ) : (
                  <>
                    <header className="wm-chat-header">
                      <button
                        className="icon-button"
                        aria-label="Back to messages"
                        onClick={() => guard(closePane)}
                      >
                        <ArrowLeft size={20} />
                      </button>
                      <div>
                        <span className="wm-kicker">
                          {draft && !draft.reply_to ? 'WRITE AN EMAIL' : 'EMAIL CONVERSATION'}
                        </span>
                        <h1>{title}</h1>
                      </div>
                      {selected && (
                        <div className="wm-message-actions">
                          <button
                            className="icon-button"
                            disabled={organizerBusy || !organizerReady}
                            aria-label={
                              organizer.flags[selected]?.starred ? 'Unstar email' : 'Star email'
                            }
                            onClick={() => flag(selected, 'starred')}
                          >
                            <Star
                              size={20}
                              fill={organizer.flags[selected]?.starred ? 'currentColor' : 'none'}
                            />
                          </button>
                          <button
                            className="text-button"
                            disabled={organizerBusy || !organizerReady}
                            onClick={() => flag(selected, 'archived')}
                          >
                            {organizer.flags[selected]?.archived ? 'Unarchive' : 'Archive'}
                          </button>
                          <button
                            className="icon-button"
                            aria-label={expanded ? 'Collapse email' : 'Expand email'}
                            title={expanded ? 'Collapse email' : 'Expand email'}
                            onClick={() => setExpanded(!expanded)}
                          >
                            {expanded ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
                          </button>
                        </div>
                      )}
                      <span className="wm-chat-header-mark">
                        <Mail size={20} />
                      </span>
                    </header>
                    <div className="wm-pane-scroll">
                      {detailLoading ? (
                        <div className="wm-reader-status" role="status">
                          <LoaderCircle className="spin" size={24} />
                          <p>Opening your conversation…</p>
                        </div>
                      ) : (
                        <>
                          {detailError && (
                            <div className="wm-alert" role="alert">
                              {detailError}
                              <button
                                className="text-button"
                                onClick={() => void loadConversation(selected, true)}
                              >
                                Try again
                              </button>
                            </div>
                          )}
                          {thread.length > 0 && (
                            <Conversation
                              messages={
                                expanded
                                  ? thread.filter((message) => message.id === selected)
                                  : thread
                              }
                              address={session.user.address}
                              truncated={truncated}
                              onReply={reply}
                              onForward={forward}
                              composing={Boolean(draft)}
                            />
                          )}
                          {draft && (
                            <Compose
                              key={`${composeID}:${draft.reply_to || 'new'}`}
                              draft={draft}
                              organizer={organizer}
                              sender={session.user.address}
                              simulation={session.mode === 'simulation'}
                              onChange={setDraft}
                              onClose={() =>
                                guard(() => {
                                  if (selectedRef.current) setDraft(null);
                                  else closePane();
                                })
                              }
                              onSent={sent}
                              onBusyChange={(value) => {
                                busyRef.current = value;
                              }}
                            />
                          )}
                        </>
                      )}
                    </div>
                    {!draft && latest && (
                      <div className="wm-quick-reply">
                        <button onClick={() => reply(latest)}>
                          <MessageCircle size={20} />
                          <span>Write a reply…</span>
                          <Paperclip size={18} />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </section>
            </section>
          )}
          {filterEditor !== undefined && (
            <FilterEditor
              initial={filterEditor}
              onClose={() => setFilterEditor(undefined)}
              onSaved={(filter) => {
                if (owner !== epoch.current) return;
                setFilters((previous) => [
                  ...previous.filter((item) => item.id !== filter.id),
                  filter,
                ]);
                setFilterID(filter.id);
                setFilterEditor(undefined);
              }}
              onDeleted={(id) => {
                if (owner !== epoch.current) return;
                setFilters((previous) => previous.filter((item) => item.id !== id));
                if (filterID === id) setFilterID('all');
                setFilterEditor(undefined);
              }}
            />
          )}
          {pendingAction && (
            <Modal title="Keep your draft?" onClose={() => setPendingAction(null)}>
              <p>Discard this draft? It hasn’t been sent.</p>
              <div className="wm-discard-actions">
                <button className="button secondary" onClick={() => setPendingAction(null)}>
                  Keep writing
                </button>
                <button
                  className="button danger"
                  onClick={() => {
                    const action = pendingAction;
                    setPendingAction(null);
                    setDraft(null);
                    dirtyRef.current = false;
                    action();
                  }}
                >
                  Discard draft
                </button>
              </div>
            </Modal>
          )}
        </main>
      )}
      {install.help && (
        <Modal title="Your mail, one tap away" onClose={() => install.setHelp(false)}>
          <p>
            {install.ios
              ? 'Open this page in Safari. Tap Share, then Add to Home Screen.'
              : 'Use your browser’s Install app option. If it is unavailable, bookmark this page to return to your mail.'}
          </p>
          <p className="muted">Messages and drafts are available while you are online.</p>
        </Modal>
      )}
    </div>
  );
}
