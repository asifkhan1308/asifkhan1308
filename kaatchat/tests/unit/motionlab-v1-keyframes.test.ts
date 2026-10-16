import { describe, expect, it, beforeEach } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';

const opacityKfs = (id: string) =>
  useV1.getState().project.layers.find((l) => l.id === id)!.transform.opacity.keyframes ?? [];
const positionKfs = (id: string) =>
  useV1.getState().project.layers.find((l) => l.id === id)!.transform.position.keyframes ?? [];

function keyAt(id: string, t: number) {
  const s = useV1.getState();
  s.setCurrentTime(t);
  s.toggleKeyframe(id, 'opacity');
  s.toggleKeyframe(id, 'position');
}

describe('MOTIONLAB V1 timeline keyframe ops', () => {
  let id: string;
  beforeEach(() => {
    useV1.getState().newProject();
    id = useV1.getState().addRectangle();
  });

  it('moves every prop keyed at a time together', () => {
    keyAt(id, 1);
    keyAt(id, 3);
    useV1.getState().moveKeyframesAt(id, 1, 2);
    expect(opacityKfs(id).map((k) => k.time)).toEqual([2, 3]);
    expect(positionKfs(id).map((k) => k.time)).toEqual([2, 3]);
  });

  it('overwrites a key already at the destination instead of duplicating', () => {
    keyAt(id, 1);
    keyAt(id, 3);
    useV1.getState().moveKeyframesAt(id, 1, 3);
    expect(opacityKfs(id).map((k) => k.time)).toEqual([3]);
  });

  it('clamps moves to the composition duration', () => {
    keyAt(id, 1);
    useV1.getState().moveKeyframesAt(id, 1, 999);
    expect(opacityKfs(id)[0].time).toBe(useV1.getState().project.composition.duration);
  });

  it('copies and pastes keyframes onto another layer at a new time', () => {
    const s = useV1.getState();
    s.setPropertyBase(id, 'opacity', 0.25);
    keyAt(id, 1);
    expect(s.copyKeyframesAt(id, 1)).toBe(2);
    const other = s.addEllipse();
    expect(useV1.getState().pasteKeyframesAt(other, 4)).toBe(2);
    const pasted = useV1.getState().project.layers.find((l) => l.id === other)!.transform.opacity.keyframes!;
    expect(pasted).toHaveLength(1);
    expect(pasted[0].time).toBe(4);
    expect(pasted[0].value).toBe(0.25);
  });

  it('copy at an empty time leaves the clipboard untouched', () => {
    keyAt(id, 1);
    useV1.getState().copyKeyframesAt(id, 1);
    expect(useV1.getState().copyKeyframesAt(id, 5)).toBe(0);
    expect(useV1.getState().hasKeyframeClipboard()).toBe(true);
  });
});
