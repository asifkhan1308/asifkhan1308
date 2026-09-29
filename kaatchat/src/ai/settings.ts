// Non-secret AI preferences (which provider, which model). Keys live in keys.ts.

import { PROVIDERS, createProvider } from './providers';
import type { AIProvider, ProviderId, ProviderSettings } from './types';

export interface AISettings {
  active: ProviderId;
  providers: Record<ProviderId, ProviderSettings>;
}

const KEY = 'kaatchat.ai.settings';

export function defaultAISettings(): AISettings {
  const providers = {} as Record<ProviderId, ProviderSettings>;
  for (const p of Object.values(PROVIDERS)) {
    providers[p.id] = { enabled: p.id === 'builtin', model: p.defaultModel, ...(p.id === 'local' ? { baseUrl: 'http://localhost:11434' } : {}) };
  }
  return { active: 'builtin', providers };
}

export function loadAISettings(): AISettings {
  const d = defaultAISettings();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<AISettings> | null;
    if (!raw) return d;
    const providers = { ...d.providers };
    for (const id of Object.keys(providers) as ProviderId[]) providers[id] = { ...providers[id], ...(raw.providers?.[id] ?? {}) };
    const active = raw.active && raw.active in PROVIDERS && providers[raw.active].enabled ? raw.active : 'builtin';
    return { active, providers };
  } catch {
    return d;
  }
}

export function saveAISettings(s: AISettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked — settings last for this session */
  }
}

export function activeProvider(s: AISettings): AIProvider {
  return createProvider(s.active, s.providers[s.active]);
}
