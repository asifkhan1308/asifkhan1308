import { describe, expect, it } from 'vitest';
import { gifDelays } from '../../src/features/motionlab-v1/engine/exportGif';

describe('MOTIONLAB V1 GIF timing', () => {
  it('per-frame delays (1/100 s) add up to real time even when fps does not divide 100', () => {
    for (const fps of [10, 15, 20, 24, 25, 30]) {
      const d = gifDelays(fps * 4, fps);                         // 4 seconds
      expect(d.reduce((a, b) => a + b, 0)).toBe(400);
      expect(Math.max(...d) - Math.min(...d)).toBeLessThanOrEqual(1);
    }
    expect(gifDelays(3, 15)).toEqual([7, 6, 7]);
  });
  it('never uses delays under 2/100 s (browsers slow those down)', () => {
    expect(Math.min(...gifDelays(100, 100))).toBe(2);
  });
});
