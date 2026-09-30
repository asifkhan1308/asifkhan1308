// Noise reduction DSP: exact pass-through, real noise removal, speech kept.
import { describe, expect, it } from 'vitest';
import { Denoiser, NoiseProfiler, type NoiseProfile } from '../../src/engine/denoise';

const SR = 48000;

/** Deterministic white noise. */
function noise(n: number, amp: number, seed = 1) {
  let s = seed;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = ((s / 2 ** 32) * 2 - 1) * amp * Math.sqrt(3);
  }
  return out;
}

const rmsDb = (x: Float32Array, a: number, b: number) => {
  let e = 0;
  for (let i = a; i < b; i++) e += x[i] * x[i];
  return 10 * Math.log10(e / (b - a) + 1e-20);
};

/** Feeds the signal in uneven chunks, like real decoders do. */
function run(d: Denoiser, x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  const sizes = [128, 1000, 37, 4096, 480, 1];
  let i = 0;
  for (let c = 0; i < x.length; c++) {
    const n = Math.min(sizes[c % sizes.length], x.length - i);
    const [l] = d.process([x.subarray(i, i + n), x.subarray(i, i + n)]);
    out.set(l, i);
    i += n;
  }
  return out;
}

describe('noise reduction', () => {
  it('passes audio through unchanged when there is no noise to remove, with a fixed delay', () => {
    const silentProfile: NoiseProfile = { sampleRate: SR, db: new Array(513).fill(-150) };
    const x = noise(SR, 0.3, 7);
    const y = run(new Denoiser(SR, silentProfile, 1), x);
    const L = Denoiser.latency;
    let maxErr = 0;
    for (let i = L; i < x.length; i++) maxErr = Math.max(maxErr, Math.abs(y[i] - x[i - L]));
    expect(maxErr).toBeLessThan(1e-5);
    for (let i = 0; i < L; i++) expect(Math.abs(y[i])).toBeLessThan(1e-9);
  });

  it('removes steady background noise and keeps the voice', () => {
    // 4 s: hiss throughout at -40 dBFS; a "voice" (two harmonics) from 1.5 s to 3 s.
    const n = 4 * SR;
    const x = noise(n, 0.01, 3);
    const v0 = Math.round(1.5 * SR);
    const v1 = 3 * SR;
    const voice = new Float32Array(n);
    for (let i = v0; i < v1; i++) voice[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / SR) + 0.1 * Math.sin((2 * Math.PI * 660 * i) / SR);
    for (let i = 0; i < n; i++) x[i] += voice[i];

    const prof = new NoiseProfiler(SR);
    prof.push(x);
    const profile = prof.finish()!;
    expect(profile.db).toHaveLength(513);

    const y = run(new Denoiser(SR, profile, 1), x);
    const L = Denoiser.latency;
    // Noise-only stretch: at least 15 dB quieter.
    const before = rmsDb(x, Math.round(0.3 * SR), SR);
    const after = rmsDb(y, Math.round(0.3 * SR) + L, SR + L);
    expect(before - after).toBeGreaterThan(15);
    // Voice stretch: level within 1 dB.
    const vBefore = rmsDb(x, v0 + 4800, v1 - 4800);
    const vAfter = rmsDb(y, v0 + 4800 + L, v1 - 4800 + L);
    expect(Math.abs(vBefore - vAfter)).toBeLessThan(1);
  });

  it('a lighter setting removes less', () => {
    const x = noise(2 * SR, 0.01, 5);
    const prof = new NoiseProfiler(SR);
    prof.push(x);
    const profile = prof.finish()!;
    const L = Denoiser.latency;
    const strong = rmsDb(run(new Denoiser(SR, profile, 1), x), SR / 2 + L, SR + L);
    const light = rmsDb(run(new Denoiser(SR, profile, 0.2), x), SR / 2 + L, SR + L);
    expect(light).toBeGreaterThan(strong + 5);
  });

  it('works when the preview runs at another sample rate than the profile', () => {
    const x44 = noise(2 * 44100, 0.01, 9);
    const prof = new NoiseProfiler(48000);
    prof.push(noise(2 * SR, 0.01, 11));
    const y = run(new Denoiser(44100, prof.finish()!, 1), x44);
    const L = Denoiser.latency;
    expect(rmsDb(x44, 22050, 44100) - rmsDb(y, 22050 + L, 44100 + L)).toBeGreaterThan(12);
  });

  it('needs enough sound to measure, and ignores digital silence', () => {
    const p = new NoiseProfiler(SR);
    p.push(new Float32Array(10 * SR));
    expect(p.finish()).toBeNull();
    const q = new NoiseProfiler(SR);
    q.push(noise(SR / 10, 0.01));
    expect(q.finish()).toBeNull();
  });
});

