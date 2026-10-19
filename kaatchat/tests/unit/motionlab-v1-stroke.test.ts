import { beforeEach, describe, expect, it } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';
import { applyAIActions } from '../../src/features/motionlab-v1/engine/aiActions';
import { parseLocalCommand } from '../../src/features/motionlab-v1/engine/aiLocal';

const st = () => useV1.getState();
beforeEach(() => st().replaceProject(defaultProject()));

describe('MOTIONLAB V1 stroke via ✦ Ask', () => {
  it('parses outline phrases and applies / removes a stroke', () => {
    expect(parseLocalCommand('outline it white 4px', 0)).toEqual([{ op: 'set_stroke', color: '#ffffff', width: 4 }]);
    expect(parseLocalCommand('stroke 6px black', 0)).toEqual([{ op: 'set_stroke', color: '#000000', width: 6 }]);
    expect(parseLocalCommand('no outline', 0)).toEqual([{ op: 'set_stroke', color: null }]);
    applyAIActions([{ op: 'add_layer', type: 'ellipse' }]);
    expect(applyAIActions(parseLocalCommand('outline it red 8px', 0)).skipped).toEqual([]);
    const e = () => st().project.layers[0] as { stroke: string | null; strokeWidth: number };
    expect([e().stroke, e().strokeWidth]).toEqual(['#ff3b30', 8]);
    applyAIActions(parseLocalCommand('no outline', 0));
    expect(e().stroke).toBeNull();
    expect(applyAIActions([{ op: 'set_stroke', color: 'blue' }]).skipped).toHaveLength(1);
  });
});
