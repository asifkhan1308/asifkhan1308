import { describe, expect, it } from 'vitest';
import { applyGain, mapChannels, StreamResampler } from '../../src/engine/audio';

describe('streaming resampler', () => {
  it('produces the right number of samples across chunk boundaries', () => {
    const r = new StreamResampler(44100, 48000, 1);
    let total = 0;
    for (let i = 0; i < 10; i++) total += r.push([new Float32Array(4410)])[0].length;
    expect(Math.abs(total - 48000)).toBeLessThanOrEqual(2);
  });

  it('keeps a sine continuous across chunks', () => {
    const inRate = 16000;
    const r = new StreamResampler(inRate, 48000, 1);
    const out: number[] = [];
    for (let c = 0; c < 4; c++) {
      const chunk = new Float32Array(1000);
      for (let i = 0; i < 1000; i++) chunk[i] = Math.sin((2 * Math.PI * 200 * (c * 1000 + i)) / inRate);
      out.push(...r.push([chunk])[0]);
    }
    let maxStep = 0;
    for (let i = 1; i < out.length; i++) maxStep = Math.max(maxStep, Math.abs(out[i] - out[i - 1]));
    expect(maxStep).toBeLessThan(0.05);
  });

  it('downsamples to 16 kHz mono for speech models', () => {
    const r = new StreamResampler(48000, 16000, 1);
    expect(r.push([new Float32Array(48000)])[0].length).toBe(16000);
  });
});

describe('channel mapping and gain', () => {
  it('duplicates mono and downmixes to mono', () => {
    const a = new Float32Array([1, 1]);
    const b = new Float32Array([0, 0]);
    expect(mapChannels([a], 2)).toEqual([a, a]);
    expect(Array.from(mapChannels([a, b], 1)[0])).toEqual([0.5, 0.5]);
  });

  it('soft-limits boosted audio below full scale', () => {
    const p = [new Float32Array([0.5, -0.5, 0.1])];
    applyGain(p, 12);
    expect(Math.max(...Array.from(p[0]).map(Math.abs))).toBeLessThanOrEqual(1);
    expect(p[0][2]).toBeCloseTo(0.398, 2);
  });
});
