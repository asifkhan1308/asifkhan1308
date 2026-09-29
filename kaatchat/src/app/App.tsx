import { lazy, Suspense, useEffect, useState } from 'react';
import { Home } from '../ui/Home';
import { Toasts } from '../ui/bits';
import { useLang } from '../i18n';

const Editor = lazy(() => import('../ui/Editor').then((m) => ({ default: m.Editor })));
const Settings = lazy(() => import('../ui/Settings').then((m) => ({ default: m.Settings })));
const Privacy = lazy(() => import('../ui/Privacy').then((m) => ({ default: m.Privacy })));

type Route = { name: 'home' } | { name: 'editor'; id: string } | { name: 'settings' } | { name: 'privacy' };

function parse(hash: string): Route {
  const h = hash.replace(/^#/, '');
  const m = /^\/p\/([A-Za-z0-9_-]{1,64})$/.exec(h);
  if (m) return { name: 'editor', id: m[1] };
  if (h === '/settings') return { name: 'settings' };
  if (h === '/privacy') return { name: 'privacy' };
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
  return (
    <>
      <Suspense fallback={<div className="page" aria-busy="true" />}>
        {route.name === 'home' && <Home />}
        {route.name === 'editor' && <Editor key={route.id} projectId={route.id} />}
        {route.name === 'settings' && <Settings />}
        {route.name === 'privacy' && <Privacy />}
      </Suspense>
      <Toasts />
    </>
  );
}
