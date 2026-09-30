// Desktop app updates. The main process talks to GitHub and runs the installer;
// this module only holds the state the Settings page and the startup check show.

import { useSyncExternalStore } from 'react';
import { desktop, type UpdateCheck } from '../platform/desktop';

export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'result'; result: UpdateCheck }
  | { phase: 'downloading'; version: string; progress: number }
  | { phase: 'installing'; version: string }
  | { phase: 'error'; message: string };

let state: UpdateState = { phase: 'idle' };
const listeners = new Set<() => void>();
const set = (s: UpdateState) => {
  state = s;
  for (const l of listeners) l();
};

export const updatesSupported = !!desktop?.updates;

export function useUpdates(): UpdateState {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => state,
  );
}

export async function checkForUpdates(): Promise<UpdateCheck | null> {
  if (!desktop?.updates) return null;
  set({ phase: 'checking' });
  try {
    const result = await desktop.updates.check();
    set({ phase: 'result', result });
    return result;
  } catch (e) {
    set({ phase: 'error', message: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e) });
    return null;
  }
}

export async function installUpdate() {
  const u = desktop?.updates;
  if (!u || state.phase !== 'result' || state.result.status !== 'available') return;
  const { version } = state.result;
  set({ phase: 'downloading', version, progress: 0 });
  const off = u.onProgress((progress) => {
    if (state.phase === 'downloading') set({ phase: 'downloading', version, progress });
  });
  try {
    const r = await u.install();
    set(r.status === 'installing' ? { phase: 'installing', version } : { phase: 'idle' });
  } catch (e) {
    set({ phase: 'error', message: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e) });
  } finally {
    off();
  }
}
