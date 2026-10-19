import { beforeEach, describe, expect, it } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';
import { applyAIActions } from '../../src/features/motionlab-v1/engine/aiActions';
import { parseLocalCommand } from '../../src/features/motionlab-v1/engine/aiLocal';

const st = () => useV1.getState();
const byName = (n: string) => st().project.layers.find((l) => l.name === n)!;
beforeEach(() => st().replaceProject(defaultProject()));

describe('MOTIONLAB V1 track mattes', () => {
  it('sets, validates, clears and undoes a matte', () => {
    const a = st().addRectangle(), b = st().addEllipse();
    expect(st().setMatte(a, { layerId: b, mode: 'alpha' })).toBe(true);
    expect(st().project.layers.find((l) => l.id === a)!.matte).toEqual({ layerId: b, mode: 'alpha' });
    expect(st().setMatte(a, { layerId: a, mode: 'alpha' })).toBe(false);           // not itself
    expect(st().setMatte(a, { layerId: 'ghost', mode: 'alpha' })).toBe(false);     // must exist
    st().undo();
    expect(st().project.layers.find((l) => l.id === a)!.matte).toBeUndefined();
  });

  it('deleting the matte layer clears the reference', () => {
    const a = st().addRectangle(), b = st().addEllipse();
    st().setMatte(a, { layerId: b, mode: 'alpha-inverted' });
    st().removeLayer(b);
    expect(st().project.layers.find((l) => l.id === a)!.matte).toBeUndefined();
  });

  it('✦ Ask: "use X as matte", inverted, and "remove the matte" does NOT delete the layer', () => {
    expect(parseLocalCommand('use "Shape" as matte', 0)).toEqual([{ op: 'matte', to: 'Shape' }]);
    expect(parseLocalCommand('mask it with Shape inverted', 0)).toEqual([{ op: 'matte', to: 'Shape', inverted: true }]);
    expect(parseLocalCommand('remove the matte', 0)).toEqual([{ op: 'matte', to: null }]);
    applyAIActions([{ op: 'add_layer', type: 'ellipse', name: 'Shape' }, { op: 'add_layer', type: 'text', name: 'Title', text: 'Hi' }]);
    expect(applyAIActions(parseLocalCommand('mask it with Shape inverted', 0)).skipped).toEqual([]);
    expect(byName('Title').matte).toEqual({ layerId: byName('Shape').id, mode: 'alpha-inverted' });
    applyAIActions(parseLocalCommand('remove the matte', 0));
    expect(byName('Title')).toBeDefined();
    expect(byName('Title').matte).toBeUndefined();
    expect(applyAIActions([{ op: 'matte', layer: 'Title', to: 'Title' }]).skipped).toHaveLength(1);
  });
});
