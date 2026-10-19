import { beforeEach, describe, expect, it } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';
import { worldCorners } from '../../src/features/motionlab-v1/engine/bbox';
import { aabb } from '../../src/features/motionlab-v1/engine/guides';

const st = () => useV1.getState();
const box = (id: string) => aabb(worldCorners(st().project.layers.find((l) => l.id === id)!, 0, st().project.assets, st().project.layers)!.corners);
beforeEach(() => st().replaceProject(defaultProject()));

describe('MOTIONLAB V1 nudge', () => {
  it('moves the selection by screen pixels; held nudges are one undo step', () => {
    const a = st().addRectangle(), b = st().addEllipse();
    st().selectLayer(a); st().toggleSelect(b);
    const a0 = box(a), b0 = box(b);
    for (let i = 0; i < 5; i++) st().nudgeSelected(10, 0);
    st().nudgeSelected(0, -1);
    expect(box(a).minX).toBeCloseTo(a0.minX + 50, 1);
    expect(box(b).minY).toBeCloseTo(b0.minY - 1, 1);
    st().undo();
    expect(box(a).minX).toBeCloseTo(a0.minX, 1);
  });

  it('skips locked layers and moves a parented child only once, in screen space', () => {
    const nul = st().addNull(), child = st().addRectangle(), locked = st().addRectangle();
    st().setPropertyBase(nul, 'rotation', 90);
    st().setParent(child, nul);
    st().setLocked(locked, true);
    const c0 = box(child), l0 = box(locked);
    st().selectLayer(child); st().nudgeSelected(10, 0);
    expect(box(child).minX).toBeCloseTo(c0.minX + 10, 1);             // right on screen despite the rotated parent
    expect(box(child).minY).toBeCloseTo(c0.minY, 1);
    st().selectLayer(nul); st().toggleSelect(child); st().toggleSelect(locked);
    st().nudgeSelected(0, 20);
    expect(box(child).minY).toBeCloseTo(c0.minY + 20, 1);             // via its parent, not twice
    expect(box(locked).minY).toBeCloseTo(l0.minY, 1);
  });
});
