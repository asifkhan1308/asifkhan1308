// The indexed lookup gives exactly the answers of the linear scan it replaces.
import { describe, expect, it } from 'vitest';
import { SourceIndex, sourceToTimeline } from '../../src/engine/timeline';
import type { Clip } from '../../src/engine/types';

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('SourceIndex', () => {
  it('matches sourceToTimeline on cut, reordered and duplicated clips from several assets', () => {
    const r = rng(7);
    for (let trial = 0; trial < 20; trial++) {
      const clips: Clip[] = [];
      for (let i = 0; i < 60; i++) {
        const a = r() < 0.7 ? 'A' : 'B';
        const i0 = r() * 100;
        clips.push({ id: `c${i}`, assetId: a, in: i0, out: i0 + 0.05 + r() * 6, gainDb: 0 } as Clip);
      }
      const idx = new SourceIndex(clips);
      for (let q = 0; q < 400; q++) {
        const asset = r() < 0.5 ? 'A' : 'B';
        const t = r() * 110;
        const hits = sourceToTimeline(clips, asset, t);
        const got = idx.first(asset, t);
        if (hits.length === 0) expect(got).toBeNull();
        else expect(got).toBeCloseTo(Math.min(...hits), 9);
      }
      expect(idx.first('missing', 1)).toBeNull();
    }
  });

  it('is far faster than scanning every clip (2,000 clips), whatever the machine load', () => {
    const clips: Clip[] = Array.from({ length: 2000 }, (_, i) => ({ id: `c${i}`, assetId: 'A', in: i * 1.8, out: i * 1.8 + 1.2, gainDb: 0 }) as Clip);
    const idx = new SourceIndex(clips);
    const qs = Array.from({ length: 2000 }, (_, q) => (q * 1.77) % 3600);
    const time = (f: (t: number) => unknown) => {
      for (const t of qs.slice(0, 200)) f(t); // warm up the JIT
      const t0 = performance.now();
      for (const t of qs) f(t);
      return performance.now() - t0;
    };
    const indexed = time((t) => idx.first('A', t));
    const scanned = time((t) => sourceToTimeline(clips, 'A', t));
    expect(indexed * 10).toBeLessThan(scanned);
  });
});
