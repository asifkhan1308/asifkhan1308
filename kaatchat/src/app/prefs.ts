// Per-device preferences (not project data).

import { useSyncExternalStore } from 'react';

export interface Prefs {
  uiScale: number; // 0.9 – 1.3
  highContrast: boolean;
  reducedMotion: 'system' | 'on' | 'off';
  whisperModel: string;
  /** Spoken language hint for transcription; '' = detect. */
  speechLanguage: string;
}

const KEY = 'kaatchat.prefs';
const defaults: Prefs = {
  uiScale: 1,
  highContrast: false,
  reducedMotion: 'system',
  whisperModel: 'onnx-community/whisper-base',
  speechLanguage: '',
};

let prefs: Prefs = (() => {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return defaults;
  }
})();
const listeners = new Set<() => void>();

export function applyPrefs() {
  const r = document.documentElement;
  r.style.fontSize = `${Math.round(prefs.uiScale * 100)}%`;
  r.style.setProperty('--ui-scale', String(prefs.uiScale));
  r.dataset.contrast = prefs.highContrast ? 'high' : 'normal';
  r.dataset.motion = prefs.reducedMotion;
}

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
  applyPrefs();
  for (const f of listeners) f();
}

export const getPrefs = () => prefs;

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => prefs,
  );
}
