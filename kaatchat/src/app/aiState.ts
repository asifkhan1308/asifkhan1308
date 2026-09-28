import { useSyncExternalStore } from 'react';
import { loadAISettings, saveAISettings, activeProvider, type AISettings } from '../ai/settings';

let state: AISettings = loadAISettings();
const listeners = new Set<() => void>();

export function setAISettings(next: AISettings) {
  state = next;
  saveAISettings(next);
  for (const f of listeners) f();
}

export const getAISettings = () => state;
export const getActiveProvider = () => activeProvider(state);

export function useAISettings(): AISettings {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => state,
  );
}
