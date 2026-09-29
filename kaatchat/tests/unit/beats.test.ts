import { describe, expect, it } from 'vitest';
import { duckDbAt, estimateBeats, fadeGain, OnsetDetector, snapCutsToBeats, speechRanges, timelineBeats } from '../../src/engine/beats';
import { sequenceDuration } from '../../src/engine/timeline';
import { clip, envelope } from './helpers';

function clickTrack(bpm: number, seconds: number, sr = 44100, offset = 0.1): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr));
  const period = 60 / bpm;
  for (let t = offset; t < seconds; t += period) {
    const i0 = Math.round(t * sr);
    for (let k = 0; k < 800 && i0 + k < out.length; k++) out[i0 + k] = Math.sin(k * 0.3) * Math.exp(-k / 150);
  }
  // A quiet pad underneath so it is not silence between clicks.
  for (let i = 0; i < out.length; i++) out[i] += 0.02 * Math.sin((2 * Math.PI * 220 * i) / sr);
  return out;
}

describe('beat detection', () => {
  it('finds 120 bpm and lands the grid on the clicks', () => {
    const det = new OnsetDetector(44100);
    const s = clickTrack(120, 12);
    for (let i = 0; i < s.length; i += 4096) det.push(s.subarray(i, i + 4096));
    const b = estimateBeats(det.flux, det.rate)!;
    expect(b.bpm).toBeGreaterThan(117);
    expect(b.bpm).toBeLessThan(123);
    // Every detected beat is within 30 ms of a click (clicks at 0.1 + k*0.5).
    for (const t of b.beats.slice(1, -1)) {
      const k = Math.round((t - 0.1) / 0.5);
      expect(Math.abs(t - (0.1 + k * 0.5))).toBeLessThan(0.03);
    }
    expect(b.confidence).toBeGreaterThan(0.2);
  });

  it('reports nothing for too little audio', () => {
    expect(estimateBeats([1, 2, 3], 86)).toBeNull();
  });
});

describe('beat sync', () => {
  it('moves cuts onto nearby beats, within media, and ignores far ones', () => {
    const clips = [clip('a', 'A', 0, 1.9), clip('b', 'A', 5, 8), clip('c', 'A', 10, 12)];
    const beats = [2, 4, 5.5];
    const r = snapCutsToBeats(clips, beats, 0.25, () => 20);
    expect(r.moved).toBe(1); // 1.9 → 2.0; the next cut (≈4.9) is 0.6 away from 5.5 and 0.9 from 4: left alone
    expect(r.clips[0].out).toBeCloseTo(2);
    expect(sequenceDuration(r.clips)).toBeCloseTo(7.0); // 1.9 + 3 + 2, plus the 0.1 s extension
  });

  it('maps music beats onto the timeline', () => {
    const t = timelineBeats([{ id: 'm', assetId: 'M', start: 10, in: 2, out: 6, gainDb: 0, fadeIn: 0, fadeOut: 0, duck: true }], () => ({ bpm: 120, beats: [1, 2, 3, 7], confidence: 1 }));
    expect(t).toEqual([10, 11]);
  });
});

describe('mixing', () => {
  it('ducks music under speech with smooth attack and release', () => {
    const a = envelope([
      [2, -60],
      [2, -15],
      [2, -60],
    ]);
    const speech = speechRanges([clip('a', 'A', 0, 6)], () => a);
    expect(speech).toHaveLength(1);
    expect(speech[0].start).toBeCloseTo(2, 1);
    expect(duckDbAt(3, speech, -12)).toBe(-12);
    expect(duckDbAt(0.5, speech, -12)).toBeCloseTo(0);
    const rel = duckDbAt(4.1, speech, -12);
    expect(rel).toBeLessThan(0);
    expect(rel).toBeGreaterThan(-12);
  });

  it('fades clip edges linearly', () => {
    expect(fadeGain(0, 10, 1, 1)).toBe(0);
    expect(fadeGain(0.5, 10, 1, 1)).toBeCloseTo(0.5);
    expect(fadeGain(5, 10, 1, 1)).toBe(1);
    expect(fadeGain(9.75, 10, 1, 1)).toBeCloseTo(0.25);
  });
});
