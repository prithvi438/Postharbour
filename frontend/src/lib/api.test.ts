import { describe, expect, it, vi } from 'vitest';
import { api, setCSRF } from './api';

describe('API transport', () => {
  it('uses same-origin cookies, CSRF, and no private response caching', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    setCSRF('session-csrf');
    await api('/logout', 'POST');
    expect(request).toHaveBeenCalledWith(
      '/api/logout',
      expect.objectContaining({
        credentials: 'same-origin',
        cache: 'no-store',
        headers: expect.objectContaining({ 'X-CSRF-Token': 'session-csrf' }),
      }),
    );
  });
  it('invalidates the frontend session when the API expires it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":"Please sign in"}', { status: 401 }),
    );
    const listener = vi.fn();
    window.addEventListener('session-expired', listener);
    await expect(api('/tenants')).rejects.toThrow('Please sign in');
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener('session-expired', listener);
  });
});