describe('noise reduction as an edit', () => {
  const profile: NoiseProfile = { sampleRate: 48000, db: new Array(513).fill(-60) };

  it('is one undoable command, per clip or for all clips', async () => {
    const { EditorStore } = await import('../../src/engine/store');
    const { asset, clip, doc, projectOf } = await import('./helpers');
    const s = new EditorStore(projectOf(doc([clip('c1', 'A', 0, 5), clip('c2', 'A', 5, 9)], [asset('A', 10)])), { A: { noise: profile } });
    s.run([{ type: 'reduce_noise', strength: 0.6, clipIds: ['c2'] }], 'Reduce noise');
    expect(s.doc.clips.map((c) => c.denoise)).toEqual([undefined, 0.6]);
    s.run([{ type: 'reduce_noise', strength: 0.9 }], 'Reduce noise');
    expect(s.doc.clips.map((c) => c.denoise)).toEqual([0.9, 0.9]);
    s.run([{ type: 'reduce_noise', strength: 0 }], 'Off');
    expect(s.doc.clips.map((c) => c.denoise)).toEqual([undefined, undefined]);
    s.undo();
    expect(s.doc.clips.map((c) => c.denoise)).toEqual([0.9, 0.9]);
  });

  it('says when a clip still needs its noise measured, and refuses clips without sound', async () => {
    const { applyCommand } = await import('../../src/engine/commands/execute');
    const { asset, clip, doc } = await import('./helpers');
    const view = doc([clip('c1', 'A', 0, 5)], [asset('A', 10)]);
    const r = applyCommand(view, { type: 'reduce_noise', strength: 0.6 }, { index: {}, newId: () => 'x' } as never);
    expect(r.notes.join(' ')).toMatch(/will be cleaned once the background noise is measured/);
    const silent = doc([clip('c1', 'S', 0, 5)], [asset('S', 10, { hasAudio: false })]);
    expect(() => applyCommand(silent, { type: 'reduce_noise', strength: 0.6 }, { index: {}, newId: () => 'x' } as never)).toThrow(/no clips with sound/);
  });

  it('the built-in assistant understands it, and a talking-head clean-up includes it', async () => {
    const { rulePlan } = await import('../../src/ai/planner');
    const { asset, clip, doc } = await import('./helpers');
    const view = doc([clip('c1', 'A', 0, 5)], [asset('A', 10)]);
    expect(rulePlan('remove the background noise', view, {}, 0)!.commands).toContainEqual({ type: 'reduce_noise', strength: 0.6 });
    expect(rulePlan('reduce the hiss a bit', view, {}, 0)!.commands).toContainEqual({ type: 'reduce_noise', strength: 0.3 });
    expect(rulePlan('turn off noise reduction', view, {}, 0)!.commands).toContainEqual({ type: 'reduce_noise', strength: 0 });
    expect(rulePlan('clean up this talking head', view, {}, 0)!.commands.map((c) => c.type)).toContain('reduce_noise');
  });

  it('voice isolation is its own mode, needs no measurement, and switching back clears it', async () => {
    const { EditorStore } = await import('../../src/engine/store');
    const { applyCommand } = await import('../../src/engine/commands/execute');
    const { validatePlan } = await import('../../src/engine/commands/schema');
    const { asset, clip, doc, projectOf } = await import('./helpers');
    const s = new EditorStore(projectOf(doc([clip('c1', 'A', 0, 5)], [asset('A', 10)])), {});
    s.run([{ type: 'reduce_noise', strength: 0.9, mode: 'voice' }], 'Isolate voice');
    expect(s.doc.clips[0]).toMatchObject({ denoise: 0.9, denoiseMode: 'voice' });
    s.run([{ type: 'reduce_noise', strength: 0.6 }], 'Reduce noise');
    expect(s.doc.clips[0].denoise).toBe(0.6);
    expect('denoiseMode' in s.doc.clips[0]).toBe(false);
    s.run([{ type: 'reduce_noise', strength: 0, mode: 'voice' }], 'Off');
    expect('denoise' in s.doc.clips[0] || 'denoiseMode' in s.doc.clips[0]).toBe(false);
    // Unmeasured files are fine for voice isolation.
    const r = applyCommand(doc([clip('c1', 'A', 0, 5)], [asset('A', 10)]), { type: 'reduce_noise', strength: 0.6, mode: 'voice' }, { index: {}, newId: () => 'x' } as never);
    expect(r.notes.join(' ')).toMatch(/Voice isolation 60% on 1 clip/);
    expect(r.notes.join(' ')).not.toMatch(/measured/);
    // AI plans may ask for it; anything else is rejected.
    expect(validatePlan({ summary: 's', commands: [{ type: 'reduce_noise', strength: 1, mode: 'voice' }] }).ok).toBe(true);
    expect(validatePlan({ summary: 's', commands: [{ type: 'reduce_noise', strength: 1, mode: 'magic' }] }).ok).toBe(false);
  });

  it('the built-in assistant picks voice isolation for noise that comes and goes', async () => {
    const { rulePlan } = await import('../../src/ai/planner');
    const { asset, clip, doc } = await import('./helpers');
    const view = doc([clip('c1', 'A', 0, 5)], [asset('A', 10)]);
    for (const ask of ['remove the traffic noise', 'get rid of the keyboard typing', 'isolate my voice', 'remove the background music behind me', 'cut the wind noise'])
      expect(rulePlan(ask, view, {}, 0)!.commands, ask).toContainEqual({ type: 'reduce_noise', strength: 0.6, mode: 'voice' });
    expect(rulePlan('remove the hiss', view, {}, 0)!.commands).toContainEqual({ type: 'reduce_noise', strength: 0.6 });
  });
});
