import { describe, expect, it } from 'vitest';
import { clipGainAt, clipIsAudible } from '../../src/features/motionlab-v1/engine/audioMix';
import { newMediaLayer, defaultComposition } from '../../src/features/motionlab-v1/engine/defaults';
import type { MediaLayer } from '../../src/features/motionlab-v1/types';

const clip = (patch: Partial<MediaLayer> = {}): MediaLayer => ({
  ...newMediaLayer({ ...defaultComposition(), duration: 10 }, 'a', 'clip', 10),
  startTime: 2,
  duration: 4,
  ...patch,
});

describe('MOTIONLAB V1 clip audio gain', () => {
  it('is full volume inside the clip and silent outside it', () => {
    const c = clip();
    expect(clipGainAt(c, 3)).toBe(1);
    expect(clipGainAt(c, 1.9)).toBe(0);
    expect(clipGainAt(c, 6.1)).toBe(0);
  });

  it('applies volume, clamped to 0..2', () => {
    expect(clipGainAt(clip({ volume: 0.5 }), 3)).toBe(0.5);
    expect(clipGainAt(clip({ volume: 5 }), 3)).toBe(2);
    expect(clipGainAt(clip({ volume: -1 }), 3)).toBe(0);
  });

  it('ramps linearly through fade-in and fade-out', () => {
    const c = clip({ fadeIn: 1, fadeOut: 2 });
    expect(clipGainAt(c, 2)).toBe(0);
    expect(clipGainAt(c, 2.5)).toBeCloseTo(0.5);
    expect(clipGainAt(c, 3.5)).toBe(1);
    expect(clipGainAt(c, 5)).toBeCloseTo(0.5);
    expect(clipGainAt(c, 6)).toBeCloseTo(0);
  });

  it('clamps fades to half the clip so they never overlap', () => {
    const c = clip({ fadeIn: 10, fadeOut: 10 }); // 4 s clip → 2 s each
    expect(clipGainAt(c, 4)).toBeCloseTo(1);
    expect(clipGainAt(c, 3)).toBeCloseTo(0.5);
  });

  it('muted or zero-volume clips are silent and excluded from the mix', () => {
    expect(clipGainAt(clip({ muted: true }), 3)).toBe(0);
    expect(clipIsAudible(clip({ muted: true }))).toBe(false);
    expect(clipIsAudible(clip({ volume: 0 }))).toBe(false);
    expect(clipIsAudible(clip())).toBe(true);
  });
});
