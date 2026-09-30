// Background-noise reduction for voice: spectral gating against a measured
// noise profile. Pure and streaming, so the same code runs in the preview
// (an AudioWorklet) and in export (the mixer), and they sound the same.
//
// Profile: while loudness is measured, every 1024-sample frame's power
// spectrum goes into a per-bin histogram (in dB). The noise floor of each bin
// is its 10th percentile: steady noise (hiss, hum, fans, room tone) is present
// in nearly every frame, speech is not. Memory is fixed, whatever the length.
//
// Reduction: 50%-overlap STFT with sqrt-Hann analysis and synthesis windows
// (perfect reconstruction when nothing is removed). Each bin's gain comes from
// power subtraction with a floor, smoothed across neighbouring bins and over
// time to avoid "musical noise". Both channels get the same gains, so the
// stereo image does not move.

import { fft } from './beats';

export const DENOISE_FFT = 1024;
const HOP = DENOISE_FFT / 2;
const BINS = DENOISE_FFT / 2 + 1;
const DB_MIN = -150;
const DB_STEP = 1;
const DB_SLOTS = 150;

export interface NoiseProfile {
  sampleRate: number;
  /** Noise power per FFT bin (0 … Nyquist), in dB, for a 1024-point sqrt-Hann frame. */
  db: number[];
}

const sqrtHann = (() => {
  const w = new Float64Array(DENOISE_FFT);
  for (let i = 0; i < DENOISE_FFT; i++) w[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / DENOISE_FFT));
  return w;
})();

/** Accumulates the per-bin noise floor of a mono signal. */
export class NoiseProfiler {
  private hist = new Uint32Array(BINS * DB_SLOTS);
  private buf = new Float32Array(DENOISE_FFT);
  private fill = 0;
  private frames = 0;
  private re = new Float64Array(DENOISE_FFT);
  private im = new Float64Array(DENOISE_FFT);
  constructor(readonly sampleRate: number) {}

  push(mono: Float32Array) {
    let i = 0;
    while (i < mono.length) {
      const take = Math.min(DENOISE_FFT - this.fill, mono.length - i);
      this.buf.set(mono.subarray(i, i + take), this.fill);
      this.fill += take;
      i += take;
      if (this.fill === DENOISE_FFT) {
        this.frame();
        this.buf.copyWithin(0, HOP);
        this.fill = DENOISE_FFT - HOP;
      }
    }
  }

  private frame() {
    const { re, im } = this;
    let energy = 0;
    for (let k = 0; k < DENOISE_FFT; k++) {
      re[k] = this.buf[k] * sqrtHann[k];
      im[k] = 0;
      energy += this.buf[k] * this.buf[k];
    }
    // Digital silence (gaps, padding) says nothing about the noise.
    if (energy < 1e-12) return;
    fft(re, im);
    for (let k = 0; k < BINS; k++) {
      const db = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-20);
      const slot = Math.max(0, Math.min(DB_SLOTS - 1, Math.floor((db - DB_MIN) / DB_STEP)));
      this.hist[k * DB_SLOTS + slot]++;
    }
    this.frames++;
  }

  /** The profile, or null when there was too little sound to measure (under ~0.5 s). */
  finish(percentile = 0.1): NoiseProfile | null {
    if (this.frames < 40) return null;
    const want = Math.max(1, Math.round(this.frames * percentile));
    // A noise bin's power per frame is exponentially distributed, so its p-th
    // percentile sits at -ln(1-p) × the mean (−9.8 dB for p = 0.1). Undo that bias.
    const bias = 10 * Math.log10(1 / -Math.log(1 - percentile));
    const db: number[] = [];
    for (let k = 0; k < BINS; k++) {
      let acc = 0;
      let s = 0;
      for (; s < DB_SLOTS; s++) {
        acc += this.hist[k * DB_SLOTS + s];
        if (acc >= want) break;
      }
      db.push(Math.round((DB_MIN + (s + 0.5) * DB_STEP + bias) * 10) / 10);
    }
    return { sampleRate: this.sampleRate, db };
  }
}

/** Noise power per bin for processing at `sampleRate`, interpolated by frequency. */
function profilePower(profile: NoiseProfile, sampleRate: number): Float64Array {
  const out = new Float64Array(BINS);
  const srcBinHz = profile.sampleRate / DENOISE_FFT;
  for (let k = 0; k < BINS; k++) {
    const f = (k * sampleRate) / DENOISE_FFT;
    const x = Math.min(profile.db.length - 1, f / srcBinHz);
    const i = Math.floor(x);
    const t = x - i;
    const db = i + 1 < profile.db.length ? profile.db[i] * (1 - t) + profile.db[i + 1] * t : profile.db[profile.db.length - 1];
    out[k] = Math.pow(10, db / 10);
  }
  return out;
}

/** 0 = off, 1 = strongest. Maps to how far noise is pushed down and how hard. */
export function denoiseParams(strength: number) {
  const s = Math.max(0, Math.min(1, strength));
  return { floor: Math.pow(10, -(6 + 18 * s) / 20), over: 1 + 1.5 * s };
}

/**
 * Streaming stereo denoiser. `process` takes any number of samples and returns
 * the same number, delayed by exactly `latency` samples (the first `latency`
 * output samples are silence). The delay is constant whatever the chunk sizes.
 */
