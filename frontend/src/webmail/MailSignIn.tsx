import { useState, type FormEvent } from 'react';
import { Check, Inbox, LoaderCircle, Mail } from 'lucide-react';
import { mailAPI } from './api';

/** MailSignIn keeps mailbox credentials separate from platform/business admin logins. */
export function MailSignIn({ onLogin }: { onLogin: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await mailAPI('/login', 'POST', { email: data.get('email'), password: data.get('password') });
      await onLogin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="wm-signin glass">
      <section className="wm-welcome">
        <span className="wm-kicker">YOUR OWN LITTLE CORNER</span>
        <h1>
          Good conversations.
          <br />
          <em>A calmer inbox.</em>
        </h1>
        <p>
          A familiar place to read, reply, and stay in touch. A little less clutter. A little more
          clarity.
        </p>
        <div className="wm-letter-art" aria-hidden="true">
          <div className="wm-art-note">
            <span className="wm-art-avatar">H</span>
            <div>
              <strong>Hello, you.</strong>
              <span>Let’s start a conversation.</span>
            </div>
            <Check size={18} />
          </div>
          <div className="wm-art-envelope">
            <Mail size={92} strokeWidth={1} />
          </div>
          <span className="wm-art-tag">Made for the everyday.</span>
        </div>
      </section>
      <section className="wm-signin-form">
        <span className="wm-login-symbol">
          <Inbox size={26} />
        </span>
        <h2>Welcome to your mail.</h2>
        <p>Sign in with your mailbox account.</p>
        <form onSubmit={(event) => void submit(event)}>
          <fieldset disabled={busy}>
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="username"
                placeholder="alex@harbor.test"
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Your mailbox password"
                required
              />
            </label>
          </fieldset>
          {error && (
            <p className="wm-alert" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy && <LoaderCircle className="spin" size={18} />}
            {busy ? 'Opening your inbox…' : 'Open my inbox'}
          </button>
        </form>
        <p className="wm-signin-note">
          Use your mailbox password, rather than your administrator login.
        </p>
        <a className="wm-admin-link" href="/">
          Administrator dashboard
        </a>
      </section>
    </main>
  );
}
