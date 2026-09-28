// Measurement primitives. Pure functions over numbers — unit-tested directly.

import type { AudioAnalysis, FramingAnalysis, TimeRange } from './types';

export const SILENT_DB = -100;
export const ANALYSIS_RATE = 50; // loudness frames per second (20 ms hop)

export const toDb = (rms: number) => (rms > 1e-5 ? 20 * Math.log10(rms) : SILENT_DB);
export const fromDb = (db: number) => Math.pow(10, db / 20);

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return SILENT_DB;
  const s = values.slice().sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[i];
}

/** Mean of the loudest `share` of frames, in the power domain. */
export function loudestShareDb(frames: readonly number[], share = 0.4): number {
  const voiced = frames.filter((d) => d > SILENT_DB);
  if (voiced.length === 0) return SILENT_DB;
  const s = voiced.slice().sort((a, b) => b - a);
  const n = Math.max(1, Math.round(s.length * share));
  let p = 0;
  for (let i = 0; i < n; i++) p += Math.pow(10, s[i] / 10);
  return 10 * Math.log10(p / n);
}

/**
 * Streaming RMS envelope builder. Feed mono samples at any sample rate; it
 * emits one dB value per 1/ANALYSIS_RATE seconds.
 */
export class EnvelopeBuilder {
  private acc = 0;
  private n = 0;
  private readonly hop: number;
  readonly frames: number[] = [];
  constructor(sampleRate: number, rate = ANALYSIS_RATE) {
    this.hop = Math.max(1, Math.round(sampleRate / rate));
  }
  push(mono: Float32Array) {
    for (let i = 0; i < mono.length; i++) {
      const v = mono[i];
      this.acc += v * v;
      if (++this.n === this.hop) {
        this.frames.push(toDb(Math.sqrt(this.acc / this.n)));
        this.acc = 0;
        this.n = 0;
      }
    }
  }
  finish(): AudioAnalysis {
    if (this.n > 0) this.frames.push(toDb(Math.sqrt(this.acc / this.n)));
    const rmsDb = this.frames.map((d) => Math.round(d * 10) / 10);
    return { rate: ANALYSIS_RATE, rmsDb, levelDb: loudestShareDb(rmsDb), p90Db: percentile(rmsDb, 90) };
  }
}

export interface SilencePreset {
  id: 'natural' | 'balanced' | 'aggressive';
  label: string;
  /** dB relative to the 90th-percentile frame. */
  thresholdDb: number;
  minGap: number;
  padding: number;
}

export const SILENCE_PRESETS: Record<SilencePreset['id'], SilencePreset> = {
  natural: { id: 'natural', label: 'Natural', thresholdDb: -34, minGap: 0.7, padding: 0.14 },
  balanced: { id: 'balanced', label: 'Balanced', thresholdDb: -30, minGap: 0.45, padding: 0.09 },
  aggressive: { id: 'aggressive', label: 'Aggressive', thresholdDb: -26, minGap: 0.28, padding: 0.05 },
};

/**
 * Quiet stretches (SOURCE seconds) inside [from, to). Each stretch had to be
 * at least `minGap` long, and `padding` is left on both sides so words are
 * not clipped.
 */
export function detectSilences(
  audio: AudioAnalysis,
  preset: SilencePreset,
  from = 0,
  to = Infinity,
): TimeRange[] {
  const { rate, rmsDb } = audio;
  const threshold = Math.max(audio.p90Db + preset.thresholdDb, -70);
  const i0 = Math.max(0, Math.floor(from * rate));
  const i1 = Math.min(rmsDb.length, Math.ceil(Math.min(to, rmsDb.length / rate) * rate));
  const out: TimeRange[] = [];
  let runStart = -1;
  const flush = (endIdx: number) => {
    if (runStart < 0) return;
    const s = runStart / rate;
    const e = endIdx / rate;
    if (e - s >= preset.minGap) {
      // Keep padding next to speech, but not at the very edges of the range.
      const ps = runStart === i0 ? s : s + preset.padding;
      const pe = endIdx === i1 ? e : e - preset.padding;
      if (pe - ps > 0.02) out.push({ start: Math.max(from, ps), end: Math.min(to, pe) });
    }
    runStart = -1;
  };
  for (let i = i0; i < i1; i++) {
    if (rmsDb[i] < threshold) {
      if (runStart < 0) runStart = i;
    } else flush(i);
  }
  flush(i1);
  return out;
}

