import { beforeEach, describe, expect, it } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';
import { sourceTimeAt } from '../../src/features/motionlab-v1/engine/mediaSync';
import { applyAIActions } from '../../src/features/motionlab-v1/engine/aiActions';
import { parseLocalCommand } from '../../src/features/motionlab-v1/engine/aiLocal';
import type { Asset, MediaLayer } from '../../src/features/motionlab-v1/types';

const st = () => useV1.getState();
const clip = (id: string) => st().project.layers.find((l) => l.id === id) as MediaLayer;
const asset: Asset = { id: 'v1', kind: 'video', name: 'v.mp4', mime: 'video/mp4', width: 640, height: 360, duration: 8, url: 'blob:x' };
const audio: Asset = { ...asset, id: 'a1', kind: 'audio', name: 'a.mp3', mime: 'audio/mpeg', width: 0, height: 0 };
let id = '';
beforeEach(() => {
  st().replaceProject({ ...defaultProject(), composition: { ...defaultProject().composition, duration: 20 } });
  st().addAsset(asset);
  id = st().addMediaLayer(asset);
  st().patchLayer(id, { startTime: 1, duration: 4, sourceIn: 2, sourceOut: 6 });
});

describe('MOTIONLAB V1 time remapping', () => {
  it('speed keeps the same footage: duration scales, frames map through the rate', () => {
    st().setClipSpeed(id, 2);
    expect(clip(id)).toMatchObject({ speed: 2, duration: 2, sourceIn: 2, sourceOut: 6 });
    expect(sourceTimeAt(clip(id), 1)).toBe(2);
    expect(sourceTimeAt(clip(id), 2)).toBe(4);                              // 1 s in → 2 s of source
    st().setClipSpeed(id, 0.5);
    expect(clip(id)).toMatchObject({ speed: 0.5, duration: 8, sourceOut: 6 });
    expect(sourceTimeAt(clip(id), 3)).toBe(3);
    st().setClipSpeed(id, 0.1);                                             // would be 40 s: capped at the comp end
    expect(clip(id).duration).toBe(19);
    expect(clip(id).sourceOut).toBeCloseTo(3.9);
    st().setClipSpeed(id, 1);
    expect(clip(id).speed).toBeUndefined();
    st().undo();                                                            // back one speed change
    expect(clip(id)).toMatchObject({ speed: 0.1, duration: 19 });
  });

  it('trims and splits respect the speed (seamless across the cut)', () => {
    st().setClipSpeed(id, 2);                                               // 1..3 s, source 2..6
    st().trimLayerIn(id, 1.5);
    expect(clip(id).sourceIn).toBeCloseTo(3);
    expect(sourceTimeAt(clip(id), 2)).toBeCloseTo(4);                      // same frame as before the trim
    st().trimLayerOut(id, 2.5);
    expect(clip(id).sourceOut).toBeCloseTo(5);
    st().splitLayerAt(id, 2);
    const [a, b] = st().project.layers.filter((l) => l.type === 'media') as MediaLayer[];
    expect(a.sourceOut).toBeCloseTo(4);
    expect(b.sourceIn).toBeCloseTo(4);
    expect(b.speed).toBe(2);
  });

  it('freeze frame at the playhead: split + hold that frame, one undo; splits keep the frame', () => {
    const frozen = st().freezeFrameAt(id, 3)!;
    expect(frozen).toBeTruthy();
    expect(st().selectedLayerId).toBe(frozen);
    expect(clip(frozen)).toMatchObject({ freeze: true, startTime: 3, sourceIn: 4 });
    expect(sourceTimeAt(clip(frozen), 3.2)).toBe(4);
    expect(sourceTimeAt(clip(frozen), 4.9)).toBe(4);
    st().trimLayerIn(frozen, 3.5);
    expect(clip(frozen).sourceIn).toBe(4);
    st().splitLayerAt(frozen, 4);
    for (const l of st().project.layers.filter((x) => x.type === 'media' && x.freeze) as MediaLayer[]) expect(l.sourceIn).toBe(4);
    st().undo(); st().undo(); st().undo();
    expect(st().project.layers.filter((l) => l.type === 'media')).toHaveLength(1);
    expect(clip(id).freeze).toBeUndefined();
    expect(st().freezeFrameAt(id, 0.5)).toBeNull();                         // outside the clip
  });

  it('✦ Ask: speed and freeze, online actions and offline phrases', () => {
    expect(parseLocalCommand('slow it down to half speed', 0)).toEqual([{ op: 'speed', speed: 0.5 }]);
    expect(parseLocalCommand('slow motion', 0)).toEqual([{ op: 'speed', speed: 0.5 }]);
    expect(parseLocalCommand('speed it up 4x', 0)).toEqual([{ op: 'speed', speed: 4 }]);
    expect(parseLocalCommand('2x speed', 0)).toEqual([{ op: 'speed', speed: 2 }]);
    expect(parseLocalCommand('normal speed', 0)).toEqual([{ op: 'speed', speed: 1 }]);
    expect(parseLocalCommand('freeze frame at 3s', 0)).toEqual([{ op: 'freeze', time: 3 }]);
    expect(parseLocalCommand('unfreeze', 0)).toEqual([{ op: 'freeze', time: null }]);
    st().selectLayer(id);
    expect(applyAIActions(parseLocalCommand('2x speed', 0)).skipped).toEqual([]);
    expect(clip(id).speed).toBe(2);
    expect(applyAIActions(parseLocalCommand('freeze frame at 2s', 0)).skipped).toEqual([]);
    expect(st().project.layers.some((l) => l.type === 'media' && l.freeze)).toBe(true);
    const t = st().addTextLayer();
    expect(applyAIActions([{ op: 'speed', speed: 2, layer: t }]).skipped[0]).toMatch(/no speed/);
    st().addAsset(audio);
    const a = st().addMediaLayer(audio);
    expect(applyAIActions([{ op: 'freeze', layer: a }]).skipped[0]).toMatch(/only video/);
    expect(applyAIActions([{ op: 'speed', speed: 20, layer: a }]).skipped[0]).toMatch(/0\.1–8/);
  });
});
