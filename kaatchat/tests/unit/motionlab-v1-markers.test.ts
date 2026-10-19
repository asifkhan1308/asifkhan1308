import { beforeEach, describe, expect, it } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';
import { applyAIActions } from '../../src/features/motionlab-v1/engine/aiActions';
import { parseLocalCommand } from '../../src/features/motionlab-v1/engine/aiLocal';

const st = () => useV1.getState();
beforeEach(() => st().replaceProject(defaultProject()));

describe('MOTIONLAB V1 timeline markers', () => {
  it('adds (one per moment, sorted), renames, removes, undoes', () => {
    const a = st().addMarker(4);
    st().addMarker(1.5, 'Intro');
    expect(st().addMarker(4.004)).toBe(a);                               // same moment → same marker
    expect(st().project.markers!.map((m) => [m.time, m.label])).toEqual([[1.5, 'Intro'], [4, 'Marker 1']]);
    st().renameMarker(a, 'Drop');
    st().renameMarker(a, '   ');                                          // blank keeps the old name
    expect(st().project.markers![1].label).toBe('Drop');
    st().removeMarker(a);
    expect(st().project.markers).toHaveLength(1);
    st().undo();
    expect(st().project.markers).toHaveLength(2);
    expect(st().addMarker(999)).toBeTruthy();                              // clamped to the comp
    expect(st().project.markers!.at(-1)!.time).toBe(10);
  });

  it('✦ Ask: "add a marker called Drop at 2s"', () => {
    expect(parseLocalCommand('add a marker called "Drop" at 2s', 0)).toEqual([{ op: 'marker', label: 'Drop', time: 2 }]);
    expect(parseLocalCommand('drop a marker', 0)).toEqual([{ op: 'marker' }]);
    st().setCurrentTime(3);
    expect(applyAIActions(parseLocalCommand('add a marker called Drop at 2s, then add a marker', 3)).skipped).toEqual([]);
    expect(st().project.markers!.map((m) => [m.time, m.label])).toEqual([[2, 'Drop'], [3, 'Marker 2']]);
  });
});
