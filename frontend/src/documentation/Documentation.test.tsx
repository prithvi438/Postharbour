import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Documentation } from './Documentation';
import { api } from '../lib/api';
import type { DNSInfo, Domain, Session, Tenant } from '../lib/types';
vi.mock('../lib/api', () => ({ api: vi.fn() }));
const tenant = { id: 'business-a', name: 'Example' } as Tenant;
const session = { mode: 'stalwart', mail_host: 'mail.example.net' } as Session;
const domain = (id: string) =>
  ({
    id,
    tenant_id: tenant.id,
    name: `${id}.example.com`,
    verification_token: `${id}-ownership`,
    status: 'active',
  }) as Domain;
const info = (value: string, name = 'one.example.com'): DNSInfo => ({
  ownership_name: '',
  ownership_value: '',
  mx_host: 'mail.example.net',
  mx_matches: false,
  zone: `${name}. IN TXT "v=spf1 ${value} -all"`,
  note: 'Routing check only.',
});

describe('domain setup documentation', () => {
  it('keeps the public guide independent of private APIs and includes real screenshot links', () => {
    vi.mocked(api).mockClear();
    render(<Documentation />);
    expect(api).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /Sign in for your records/ })).toHaveAttribute(
      'href',
      '/#documentation',
    );
    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(screen.getByText(/This public guide uses example names only/)).toBeInTheDocument();
  });
  it('discards a delayed DNS response after switching domains', async () => {
    let finish!: (value: DNSInfo) => void;
    const delayed = new Promise<DNSInfo>((resolve) => {
      finish = resolve;
    });
    vi.mocked(api).mockImplementation(async (path) =>
      path.includes('/one/') ? delayed : info('ip4:192.0.2.2', 'two.example.com'),
    );
    render(
      <Documentation tenant={tenant} session={session} domains={[domain('one'), domain('two')]} />,
    );
    await waitFor(() => expect(api).toHaveBeenCalledWith('/tenants/business-a/domains/one/dns'));
    fireEvent.change(screen.getByLabelText('Guide domain'), { target: { value: 'two' } });
    await screen.findByText('v=spf1 ip4:192.0.2.2 -all');
    await act(async () => finish(info('ip4:192.0.2.1')));
    expect(screen.queryByText('v=spf1 ip4:192.0.2.1 -all')).not.toBeInTheDocument();
    expect(screen.queryByText('one-ownership')).not.toBeInTheDocument();
    expect(screen.getByText('two-ownership')).toBeInTheDocument();
  });
});
