# Responsive React and PWA behavior

The frontend is React + TypeScript built by Vite. It is a web application that can
be installed by compatible browsers. Installation gives it a home-screen icon and
standalone window; it does not produce an APK/IPA or bypass app-store requirements.

## Files and responsibilities

| File | Responsibility |
| --- | --- |
| `index.html` | Viewport, manifest, theme color, Apple touch icon, React mount |
| `public/manifest.webmanifest` | Name, scope, start URL, standalone mode, PNG icons |
| `public/mail.webmanifest` | Mail interface identity and `/mail` start URL |
| `public/theme.js` | Apply theme before first render |
| `src/hooks/useInstall.ts` | Deferred install prompt and installed-state detection |
| `src/App.tsx` | Footer button and browser-specific installation instructions |
| `vite.config.ts` | Generate versioned service worker during production build |
| `public/offline.html` | Public-only fallback when navigation has no network |
| `scripts/generate_icons.py` | Recreate original logo PNGs without image dependencies |

## Android, iOS, and desktop

Chromium may fire `beforeinstallprompt` when the browser considers the application
installable. We retain the event and call `prompt()` only after the user taps
Install. Dismissing it does not mark the app installed. `appinstalled` and standalone
display mode hide the button when supported.

iOS does not expose this direct prompt in the same way. The button explains how to
use Safari's Share menu and Add to Home Screen. Browser menu names and placement
vary; users always control the installation. Browsers without a prompt get honest
manual-install instructions instead of an inactive or misleading button.

## HTTPS and development

PWA features require a secure context: HTTPS or local loopback during development.
A phone visiting a laptop over `http://192.168...` is not visiting its own localhost.
Use a test HTTPS domain or your VPS to verify real-device installation.

The development server does not register a service worker. Build the frontend and
serve it through Go to test production installation and offline behavior. Browsers
may still expose manifest-based installation in development; that alone does not
verify the production service worker.

## Cache policy

Only generated, content-hashed JavaScript/CSS, public icons, and `offline.html` are
precached. Network navigation falls back to the offline notice. `/api/*` and health
checks bypass the service worker, and API responses use `Cache-Control: no-store`.

No email messages, credentials, tenant records, or administrator responses are
cached by this worker. We do not use IndexedDB or localStorage for these records.
Only the theme preference is stored in localStorage. An offline session cannot
queue account changes or read private records.
Webmail drafts are also memory-only. Installing the mail interface does not add
offline sending, message synchronization, or push notifications.

New builds get a new asset-based cache name. Activation removes old Postharbor
caches. We do not force `skipWaiting`; close existing tabs/windows to allow an
updated worker to activate without abruptly replacing an open session.

## Manual acceptance checks

1. Production build: manifest and all PNG icon URLs return 200 with correct types.
2. Chromium Android: tap Install; accept; launch standalone; install button disappears.
3. Dismiss installation: dashboard remains functional; no false installed status.
4. iPhone/iPad Safari: tap Install, follow instructions, launch from home screen.
5. Disconnect the network and reload: offline notice appears, no private cached data.
6. Reconnect, sign in, then sign out: the previous business's data is removed.
7. Check widths 375, 768, and 1440 CSS pixels in both themes; test drawer, dialogs,
   table scrolling, keyboard focus, 200% text zoom, and reduced motion.
8. In `/mail` on a phone, opening a conversation or Compose should use the entire
   viewport, including safe-area handling. Verify Back, the on-screen keyboard,
   inline reply, attachment pickers, photo previews, and filter-chip scrolling.
   Draft text and files must not enter service-worker caches or localStorage.

Real Android/iOS installation must be tested on those devices before release.

References: [MDN installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
and [MDN custom install prompts](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Trigger_install_prompt).
