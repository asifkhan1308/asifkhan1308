// Voice isolation (RNNoise): fixed delay, removes noise that comes and goes
// (which the spectral filter cannot), keeps speech.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Denoiser, NoiseProfiler } from '../../src/engine/denoise';
import { loadRnnoise, VoiceDenoiser } from '../../src/engine/voiceDenoise';

const SR = 48000;

/** Traffic-like noise: low rumble plus hiss that swells and fades every 0.35 s. */
function changingNoise(n: number, seed = 3) {
  let s = seed;
  let lp = 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const w = (s / 2 ** 32) * 2 - 1;
    lp = 0.97 * lp + 0.03 * w;
    out[i] = (0.25 * lp + 0.02 * w) * (Math.floor(i / (0.35 * SR)) % 2 ? 1 : 0.15);
  }
  return out;
}

const rmsDb = (x: Float32Array, a: number, b: number) => {
  let e = 0;
  for (let i = a; i < b; i++) e += x[i] * x[i];
  return 10 * Math.log10(e / (b - a) + 1e-20);
};

function run(d: { process(p: Float32Array[]): Float32Array[] }, x: Float32Array, sizes = [128, 1000, 37, 4096, 480, 1]) {
  const out = new Float32Array(x.length);
  for (let i = 0, c = 0; i < x.length; c++) {
    const n = Math.min(sizes[c % sizes.length], x.length - i);
    out.set(d.process([x.subarray(i, i + n), x.subarray(i, i + n)])[0], i);
    i += n;
  }
  return out;
}

/** Real synthesized speech at 48 kHz mono, or null where espeak-ng is missing. */
function speech(): Float32Array | null {
  const dir = mkdtempSync(join(tmpdir(), 'kc-voice-'));
  const wav = join(dir, 's.wav');
  const raw = join(dir, 's.f32');
  if (spawnSync('espeak-ng', ['-v', 'en-us', '-s', '140', '-w', wav, 'Hello world. This is a test of the video editor.']).status !== 0) return null;
  if (spawnSync(process.env.FFMPEG || 'ffmpeg', ['-v', 'error', '-y', '-i', wav, '-ar', '48000', '-ac', '1', '-f', 'f32le', raw]).status !== 0) return null;
  const b = readFileSync(raw);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
}

describe('voice isolation', () => {
  it('at strength 0 it is an exact pass-through, delayed by its fixed latency, whatever the chunk sizes', async () => {
    const m = await loadRnnoise();
    const x = changingNoise(SR);
    const y = run(new VoiceDenoiser(m, 0), x);
    const L = VoiceDenoiser.latency;
    let err = 0;
    for (let i = L; i < x.length; i++) err = Math.max(err, Math.abs(y[i] - x[i - L]));
    expect(err).toBeLessThan(1e-6);
    for (let i = 0; i < L; i++) expect(y[i]).toBe(0);
  });

  it('gives the same output however the audio is chunked', async () => {
    const m = await loadRnnoise();
    const x = changingNoise(SR / 2, 9);
    const a = run(new VoiceDenoiser(m, 0.8), x, [128]);
    const b = run(new VoiceDenoiser(m, 0.8), x, [4096, 7, 333]);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('removes noise that comes and goes, which the steady-noise filter cannot', async () => {
    const m = await loadRnnoise();
    const x = changingNoise(3 * SR);
    const before = rmsDb(x, SR / 2, 3 * SR - 2000);
    const voice = run(new VoiceDenoiser(m, 1), x);
    const L = VoiceDenoiser.latency;
    expect(before - rmsDb(voice, SR / 2 + L, 3 * SR)).toBeGreaterThan(25);

    const p = new NoiseProfiler(SR);
    p.push(x);
    const steady = run(new Denoiser(SR, p.finish()!, 1), x);
    expect(before - rmsDb(steady, SR / 2 + Denoiser.latency, 3 * SR)).toBeLessThan(10);
  });

  it('a lighter setting removes less', async () => {
    const m = await loadRnnoise();
    const x = changingNoise(2 * SR, 5);
    const L = VoiceDenoiser.latency;
    const strong = rmsDb(run(new VoiceDenoiser(m, 1), x), SR / 2 + L, 2 * SR);
    const light = rmsDb(run(new VoiceDenoiser(m, 0.3), x), SR / 2 + L, 2 * SR);
    expect(light).toBeGreaterThan(strong + 6);
  });

  it('keeps real speech while removing the noise around it', async (ctx) => {
    const sp = speech();
    if (!sp) return ctx.skip();
    const m = await loadRnnoise();
    const pad = SR;
    const n = sp.length + 2 * pad;
    const noise = changingNoise(n);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = noise[i] + (i >= pad && i < pad + sp.length ? sp[i - pad] : 0);
    const y = run(new VoiceDenoiser(m, 1), x);
    const L = VoiceDenoiser.latency;
    // The noise-only lead-in is gone…
    expect(rmsDb(x, 2000, pad - 2000) - rmsDb(y, 2000 + L, pad - 2000 + L)).toBeGreaterThan(25);
    // …and the speech keeps its level (within 3 dB of the clean voice).
    expect(Math.abs(rmsDb(sp, 0, sp.length) - rmsDb(y, pad + L, pad + sp.length + L))).toBeLessThan(3);
  });
});
