import { beforeEach, describe, expect, it } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';
import { applyAIActions } from '../../src/features/motionlab-v1/engine/aiActions';
import { parseLocalCommand } from '../../src/features/motionlab-v1/engine/aiLocal';

const st = () => useV1.getState();
beforeEach(() => st().replaceProject(defaultProject()));

describe('MOTIONLAB V1 gradient fills', () => {
  it('✦ Ask sets a gradient; a solid colour clears it; bad input is skipped', () => {
    expect(parseLocalCommand('gradient from blue to purple at 45', 0)).toEqual([{ op: 'set_gradient', from: '#0a84ff', to: '#af52de', angle: 45 }]);
    applyAIActions([{ op: 'add_layer', type: 'rectangle' }]);
    const r = applyAIActions(parseLocalCommand('gradient from #000 to white', 0));
    expect(r.skipped).toEqual([]);
    const rect = () => st().project.layers[0] as { gradient?: unknown; fill: string };
    expect(rect().gradient).toEqual({ from: '#000', to: '#ffffff', angle: 90 });
    applyAIActions([{ op: 'set_color', color: '#ff0000' }]);
    expect(rect().gradient).toBeUndefined();
    expect(rect().fill).toBe('#ff0000');
    expect(applyAIActions([{ op: 'set_gradient', from: 'red', to: '#fff' }]).skipped).toHaveLength(1);
    applyAIActions([{ op: 'add_layer', type: 'null' }]);
    expect(applyAIActions([{ op: 'set_gradient', from: '#000', to: '#fff' }]).skipped[0]).toMatch(/no fill/);
  });
});
