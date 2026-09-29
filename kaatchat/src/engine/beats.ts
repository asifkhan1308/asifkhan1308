// Music analysis and timing: onsets (spectral flux), tempo (autocorrelation),
// beat grid, ducking envelope and beat-snapping of cuts. All pure.

import type { AudioAnalysis, AudioClip, Clip, TimeRange } from './types';
import { clipLength, clipStarts } from './timeline';

export interface BeatAnalysis {
  bpm: number;
  /** Beat times in SOURCE seconds of the music file. */
  beats: number[];
  /** How clearly periodic the onsets are, 0..1. Low = no steady beat. */
  confidence: number;
}

/** In-place radix-2 FFT (re/im arrays of power-of-two length). */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/**
 * Streaming spectral-flux onset detector. Push mono samples; `finish()`
 * returns the onset envelope at `rate` frames per second.
 */
export class OnsetDetector {
  private readonly size = 1024;
  private readonly hop: number;
  private buf: Float32Array;
  private fill = 0;
  private prev: Float64Array | null = null;
  private readonly win: Float64Array;
  readonly flux: number[] = [];
  readonly rate: number;
  constructor(readonly sampleRate: number) {
    this.hop = 512;
    this.rate = sampleRate / this.hop;
    this.buf = new Float32Array(this.size);
    this.win = new Float64Array(this.size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.size - 1)));
  }
  push(mono: Float32Array) {
    let i = 0;
    while (i < mono.length) {
      const take = Math.min(this.size - this.fill, mono.length - i);
      this.buf.set(mono.subarray(i, i + take), this.fill);
      this.fill += take;
      i += take;
      if (this.fill === this.size) {
        this.frame();
        this.buf.copyWithin(0, this.hop);
        this.fill = this.size - this.hop;
      }
    }
  }
  private frame() {
    const re = new Float64Array(this.size);
    const im = new Float64Array(this.size);
    for (let k = 0; k < this.size; k++) re[k] = this.buf[k] * this.win[k];
    fft(re, im);
    const half = this.size / 2;
    const mag = new Float64Array(half);
    for (let k = 0; k < half; k++) mag[k] = Math.log1p(10 * Math.hypot(re[k], im[k]));
    let f = 0;
    if (this.prev) for (let k = 0; k < half; k++) f += Math.max(0, mag[k] - this.prev[k]);
    this.prev = mag;
    this.flux.push(f);
  }
}

/** Tempo + beat grid from an onset envelope. */
export function estimateBeats(flux: readonly number[], rate: number, minBpm = 70, maxBpm = 180): BeatAnalysis | null {
  if (flux.length < rate * 4) return null;
  // Remove the local mean so sustained loudness does not look like onsets.
  const w = Math.max(1, Math.round(rate * 0.5));
  const env = flux.map((v, i) => {
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(flux.length - 1, i + w); k++) {
      s += flux[k];
      n++;
    }
    return Math.max(0, v - s / n);
  });
  const minLag = Math.floor((60 / maxBpm) * rate);
  const maxLag = Math.ceil((60 / minBpm) * rate);
  let energy = 0;
  for (const v of env) energy += v * v;
  if (energy === 0) return null;
  let bestLag = 0;
  let best = -Infinity;
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    // Gentle preference for tempos near 120 bpm (resolves half/double ambiguity).
    const bpm = (60 * rate) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const score = (s / energy) * prior;
    scores.push(score);
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const confidence = Math.max(0, Math.min(1, (best - mean) / (best + 1e-9)));
  const period = bestLag / rate;
  // Phase: the grid offset that lands on the most onset energy.
  let bestPhase = 0;
  let bestSum = -1;
  for (let p = 0; p < bestLag; p++) {
    let s = 0;
    for (let i = p; i < env.length; i += bestLag) s += env[i];
    if (s > bestSum) {
      bestSum = s;
      bestPhase = p;
    }
  }
  const beats: number[] = [];
  const dur = flux.length / rate;
  for (let t = bestPhase / rate; t < dur; t += period) beats.push(Math.round(t * 1000) / 1000);
  return { bpm: Math.round((60 / period) * 10) / 10, beats, confidence: Math.round(confidence * 100) / 100 };
}

