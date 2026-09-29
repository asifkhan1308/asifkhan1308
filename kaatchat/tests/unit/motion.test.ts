import { describe, expect, it } from 'vitest';
import { ease, effectsFilter, interpolate, keyedState, overlayState, transitionWindows, LOOKS } from '../../src/engine/motion';
import { textOverlay } from '../../src/engine/overlays';
import { applyCommand } from '../../src/engine/commands/execute';
import { validatePlan } from '../../src/engine/commands/schema';
import { rulePlan } from '../../src/ai/planner';
import { clipStarts } from '../../src/engine/timeline';
import { NEUTRAL_EFFECTS } from '../../src/engine/types';
import { asset, clip, doc, seqId } from './helpers';

const view = doc([clip('a', 'A', 0, 4), clip('b', 'A', 6, 10), clip('c', 'A', 12, 15)], [asset('A', 20)]);
const ctx = { index: {}, newId: seqId };

describe('easing and keyframes', () => {
  it('eases between 0 and 1', () => {
    for (const k of ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'back-out', 'elastic-out'] as const) {
      expect(ease(k, 0)).toBeCloseTo(0);
      expect(ease(k, 1)).toBeCloseTo(1);
    }
    expect(ease('back-out', 0.6)).toBeGreaterThan(1); // overshoots
  });

  it('interpolates only properties a keyframe sets', () => {
    const keys = [
      { t: 0, x: 0.2 },
      { t: 2, x: 0.8, easing: 'linear' as const },
      { t: 1, opacity: 0.5 },
    ];
    expect(interpolate(keys, 'x', 1, 0.5)).toBeCloseTo(0.5);
    expect(interpolate(keys, 'x', 5, 0.5)).toBeCloseTo(0.8);
    expect(interpolate(keys, 'opacity', 0, 1)).toBeCloseTo(0.5);
    expect(interpolate(keys, 'scale', 1, 1.3)).toBe(1.3);
  });
});

describe('animation presets', () => {
  const o = textOverlay('t', 'Hello big world', 0, 4, { anim: 'fade' });
  it('fades in and out', () => {
    expect(overlayState(o, 0).opacity).toBeCloseTo(0);
    expect(overlayState(o, 2).opacity).toBeCloseTo(1);
    expect(overlayState(o, 3.99).opacity).toBeLessThan(0.1);
  });
  it('typewriter reveals characters over time', () => {
    const t = { ...o, animIn: 'typewriter' as const };
    expect(overlayState(t, 0.1).reveal).toBeCloseTo(0.25);
    expect(overlayState(t, 1).reveal).toBe(1);
  });
  it('kinetic text steps through words', () => {
    const k = { ...o, animIn: 'kinetic' as const };
    expect(overlayState(k, 0.5).kineticWord).toBe(0);
    expect(overlayState(k, 3.5).kineticWord).toBe(2);
  });
  it('keyed values ignore in/out animation (so keyframes never capture a fade)', () => {
    expect(overlayState(o, 0).opacity).toBeCloseTo(0);
    expect(keyedState(o, 0).opacity).toBe(1);
  });
  it('pop overshoots scale, slide moves', () => {
    expect(overlayState({ ...o, animIn: 'pop' }, 0.3).scale).toBeGreaterThan(1);
    expect(overlayState({ ...o, animIn: 'slide-up' }, 0.1).y).toBeGreaterThan(o.y);
  });
});

describe('effects', () => {
  it('builds a filter only for what is set', () => {
    expect(effectsFilter(NEUTRAL_EFFECTS, 1080)).toBe('none');
    const f = effectsFilter({ ...NEUTRAL_EFFECTS, exposure: 1, contrast: 0.2, saturation: -1, blur: 0.5 }, 1000);
    expect(f).toBe('brightness(2.000) contrast(1.200) saturate(0.000) blur(10.00px)');
  });
  it('every look is valid effects', () => {
    for (const l of Object.values(LOOKS)) for (const k of Object.keys(l.effects)) expect(k in NEUTRAL_EFFECTS).toBe(true);
  });
});

describe('transitions', () => {
  it('centres windows on cuts and never exceeds either clip', () => {
    const clips = [clip('a', 'A', 0, 4), { ...clip('b', 'A', 6, 6.4), transition: { kind: 'dissolve' as const, duration: 1 } }];
    const w = transitionWindows(clips, clipStarts(clips));
    expect(w).toHaveLength(1);
    expect(w[0].boundary).toBe(4);
    expect(w[0].end - w[0].start).toBeCloseTo(0.4);
  });
});

describe('motion commands', () => {
  it('adds text, looks, transitions and punch-ins', () => {
    let v = applyCommand(view, { type: 'add_text', text: 'Hello', start: 1, duration: 2, position: 'lower-third', animation: 'kinetic' }, ctx).doc;
    expect(v.overlays[0]).toMatchObject({ text: 'Hello', start: 1, animIn: 'kinetic', align: 'left' });
    v = applyCommand(v, { type: 'set_look', look: 'bw' }, ctx).doc;
    expect(v.clips.every((c) => c.effects?.saturation === -1)).toBe(true);
    v = applyCommand(v, { type: 'set_transitions', kind: 'whip', duration: 0.3 }, ctx).doc;
    expect(v.clips.map((c) => c.transition?.kind)).toEqual([undefined, 'whip', 'whip']);
    v = applyCommand(v, { type: 'punch_in', amount: 1.2, pattern: 'alternate' }, ctx).doc;
    expect(v.clips.map((c) => c.scale)).toEqual([1, 1.2, 1]);
    v = applyCommand(v, { type: 'set_transitions', kind: 'cut', duration: 0.5 }, ctx).doc;
    expect(v.clips.every((c) => !c.transition)).toBe(true);
  });

  it('the rules planner understands looks, transitions, titles and punch-ins', () => {
    const p = rulePlan('make it black and white with dissolve transitions and punch-ins, add a title "Chapter 1"', view, {}, 2)!;
    const types = p.commands.map((c) => c.type);
    expect(types).toEqual(expect.arrayContaining(['set_look', 'set_transitions', 'punch_in', 'add_text']));
    expect(p.commands.find((c) => c.type === 'add_text')).toMatchObject({ text: 'Chapter 1', start: 2 });
  });

  it('rejects unknown looks and animations from models', () => {
    expect(validatePlan({ summary: '', commands: [{ type: 'set_look', look: 'teal-orange-9000' }] }).ok).toBe(false);
    expect(validatePlan({ summary: '', commands: [{ type: 'add_text', text: 'x', animation: 'explode' }] }).ok).toBe(false);
  });
});
