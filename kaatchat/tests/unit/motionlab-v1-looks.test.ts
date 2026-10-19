import { beforeEach, describe, expect, it } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';
import { AI_SYSTEM, applyAIActions, LOOK_NAMES } from '../../src/features/motionlab-v1/engine/aiActions';
import { parseLocalCommand } from '../../src/features/motionlab-v1/engine/aiLocal';
import type { Layer } from '../../src/features/motionlab-v1/types';

const st = () => useV1.getState();
const fx = () => (st().project.layers[0] as Layer).effects!;
beforeEach(() => st().replaceProject(defaultProject()));

describe('MOTIONLAB V1 one-word looks', () => {
  it('parses looks (incl. "black and white" as a look, not a colour)', () => {
    expect(parseLocalCommand('make it cinematic', 0)).toEqual([{ op: 'look', name: 'cinematic' }]);
    expect(parseLocalCommand('make it black and white', 0)).toEqual([{ op: 'look', name: 'black-and-white' }]);
    expect(parseLocalCommand('retro look', 0)).toEqual([{ op: 'look', name: 'vintage' }]);
    expect(parseLocalCommand('reset the look', 0)).toEqual([{ op: 'look', name: 'none' }]);
    expect(AI_SYSTEM).toContain('"cinematic"');
  });

  it('applies every look cleanly, and "none" resets to neutral', () => {
    applyAIActions([{ op: 'add_layer', type: 'rectangle' }]);
    for (const name of LOOK_NAMES) expect(applyAIActions([{ op: 'look', name }]).skipped).toEqual([]);
    applyAIActions(parseLocalCommand('make it black and white', 0));
    expect(fx().saturation.default).toBe(-1);
    applyAIActions(parseLocalCommand('make it cinematic', 0));
    expect(fx().saturation.default).toBeCloseTo(-0.15);
    expect(fx().tintColor).toBe('#ffb46b');
    applyAIActions(parseLocalCommand('reset the look', 0));
    for (const k of ['brightness', 'contrast', 'saturation', 'vignette', 'grain', 'tintAmount', 'glow'] as const) expect(fx()[k]!.default).toBe(0);
    st().undo();
    expect(fx().saturation.default).toBeCloseTo(-0.15);                 // one undo per look
  });

  it('refuses looks on nulls and unknown names', () => {
    applyAIActions([{ op: 'add_layer', type: 'null' }]);
    expect(applyAIActions([{ op: 'look', name: 'cinematic' }]).skipped[0]).toMatch(/no look/);
    applyAIActions([{ op: 'add_layer', type: 'ellipse' }]);
    expect(applyAIActions([{ op: 'look', name: 'sepia-vibes' }]).skipped[0]).toMatch(/unknown look/);
  });
});
