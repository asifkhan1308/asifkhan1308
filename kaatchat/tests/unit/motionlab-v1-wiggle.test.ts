import { beforeEach, describe, expect, it } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';
import { applyAIActions } from '../../src/features/motionlab-v1/engine/aiActions';
import { parseLocalCommand } from '../../src/features/motionlab-v1/engine/aiLocal';
import { resolveAnimated, resolveBase, wiggleNoise } from '../../src/features/motionlab-v1/engine/interp';
import type { AnimatedProperty, V2 } from '../../src/features/motionlab-v1/types';

const st = () => useV1.getState();
const layer = (id: string) => st().project.layers.find((l) => l.id === id)!;
beforeEach(() => st().replaceProject(defaultProject()));

describe('MOTIONLAB V1 wiggle', () => {
  it('noise is bounded, smooth and repeatable', () => {
    let prev = wiggleNoise(0, 7), maxStep = 0, min = 1, max = -1;
    for (let i = 1; i <= 2000; i++) {
      const v = wiggleNoise(i / 100, 7);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      maxStep = Math.max(maxStep, Math.abs(v - prev));
      min = Math.min(min, v); max = Math.max(max, v);
      prev = v;
    }
    expect(maxStep).toBeLessThan(0.05);                       // no jumps between frames
    expect(max - min).toBeGreaterThan(0.8);                   // it really moves
    expect(wiggleNoise(3.3, 7)).toBe(wiggleNoise(3.3, 7));
    expect(wiggleNoise(3.3, 7)).not.toBe(wiggleNoise(3.3, 8));
  });

  it('adds up to ±amount on top of keyframes / default; base stays the edited value', () => {
    const ap: AnimatedProperty<V2> = { default: [100, 200], wiggle: { amount: 30, freq: 2, seed: 5 } };
    let moved = false;
    for (let t = 0; t < 5; t += 0.05) {
      const [x, y] = resolveAnimated(ap, t);
      expect(Math.abs(x - 100)).toBeLessThanOrEqual(30);
      expect(Math.abs(y - 200)).toBeLessThanOrEqual(30);
      if (Math.abs(x - 100) > 5) moved = true;
      expect(resolveBase(ap, t)).toEqual([100, 200]);
    }
    expect(moved).toBe(true);
  });

  it('store: set / tune / remove; editing and nudging do not bake the wiggle in; one undo', () => {
    const id = st().addRectangle();
    st().setPropertyBase(id, 'position', [500, 500]);
    expect(st().setWiggle(id, 'position', { amount: 40, freq: 3 })).toBe(true);
    const w = layer(id).transform.position.wiggle!;
    expect(w).toMatchObject({ amount: 40, freq: 3 });
    st().setWiggle(id, 'position', { ...w, amount: 10 });
    expect(layer(id).transform.position.wiggle!.seed).toBe(w.seed);          // same motion, just smaller
    st().setCurrentTime(1.3);
    st().selectLayer(id);
    st().nudgeSelected(5, 0);
    expect(layer(id).transform.position.default).toEqual([505, 500]);
    st().toggleKeyframe(id, 'position');
    expect(layer(id).transform.position.keyframes![0].value).toEqual([505, 500]);
    expect(st().setWiggle(id, 'position', null)).toBe(true);
    expect(layer(id).transform.position.wiggle).toBeUndefined();
    st().undo();
    expect(layer(id).transform.position.wiggle).toBeDefined();
    expect(st().setWiggle(id, 'size', { amount: 4, freq: 1 })).toBe(true);    // shapes have a size
    const t = st().addTextLayer();
    expect(st().setWiggle(t, 'size', { amount: 4, freq: 1 })).toBe(false);    // text has none
  });

  it('✦ Ask offline: wiggle, shake with units and speed, stop', () => {
    expect(parseLocalCommand('wiggle it', 0)).toEqual([{ op: 'wiggle', path: 'position' }]);
    expect(parseLocalCommand('shake it 40px 5 times a second', 0)).toEqual([{ op: 'wiggle', path: 'position', amount: 40, freq: 5 }]);
    expect(parseLocalCommand('wiggle the rotation 10 degrees', 0)).toEqual([{ op: 'wiggle', path: 'rotation', amount: 10 }]);
    expect(parseLocalCommand('wiggle the opacity 30%', 0)).toEqual([{ op: 'wiggle', path: 'opacity', amount: 0.3 }]);
    expect(parseLocalCommand('stop wiggling', 0)).toEqual([{ op: 'wiggle', path: 'position', amount: 0 }]);
    const r = applyAIActions(parseLocalCommand('add a rectangle and wiggle it', 0));
    expect(r.skipped).toEqual([]);
    expect(st().project.layers[0].transform.position.wiggle?.amount).toBe(20);
    applyAIActions(parseLocalCommand('stop wiggling', 0));
    expect(st().project.layers[0].transform.position.wiggle).toBeUndefined();
    expect(applyAIActions([{ op: 'wiggle', path: 'nope' }]).skipped[0]).toMatch(/unknown property/);
  });
});

describe('MOTIONLAB V1 wiggle on copies', () => {
  it('duplicate and paste get their own motion; split halves keep it (same clip)', () => {
    const id = st().addRectangle();
    st().setWiggle(id, 'position', { amount: 30, freq: 2, seed: 7 });
    st().setWiggle(id, 'rotation', { amount: 5, freq: 1, seed: 7 });
    st().duplicate(id);
    const dup = st().selectedLayerId!;
    expect(dup).not.toBe(id);
    expect(layer(dup).transform.position.wiggle).toMatchObject({ amount: 30, freq: 2 });
    expect(layer(dup).transform.position.wiggle!.seed).not.toBe(7);
    expect(layer(dup).transform.rotation.wiggle!.seed).not.toBe(7);
    expect(layer(id).transform.position.wiggle!.seed).toBe(7);               // original untouched
    st().copyLayers([id]);
    st().pasteLayers();
    const pasted = st().selectedLayerId!;
    expect(layer(pasted).transform.position.wiggle!.seed).not.toBe(7);
    st().splitLayerAt(id, layer(id).startTime + layer(id).duration / 2);
    const halves = st().project.layers.filter((l) => l.name.startsWith(layer(id).name) && l.transform.position.wiggle?.seed === 7);
    expect(halves.length).toBeGreaterThanOrEqual(2);
  });
});
