import { useEffect, useState } from 'react';

/** Chromium exposes a deferred prompt; Safari/iOS require browser-menu instructions. */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** useInstall handles browser capability, dismissal, and standalone app detection.
 * It never promises a one-tap iOS install or mistakes dismissal for installation. */
export function useInstall() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [help, setHelp] = useState(false);
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)');
    const update = () =>
      setInstalled(
        media.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
      );
    const capture = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const done = () => {
      setInstalled(true);
      setPrompt(null);
      setHelp(false);
    };
    update();
    media.addEventListener('change', update);
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', done);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', done);
    };
  }, []);
  /** install must be called from a user gesture to allow the native browser prompt. */
  async function install() {
    if (!prompt) {
      setHelp(true);
      return;
    }
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      setHelp(true);
    } finally {
      setPrompt(null);
    }
  }
  return { installed, ios, help, setHelp, install };
}
