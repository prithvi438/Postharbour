// Apply a saved or system theme before React loads, avoiding a bright first frame.
try {
  const saved = localStorage.getItem('postharbor-theme');
  document.documentElement.dataset.theme =
    saved === 'dark' || saved === 'light'
      ? saved
      : matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
} catch (_) {
  document.documentElement.dataset.theme = 'light';
}
