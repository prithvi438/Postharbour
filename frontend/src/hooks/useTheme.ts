import { useEffect, useState } from 'react';

/** useTheme owns the only persistent UI preference; private API data is not saved. */
export function useTheme() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('postharbor-theme', theme);
    } catch {
      /* Storage can be disabled in private browsers. */
    }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#102b32' : '#edf5f3');
  }, [theme]);
  return {
    theme,
    toggleTheme: () => setTheme((current) => (current === 'dark' ? 'light' : 'dark')),
  };
}
