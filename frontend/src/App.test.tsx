import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { api } from './lib/api';
import type { Domain } from './lib/types';

vi.mock('./lib/api', async (original) => ({
  ...(await original<typeof import('./lib/api')>()),
  api: vi.fn(),
  setCSRF: vi.fn(),
}));

describe('workspace isolation in React', () => {
  it('discards a delayed response from the previously selected business', async () => {
    location.hash = '#domains';
    let finishOldRequest!: (rows: Domain[]) => void;
    const oldRequest = new Promise<Domain[]>((resolve) => {
      finishOldRequest = resolve;
    });
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/session')
        return {
          user: {
            id: 'owner',
            name: 'Owner',
            email: 'owner@example.test',
            role: 'platform_admin',
            tenant_id: '',
          },
          csrf: 'test',
          mode: 'simulation',
          max_mailboxes: 5,
          mail_host: 'mail.example.test',
          webmail_url: '',
        };
      if (path === '/tenants')
        return ['a', 'b'].map((id) => ({
          id,
          name: `Business ${id}`,
          status: 'active',
          max_mailboxes: 5,
          quota_mb: 25600,
        }));
      if (path === '/tenants/a/domains') return oldRequest;
      if (path === '/tenants/b/domains')
        return [
          { id: 'domain-b', tenant_id: 'b', name: 'beta.test', status: 'active', verified: true },
        ];
      return [];
    });
    render(<App />);
    await screen.findByRole('option', { name: 'Business a' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Select business' }), {
      target: { value: 'b' },
    });
    await screen.findByRole('heading', { name: 'beta.test' });
    await act(async () =>
      finishOldRequest([
        {
          id: 'domain-a',
          tenant_id: 'a',
          name: 'alpha.test',
          status: 'active',
          verified: true,
          verification_token: 'test',
          created_at: '',
        },
      ]),
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'beta.test' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('heading', { name: 'alpha.test' })).not.toBeInTheDocument();
  });
});
