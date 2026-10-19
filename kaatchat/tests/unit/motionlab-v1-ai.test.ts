import { beforeEach, describe, expect, it } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';
import { applyAIActions, extractJson } from '../../src/features/motionlab-v1/engine/aiActions';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';
import type { Layer } from '../../src/features/motionlab-v1/types';

const st = () => useV1.getState();
const layers = () => st().project.layers;
const byName = (n: string) => layers().find((l) => l.name === n) as Layer;

beforeEach(() => {
  st().replaceProject(defaultProject());
});

describe('MOTIONLAB V1 ✦ Ask actions', () => {
  it('adds a named text layer, styles and animates it — one undo removes it all', () => {
    const r = applyAIActions([
      { op: 'add_layer', type: 'text', text: 'Hello', name: 'Title' },
      { op: 'set_color', color: '#ff0000' },
      { op: 'preset', name: 'fade_in', duration: 1 },
    ]);
    expect(r).toEqual({ applied: 3, skipped: [] });
    const t = byName('Title');
    expect(t.type === 'text' && t.text).toBe('Hello');
    expect(t.type === 'text' && t.fill).toBe('#ff0000');
    expect(t.transform.opacity.keyframes?.map((k) => [k.time, k.value])).toEqual([[0, 0], [1, 1]]);
    expect(st().selectedLayerId).toBe(t.id);

    st().undo();
    expect(layers()).toHaveLength(0);
  });

  it('targets layers by name and edits the timeline', () => {
    applyAIActions([{ op: 'add_layer', type: 'rectangle', name: 'Box' }, { op: 'add_layer', type: 'ellipse', name: 'Dot' }]);
    const r = applyAIActions([
      { op: 'trim', layer: 'box', start: 1, end: 6 },
      { op: 'trim', layer: 'Dot', end: 3 },
      { op: 'move', layer: 'Dot', start: 2 },
      { op: 'rename', layer: 'Dot', name: 'Ball' },
      { op: 'split', layer: 'Box', time: 3 },
    ]);
    expect(r.skipped).toEqual([]);
    const boxes = layers().filter((l) => l.name.startsWith('Box'));
    expect(boxes).toHaveLength(2);
    expect(boxes.map((b) => [b.startTime, +(b.startTime + b.duration).toFixed(3)]).sort()).toEqual([[1, 3], [3, 6]]);
    expect(byName('Ball').startTime).toBe(2);

    applyAIActions([{ op: 'delete', layer: 'Ball' }]);
    expect(layers().some((l) => l.name === 'Ball')).toBe(false);
  });

  it('presets key from the current value: slide in from the left, pop, spin, fade out at the clip end', () => {
    applyAIActions([{ op: 'add_layer', type: 'rectangle', name: 'R' }]);
    const comp = st().project.composition;
    const [x, y] = byName('R').transform.position.default;
    applyAIActions([
      { op: 'trim', end: 5 },
      { op: 'preset', name: 'slide_in_left', duration: 0.5 },
      { op: 'preset', name: 'pop', duration: 1, at: 2 },
      { op: 'preset', name: 'spin', duration: 1, at: 3 },
      { op: 'preset', name: 'fade_out', duration: 1 },
    ]);
    const tr = byName('R').transform;
    expect(tr.position.keyframes?.map((k) => k.value)).toEqual([[x - comp.width * 0.3, y], [x, y]]);
    expect(tr.scale.keyframes?.map((k) => [k.time, k.value])).toEqual([[2, [0, 0]], [2.7, [1.1, 1.1]], [3, [1, 1]]]);
    expect(tr.rotation.keyframes?.map((k) => k.value)).toEqual([-360, 0]);
    const op = tr.opacity.keyframes!.map((k) => [k.time, k.value]);
    expect(op.slice(-2)).toEqual([[4, 1], [5, 0]]);
  });

  it('skips invalid actions with reasons and never throws', () => {
    expect(applyAIActions('nope').skipped).toEqual(['reply had no action list']);
    const r = applyAIActions([
      { op: 'set', path: 'opacity', value: 0.5 },                       // nothing selected
      { op: 'add_layer', type: 'video' },
      { op: 'add_layer', type: 'ellipse' },
      { op: 'set', path: 'opacity', value: 'loud' },
      { op: 'set', path: 'position', value: [1] },
      { op: 'set', path: 'secret', value: 1 },
      { op: 'set_text', text: 'x' },                                    // ellipse isn't text
      { op: 'set_color', color: 'red' },
      { op: 'trim', layer: 'Ghost', start: 1 },
      { op: 'split', time: 99 },
      { op: 'comp', duration: -3 },
      { op: 'teleport' },
      null,
      { op: 'set', path: 'scale', value: [1.5, 1.5] },                  // valid
    ]);
    expect(r.applied).toBe(2);
    expect(r.skipped).toHaveLength(12);
    expect(layers()[0].transform.scale.default).toEqual([1.5, 1.5]);
  });

  it('extracts JSON from fenced or chatty replies', () => {
    expect(JSON.parse(extractJson('Sure!\n```json\n{"actions":[]}\n```'))).toEqual({ actions: [] });
    expect(JSON.parse(extractJson('Here: {"actions":[{"op":"delete"}]} done'))).toEqual({ actions: [{ op: 'delete' }] });
    expect(() => extractJson('no json here')).toThrow();
  });
});

