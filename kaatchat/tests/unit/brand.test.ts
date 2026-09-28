import { describe, expect, it } from 'vitest';
import { applyBrand, defaultBrand } from '../../src/engine/brand';
import { audioOffset } from '../../src/engine/multicam';
import { applyCommand } from '../../src/engine/commands/execute';
import { rulePlan } from '../../src/ai/planner';
import { textOverlay } from '../../src/engine/overlays';
import { sequenceDuration } from '../../src/engine/timeline';
import { ANALYSIS_RATE, loudestShareDb, percentile } from '../../src/engine/dsp';
import type { AudioAnalysis, ProjectIndex } from '../../src/engine/types';
import { asset, clip, doc, envelope, seqId } from './helpers';

const assets = [asset('A', 30), asset('LOGO', 5, { kind: 'image', hasAudio: false }), asset('INTRO', 2)];
const base = { ...doc([clip('c', 'A', 0, 10)], assets), overlays: [textOverlay('t', 'Hi', 1, 2)] };
const brand = {
  ...defaultBrand(),
  logoAssetId: 'LOGO',
  introAssetId: 'INTRO',
  font: 'JetBrains Mono',
  captionStyle: 'kinetic' as const,
  colors: { ink: '#111111', paper: '#FFFFFF', accent: '#FFD400' },
  lowerThird: { enabled: true, name: 'Asif Khan', title: 'Creator' },
  watermark: { enabled: true, position: 'tr' as const, opacity: 0.7 },
};

describe('brand kit', () => {
  it('adds intro, watermark, lower third, captions and font', () => {
    const r = applyBrand(base, brand, seqId).view;
    expect(r.clips[0]).toMatchObject({ assetId: 'INTRO', brandRole: 'intro' });
    expect(sequenceDuration(r.clips)).toBe(12);
    expect(r.overlays.find((o) => o.role === 'watermark')).toMatchObject({ assetId: 'LOGO', opacity: 0.7, duration: 12 });
    expect(r.overlays.find((o) => o.role === 'lower-third')).toMatchObject({ text: 'Asif Khan\nCreator', font: 'JetBrains Mono', background: '#FFFFFF' });
    // User text moved with the content and took the brand font.
    expect(r.overlays.find((o) => o.id === 't')).toMatchObject({ start: 3, font: 'JetBrains Mono' });
    expect(r.captions).toMatchObject({ style: 'kinetic', accent: '#FFD400' });
  });

  it('re-applying replaces instead of stacking', () => {
    const once = applyBrand(base, brand, seqId).view;
    const twice = applyBrand(once, brand, seqId).view;
    expect(twice.clips.filter((c) => c.brandRole)).toHaveLength(1);
    expect(twice.overlays.filter((o) => o.role === 'watermark')).toHaveLength(1);
    expect(twice.overlays.find((o) => o.id === 't')!.start).toBe(3);
    const removed = applyBrand(twice, { ...brand, introAssetId: null, watermark: { ...brand.watermark, enabled: false } }, seqId).view;
    expect(removed.clips.some((c) => c.brandRole)).toBe(false);
    expect(removed.overlays.find((o) => o.id === 't')!.start).toBe(1);
  });

  it('apply_brand needs a kit', () => {
    expect(() => applyCommand(base, { type: 'apply_brand' }, { index: {}, newId: seqId })).toThrow(/Brand Kit/);
    const r = applyCommand({ ...base, brand }, { type: 'apply_brand' }, { index: {}, newId: seqId });
    expect(r.notes).toContain('Watermark added');
  });
});

function shifted(src: AudioAnalysis, by: number): AudioAnalysis {
  const k = Math.round(by * src.rate);
  const rmsDb = k >= 0 ? [...new Array(k).fill(-100), ...src.rmsDb] : src.rmsDb.slice(-k);
  return { rate: src.rate, rmsDb, levelDb: loudestShareDb(rmsDb), p90Db: percentile(rmsDb, 90) };
}

describe('multicam', () => {
  // A distinctive loudness pattern (speech-like bursts).
  const bursts: [number, number][] = [];
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 30; i++) bursts.push([0.2 + rnd() * 0.9, -14 - rnd() * 16], [0.1 + rnd() * 0.6, -70]);
  const camA = envelope(bursts);
  const camB = shifted(camA, 2.5); // camera B started recording 2.5 s earlier

  it('finds the offset between two recordings by their sound', () => {
    const m = audioOffset(camA, camB)!;
    expect(m.offset).toBeCloseTo(2.5, 1);
    expect(m.confidence).toBeGreaterThan(0.2);
    expect(ANALYSIS_RATE).toBe(camA.rate);
  });

  it('switch_angle keeps the clip in sync on the other camera', () => {
    const v = doc([clip('c', 'A', 2, 6)], [asset('A', 20), asset('B', 25)]);
    const index: ProjectIndex = { A: { audio: camA }, B: { audio: camB } };
    const r = applyCommand(v, { type: 'switch_angle', clipId: 'c', assetId: 'B' }, { index, newId: seqId });
    expect(r.doc.clips[0].assetId).toBe('B');
    expect(r.doc.clips[0].in).toBeCloseTo(4.5, 1);
    expect(r.doc.clips[0].out).toBeCloseTo(8.5, 1);
  });

  it('refuses when the recordings do not match', () => {
    const v = doc([clip('c', 'A', 2, 6)], [asset('A', 20), asset('B', 25)]);
    const flat = envelope([[20, -40]]);
    expect(() => applyCommand(v, { type: 'switch_angle', clipId: 'c', assetId: 'B' }, { index: { A: { audio: camA }, B: { audio: flat } }, newId: seqId })).toThrow(/line up/);
  });
});

describe('talking-head clean-up', () => {
  it('chains measured steps, adding fillers and captions only with a transcript', () => {
    const v = doc([clip('c', 'A', 0, 10)], [asset('A', 30)]);
    const noText = rulePlan('clean up this talking head', v, {}, 0)!;
    expect(noText.commands.map((c) => c.type)).toEqual(['remove_silence', 'match_levels', 'punch_in']);
    const withText = rulePlan('clean up this podcast', v, { A: { transcript: { model: 't', language: 'en', createdAt: 0, segments: [] } } }, 0)!;
    expect(withText.commands.map((c) => c.type)).toEqual(['remove_silence', 'remove_fillers', 'match_levels', 'punch_in', 'set_captions']);
    expect(rulePlan('use my brand', v, {}, 0)!.commands).toEqual([{ type: 'apply_brand' }]);
  });
});
