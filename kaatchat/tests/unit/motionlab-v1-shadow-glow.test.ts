import { beforeEach, describe, expect, it } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';
import { layerKeyTimes } from '../../src/features/motionlab-v1/engine/snap';
import type { Effects, Layer } from '../../src/features/motionlab-v1/types';

const st = () => useV1.getState();
const L = (id: string) => st().project.layers.find((l) => l.id === id) as Layer;
beforeEach(() => st().replaceProject(defaultProject()));

describe('MOTIONLAB V1 drop shadow + glow', () => {
  it('new effects include shadow and glow, neutral at 0', () => {
    const id = st().addRectangle();
    st().enableEffects(id);
    expect(L(id).effects).toMatchObject({ shadow: { default: 0 }, glow: { default: 0 }, shadowColor: '#000000', glowColor: '#ffffff' });
  });

  it('older saved effects without them still work (and become keyframable)', () => {
    const id = st().addRectangle();
    st().enableEffects(id);
    const legacy = { ...L(id).effects } as Partial<Effects>;
    delete legacy.shadow; delete legacy.glow; delete legacy.shadowColor; delete legacy.glowColor;
    st().patchLayer(id, { effects: legacy as Effects });
    st().setPropertyBase(id, 'glow', 0.6);
    expect(L(id).effects!.glow).toEqual({ default: 0.6 });
    st().setCurrentTime(1);
    st().toggleKeyframe(id, 'shadow');
    expect(L(id).effects!.shadow!.keyframes).toHaveLength(1);
  });

  it('effect keyframes show on the timeline', () => {
    const id = st().addRectangle();
    st().enableEffects(id);
    st().setCurrentTime(2);
    st().toggleKeyframe(id, 'glow');
    expect(layerKeyTimes(L(id))).toContain(2);
  });
});
