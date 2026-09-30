// Translations: complete (enforced by the types), and every placeholder survives.
import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  const mem = new Map<string, string>();
  Object.assign(globalThis, {
    localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    document: { documentElement: { lang: 'en' } },
  });
});

describe('translations', () => {
  it('fills placeholders and pluralises files in every language', async () => {
    const { setLang, t, tFiles } = await import('../../src/i18n');
    setLang('en');
    expect(t('import.measuring', { files: tFiles(1) })).toBe('Imported 1 file. Measuring on this device…');
    expect(t('import.measured', { files: tFiles(3) })).toBe('Measured 3 files.');
    setLang('hi');
    expect(t('import.measured', { files: tFiles(3) })).toBe('3 फ़ाइलें माप ली गईं।');
    expect(t('ai.plan')).toBe('योजना बनाएँ');
    setLang('hinglish');
    expect(t('import.done', { files: tFiles(2) })).toBe('2 files import ho gayi.');
    setLang('en');
  });

  it('every translation keeps the same {placeholders} as the English', async () => {
    const mod = await import('../../src/i18n');
    const { setLang, t } = mod;
    const keys = ['import.done', 'import.measuring', 'import.measured', 'import.failed', 'files.one', 'files.many'] as const;
    const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    setLang('en');
    const en = Object.fromEntries(keys.map((k) => [k, holes(t(k))]));
    for (const l of ['hi', 'hinglish'] as const) {
      setLang(l);
      for (const k of keys) expect(holes(t(k)), `${l} ${k}`).toBe(en[k]);
    }
    setLang('en');
  });
});
