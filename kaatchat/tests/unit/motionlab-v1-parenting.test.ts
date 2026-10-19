import { beforeEach, describe, expect, it } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';
import { apply, IDENTITY, invert, localMatrix, mul, worldMatrix } from '../../src/features/motionlab-v1/engine/matrix';
import { worldCorners } from '../../src/features/motionlab-v1/engine/bbox';
import type { Layer, V2 } from '../../src/features/motionlab-v1/types';

const st = () => useV1.getState();
const L = (id: string) => st().project.layers.find((l) => l.id === id) as Layer;
const centre = (id: string): V2 => worldCorners(L(id), st().currentTime, st().project.assets, st().project.layers)!.center;
const close = (a: V2, b: V2) => { expect(a[0]).toBeCloseTo(b[0], 3); expect(a[1]).toBeCloseTo(b[1], 3); };

beforeEach(() => st().replaceProject(defaultProject()));

describe('MOTIONLAB V1 matrices', () => {
  it('inverts and composes', () => {
    const m: [number, number, number, number, number, number] = [2, 0.5, -1, 3, 10, -4];
    const r = mul(invert(m)!, m);
    r.forEach((v, i) => expect(v).toBeCloseTo(IDENTITY[i], 9));
  });
  it('maps the anchor point onto the position', () => {
    const id = st().addRectangle();
    st().setPropertyBase(id, 'rotation', 33);
    st().setPropertyBase(id, 'scale', [1.7, 0.4]);
    close(apply(localMatrix(L(id), 0), L(id).transform.anchor.default), L(id).transform.position.default);
  });
});

describe('MOTIONLAB V1 parenting', () => {
  it('parenting keeps the child in place, then the child follows the parent', () => {
    const nul = st().addNull();
    const box = st().addRectangle();
    st().setPropertyBase(nul, 'position', [500, 500]);
    st().setPropertyBase(nul, 'rotation', 90);
    st().setPropertyBase(nul, 'scale', [2, 2]);
    st().setPropertyBase(box, 'position', [700, 300]);
    const before = centre(box);

    expect(st().setParent(box, nul)).toBe(true);
    expect(L(box).parentId).toBe(nul);
    close(centre(box), before);                        // no jump

    st().setPropertyBase(nul, 'position', [600, 520]); // move the parent
    close(centre(box), [before[0] + 100, before[1] + 20]);
    st().setPropertyBase(nul, 'rotation', 180);        // rotate the parent: child orbits it
    const c = centre(box);
    const r0 = Math.hypot(before[0] + 100 - 600, before[1] + 20 - 520);
    expect(Math.hypot(c[0] - 600, c[1] - 520)).toBeCloseTo(r0, 3);
  });

  it('chains through several parents and refuses loops', () => {
    const a = st().addNull(), b = st().addNull(), box = st().addRectangle();
    st().setParent(b, a);
    st().setParent(box, b);
    st().setPropertyBase(a, 'position', [st().project.composition.width / 2 + 50, st().project.composition.height / 2]);
    expect(L(box).parentId).toBe(b);
    const w = worldMatrix(L(box), st().project.layers, 0);
    expect(w[4]).not.toBe(localMatrix(L(box), 0)[4]); // grandparent moved it
    expect(st().setParent(a, box)).toBe(false);        // a → box → b → a
    expect(st().setParent(a, a)).toBe(false);
    expect(L(a).parentId).toBeUndefined();
  });

  it('unparenting and deleting a parent release children where they are', () => {
    const nul = st().addNull(), box = st().addRectangle();
    st().setPropertyBase(nul, 'position', [300, 200]);
    st().setPropertyBase(nul, 'rotation', 45);
    st().setParent(box, nul);
    st().setPropertyBase(nul, 'position', [800, 600]);
    const here = centre(box);
    st().setParent(box, null);
    close(centre(box), here);
    st().setParent(box, nul);
    st().removeLayer(nul);
    expect(L(box).parentId).toBeUndefined();
    close(centre(box), here);
  });

  it('is one undoable step', () => {
    const nul = st().addNull(), box = st().addRectangle();
    st().setPropertyBase(nul, 'position', [100, 100]);
    const pos = L(box).transform.position.default;
    st().setParent(box, nul);
    st().undo();
    expect(L(box).parentId).toBeUndefined();
    expect(L(box).transform.position.default).toEqual(pos);
  });
});

import { applyAIActions } from '../../src/features/motionlab-v1/engine/aiActions';
import { parseLocalCommand } from '../../src/features/motionlab-v1/engine/aiLocal';

describe('MOTIONLAB V1 parenting via ✦ Ask', () => {
  it('parses and applies parent / unparent, refusing loops', () => {
    expect(parseLocalCommand('add a circle and parent it to "Rig"', 0)).toEqual([
      { op: 'add_layer', type: 'ellipse' },
      { op: 'parent', to: 'Rig' },
    ]);
    expect(parseLocalCommand('unparent', 0)).toEqual([{ op: 'parent', to: null }]);
    applyAIActions([{ op: 'add_layer', type: 'null', name: 'Rig' }]);
    const r = applyAIActions(parseLocalCommand('add a circle and parent it to Rig', 0));
    expect(r.skipped).toEqual([]);
    const rig = st().project.layers.find((l) => l.name === 'Rig')!;
    const dot = st().project.layers.find((l) => l.type === 'ellipse')!;
    expect(dot.parentId).toBe(rig.id);
    expect(applyAIActions([{ op: 'parent', layer: 'Rig', to: dot.id }]).skipped[0]).toMatch(/loop/);
    applyAIActions([{ op: 'parent', layer: dot.id, to: null }]);
    expect(L(dot.id).parentId).toBeUndefined();
  });
});