export class Denoiser {
  /** One hop of zero prefix plus one hop of ready-queue slack, so a request never outruns the frames. */
  static readonly latency = 2 * HOP;
  readonly latency = Denoiser.latency;
  private noise: Float64Array;
  private floor: number;
  private over: number;
  private inBuf: Float32Array[];
  private outAcc: Float64Array[];
  private fill = 0;
  private gains = new Float64Array(BINS).fill(1);
  private ready: Float32Array[][];
  private readyLen = HOP;
  private re: Float64Array[];
  private im: Float64Array[];

  constructor(
    sampleRate: number,
    profile: NoiseProfile,
    strength: number,
    private channels = 2,
  ) {
    this.noise = profilePower(profile, sampleRate);
    ({ floor: this.floor, over: this.over } = denoiseParams(strength));
    this.inBuf = Array.from({ length: channels }, () => new Float32Array(DENOISE_FFT));
    this.outAcc = Array.from({ length: channels }, () => new Float64Array(DENOISE_FFT));
    this.re = Array.from({ length: channels }, () => new Float64Array(DENOISE_FFT));
    this.im = Array.from({ length: channels }, () => new Float64Array(DENOISE_FFT));
    this.fill = HOP;
    this.ready = Array.from({ length: channels }, () => [new Float32Array(HOP)]);
  }

  setStrength(strength: number) {
    ({ floor: this.floor, over: this.over } = denoiseParams(strength));
  }

  process(planes: Float32Array[]): Float32Array[] {
    const n = planes[0].length;
    let i = 0;
    while (i < n) {
      const take = Math.min(DENOISE_FFT - this.fill, n - i);
      for (let ch = 0; ch < this.channels; ch++) this.inBuf[ch].set((planes[ch] ?? planes[0]).subarray(i, i + take), this.fill);
      this.fill += take;
      i += take;
      if (this.fill === DENOISE_FFT) {
        this.frame();
        for (let ch = 0; ch < this.channels; ch++) this.inBuf[ch].copyWithin(0, HOP);
        this.fill = DENOISE_FFT - HOP;
      }
    }
    return this.take(n);
  }

  private frame() {
    const C = this.channels;
    for (let ch = 0; ch < C; ch++) {
      const re = this.re[ch];
      const im = this.im[ch];
      const x = this.inBuf[ch];
      for (let k = 0; k < DENOISE_FFT; k++) {
        re[k] = x[k] * sqrtHann[k];
        im[k] = 0;
      }
      fft(re, im);
    }
    // Gains from the channel-average power.
    const g = new Float64Array(BINS);
    for (let k = 0; k < BINS; k++) {
      let p = 0;
      for (let ch = 0; ch < C; ch++) p += this.re[ch][k] * this.re[ch][k] + this.im[ch][k] * this.im[ch][k];
      p /= C;
      g[k] = Math.max(this.floor, p > 0 ? 1 - (this.over * this.noise[k]) / p : this.floor);
    }
    // Across frequency: a 3-bin average, so isolated bins do not "twinkle".
    const s = new Float64Array(BINS);
    for (let k = 0; k < BINS; k++) s[k] = (g[Math.max(0, k - 1)] + g[k] + g[Math.min(BINS - 1, k + 1)]) / 3;
    // Over time: open quickly for speech onsets, close more slowly.
    for (let k = 0; k < BINS; k++) {
      const prev = this.gains[k];
      this.gains[k] = s[k] > prev ? 0.3 * prev + 0.7 * s[k] : 0.7 * prev + 0.3 * s[k];
    }
    for (let ch = 0; ch < C; ch++) {
      const re = this.re[ch];
      const im = this.im[ch];
      for (let k = 0; k < BINS; k++) {
        re[k] *= this.gains[k];
        im[k] *= this.gains[k];
        if (k > 0 && k < BINS - 1) {
          re[DENOISE_FFT - k] = re[k];
          im[DENOISE_FFT - k] = -im[k];
        }
      }
      // Inverse FFT via conjugation.
      for (let k = 0; k < DENOISE_FFT; k++) im[k] = -im[k];
      fft(re, im);
      const acc = this.outAcc[ch];
      for (let k = 0; k < DENOISE_FFT; k++) acc[k] += (re[k] / DENOISE_FFT) * sqrtHann[k];
      // The first hop is final (both overlapping frames have been added).
      const done = new Float32Array(HOP);
      for (let k = 0; k < HOP; k++) done[k] = acc[k];
      acc.copyWithin(0, HOP);
      acc.fill(0, HOP);
      this.ready[ch].push(done);
    }
    this.readyLen += HOP;
  }

  /** Exactly n samples per channel. Always available: cumulative output never lags input by more than the slack. */
  private take(n: number): Float32Array[] {
    const out: Float32Array[] = [];
    for (let ch = 0; ch < this.channels; ch++) {
      const q = this.ready[ch];
      const o = new Float32Array(n);
      let at = 0;
      while (at < n && q.length) {
        const head = q[0];
        const k = Math.min(n - at, head.length);
        o.set(head.subarray(0, k), at);
        at += k;
        if (k === head.length) q.shift();
        else q[0] = head.subarray(k);
      }
      out.push(o);
    }
    this.readyLen -= n;
    return out;
  }
}
