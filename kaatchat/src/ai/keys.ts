// Bring-your-own-key storage.
//
// Desktop: keys are encrypted by the OS keychain in the main process and are
//          never readable by the page.
// Browser: keys live in this browser's storage for this site only. Anything
//          running on the page could read them, so the UI says so, and the
//          person can choose "this session only".

import { desktop } from '../platform/desktop';
import type { ProviderId } from './types';

const PREFIX = 'kaatchat.key.';

function webGet(p: ProviderId): string | null {
  try {
    return sessionStorage.getItem(PREFIX + p) ?? localStorage.getItem(PREFIX + p);
  } catch {
    return null;
  }
}

export const keyStore = {
  mode: desktop ? ('os-keychain' as const) : ('browser' as const),

  async secure(): Promise<boolean> {
    return desktop ? desktop.keys.secure() : false;
  },

  async has(p: ProviderId): Promise<boolean> {
    if (desktop) return desktop.keys.has(p);
    return !!webGet(p);
  },

  async set(p: ProviderId, key: string, remember: boolean): Promise<void> {
    const k = key.trim();
    if (!k) throw new Error('The key is empty.');
    if (desktop) return desktop.keys.set(p, k);
    try {
      localStorage.removeItem(PREFIX + p);
      sessionStorage.removeItem(PREFIX + p);
      (remember ? localStorage : sessionStorage).setItem(PREFIX + p, k);
    } catch {
      throw new Error('This browser blocked storage, so the key cannot be kept.');
    }
  },

  async clear(p: ProviderId): Promise<void> {
    if (desktop) return desktop.keys.clear(p);
    try {
      localStorage.removeItem(PREFIX + p);
      sessionStorage.removeItem(PREFIX + p);
    } catch {
      /* nothing stored */
    }
  },

  /** Browser only — the desktop build never exposes keys to the page. */
  webKey(p: ProviderId): string | null {
    return desktop ? null : webGet(p);
  },
};
