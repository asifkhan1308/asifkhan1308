import { beforeEach, describe, expect, it } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';
import { worldCorners } from '../../src/features/motionlab-v1/engine/bbox';
import { aabb } from '../../src/features/motionlab-v1/engine/guides';
import { applyAIActions } from '../../src/features/motionlab-v1/engine/aiActions';
import { parseLocalCommand } from '../../src/features/motionlab-v1/engine/aiLocal';

const st = () => useV1.getState();
const box = (id: string) => aabb(worldCorners(st().project.layers.find((l) => l.id === id)!, st().currentTime, st().project.assets, st().project.layers)!.corners);
beforeEach(() => st().replaceProject(defaultProject()));

describe('MOTIONLAB V1 align to frame', () => {
  it('aligns every edge of a rotated layer exactly to the frame', () => {
    const id = st().addRectangle();
    st().setPropertyBase(id, 'rotation', 30);
    st().setPropertyBase(id, 'position', [300, 200]);
    st().alignToFrame(id, 'left'); expect(box(id).minX).toBeCloseTo(0, 1);
    st().alignToFrame(id, 'right'); expect(box(id).maxX).toBeCloseTo(1920, 1);
    st().alignToFrame(id, 'top'); expect(box(id).minY).toBeCloseTo(0, 1);
    st().alignToFrame(id, 'bottom'); expect(box(id).maxY).toBeCloseTo(1080, 1);
    st().alignToFrame(id, 'hcenter'); st().alignToFrame(id, 'vcenter');
    const b = box(id);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(960, 1);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(540, 1);
  });

  it('works for a layer inside a rotated, scaled parent', () => {
    const nul = st().addNull(), id = st().addEllipse();
    st().setParent(id, nul);
    st().setPropertyBase(nul, 'rotation', 90);
    st().setPropertyBase(nul, 'scale', [1.5, 1.5]);
    st().alignToFrame(id, 'right');
    expect(box(id).maxX).toBeCloseTo(1920, 1);
  });

  it('✦ Ask: "center it" and "align to the bottom"', () => {
    expect(parseLocalCommand('center it', 0)).toEqual([{ op: 'align', edge: 'hcenter' }, { op: 'align', edge: 'vcenter' }]);
    expect(parseLocalCommand('align to the bottom', 0)).toEqual([{ op: 'align', edge: 'bottom' }]);
    applyAIActions([{ op: 'add_layer', type: 'rectangle' }, { op: 'set', path: 'position', value: [100, 100] }]);
    const id = st().project.layers[0].id;
    expect(applyAIActions(parseLocalCommand('align to the bottom', 0)).skipped).toEqual([]);
    expect(box(id).maxY).toBeCloseTo(1080, 1);
  });
});