/** Beat times on the TIMELINE, from every music clip that has a beat grid. */
export function timelineBeats(audio: readonly AudioClip[], beatsOf: (assetId: string) => BeatAnalysis | undefined): number[] {
  const out: number[] = [];
  for (const a of audio) {
    const b = beatsOf(a.assetId);
    if (!b) continue;
    for (const s of b.beats) if (s >= a.in && s <= a.out) out.push(a.start + (s - a.in));
  }
  return out.sort((x, y) => x - y);
}

/**
 * Move each cut onto the nearest beat within `window` seconds, by trimming
 * or extending the clip before the cut (never past its media). Returns the
 * new clips and how many cuts moved.
 */
export function snapCutsToBeats(clips: readonly Clip[], beats: readonly number[], window: number, assetDuration: (id: string) => number): { clips: Clip[]; moved: number } {
  const out = clips.map((c) => ({ ...c }));
  let moved = 0;
  if (beats.length === 0) return { clips: out, moved };
  for (let i = 0; i < out.length - 1; i++) {
    const cut = clipStarts(out)[i] + clipLength(out[i]);
    let near = beats[0];
    for (const b of beats) if (Math.abs(b - cut) < Math.abs(near - cut)) near = b;
    const delta = near - cut;
    if (Math.abs(delta) < 1e-3 || Math.abs(delta) > window) continue;
    const c = out[i];
    const nextOut = Math.min(assetDuration(c.assetId), c.out + delta);
    if (nextOut - c.in < 0.2) continue;
    if (Math.abs(nextOut - (c.out + delta)) > 1e-6) continue; // not enough media to extend
    c.out = nextOut;
    moved++;
  }
  return { clips: out, moved };
}

/**
 * Ducking: gain multiplier (dB) for music at timeline time `t`, from where
 * the main track has speech. Attack 80 ms, release 350 ms.
 */
export function speechRanges(clips: readonly Clip[], audioOf: (assetId: string) => AudioAnalysis | undefined, thresholdBelowP90 = -18): TimeRange[] {
  const starts = clipStarts(clips);
  const out: TimeRange[] = [];
  clips.forEach((c, i) => {
    const a = audioOf(c.assetId);
    if (!a || c.muted) return;
    const th = a.p90Db + thresholdBelowP90;
    let runStart = -1;
    const i0 = Math.floor(c.in * a.rate);
    const i1 = Math.ceil(c.out * a.rate);
    for (let k = i0; k <= i1; k++) {
      const loud = k < i1 && (a.rmsDb[k] ?? -100) > th;
      if (loud && runStart < 0) runStart = k;
      if (!loud && runStart >= 0) {
        out.push({ start: starts[i] + runStart / a.rate - c.in, end: starts[i] + k / a.rate - c.in });
        runStart = -1;
      }
    }
  });
  // Bridge short gaps between words.
  const merged: TimeRange[] = [];
  for (const r of out.sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end < 0.4) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

export function duckDbAt(t: number, speech: readonly TimeRange[], duckDb: number, attack = 0.08, release = 0.35): number {
  let amount = 0;
  for (const r of speech) {
    if (t >= r.start && t <= r.end) return duckDb;
    if (t < r.start && r.start - t < attack) amount = Math.max(amount, 1 - (r.start - t) / attack);
    if (t > r.end && t - r.end < release) amount = Math.max(amount, 1 - (t - r.end) / release);
    if (r.start > t + attack) break;
  }
  return duckDb * amount;
}

/** Linear fade multiplier for a clip at local time `x` (seconds from its start). */
export function fadeGain(x: number, len: number, fadeIn = 0, fadeOut = 0): number {
  let g = 1;
  if (fadeIn > 0 && x < fadeIn) g = Math.min(g, Math.max(0, x / fadeIn));
  if (fadeOut > 0 && x > len - fadeOut) g = Math.min(g, Math.max(0, (len - x) / fadeOut));
  return g;
}
