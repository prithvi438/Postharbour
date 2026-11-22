import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useInstall } from './useInstall';

describe('PWA installation', () => {
  it('shows instructions when there is no browser install prompt', async () => {
    const { result } = renderHook(useInstall);
    await act(() => result.current.install());
    expect(result.current.help).toBe(true);
    expect(result.current.installed).toBe(false);
  });
  it('uses a deferred native prompt without treating dismissal as installation', async () => {
    const { result } = renderHook(useInstall);
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    await act(() => result.current.install());
    expect(prompt).toHaveBeenCalledOnce();
    expect(result.current.installed).toBe(false);
    act(() => window.dispatchEvent(new Event('appinstalled')));
    expect(result.current.installed).toBe(true);
  });
});
