import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyPrefs } from './app/prefs';
import { isDesktop } from './platform/desktop';
import './styles.css';

applyPrefs();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline shell for the web build (the desktop app is already offline).
if (import.meta.env.PROD && !isDesktop && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
