import { describe, expect, it } from 'vitest';
import { applyEasing, cubicBezier, resolveAnimated } from '../../src/features/motionlab-v1/engine/interp';

describe('MOTIONLAB V1 easing', () => {
  it('cubic-bezier matches known curves', () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) expect(cubicBezier(t, [0, 0, 1, 1])).toBeCloseTo(t, 5); // linear
    expect(cubicBezier(0.5, [0.42, 0, 0.58, 1])).toBeCloseTo(0.5, 5);        // symmetric ease-in-out
    expect(cubicBezier(0.25, [0.42, 0, 1, 1])).toBeLessThan(0.25);            // ease-in starts slow
    expect(cubicBezier(0.25, [0, 0, 0.58, 1])).toBeGreaterThan(0.25);         // ease-out starts fast
  });

  it('allows overshoot for bouncy moves and stays monotonic in time', () => {
    const back: [number, number, number, number] = [0.34, 1.56, 0.64, 1];
    const ys = Array.from({ length: 101 }, (_, i) => cubicBezier(i / 100, back));
    expect(Math.max(...ys)).toBeGreaterThan(1.05);
    expect(ys[0]).toBe(0);
    expect(ys[100]).toBe(1);
    // Steep / degenerate handles still solve (bisection fallback).
    expect(cubicBezier(0.5, [1, 0, 0, 1])).toBeCloseTo(0.5, 4);
  });

  it('hold keeps the previous value until the keyframe, then jumps', () => {
    expect(applyEasing(0.99, 'hold')).toBe(0);
    expect(applyEasing(1, 'hold')).toBe(1);
    const prop = { default: 0, keyframes: [{ time: 0, value: 0 }, { time: 2, value: 100, easing: 'hold' as const }] };
    expect(resolveAnimated(prop, 1.999)).toBe(0);
    expect(resolveAnimated(prop, 2)).toBe(100);
  });

  it('resolves keyframes through a custom curve', () => {
    const prop = { default: 0, keyframes: [{ time: 0, value: 0 }, { time: 1, value: 10, easing: 'bezier' as const, bezier: [0.34, 1.56, 0.64, 1] as [number, number, number, number] }] };
    expect(Math.max(...Array.from({ length: 21 }, (_, i) => resolveAnimated(prop, i / 20)))).toBeGreaterThan(10.4);
  });
});

import { useV1 } from '../../src/features/motionlab-v1/store';
import { applyAIActions } from '../../src/features/motionlab-v1/engine/aiActions';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';

describe('MOTIONLAB V1 easing via store and ✦ Ask', () => {
  it('sets hold / curves, drops the curve when switching away, and validates AI input', () => {
    useV1.getState().replaceProject(defaultProject());
    applyAIActions([
      { op: 'add_layer', type: 'rectangle', name: 'R' },
      { op: 'keyframe', path: 'rotation', time: 0, value: 0 },
      { op: 'keyframe', path: 'rotation', time: 1, value: 90, bezier: [0.34, 1.56, 0.64, 1] },
      { op: 'keyframe', path: 'rotation', time: 2, value: 180, easing: 'hold' },
      { op: 'keyframe', path: 'rotation', time: 3, value: 270, bezier: [5, 0, 0, 1], easing: 'teleport' }, // invalid → default
    ]);
    const kf = () => useV1.getState().project.layers[0].transform.rotation.keyframes!;
    expect(kf()[1]).toMatchObject({ easing: 'bezier', bezier: [0.34, 1.56, 0.64, 1] });
    expect(kf()[2].easing).toBe('hold');
    expect(kf()[3].easing).toBeUndefined();
    const id = useV1.getState().project.layers[0].id;
    useV1.getState().setKeyframeEasing(id, 'rotation', 1, 'linear');
    expect(kf()[1].bezier).toBeUndefined();
  });
});

describe('MOTIONLAB V1 curves survive edits and copy/paste', () => {
  it('editing a keyed value keeps its custom curve; copy/paste carries it', () => {
    const st = useV1.getState;
    st().replaceProject(defaultProject());
    const id = st().addRectangle();
    st().setCurrentTime(0); st().toggleKeyframe(id, 'rotation');
    st().setCurrentTime(1); st().setPropertyBase(id, 'rotation', 90);
    st().setKeyframeEasing(id, 'rotation', 1, 'bezier', [0.34, 1.56, 0.64, 1]);
    st().setPropertyBase(id, 'rotation', 120);                         // auto-key edit at the same time
    const k = () => st().project.layers[0].transform.rotation.keyframes!.find((x) => x.time === 1)!;
    expect(k()).toMatchObject({ value: 120, easing: 'bezier', bezier: [0.34, 1.56, 0.64, 1] });
    st().copyKeyframesAt(id, 1);
    const other = st().addRectangle();
    st().pasteKeyframesAt(other, 2);
    const pasted = st().project.layers.find((l) => l.id === other)!.transform.rotation.keyframes![0];
    expect(pasted).toMatchObject({ time: 2, value: 120, easing: 'bezier', bezier: [0.34, 1.56, 0.64, 1] });
  });
});
