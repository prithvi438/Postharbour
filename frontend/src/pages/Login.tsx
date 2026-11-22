import { ArrowUpRight, Globe2, ShieldCheck, Smartphone } from 'lucide-react';
import { api, setCSRF } from '../lib/api';
import { AsyncForm, Brand, Field } from '../components/ui';

/** Login authenticates dashboard administrators. Mailbox credentials are separate. */
export function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  return (
    <main className="login-layout">
      <section className="login-story">
        <Brand />
        <div>
          <span className="eyebrow">YOUR DOMAIN. YOUR PEOPLE. YOUR EMAIL.</span>
          <h1>
            A calmer home
            <br />
            for your email<span>.</span>
          </h1>
          <p>
            Bring your businesses, domains, and mailboxes together. Keep the control in your hands.
          </p>
          <div className="login-features">
            <span>
              <Globe2 size={18} /> Multiple domains
            </span>
            <span>
              <ShieldCheck size={18} /> Separate workspaces
            </span>
            <span>
              <Smartphone size={18} /> Ready for any screen
            </span>
          </div>
        </div>
        <span className="story-footer">Thoughtfully simple. Independently hosted.</span>
        <div className="login-orbit" aria-hidden="true" />
      </section>
      <section className="login-panel">
        <div className="glass login-card">
          <span className="eyebrow">WELCOME ABOARD</span>
          <h2>Sign in to your workspace</h2>
          <p>Use your administrator account to continue.</p>
          <AsyncForm
            label="Sign in"
            onSubmit={async (data) => {
              const result = await api<{ csrf: string }>('/login', 'POST', {
                email: data.get('email'),
                password: data.get('password'),
              });
              setCSRF(result.csrf);
              await onLogin();
            }}
          >
            <Field label="Email address">
              <input
                name="email"
                type="email"
                autoComplete="username"
                placeholder="you@yourbusiness.com"
                required
              />
            </Field>
            <Field label="Password">
              <input name="password" type="password" autoComplete="current-password" required />
            </Field>
          </AsyncForm>
          <p className="login-note">
            <ShieldCheck size={16} /> Your session stays private on this device.
          </p>
          <div className="login-help">
            First time here? Your platform owner creates your administrator account.
            <ArrowUpRight size={16} />
          </div>
        </div>
      </section>
    </main>
  );
}
