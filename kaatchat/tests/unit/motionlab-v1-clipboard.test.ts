import { beforeEach, describe, expect, it } from 'vitest';
import { selectionOf, useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';

const st = () => useV1.getState();
beforeEach(() => st().replaceProject(defaultProject()));

describe('MOTIONLAB V1 copy / paste layers', () => {
  it('pastes copies with new ids, keeping parent + matte links inside the set', () => {
    const rig = st().addNull(), dot = st().addEllipse(), mask = st().addRectangle(), outsider = st().addTextLayer();
    st().setParent(dot, rig);
    st().setMatte(dot, { layerId: mask, mode: 'alpha' });
    st().setMatte(mask, { layerId: outsider, mode: 'alpha' });           // points outside the copied set
    expect(st().copyLayers([rig, dot, mask])).toBe(3);
    expect(st().lastCopied()).toBe('layers');
    expect(st().pasteLayers()).toBe(3);
    const layers = st().project.layers;
    expect(layers).toHaveLength(7);
    const [pRig, pDot, pMask] = layers.slice(4);
    expect(new Set([pRig.id, pDot.id, pMask.id]).size).toBe(3);
    expect([pRig.id, pDot.id, pMask.id]).not.toContain(rig);
    expect(pDot.parentId).toBe(pRig.id);                                  // remapped
    expect(pDot.matte).toEqual({ layerId: pMask.id, mode: 'alpha' });     // remapped
    expect(pMask.matte).toBeUndefined();                                  // outsider wasn't copied
    expect(selectionOf(st())).toEqual([pRig.id, pDot.id, pMask.id]);      // pasted layers selected
    st().undo();
    expect(st().project.layers).toHaveLength(4);                          // one undo step
  });

  it('carries the media a layer needs into another project', () => {
    st().addAsset({ id: 'a1', kind: 'image', name: 'logo.png', mime: 'image/png', width: 400, height: 200, duration: 0, url: 'blob:x' });
    const img = st().addImageLayer(st().project.assets[0]);
    st().copyLayers([img]);
    st().replaceProject(defaultProject());                                // a different project
    st().pasteLayers();
    expect(st().project.assets.map((a) => a.id)).toEqual(['a1']);
    st().pasteLayers();                                                   // pasting again doesn't duplicate the asset
    expect(st().project.assets).toHaveLength(1);
    expect(st().project.layers).toHaveLength(2);
  });

  it('copying keyframes still marks keyframes as the last copy', () => {
    const id = st().addRectangle();
    st().toggleKeyframe(id, 'opacity');
    expect(st().copyKeyframesAt(id, 0)).toBeGreaterThan(0);
    expect(st().lastCopied()).toBe('keyframes');
  });
});
