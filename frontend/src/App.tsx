import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  ArrowUpRight,
  ChevronDown,
  Download,
  Globe2,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  Settings2,
  Sun,
  X,
} from 'lucide-react';
import { api, ApiError, setCSRF } from './lib/api';
import type { AuditEvent, Domain, Mailbox, Page, Session, Tenant } from './lib/types';
import { useInstall } from './hooks/useInstall';
import { useTheme } from './hooks/useTheme';
import { Brand, Empty, Modal } from './components/ui';
import { ResourceDialogs, type ActionDialog } from './components/ResourceDialogs';
import { Login } from './pages/Login';
import { ProfilePhoto } from './components/ProfilePhoto';
import { Documentation } from './documentation/Documentation';
import { Workspace } from './pages/Workspace';

const navigation: { id: Page; label: string; icon: typeof Mail }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'domains', label: 'Domains', icon: Globe2 },
  { id: 'mailboxes', label: 'Mailboxes', icon: Mail },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings2 },
  { id: 'documentation', label: 'Documentation', icon: BookOpen },
];

/** pageFromHash preserves browser Back/Forward without needing a routing dependency. */
function pageFromHash(): Page {
  const value = location.hash.slice(1);
  return navigation.some((item) => item.id === value) ? (value as Page) : 'overview';
}

/** App owns authentication and the selected business. All resource views receive
 * scoped data; switching businesses clears old data before fetching new results. */
