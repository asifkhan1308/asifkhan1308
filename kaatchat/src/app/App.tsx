import { lazy, Suspense, useEffect, useState } from 'react';
import { Home } from '../ui/Home';
import { Toasts, toast } from '../ui/bits';
import { checkForUpdates, updatesSupported } from './updates';
import { getPrefs } from './prefs';
import { useLang } from '../i18n';

const Editor = lazy(() => import('../ui/Editor').then((m) => ({ default: m.Editor })));
const Settings = lazy(() => import('../ui/Settings').then((m) => ({ default: m.Settings })));
const Privacy = lazy(() => import('../ui/Privacy').then((m) => ({ default: m.Privacy })));
const MotionLab = lazy(() => import('../features/motionlab/MotionLabFeature'));

type Route = { name: 'home' } | { name: 'editor'; id: string } | { name: 'settings' } | { name: 'privacy' } | { name: 'motionlab' };

function parse(hash: string): Route {
  const h = hash.replace(/^#/, '');
  const m = /^\/p\/([A-Za-z0-9_-]{1,64})$/.exec(h);
  if (m) return { name: 'editor', id: m[1] };
  if (h === '/settings') return { name: 'settings' };
  if (h === '/privacy') return { name: 'privacy' };
  if (h === '/motionlab') return { name: 'motionlab' };
  return { name: 'home' };
}

export function App() {
  useLang();
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  // Desktop: one quiet look for a new version shortly after start. Nothing is
  // downloaded unless the person chooses to install it in Settings.
  useEffect(() => {
    if (!updatesSupported || !getPrefs().checkUpdates) return;
    const t = setTimeout(async () => {
      const r = await checkForUpdates();
      if (r?.status === 'available') toast(`Kaatchat ${r.version} is available.`, 'info', { label: 'Details', run: () => (location.hash = '#/settings') }, { sticky: true });
    }, 8000);
    return () => clearTimeout(t);
  }, []);
  return (
    <>
      <Suspense fallback={<div className="page" aria-busy="true" />}>
        {route.name === 'home' && <Home />}
        {route.name === 'editor' && <Editor key={route.id} projectId={route.id} />}
        {route.name === 'settings' && <Settings />}
        {route.name === 'privacy' && <Privacy />}
        {route.name === 'motionlab' && <MotionLab />}
      </Suspense>
      <Toasts />
    </>
  );
}