import { parseLocalCommand } from '../../src/features/motionlab-v1/engine/aiLocal';

describe('MOTIONLAB V1 offline ✦ Ask parser', () => {
  const p = (s: string) => parseLocalCommand(s, 4);
  it('turns common phrases into actions', () => {
    expect(p('add a title "Hello, world" and pop it in')).toEqual([
      { op: 'add_layer', type: 'text', text: 'Hello, world' },
      { op: 'preset', name: 'pop' },
    ]);
    expect(p('Add text saying Big Sale')).toEqual([{ op: 'add_layer', type: 'text', text: 'Big Sale' }]);
    expect(p('add a circle, make it blue, slide in from the top over 0.8s')).toEqual([
      { op: 'add_layer', type: 'ellipse' },
      { op: 'set_color', color: '#0a84ff' },
      { op: 'preset', name: 'slide_in_down', duration: 0.8 },
    ]);
    expect(p('fade in over 500ms then fade out')).toEqual([
      { op: 'preset', name: 'fade_in', duration: 0.5 },
      { op: 'preset', name: 'fade_out' },
    ]);
    expect(p('spin at 2s')).toEqual([{ op: 'preset', name: 'spin', at: 2 }]);
    expect(p('trim to 3s')).toEqual([{ op: 'trim', length: 3 }]);
    expect(p('start at 1.5s')).toEqual([{ op: 'move', start: 1.5 }]);
    expect(p('split')).toEqual([{ op: 'split', time: 4 }]);
    expect(p('rename to "Logo"')).toEqual([{ op: 'rename', name: 'Logo' }]);
    expect(p('change the text to Welcome')).toEqual([{ op: 'set_text', text: 'Welcome' }]);
    expect(p('opacity 50%')).toEqual([{ op: 'set', path: 'opacity', value: 0.5 }]);
    expect(p('scale 120%')).toEqual([{ op: 'set', path: 'scale', value: [1.2, 1.2] }]);
    expect(p('make the video 8 seconds')).toEqual([{ op: 'comp', duration: 8 }]);
    expect(p('delete it')).toEqual([{ op: 'delete' }]);
  });
  it('returns nothing for phrases it does not know', () => {
    expect(p('write me a poem about cats')).toEqual([]);
  });
  it('round-trips through the validator', () => {
    const r = applyAIActions(p('add a title "Hi" and fade in over 1s, make it red, trim to 3s'));
    expect(r).toEqual({ applied: 4, skipped: [] });
    const t = layers()[0];
    expect(t.type === 'text' && [t.text, t.fill]).toEqual(['Hi', '#ff3b30']);
    expect(t.duration).toBe(3);
  });
});
