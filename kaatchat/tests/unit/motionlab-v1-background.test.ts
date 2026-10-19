import { beforeEach, describe, expect, it } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';
import { applyAIActions } from '../../src/features/motionlab-v1/engine/aiActions';
import { parseLocalCommand } from '../../src/features/motionlab-v1/engine/aiLocal';

const st = () => useV1.getState();
beforeEach(() => st().replaceProject(defaultProject()));

describe('MOTIONLAB V1 composition background', () => {
  it('sets a valid colour, ignores junk, undoes', () => {
    st().setBackground('#123456');
    expect(st().project.composition.background).toBe('#123456');
    st().setBackground('red; drop table');
    expect(st().project.composition.background).toBe('#123456');
    st().undo();
    expect(st().project.composition.background).toBe('#000000');
  });
  it('✦ Ask: "make the background navy", comp with duration and/or background', () => {
    expect(parseLocalCommand('make the background navy', 0)).toEqual([{ op: 'comp', background: '#0b1a33' }]);
    expect(applyAIActions(parseLocalCommand('make the background white', 0)).skipped).toEqual([]);
    expect(st().project.composition.background).toBe('#ffffff');
    expect(applyAIActions([{ op: 'comp', duration: 6, background: '#222' }]).skipped).toEqual([]);
    expect(st().project.composition.duration).toBe(6);
    expect(applyAIActions([{ op: 'comp' }]).skipped).toHaveLength(1);
    expect(applyAIActions([{ op: 'comp', background: 'url(x)' }]).skipped).toHaveLength(1);
    expect(applyAIActions(parseLocalCommand('make the video 8 seconds', 0)).skipped).toEqual([]); // old form still works
  });
});
