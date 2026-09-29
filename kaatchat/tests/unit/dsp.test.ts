import { describe, expect, it } from 'vitest';
import { cropRect, detectSilences, EnvelopeBuilder, frameFocus, rangeFocus, SILENCE_PRESETS } from '../../src/engine/dsp';
import { envelope } from './helpers';

describe('loudness envelope', () => {
  it('measures a full-scale sine at about -3 dBFS', () => {
    const sr = 48000;
    const b = new EnvelopeBuilder(sr);
    const s = new Float32Array(sr);
    for (let i = 0; i < sr; i++) s[i] = Math.sin((2 * Math.PI * 440 * i) / sr);
    b.push(s);
    const a = b.finish();
    expect(a.rmsDb.length).toBe(50);
    expect(a.levelDb).toBeGreaterThan(-3.5);
    expect(a.levelDb).toBeLessThan(-2.5);
  });
});

describe('silence detection', () => {
  const audio = envelope([
    [2, -20],
    [1.5, -80],
    [2, -20],
    [0.2, -80], // too short to count
    [2, -20],
  ]);

  it('finds quiet stretches longer than the minimum gap, with padding', () => {
    const r = detectSilences(audio, SILENCE_PRESETS.balanced);
    expect(r).toHaveLength(1);
    expect(r[0].start).toBeCloseTo(2 + 0.09, 2);
    expect(r[0].end).toBeCloseTo(3.5 - 0.09, 2);
  });

  it('respects the requested range and does not pad at range edges', () => {
    const r = detectSilences(audio, SILENCE_PRESETS.balanced, 2.5, 5);
    expect(r[0].start).toBeCloseTo(2.5, 2);
  });
});

describe('framing', () => {
  it('finds detail in the right third of a frame', () => {
    const w = 30;
    const h = 20;
    const g = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 22; x < 28; x++) g[y * w + x] = (x + y) % 2 ? 255 : 0;
    const f = frameFocus(g, w, h);
    expect(f.x).toBeGreaterThan(0.7);
    expect(f.y).toBeGreaterThan(0.3);
    expect(f.y).toBeLessThan(0.7);
  });

  it('takes a weighted median over a range', () => {
    const framing = {
      samples: [
        { t: 0, x: 0.2, y: 0.5, weight: 1 },
        { t: 1, x: 0.8, y: 0.5, weight: 5 },
        { t: 9, x: 0.1, y: 0.1, weight: 9 },
      ],
    };
    expect(rangeFocus(framing, 0, 2).x).toBe(0.8);
    expect(rangeFocus(undefined, 0, 2)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('crops 16:9 to 9:16 around the focus and clamps to the frame', () => {
    const r = cropRect(1920, 1080, 1080, 1920, 'fill', 1, 0.5);
    expect(r.sh).toBeCloseTo(1080);
    expect(r.sw).toBeCloseTo(607.5);
    expect(r.sx + r.sw).toBeCloseTo(1920);
    const fit = cropRect(1920, 1080, 1080, 1920, 'fit', 0.5, 0.5);
    expect(fit.dw).toBeCloseTo(1080);
    expect(fit.dy).toBeGreaterThan(0);
  });
});
