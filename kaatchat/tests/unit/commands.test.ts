import { describe, expect, it } from 'vitest';
import { extractJson, validatePlan } from '../../src/engine/commands/schema';
import { applyCommand, previewPlan, CommandError } from '../../src/engine/commands/execute';
import { EditorStore } from '../../src/engine/store';
import { sequenceDuration } from '../../src/engine/timeline';
import type { ProjectIndex, Transcript } from '../../src/engine/types';
import { asset, clip, doc, envelope, projectOf, seqId } from './helpers';

const A = asset('A', 10);
const base = doc([clip('c1', 'A', 0, 10)], [A]);
const index: ProjectIndex = {
  A: {
    audio: envelope([
      [1, -80], // dead air at the head
      [3, -18],
      [2, -80], // pause in the middle
      [3, -24],
      [1, -80], // dead air at the tail
    ]),
    framing: { samples: [{ t: 5, x: 0.8, y: 0.4, weight: 1 }] },
  },
};
const ctx = { index, newId: seqId };

describe('plan validation', () => {
  it('accepts a well-formed plan and fills defaults', () => {
    const r = validatePlan({ summary: 'x', commands: [{ type: 'remove_silence' }, { type: 'set_aspect', aspect: '9:16' }] });
    expect(r.ok).toBe(true);
    expect(r.plan!.commands[0]).toEqual({ type: 'remove_silence', preset: 'balanced' });
  });

  it('rejects unknown commands, extra fields and bad values', () => {
    expect(validatePlan({ summary: 'x', commands: [{ type: 'rm_rf' }] }).ok).toBe(false);
    expect(validatePlan({ summary: 'x', commands: [{ type: 'set_aspect', aspect: '21:9' }] }).ok).toBe(false);
    expect(validatePlan({ summary: 'x', commands: [{ type: 'remove_fillers', shell: 'rm -rf /' }] }).ok).toBe(false);
    expect(validatePlan({ summary: 'x', commands: [{ type: 'keep_ranges', ranges: [{ start: 5, end: 2 }] }] }).ok).toBe(false);
    expect(validatePlan('not json').ok).toBe(false);
  });

  it('extracts JSON from fenced or chatty replies', () => {
    expect(extractJson('Sure!\n```json\n{"summary":"a","commands":[]}\n```')).toEqual({ summary: 'a', commands: [] });
    expect(extractJson('here {"a":"}{"} trailing')).toEqual({ a: '}{' });
    expect(() => extractJson('no json here')).toThrow();
    expect(() => extractJson('{"a": 1')).toThrow();
  });
});

describe('commands', () => {
  it('removes silence from the middle and the edges', () => {
    const r = applyCommand(base, { type: 'remove_silence', preset: 'balanced' }, ctx);
    const d = sequenceDuration(r.doc.clips);
    expect(d).toBeGreaterThan(6);
    expect(d).toBeLessThan(6.6);
    expect(r.notes[0]).toMatch(/Removed 3 quiet stretches/);
  });

  it('smart cuts only trims head and tail', () => {
    const r = applyCommand(base, { type: 'smart_cuts', preset: 'balanced' }, ctx);
    expect(r.doc.clips).toHaveLength(1);
    expect(r.doc.clips[0].in).toBeGreaterThan(0.8);
    expect(r.doc.clips[0].out).toBeLessThan(9.2);
  });

  it('matches levels toward the target', () => {
    const r = applyCommand(base, { type: 'match_levels', targetDb: -18 }, ctx);
    expect(r.doc.clips[0].gainDb).toBeGreaterThan(0);
    expect(r.doc.clips[0].gainDb).toBeLessThan(6);
  });

  it('reframes around measured detail', () => {
    const r = applyCommand(base, { type: 'reframe', mode: 'content' }, ctx);
    expect(r.doc.clips[0].focusX).toBeCloseTo(0.8);
    expect(r.notes[0]).toMatch(/Content-aware crop/);
  });

  it('refuses to remove fillers without a transcript', () => {
    expect(() => applyCommand(base, { type: 'remove_fillers' }, ctx)).toThrow(CommandError);
  });

  it('removes filler words using transcript timings', () => {
    const transcript: Transcript = {
      model: 't',
      language: 'en',
      createdAt: 0,
      segments: [
        {
          t0: 1,
          t1: 3,
          text: 'So, um, hello',
          words: [
            { t0: 1, t1: 1.3, text: 'So,' },
            { t0: 1.4, t1: 1.8, text: 'um,' },
            { t0: 1.9, t1: 2.5, text: 'hello' },
          ],
        },
      ],
    };
    const r = applyCommand(base, { type: 'remove_fillers' }, { index: { A: { ...index.A, transcript } }, newId: seqId });
    expect(sequenceDuration(r.doc.clips)).toBeCloseTo(9.6);
  });

  it('selects highlights up to the target length', () => {
    const r = applyCommand(base, { type: 'select_highlights', targetDuration: 4 }, ctx);
    expect(sequenceDuration(r.doc.clips)).toBeCloseTo(4, 1);
  });

  it('rejects references to clips that do not exist', () => {
    expect(() => applyCommand(base, { type: 'delete_clip', clipId: 'ghost' }, ctx)).toThrow(/No clip/);
  });
});

describe('plans and undo', () => {
  it('previews without changing the document and fails atomically', () => {
    const plan = validatePlan({
      summary: 'Reel',
      commands: [{ type: 'set_aspect', aspect: '9:16' }, { type: 'delete_clip', clipId: 'ghost' }],
    }).plan!;
    const p = previewPlan(base, plan, ctx);
    expect(p.ok).toBe(false);
    expect(p.steps[1].error).toMatch(/No clip/);
    expect(base.aspect).toBe('16:9');
  });

  it('refuses a plan that would empty the timeline', () => {
    const plan = validatePlan({ summary: 'x', commands: [{ type: 'delete_clip', clipId: 'c1' }] }).plan!;
    expect(previewPlan(base, plan, ctx).ok).toBe(false);
  });

  it('applies a whole plan as one undo step', () => {
    const store = new EditorStore(projectOf(base), index);
    const plan = validatePlan({
      summary: 'Reel',
      commands: [{ type: 'remove_silence' }, { type: 'set_aspect', aspect: '9:16' }, { type: 'reframe' }],
    }).plan!;
    store.applyPlan(plan, 'Make a reel');
    expect(store.doc.aspect).toBe('9:16');
    expect(store.doc.clips.length).toBeGreaterThan(1);
    expect(store.history).toHaveLength(1);
    store.undo();
    expect(store.doc.aspect).toBe('16:9');
    expect(store.doc.clips).toHaveLength(1);
    store.redo();
    expect(store.doc.aspect).toBe('9:16');
  });

  it('restores named versions as an undoable step', () => {
    const store = new EditorStore(projectOf(base), index);
    store.saveVersion('Original');
    store.run([{ type: 'set_aspect', aspect: '1:1' }], 'Square');
    store.restoreVersion(store.versions[0].id);
    expect(store.doc.aspect).toBe('16:9');
    store.undo();
    expect(store.doc.aspect).toBe('1:1');
  });
});
