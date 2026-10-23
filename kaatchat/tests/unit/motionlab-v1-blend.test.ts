import { beforeEach, describe, expect, it } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';
import { compositeOp } from '../../src/features/motionlab-v1/engine/compose';
import { applyAIActions } from '../../src/features/motionlab-v1/engine/aiActions';
import { parseLocalCommand } from '../../src/features/motionlab-v1/engine/aiLocal';
import { BLEND_MODES, type BlendMode } from '../../src/features/motionlab-v1/types';

const st = () => useV1.getState();
beforeEach(() => st().replaceProject(defaultProject()));

describe('MOTIONLAB V1 blend modes', () => {
  it('maps to canvas composite operations; unknown / normal draw normally', () => {
    expect(compositeOp(undefined)).toBe('source-over');
    expect(compositeOp('normal')).toBe('source-over');
    expect(compositeOp('add')).toBe('lighter');
    expect(compositeOp('soft-light')).toBe('soft-light');
    expect(compositeOp('bogus' as BlendMode)).toBe('source-over');
    for (const m of BLEND_MODES) expect(typeof compositeOp(m)).toBe('string');
  });

  it('✦ Ask: offline phrases and the action', () => {
    expect(parseLocalCommand('blend multiply', 0)).toEqual([{ op: 'blend', mode: 'multiply' }]);
    expect(parseLocalCommand('set the blend mode to screen', 0)).toEqual([{ op: 'blend', mode: 'screen' }]);
    expect(parseLocalCommand('use soft light blending', 0)).toEqual([{ op: 'blend', mode: 'soft-light' }]);
    expect(parseLocalCommand('overlay blend', 0)).toEqual([{ op: 'blend', mode: 'overlay' }]);
    expect(parseLocalCommand('normal blend', 0)).toEqual([{ op: 'blend', mode: 'normal' }]);
    const r = applyAIActions(parseLocalCommand('add a rectangle and blend multiply', 0));
    expect(r.skipped).toEqual([]);
    expect(st().project.layers[0].blend).toBe('multiply');
    applyAIActions([{ op: 'blend', mode: 'Color Dodge' }]);
    expect(st().project.layers[0].blend).toBe('color-dodge');
    applyAIActions([{ op: 'blend', mode: 'normal' }]);
    expect(st().project.layers[0].blend).toBeUndefined();
    expect(applyAIActions([{ op: 'blend', mode: 'sparkle' }]).skipped[0]).toMatch(/unknown blend/);
  });
});