export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState('');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [domains, setDomains] = useState<Domain[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState<Page>(pageFromHash);
  const [search, setSearch] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [action, setAction] = useState<ActionDialog | null>(null);
  const generation = useRef(0);
  const sessionEpoch = useRef(0);
  const selectedTenant = useRef(tenantId);
  selectedTenant.current = tenantId;
  const { theme, toggleTheme } = useTheme();
  const install = useInstall();
  const tenant = tenants.find((t) => t.id === tenantId);

  /** clearSession erases in-memory private data on logout or session expiry. */
  const clearSession = useCallback(() => {
    generation.current++;
    sessionEpoch.current++;
    selectedTenant.current = '';
    setSession(null);
    setCSRF('');
    setTenants([]);
    setTenantId('');
    setDomains([]);
    setMailboxes([]);
    setEvents([]);
    setAction(null);
    setError('');
    setNotice('');
  }, []);

  /** loadSession distinguishes unauthenticated users from a server outage. */
  const loadSession = useCallback(async () => {
    setBootError('');
    try {
      const data = await api<Session>('/session');
      setCSRF(data.csrf);
      setSession(data);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401))
        setBootError(err instanceof Error ? err.message : 'Could not load your session');
    } finally {
      setBooting(false);
    }
  }, []);
  useEffect(() => {
    void loadSession();
    window.addEventListener('session-expired', clearSession);
    return () => window.removeEventListener('session-expired', clearSession);
  }, [loadSession, clearSession]);
  useEffect(() => {
    const change = () => {
      setPage(pageFromHash());
      setSearch('');
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);

  /** loadTenants refreshes the selector after creation or a provisioning retry. */
  const loadTenants = useCallback(async () => {
    const epoch = sessionEpoch.current;
    const rows = await api<Tenant[]>('/tenants');
    if (epoch !== sessionEpoch.current) return;
    setTenants(rows);
    setTenantId((previous) =>
      rows.some((row) => row.id === previous) ? previous : (rows[0]?.id ?? ''),
    );
  }, []);
  useEffect(() => {
    if (session) void loadTenants().catch((err) => setError(err.message));
  }, [session, loadTenants]);

  /** loadResources discards stale responses from a previous workspace selection. */
  const loadResources = useCallback(async () => {
    // An old modal may finish after the user closes it and changes businesses.
    // Never let that old refresh overwrite the newly selected workspace.
    if (selectedTenant.current !== tenantId) return;
    const current = ++generation.current;
    if (!tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const base = `/tenants/${tenantId}`;
      const [d, m, a] = await Promise.all([
        api<Domain[]>(`${base}/domains`),
        api<Mailbox[]>(`${base}/mailboxes`),
        api<AuditEvent[]>(`${base}/audit`),
      ]);
      if (generation.current === current && selectedTenant.current === tenantId) {
        setDomains(d);
        setMailboxes(m);
        setEvents(a);
      }
    } catch (err) {
      if (generation.current === current)
        setError(err instanceof Error ? err.message : 'Could not load workspace');
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [tenantId]);
  useEffect(() => {
    setDomains([]);
    setMailboxes([]);
    setEvents([]);
    setAction(null);
    setNotice('');
    void loadResources();
    return () => {
      generation.current++;
    };
  }, [loadResources]);

  /** navigate updates both the address and mobile navigation state. */
  function navigate(next: Page) {
    location.hash = next;
    setPage(next);
    setSearch('');
    setNavOpen(false);
  }

  /** mutate refreshes even on provider failure because a pending record may exist. */
  async function mutate(path: string, method: string, body?: unknown) {
    try {
      await api(path, method, body);
      setNotice('Changes saved.');
    } finally {
      await loadTenants();
      await loadResources();
    }
  }

  /** logout only clears the view after the server has invalidated the session. */
  async function logout() {
    try {
      await api('/logout', 'POST');
      clearSession();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (booting)
    return (
      <main className="startup">
        <Brand />
        <p>Opening your workspace…</p>
      </main>
    );
  if (bootError)
    return (
      <main className="startup">
        <Brand />
        <p role="alert">{bootError}</p>
        <button className="button primary" onClick={() => void loadSession()}>
          Try again
        </button>
      </main>
    );
  if (!session)
    return (
      <>
        <Login onLogin={loadSession} />
        <div className="login-footer">
          <a className="text-button" href="/docs">
            <BookOpen size={17} /> Domain setup guide
          </a>
          <button className="text-button" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}{' '}
            {theme === 'dark' ? 'Light' : 'Dark'} mode
          </button>
          {!install.installed && (
            <button className="text-button" onClick={() => void install.install()}>
              <Download size={17} />
              Install app
            </button>
          )}
        </div>
        {install.help && <InstallHelp ios={install.ios} close={() => install.setHelp(false)} />}
      </>
    );
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>
      {navOpen && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}
      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button mobile-only"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace-select">
          <label htmlFor="business">WORKSPACE</label>
          <div>
            <span className="workspace-avatar">{tenant?.name.slice(0, 1) || 'P'}</span>
            <select
              id="business"
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
              aria-label="Select business"
            >
              {!tenants.length && <option value="">No businesses yet</option>}
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </div>
        </div>
        <span className="nav-label">MANAGE</span>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'selected' : ''}`}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.id === 'mailboxes' && <span className="nav-count">{mailboxes.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {session.mode === 'simulation' && (
            <a className="text-button" href="/mail">
              <Mail size={17} />
              Open mailbox
            </a>
          )}
          {session.user.role === 'platform_admin' && (
            <button
              className="new-business"
              onClick={() => {
                setAction({ kind: 'business' });
                setNavOpen(false);
              }}
            >
              <Plus size={17} />
              New business
            </button>
          )}
          <div className="sidebar-tip">
            <span className="tip-symbol">
              <Globe2 size={20} />
            </span>
            <strong>A little more independence.</strong>
            <p>
              Your email infrastructure.
              <br />
              Your own corner of the internet.
            </p>
          </div>
          <div className="profile">
            <span className="avatar">
              <ProfilePhoto value={session.user.avatar} name={session.user.name} />
            </span>
            <div>
              <strong>{session.user.name}</strong>
              <small>
                {session.user.role === 'platform_admin'
                  ? 'Platform owner'
                  : 'Business administrator'}
              </small>
            </div>
            <button className="icon-button" aria-label="Sign out" onClick={() => void logout()}>
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-only"
              aria-label="Open navigation"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(true)}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <span className="crumb-divider">/</span>
            <strong>{navigation.find((item) => item.id === page)?.label}</strong>
          </div>
          <div className="top-actions">
            <span className={`mode-chip ${session.mode === 'simulation' ? 'simulated' : ''}`}>
              {session.mode === 'simulation' ? 'Simulation mode' : 'Stalwart mode'}
            </span>
            <button
              className="icon-button"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              onClick={toggleTheme}
            >
              {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
            </button>
          </div>
        </header>
        <main id="main" className="main-content" tabIndex={-1}>
          <div className="page-title">
            <div>
              <p className="eyebrow">{tenant?.name || 'LET’S GET STARTED'}</p>
              <h1>
                {page === 'overview'
                  ? 'A little overview.'
                  : navigation.find((item) => item.id === page)?.label}
              </h1>
              <p>
                {page === 'overview'
                  ? 'Everything you need. A little less to think about.'
                  : 'Your workspace, thoughtfully organized.'}
              </p>
            </div>
            <button
              className="button subtle"
              disabled={loading}
              onClick={() => {
                void loadTenants().catch((err) => setError(err.message));
                void loadResources();
              }}
              aria-label="Refresh workspace"
            >
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>
          {error && (
            <div role="alert" className="error-message">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="toast">
              {notice}
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setNotice('')}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {tenant?.status === 'pending' && (
            <div className="notice">
              This business is saved, but mail provisioning is pending.{' '}
              <button
                className="text-button"
                onClick={() =>
                  void mutate(`/tenants/${tenantId}/provision`, 'POST').catch((err) =>
                    setError(err.message),
                  )
                }
              >
                Retry provisioning
              </button>
            </div>
          )}
          {page === 'documentation' ? (
            <Documentation
              key={tenantId}
              session={session}
              tenant={tenant}
              domains={domains}
              open={setAction}
              navigate={navigate}
            />
          ) : !tenant ? (
            <section className="glass panel">
              <Empty
                title="Every business needs a home"
                action={
                  session.user.role === 'platform_admin' && (
                    <button
                      className="button primary"
                      onClick={() => setAction({ kind: 'business' })}
                    >
                      <Plus size={17} />
                      Create your first business
                    </button>
                  )
                }
              >
                Create a workspace, connect a domain, and welcome your first mailbox.
              </Empty>
            </section>
          ) : loading ? (
            <div className="glass loading-panel" role="status">
              <RefreshCw className="spin" size={22} />
              Loading your workspace…
            </div>
          ) : (
            <Workspace
              page={page}
              tenant={tenant}
              domains={domains}
              mailboxes={mailboxes}
              events={events}
              session={session}
              onProfileChanged={(avatar) =>
                setSession((current) =>
                  current?.user.id === session.user.id
                    ? { ...current, user: { ...current.user, avatar } }
                    : current,
                )
              }
              search={search}
              setSearch={setSearch}
              open={setAction}
              navigate={navigate}
              onPasswordChanged={clearSession}
            />
          )}
        </main>
        <footer className="app-footer">
          <span>
            Postharbor <span className="footer-dot">·</span> Email, in your hands.
          </span>
          <div>
            {session.webmail_url && (
              <a href={session.webmail_url} target="_blank" rel="noreferrer">
                Open webmail <ArrowUpRight size={14} />
              </a>
            )}
            {!install.installed && (
              <button className="text-button" onClick={() => void install.install()}>
                <Download size={16} />
                Install app
              </button>
            )}
            {install.installed && <span>App installed</span>}
          </div>
        </footer>
      </div>
      {action && (
        <ResourceDialogs
          action={action}
          tenant={tenant}
          domains={domains}
          session={session}
          close={() => setAction(null)}
          mutate={mutate}
        />
      )}
      {install.help && <InstallHelp ios={install.ios} close={() => install.setHelp(false)} />}
    </div>
  );
}

/** InstallHelp explains browser-specific installation when no native prompt exists. */
function InstallHelp({ ios, close }: { ios: boolean; close: () => void }) {
  return (
    <Modal
      title="A home on your home screen"
      subtitle="Install Postharbor without an app store."
      onClose={close}
    >
      <div className="install-instructions">
        <Download size={36} />
        <p>
          {ios
            ? 'On iPhone or iPad, open this site in Safari, tap Share, then Add to Home Screen. Confirm Add.'
            : 'Open your browser menu and choose Install app or Add to Home screen. If your browser supports a direct install prompt, the Install button will open it when available.'}
        </p>
        <p className="notice">
          Installation requires HTTPS (or localhost for testing) and a supported browser. This app
          needs a connection for account management; it does not store your private workspace
          offline.
        </p>
        <button className="button primary" onClick={close}>
          Got it
        </button>
      </div>
    </Modal>
  );
}
