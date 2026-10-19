import { describe, expect, it } from 'vitest';
import { aabb, guideTargets, snapMove } from '../../src/features/motionlab-v1/engine/guides';

const comp = { width: 1920, height: 1080 };

describe('MOTIONLAB V1 smart guides', () => {
  it('snaps a box centre to the frame centre', () => {
    const box = aabb([[100, 100], [300, 100], [300, 200], [100, 200]]); // centre 200,150
    const r = snapMove(box, [757, 387], guideTargets(comp, []), 8);   // centre → 957,537
    expect(r.d).toEqual([760, 390]);
    expect(r).toMatchObject({ gx: 960, gy: 540 });
  });

  it('snaps edges to another layer and to the frame edge, per axis', () => {
    const other = aabb([[1000, 400], [1200, 400], [1200, 600], [1000, 600]]);
    const box = aabb([[0, 0], [100, 0], [100, 50], [0, 50]]);
    // Right edge 100+896=996 → snaps to other's left edge 1000; top 0+3 → frame top 0.
    const r = snapMove(box, [896, 3], guideTargets(comp, [other]), 8);
    expect(r.d).toEqual([900, 0]);
    expect(r).toMatchObject({ gx: 1000, gy: 0 });
  });

  it('leaves the move alone when nothing is within the threshold', () => {
    const box = aabb([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(snapMove(box, [123, 456], guideTargets(comp, []), 4)).toEqual({ d: [123, 456], gx: null, gy: null });
  });
});
