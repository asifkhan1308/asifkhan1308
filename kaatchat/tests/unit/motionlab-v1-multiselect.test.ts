import { beforeEach, describe, expect, it } from 'vitest';
import { selectionOf, useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';
import { worldCorners } from '../../src/features/motionlab-v1/engine/bbox';
import { aabb } from '../../src/features/motionlab-v1/engine/guides';

const st = () => useV1.getState();
const box = (id: string) => aabb(worldCorners(st().project.layers.find((l) => l.id === id)!, 0, st().project.assets, st().project.layers)!.corners);
const place = (id: string, x: number, y: number) => st().setPropertyBase(id, 'position', [x, y]);
beforeEach(() => st().replaceProject(defaultProject()));

describe('MOTIONLAB V1 multi-select', () => {
  it('toggles, keeps a primary, and falls back to the primary when older code selects', () => {
    const a = st().addRectangle(), b = st().addEllipse(), c = st().addTextLayer();
    st().selectLayer(a);
    st().toggleSelect(b);
    expect(selectionOf(st())).toEqual([a, b]);
    expect(st().selectedLayerId).toBe(b);
    st().toggleSelect(b);
    expect(selectionOf(st())).toEqual([a]);
    st().toggleSelect(c); st().toggleSelect(b);
    expect(selectionOf(st())).toEqual([a, b, c]);                     // stacking order
    useV1.setState({ selectedLayerId: a });                            // legacy single-select path
    expect(selectionOf(st())).toEqual([a, b, c]);                      // a is in the set → set kept
    st().selectLayer(null);
    expect(selectionOf(st())).toEqual([]);
    st().selectAll();
    expect(selectionOf(st())).toHaveLength(3);
  });

  it('aligns 2+ layers to the selection bounds, distributes 3+, one undo each', () => {
    const a = st().addRectangle(), b = st().addRectangle(), c = st().addRectangle();
    place(a, 400, 200); place(b, 900, 500); place(c, 1700, 800);
    st().selectLayer(a); st().toggleSelect(b); st().toggleSelect(c);
    const left = Math.min(box(a).minX, box(b).minX, box(c).minX);
    st().alignSelected('left');
    for (const id of [a, b, c]) expect(box(id).minX).toBeCloseTo(left, 1);
    st().undo();
    expect(box(b).minX).not.toBeCloseTo(left, 1);                       // one undo restores all three

    place(b, 600, 500);
    st().distributeSelected('x');
    const cx = (id: string) => (box(id).minX + box(id).maxX) / 2;
    expect(cx(b)).toBeCloseTo((cx(a) + cx(c)) / 2, 1);
  });

  it('deletes and duplicates the whole selection as one step', () => {
    const a = st().addRectangle(), b = st().addEllipse();
    st().addTextLayer();
    st().selectLayer(a); st().toggleSelect(b);
    st().duplicateSelected();
    expect(st().project.layers).toHaveLength(5);
    expect(selectionOf(st())).toHaveLength(2);                          // the copies are selected
    st().undo();
    expect(st().project.layers).toHaveLength(3);
    st().selectLayer(a); st().toggleSelect(b);
    st().removeSelected();
    expect(st().project.layers).toHaveLength(1);
    expect(selectionOf(st())).toEqual([]);
    st().undo();
    expect(st().project.layers).toHaveLength(3);
  });
});