/** Level of a source range, measured like `levelDb`. */
export function rangeLevelDb(audio: AudioAnalysis, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from * audio.rate));
  const b = Math.min(audio.rmsDb.length, Math.ceil(to * audio.rate));
  return loudestShareDb(audio.rmsDb.slice(a, b));
}

/** Mean dB of a source range — used to rank moments by energy. */
export function rangeMeanDb(audio: AudioAnalysis, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from * audio.rate));
  const b = Math.min(audio.rmsDb.length, Math.ceil(to * audio.rate));
  if (b <= a) return SILENT_DB;
  let p = 0;
  for (let i = a; i < b; i++) p += Math.pow(10, audio.rmsDb[i] / 10);
  return 10 * Math.log10(p / (b - a));
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

/**
 * Where is the visual interest in a small greyscale frame? Combines spatial
 * detail (gradient magnitude) and, when a previous frame is given, motion.
 * Returns a weighted centre in 0..1 coordinates.
 */
export function frameFocus(
  gray: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  prev?: Uint8Array | Uint8ClampedArray,
): { x: number; y: number; weight: number } {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = gray[i + 1] - gray[i - 1];
      const gy = gray[i + w] - gray[i - w];
      let e = Math.sqrt(gx * gx + gy * gy);
      if (prev) e += 2 * Math.abs(gray[i] - prev[i]);
      // Square the energy so the busiest region dominates flat texture.
      const wgt = e * e;
      sx += wgt * x;
      sy += wgt * y;
      sw += wgt;
    }
  }
  if (sw === 0) return { x: 0.5, y: 0.5, weight: 0 };
  return { x: sx / sw / (w - 1), y: sy / sw / (h - 1), weight: sw / (w * h) };
}

/** Weighted median focus over a source range; centred when nothing is known. */
export function rangeFocus(framing: FramingAnalysis | undefined, from: number, to: number): { x: number; y: number } {
  if (!framing) return { x: 0.5, y: 0.5 };
  const pts = framing.samples.filter((s) => s.t >= from && s.t <= to && s.weight > 0);
  if (pts.length === 0) return { x: 0.5, y: 0.5 };
  const med = (key: 'x' | 'y') => {
    const s = pts.slice().sort((a, b) => a[key] - b[key]);
    const total = s.reduce((a, p) => a + p.weight, 0);
    let acc = 0;
    for (const p of s) {
      acc += p.weight;
      if (acc >= total / 2) return p[key];
    }
    return s[s.length - 1][key];
  };
  return { x: med('x'), y: med('y') };
}

/**
 * The source rectangle to show for a given output shape. `fill` crops around
 * the focus point (content-aware crop); `fit` shows everything, letterboxed.
 */
export function cropRect(
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
  fit: 'fill' | 'fit',
  focusX: number,
  focusY: number,
): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
  if (fit === 'fit') {
    const s = Math.min(outW / srcW, outH / srcH);
    const dw = srcW * s;
    const dh = srcH * s;
    return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx: (outW - dw) / 2, dy: (outH - dh) / 2, dw, dh };
  }
  const s = Math.max(outW / srcW, outH / srcH);
  const sw = outW / s;
  const sh = outH / s;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const sx = clamp(focusX * srcW - sw / 2, 0, srcW - sw);
  const sy = clamp(focusY * srcH - sh / 2, 0, srcH - sh);
  return { sx, sy, sw, sh, dx: 0, dy: 0, dw: outW, dh: outH };
}
