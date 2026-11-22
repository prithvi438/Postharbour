import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { Webmail } from './webmail/Webmail';
import './styles.css';

// Mailbox users get a separate entry and install identity from the admin dashboard.
const isMail = location.pathname === '/mail' || location.pathname === '/mail/';
if (isMail) {
  document.title = 'Postharbor Mail';
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', '/mail.webmanifest');
}
// main.tsx mounts the selected React application into index.html's single root element.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isMail ? <Webmail /> : <App />}</React.StrictMode>,
);

// Service workers are production-only so a development build cannot become stale.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // The online dashboard remains usable if this browser blocks service workers.
      console.warn('Offline installation support could not be registered.');
    });
  });
}
