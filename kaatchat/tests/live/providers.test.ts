// Real provider round trips with the app's own code: connection check, a real
// edit plan that Kaatchat validates, and a bad key that must not leak.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ProviderId } from '../../src/ai/types';
import { asset, clip, doc, envelope } from '../unit/helpers';

const KEYS: Partial<Record<ProviderId, string | undefined>> = {
  openai: process.env.OPENAI_API_KEY,
  gemini: process.env.GEMINI_API_KEY,
  claude: process.env.ANTHROPIC_API_KEY,
};

// The web build keeps keys in browser storage; give Node the same interface.
beforeAll(() => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  Object.assign(globalThis, { localStorage: storage, sessionStorage: storage });
});

const view = doc([clip('c1', 'A', 0, 60)], [asset('A', 60)]);
const index = {
  A: {
    audio: envelope([[10, -20], [3, -60], [20, -18], [4, -62], [23, -19]]),
    transcript: {
      model: 't',
      language: 'en',
      createdAt: 0,
      segments: [
        { t0: 0, t1: 10, text: 'Welcome back. Today we talk about starting a company.', words: [] },
        { t0: 13, t1: 33, text: 'Money matters when you start a company, so plan your runway.', words: [] },
        { t0: 37, t1: 60, text: 'Thanks for watching, see you next week.', words: [] },
      ],
    },
  },
};

for (const id of ['openai', 'gemini', 'claude'] as const) {
  const key = KEYS[id];
  describe.skipIf(!key)(`live: ${id}`, () => {
    it('connects, plans a real edit that validates, and applies it', async () => {
      const { keyStore } = await import('../../src/ai/keys');
      const { createProvider, PROVIDERS } = await import('../../src/ai/providers');
      const { requestPlan } = await import('../../src/ai/planner');
      const { EditorStore } = await import('../../src/engine/store');
      const { projectOf } = await import('../unit/helpers');
      await keyStore.set(id, key!, false);
      const provider = createProvider(id, { enabled: true, model: PROVIDERS[id].defaultModel });
      expect(await provider.testConnection()).toMatch(/Connected/);
      const out = await requestPlan(provider, view, index, 'Remove the boring pauses and make it vertical for Reels', 0);
      expect(out.via).toBe('model');
      const types = out.plan.commands.map((c) => c.type);
      expect(types).toContain('set_aspect');
      const store = new EditorStore(projectOf(view), index);
      const preview = store.preview(out.plan);
      expect(preview.ok).toBe(true);
      store.applyPlan(out.plan, 'live test');
      expect(store.doc.aspect).toBe('9:16');
    });

    it('a wrong key fails clearly, without echoing the key', async () => {
      const { keyStore } = await import('../../src/ai/keys');
      const { createProvider, PROVIDERS } = await import('../../src/ai/providers');
      const bad = id === 'gemini' ? 'AIzaSyD-invalid-kaatchat-test-0000000000' : 'sk-invalid-kaatchat-test-000000000000';
      await keyStore.set(id, bad, false);
      const err = await createProvider(id, { enabled: true, model: PROVIDERS[id].defaultModel }).testConnection().then(
        () => null,
        (e: Error) => e,
      );
      await keyStore.set(id, key!, false);
      expect(err).not.toBeNull();
      expect(String(err!.message)).not.toContain(bad);
      expect(String(err!.message)).toMatch(/key|API|401|403|400/i);
    });
  });
}

it.skipIf(Object.values(KEYS).some(Boolean))('no provider keys set — nothing to test live', () => {});
