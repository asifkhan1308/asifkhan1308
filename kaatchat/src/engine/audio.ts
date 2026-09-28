// Streaming audio helpers shared by export and transcription. Pure maths.

import { fromDb } from './dsp';

/**
 * Linear-interpolating resampler that can be fed arbitrary chunks. Keeps
 * state between pushes so chunk boundaries do not click.
 */
export class StreamResampler {
  private pos = 0; // fractional read position in the current input stream
  private last: number[]; // previous input frame, per channel
  private readonly ratio: number;
  constructor(
    readonly inRate: number,
    readonly outRate: number,
    readonly channels: number,
  ) {
    this.ratio = inRate / outRate;
    this.last = new Array(channels).fill(0);
  }

  /** Push planar input; returns planar output at `outRate`. */
  push(input: Float32Array[]): Float32Array[] {
    const n = input[0]?.length ?? 0;
    if (n === 0) return Array.from({ length: this.channels }, () => new Float32Array(0));
    // Virtual stream: index -1 is `last`, 0..n-1 is input.
    const outCount = Math.max(0, Math.floor((n - 1 - this.pos) / this.ratio) + 1);
    const out = Array.from({ length: this.channels }, () => new Float32Array(outCount));
    for (let k = 0; k < outCount; k++) {
      const p = this.pos + k * this.ratio;
      const i = Math.floor(p);
      const f = p - i;
      for (let ch = 0; ch < this.channels; ch++) {
        const src = input[ch] ?? input[0];
        const a = i < 0 ? this.last[ch] : src[i];
        const b = i + 1 < n ? src[i + 1] : src[n - 1];
        out[ch][k] = a + (b - a) * f;
      }
    }
    this.pos = this.pos + outCount * this.ratio - n;
    for (let ch = 0; ch < this.channels; ch++) this.last[ch] = (input[ch] ?? input[0])[n - 1];
    return out;
  }
}

/** Map any channel layout to `want` channels (mono is duplicated; extra channels dropped). */
export function mapChannels(planes: Float32Array[], want: number): Float32Array[] {
  if (want === 1) {
    if (planes.length === 1) return [planes[0]];
    const m = new Float32Array(planes[0].length);
    for (const p of planes) for (let i = 0; i < m.length; i++) m[i] += p[i] / planes.length;
    return [m];
  }
  return Array.from({ length: want }, (_, i) => planes[Math.min(i, planes.length - 1)]);
}

/** Apply gain with a soft knee above 0.9 so boosted clips do not hard-clip. */
export function applyGain(planes: Float32Array[], gainDb: number): void {
  const g = fromDb(gainDb);
  if (Math.abs(gainDb) < 0.01) return;
  for (const p of planes) {
    for (let i = 0; i < p.length; i++) {
      let v = p[i] * g;
      const a = Math.abs(v);
      if (a > 0.9) v = Math.sign(v) * (0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1));
      p[i] = v;
    }
  }
}

/** Copy planes of an AudioBuffer-like object. */
export function planesOf(buf: { numberOfChannels: number; getChannelData(ch: number): Float32Array }): Float32Array[] {
  return Array.from({ length: buf.numberOfChannels }, (_, ch) => buf.getChannelData(ch));
}
