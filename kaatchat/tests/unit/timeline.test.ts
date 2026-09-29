import { describe, expect, it } from 'vitest';
import {
  keepTimelineRanges,
  locate,
  moveClip,
  normalizeRanges,
  removeSourceRanges,
  removeTimelineRanges,
  sequenceDuration,
  sourceToTimeline,
  splitAt,
  subtractRanges,
  trimClip,
} from '../../src/engine/timeline';
import { clip, seqId } from './helpers';

const A = clip('a', 'A', 0, 10);
const B = clip('b', 'B', 5, 9);

describe('timeline', () => {
  it('measures and locates', () => {
    expect(sequenceDuration([A, B])).toBe(14);
    const hit = locate([A, B], 12);
    expect(hit?.clip.id).toBe('b');
    expect(hit?.sourceTime).toBeCloseTo(7);
    expect(locate([A, B], 99)?.clip.id).toBe('b');
    expect(locate([], 1)).toBeNull();
  });

  it('splits at the playhead and ignores splits at edges', () => {
    const s = splitAt([A, B], 4, seqId);
    expect(s.map((c) => [c.in, c.out])).toEqual([
      [0, 4],
      [4, 10],
      [5, 9],
    ]);
    expect(sequenceDuration(s)).toBe(14);
    expect(splitAt([A], 0, seqId)).toHaveLength(1);
  });

  it('trims within the asset and keeps a minimum length', () => {
    const t = trimClip([A], 'a', 10, { in: -3, out: 20 });
    expect([t[0].in, t[0].out]).toEqual([0, 10]);
    const t2 = trimClip([A], 'a', 10, { in: 10 });
    expect(t2[0].out - t2[0].in).toBeGreaterThan(0);
  });

  it('moves clips', () => {
    expect(moveClip([A, B], 'a', 5).map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('merges and subtracts ranges', () => {
    expect(normalizeRanges([{ start: 3, end: 5 }, { start: 1, end: 3.5 }, { start: 8, end: 7 }])).toEqual([{ start: 1, end: 5 }]);
    expect(subtractRanges(0, 10, [{ start: 2, end: 3 }, { start: 9, end: 12 }])).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 9 },
    ]);
  });

  it('removes source ranges only from the matching asset', () => {
    const r = removeSourceRanges([A, B], 'A', [{ start: 2, end: 4 }], seqId);
    expect(r.map((c) => [c.assetId, c.in, c.out])).toEqual([
      ['A', 0, 2],
      ['A', 4, 10],
      ['B', 5, 9],
    ]);
    expect(r[0].id).toBe('a'); // first piece keeps its identity
  });

  it('ripple-deletes timeline ranges across clip boundaries', () => {
    const r = removeTimelineRanges([A, B], [{ start: 9, end: 11 }], seqId);
    expect(r.map((c) => [c.assetId, c.in, c.out])).toEqual([
      ['A', 0, 9],
      ['B', 6, 9],
    ]);
    expect(sequenceDuration(r)).toBe(12);
  });

  it('keeps timeline ranges in order', () => {
    const r = keepTimelineRanges([A, B], [{ start: 11, end: 13 }, { start: 1, end: 2 }], seqId);
    expect(r.map((c) => [c.assetId, c.in, c.out])).toEqual([
      ['A', 1, 2],
      ['B', 6, 8],
    ]);
    expect(new Set(r.map((c) => c.id)).size).toBe(2);
  });

  it('maps source time back to the timeline', () => {
    expect(sourceToTimeline([A, B], 'B', 6)).toEqual([11]);
    expect(sourceToTimeline([A, B], 'B', 1)).toEqual([]);
  });
});
