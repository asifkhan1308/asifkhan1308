import { beforeEach, describe, expect, it } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';
import { applyAIActions } from '../../src/features/motionlab-v1/engine/aiActions';
import { parseLocalCommand } from '../../src/features/motionlab-v1/engine/aiLocal';
import { resolveAnimated } from '../../src/features/motionlab-v1/engine/interp';
import type { TextLayer } from '../../src/features/motionlab-v1/types';

const st = () => useV1.getState();
const text = (id: string) => st().project.layers.find((l) => l.id === id) as TextLayer;
beforeEach(() => st().replaceProject(defaultProject()));

describe('MOTIONLAB V1 text animators', () => {
  it('turning one on adds a 0 → 100 % reveal; turning it off restores the full text', () => {
    const id = st().addTextLayer();
    st().setTextAnimator(id, 'letters');
    const t = text(id);
    expect(t.revealMode).toBe('letters');
    expect(t.reveal!.keyframes!.map((k) => k.value)).toEqual([0, 1]);
    expect(resolveAnimated(t.reveal!, 0)).toBe(0);
    expect(resolveAnimated(t.reveal!, 5)).toBe(1);
    st().setTextAnimator(id, 'words');                                  // switching keeps the keys
    expect(text(id).reveal!.keyframes).toEqual(t.reveal!.keyframes);
    st().setTextAnimator(id, null);
    expect(text(id).revealMode).toBeUndefined();
    expect(text(id).reveal).toBeUndefined();
  });

  it('the Reveal amount is keyframable like any property (and shows on the timeline)', () => {
    const id = st().addTextLayer();
    st().setTextAnimator(id, 'typewriter');
    st().setCurrentTime(3);
    st().setPropertyBase(id, 'reveal', 0.25);                           // auto-keys (already animated)
    expect(text(id).reveal!.keyframes!.some((k) => k.time === 3 && k.value === 0.25)).toBe(true);
  });

  it('✦ Ask: typewriter / letter by letter / word by word; not for shapes', () => {
    expect(parseLocalCommand('typewriter over 2s', 0)).toEqual([{ op: 'preset', name: 'typewriter', duration: 2 }]);
    expect(parseLocalCommand('reveal it letter by letter', 0)).toEqual([{ op: 'preset', name: 'letters_in' }]);
    expect(parseLocalCommand('word by word at 1s', 0)).toEqual([{ op: 'preset', name: 'words_in', at: 1 }]);
    const r = applyAIActions(parseLocalCommand('add a title "Hello there" and typewriter over 2s', 0));
    expect(r.skipped).toEqual([]);
    const t = st().project.layers[0] as TextLayer;
    expect(t.revealMode).toBe('typewriter');
    expect(t.reveal!.keyframes!.map((k) => [k.time, k.value])).toEqual([[0, 0], [2, 1]]);
    expect(applyAIActions([{ op: 'add_layer', type: 'rectangle' }, { op: 'preset', name: 'typewriter' }]).skipped[0]).toMatch(/text layer/);
  });
});
