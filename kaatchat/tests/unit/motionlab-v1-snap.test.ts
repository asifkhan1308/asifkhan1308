import { describe, expect, it } from 'vitest';
import { snapSpan, snapTargets, snapTime } from '../../src/features/motionlab-v1/engine/snap';
import { newRectangleLayer, defaultComposition } from '../../src/features/motionlab-v1/engine/defaults';

describe('MOTIONLAB V1 timeline snapping', () => {
  it('snaps to the nearest target inside the threshold only', () => {
    expect(snapTime(1.04, [0, 1, 2], 0.1)).toEqual({ t: 1, hit: 1 });
    expect(snapTime(1.5, [0, 1, 2], 0.1)).toEqual({ t: 1.5, hit: null });
    expect(snapTime(1.06, [1, 1.1], 0.1).t).toBe(1.1);
  });

  it('moves a whole span by whichever edge is closer to a target', () => {
    // span 0.97–1.97: start is 0.03 from 1, end is 0.03 from 2 → start wins ties
    expect(snapSpan(0.97, 1.97, [1, 2], 0.1)).toEqual({ start: 1, hit: 1 });
    // only the end (2.48) is near a target (2.5) → span shifts by +0.02
    expect(snapSpan(1.5, 2.48, [2.5], 0.1)).toEqual({ start: 1.52, hit: 2.5 });
    expect(snapSpan(1.5, 2.5, [5], 0.1)).toEqual({ start: 1.5, hit: null });
  });

  it('collects comp bounds, other clips and extras, excluding the dragged layer', () => {
    const comp = { ...defaultComposition(), duration: 10 };
    const a = { ...newRectangleLayer(comp), id: 'a', startTime: 2, duration: 3 };
    const b = { ...newRectangleLayer(comp), id: 'b', startTime: 6, duration: 1 };
    const t = snapTargets([a, b], 10, 'a', [4.2]);
    expect(t).toEqual(expect.arrayContaining([0, 10, 4.2, 6, 7]));
    expect(t).not.toContain(2);
    expect(t).not.toContain(5);
  });
});
