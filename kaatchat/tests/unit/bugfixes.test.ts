// Regression tests for the seven reported bugs and the hardening that came with them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorStore } from '../../src/engine/store';
import { reviveProject, toView } from '../../src/engine/project';
import { clampOverlays, clampProjectOverlays, MIN_OVERLAY, sequenceDuration } from '../../src/engine/timeline';
import { nearestAspect, shapeDiffers } from '../../src/engine/types';
import { textOverlay } from '../../src/engine/overlays';
import { JobQueue, activeJobCount } from '../../src/engine/jobs';
import { speechModelError } from '../../src/engine/media';
import { providerFetch, httpError } from '../../src/ai/transport';
import { AIError, redactSecrets, rememberSecret } from '../../src/ai/types';
import { asset, clip, doc, projectOf } from './helpers';

// ---------------------------------------------------------------- bug 3: aspect from the footage

describe('vertical video detection (bug 3)', () => {
  it('maps a source size to the nearest canvas preset', () => {
    expect(nearestAspect(720, 1280)).toBe('9:16');
    expect(nearestAspect(1080, 1920)).toBe('9:16');
    expect(nearestAspect(1920, 1080)).toBe('16:9');
    expect(nearestAspect(1280, 720)).toBe('16:9');
    expect(nearestAspect(1080, 1080)).toBe('1:1');
    expect(nearestAspect(1080, 1350)).toBe('4:5');
    expect(nearestAspect(0, 0)).toBeNull(); // audio
  });

  it('knows when filling a canvas would crop noticeably', () => {
    expect(shapeDiffers(720, 1280, '9:16')).toBe(false);
    expect(shapeDiffers(1920, 1080, '9:16')).toBe(true);
    expect(shapeDiffers(1920, 1080, '16:9')).toBe(false);
    expect(shapeDiffers(0, 0, '16:9')).toBe(false);
  });

  it('a vertical first clip makes a 9:16 edit, filled; a landscape one keeps 16:9', () => {
    const v = new EditorStore(projectOf(doc([], [])));
    v.addAsset(asset('V', 8, { width: 720, height: 1280 }));
    expect(v.doc.aspect).toBe('9:16');
    expect(v.doc.clips[0].fit).toBe('fill');

    const l = new EditorStore(projectOf(doc([], [])));
    l.addAsset(asset('L', 8));
    expect(l.doc.aspect).toBe('16:9');
    expect(l.doc.clips[0].fit).toBe('fill');
  });

  it('a later clip of another shape is letterboxed, not cropped, and does not change the canvas', () => {
    const s = new EditorStore(projectOf(doc([], [])));
    s.addAsset(asset('V', 8, { width: 720, height: 1280 }));
    s.addAsset(asset('L', 5, { width: 1920, height: 1080 }));
    s.addAsset(asset('V2', 4, { width: 1080, height: 1920 }));
    expect(s.doc.aspect).toBe('9:16');
    expect(s.doc.clips.map((c) => c.fit)).toEqual(['fill', 'fit', 'fill']);
  });

  it('audio, and assets kept off the timeline, never change the canvas', () => {
    const s = new EditorStore(projectOf(doc([], [])));
    s.addAsset(asset('M', 30, { kind: 'audio', width: 0, height: 0 }));
    s.addAsset(asset('Logo', 0, { kind: 'image', width: 500, height: 500 }), false);
    expect(s.doc.aspect).toBe('16:9');
    s.addAsset(asset('V', 8, { width: 720, height: 1280 }));
    expect(s.doc.aspect).toBe('9:16');
  });

  it('one undo removes the clip and restores the previous canvas', () => {
    const s = new EditorStore(projectOf(doc([], [])));
    s.addAsset(asset('V', 8, { width: 720, height: 1280 }));
    s.undo();
    expect(s.doc.aspect).toBe('16:9');
    expect(s.doc.clips).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- bug 4: layers inside the edit

describe('timeline-duration clamping (bug 4)', () => {
  const t = (id: string, start: number, duration: number) => textOverlay(id, id, start, duration);

  it('clamps an end past the timeline, keeping the start', () => {
    const [o] = clampOverlays([t('a', 2, 3)], 4);
    expect(o.start).toBe(2);
    expect(o.duration).toBeCloseTo(2);
  });

  it('pulls a layer that starts past the end back inside, never negative', () => {
    const [o] = clampOverlays([t('a', 9, 3)], 4);
    expect(o.start).toBeCloseTo(1);
    expect(o.start + o.duration).toBeCloseTo(4);
    const [p] = clampOverlays([t('b', -2, 10)], 4);
    expect(p.start).toBe(0);
    expect(p.duration).toBeCloseTo(4);
  });

  it('never produces a zero or negative length', () => {
    const [o] = clampOverlays([t('a', 3.99, 0)], 4);
    expect(o.duration).toBeCloseTo(MIN_OVERLAY);
    expect(o.start + o.duration).toBeLessThanOrEqual(4 + 1e-9);
  });

  it('returns the same array when nothing changes, and leaves an empty timeline alone', () => {
    const list = [t('a', 0, 2)];
    expect(clampOverlays(list, 4)).toBe(list);
    const late = [t('a', 10, 2)];
    expect(clampOverlays(late, 0)).toBe(late);
  });

  it('every edit that shortens the timeline shortens layers with it; undo restores them', () => {
    const base = { ...doc([clip('c1', 'A', 0, 10)], [asset('A', 10)]), overlays: [t('title', 6, 4)] };
    const s = new EditorStore(projectOf(base));
    s.run([{ type: 'trim_clip', clipId: 'c1', in: 0, out: 7 }], 'Trim');
    const o = s.doc.overlays[0];
    expect(sequenceDuration(s.doc.clips)).toBeCloseTo(7);
    expect(o.start + o.duration).toBeCloseTo(7);
    s.undo();
    expect(s.doc.overlays[0]).toMatchObject({ start: 6, duration: 4 });
  });

  it('manually created layers follow the same rule', () => {
    const s = new EditorStore(projectOf(doc([clip('c1', 'A', 0, 5)], [asset('A', 5)])));
    s.mutate('Add text', (v) => ({ ...v, overlays: [...v.overlays, t('late', 4, 3)] }));
    const o = s.doc.overlays[0];
    expect(o.start + o.duration).toBeCloseTo(5);
    expect(o.duration).toBeGreaterThan(0);
  });

  it('projects saved before the fix are clamped when opened', () => {
    const view = { ...doc([clip('c1', 'A', 0, 4)], [asset('A', 4)]), overlays: [t('old', 2, 5)] };
    const raw = JSON.parse(JSON.stringify(projectOf(view)));
    const o = toView(reviveProject(raw)).overlays[0];
    expect(o.start + o.duration).toBeCloseTo(4);
    const p = projectOf(doc([clip('c1', 'A', 0, 4)], [asset('A', 4)]));
    expect(clampProjectOverlays(p)).toBe(p);
  });
});

// ---------------------------------------------------------------- bugs 1–2: processing state

describe('processing state (bugs 1–2)', () => {
  it('counts only queued and running jobs as processing', () => {
    const base = { id: 'x', label: 'x', group: 'g', progress: null };
    expect(
      activeJobCount([
        { ...base, state: 'running' },
        { ...base, state: 'queued' },
        { ...base, state: 'done' },
        { ...base, state: 'failed' },
        { ...base, state: 'cancelled' },
      ]),
    ).toBe(2);
  });

  it('whenSettled resolves for success, failure and cancellation — nothing can stay stuck', async () => {
    const q = new JobQueue(1);
    const ok = q.add('ok', 'g', async () => undefined).id;
    const bad = q.add('bad', 'g', async () => {
      throw new Error('decoder broke');
    }).id;
    const slow = q.add('slow', 'g', (ctl) => new Promise((_, reject) => ctl.signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))));
    const waiting = q.add('never started', 'g', async () => undefined).id;
    q.cancel(waiting);
    setTimeout(() => q.cancel(slow.id), 10);
    const settled = await q.whenSettled([ok, bad, slow.id, waiting]);
    expect(settled.map((j) => j.state)).toEqual(['done', 'failed', 'cancelled', 'cancelled']);
    expect(settled[1].error).toBe('decoder broke');
    expect(activeJobCount(q.getSnapshot())).toBe(0);
  });

  it('unknown job ids count as settled', async () => {
    expect(await new JobQueue().whenSettled(['nope'])).toEqual([]);
  });
});

// ---------------------------------------------------------------- Whisper failure messages

describe('speech model errors', () => {
  it('turns download failures into actionable advice', () => {
    for (const m of ['Failed to fetch', 'net::ERR_INTERNET_DISCONNECTED', 'Could not locate file: config.json', 'download stalled — nothing received for 120s']) {
      const text = speechModelError('onnx-community/whisper-base', m);
      expect(text).toMatch(/Couldn't download the speech model “onnx-community\/whisper-base”/);
      expect(text).toMatch(/internet connection or firewall/);
      expect(text).toMatch(/\.srt\/\.vtt/);
    }
  });
  it('keeps other failures as they are', () => {
    expect(speechModelError('m', 'out of memory')).toBe('Transcription failed: out of memory');
  });
});

// ---------------------------------------------------------------- AI providers: timeouts and keys

describe('AI provider transport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a provider that never answers times out with a clear error', async () => {
    vi.stubGlobal('fetch', (_u: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    await expect(providerFetch('local', 40)('http://localhost:11434/api/chat')).rejects.toMatchObject({ kind: 'timeout', message: expect.stringMatching(/didn't respond within/) });
  });

  it('a cancel by the person is still a cancel, not a timeout', async () => {
    vi.stubGlobal('fetch', (_u: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    const ac = new AbortController();
    const p = providerFetch('local', 5_000)('http://localhost:11434/api/chat', { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('keys never reach a message, even when a provider echoes one back', async () => {
    rememberSecret('my-very-secret-key-123');
    expect(redactSecrets('bad key my-very-secret-key-123 here')).toBe('bad key [key hidden] here');
    expect(redactSecrets('Incorrect API key provided: sk-proj-abc123***xyz9')).not.toMatch(/sk-/);
    expect(redactSecrets('key AIzaSyA1234567890abcdef rejected')).not.toMatch(/AIza/);
    expect(redactSecrets('Authorization: Bearer abc.def.ghi')).not.toMatch(/abc\.def/);
    const res = new Response(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-proj-XYZ987654***abcd' } }), { status: 401 });
    const err = await httpError(res, 'OpenAI');
    expect(err).toBeInstanceOf(AIError);
    expect(err.kind).toBe('auth');
    expect(err.message).toMatch(/OpenAI rejected the API key/);
    expect(err.message).not.toMatch(/sk-proj/);
  });
});
