import { describe, expect, it, vi } from 'vitest';
import { mailAPI, setMailToken } from './api';

describe('mailbox session transport', () => {
  it('ignores an expired response from a previous login, while expiring the current login', async () => {
    let resolveOld!: (response: Response) => void;
    const oldRequest = new Promise<Response>((resolve) => {
      resolveOld = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(oldRequest);
    const expired = vi.fn();
    window.addEventListener('mail-session-expired', expired);
    try {
      setMailToken('old-user-token');
      const oldResult = mailAPI('/messages?folder=inbox');
      setMailToken('new-user-token');
      resolveOld(new Response(JSON.stringify({ error: 'Old session expired' }), { status: 401 }));
      await expect(oldResult).rejects.toThrow('Old session expired');
      expect(expired).not.toHaveBeenCalled();
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Current session expired' }), { status: 401 }),
      );
      await expect(mailAPI('/logout', 'POST')).rejects.toThrow('Current session expired');
      expect(expired).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/webmail/logout',
        expect.objectContaining({
          credentials: 'same-origin',
          cache: 'no-store',
          headers: expect.objectContaining({ 'X-CSRF-Token': 'new-user-token' }),
        }),
      );
    } finally {
      window.removeEventListener('mail-session-expired', expired);
      setMailToken('');
    }
  });
});
