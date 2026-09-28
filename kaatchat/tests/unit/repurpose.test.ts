import { describe, expect, it } from 'vitest';
import { buildShort, candidateMoments, loudestSentences, topicUnitSet } from '../../src/engine/repurpose';
import { applyCommand } from '../../src/engine/commands/execute';
import { EditorStore } from '../../src/engine/store';
import { findClips, suggestHooks } from '../../src/ai/planner';
import { createProvider } from '../../src/ai/providers';
import { sequenceDuration } from '../../src/engine/timeline';
import type { AIProvider } from '../../src/ai/types';
import type { ProjectIndex, Transcript } from '../../src/engine/types';

import { asset, clip, doc, envelope, projectOf, seqId } from './helpers';

// 60 s talk: six 10 s sentences; sentence 4 (30–40 s) is the loudest.
const sentences = ['Welcome to the show.', 'Today we cover budgets.', 'Money is a tool.', 'AI changes how we design everything!', 'Thanks for listening.', 'See you next week.'];
const transcript: Transcript = {
  model: 't',
  language: 'en',
  createdAt: 0,
  segments: sentences.map((text, i) => ({
    t0: i * 10 + 0.5,
    t1: i * 10 + 9.5,
    text,
    words: text.split(' ').map((w, k, arr) => ({ t0: i * 10 + 0.5 + (k * 9) / arr.length, t1: i * 10 + 0.5 + ((k + 1) * 9) / arr.length, text: w })),
  })),
};
const index: ProjectIndex = {
  A: {
    audio: envelope([
      [30, -24],
      [10, -12],
      [20, -26],
    ]),
    transcript,
    framing: { samples: [{ t: 30, x: 0.7, y: 0.5, weight: 1 }] },
  },
};
const view = doc([clip('c1', 'A', 0, 60)], [asset('A', 60)]);

function fake(reply: string): AIProvider {
  return {
    info: { ...createProvider('openai', { enabled: true, model: 'x' }).info },
    async generateText() {
      return reply;
    },
    async testConnection() {
      return 'ok';
    },
  };
}

describe('candidate moments', () => {
  it('prefers the most energetic stretch and never overlaps', () => {
    const c = candidateMoments(view, index, 3, 10);
    expect(c.length).toBeGreaterThan(0);
    expect(c.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < c.length; i++) expect(c[i].start).toBeGreaterThanOrEqual(c[i - 1].end);
    expect(c.some((m) => m.start <= 30.5 && m.end >= 39.5)).toBe(true);
    expect(c[0].why).toMatch(/measured/);
  });

  it('keeps only moments that mention a topic', () => {
    const topic = topicUnitSet(view, index, 'money');
    const c = candidateMoments(view, index, 3, 10, topic);
    expect(c).toHaveLength(1);
    expect(c[0].title).toMatch(/Money/);
    expect(topicUnitSet(view, index, 'blender').size).toBe(0);
  });
});

describe('building shorts', () => {
  it('cuts, reframes and captions a moment into a new sequence', () => {
    const r = buildShort(view, index, { start: 30, end: 40 }, 'Clip 01', { target: 30, aspect: '9:16', pace: 'punchy', captions: true, captionStyle: 'kinetic' }, seqId);
    expect(r.sequence.aspect).toBe('9:16');
    expect(r.sequence.captions).toMatchObject({ enabled: true, style: 'kinetic' });
    expect(r.sequence.clips[0].focusX).toBeCloseTo(0.7);
    const d = sequenceDuration(r.sequence.clips);
    expect(d).toBeGreaterThan(8);
    expect(d).toBeLessThanOrEqual(10);
    expect(r.sequence.sourceSequenceId).toBe(view.id);
  });

  it('respects the target length', () => {
    const r = buildShort(view, index, { start: 0, end: 60 }, 'Short', { target: 15, aspect: '9:16', pace: 'clean', captions: false, captionStyle: 'bold' }, seqId);
    expect(sequenceDuration(r.sequence.clips)).toBeCloseTo(15, 0);
  });

  it('creates many sequences in one undo step', () => {
    const s = new EditorStore(projectOf(view), index);
    s.repurpose(candidateMoments(view, index, 3, 10), { target: 10, aspect: '9:16', pace: 'punchy', captions: true, captionStyle: 'bold' });
    expect(s.sequences.length).toBe(4);
    expect(s.doc.name).toBe('Clip 01');
    s.undo();
    expect(s.sequences.length).toBe(1);
  });
});

describe('hooks', () => {
  it('prepend_range copies or moves a line to the start', () => {
    const copy = applyCommand(view, { type: 'prepend_range', start: 30, end: 40, removeOriginal: false }, { index, newId: seqId }).doc;
    expect(sequenceDuration(copy.clips)).toBeCloseTo(70);
    expect(copy.clips[0]).toMatchObject({ in: 30, out: 40 });
    const moved = applyCommand(view, { type: 'prepend_range', start: 30, end: 40, removeOriginal: true }, { index, newId: seqId }).doc;
    expect(sequenceDuration(moved.clips)).toBeCloseTo(60);
    expect(() => applyCommand(view, { type: 'prepend_range', start: 5, end: 5, removeOriginal: false }, { index, newId: seqId })).toThrow();
  });

  it('built-in hooks are the loudest full sentences, labelled as such', async () => {
    const r = await suggestHooks(createProvider('builtin', { enabled: true, model: 'rules' }), view, index);
    expect(r.via).toBe('measured');
    expect(r.clips[0].title).toMatch(/AI changes/);
    expect(loudestSentences(view, {}).length).toBe(0);
  });
});

describe('AI clip selection', () => {
  it('validates, clamps and drops overlapping clips', async () => {
    const p = fake('{"clips":[{"start":10,"end":20,"title":"Budgets","why":"x"},{"start":15,"end":25,"title":"Overlap"},{"start":50,"end":99,"title":"End"},{"start":1,"end":1.5,"title":"Too short"}]}');
    const r = await findClips(p, view, index, { topic: '', count: 5, target: 10 });
    expect(r.clips.map((c) => c.title)).toEqual(['Budgets', 'End']);
    expect(r.clips[1].end).toBe(60);
  });

  it('rejects malformed replies', async () => {
    await expect(findClips(fake('{"clips":"lots"}'), view, index, { topic: '', count: 3, target: 10 })).rejects.toThrow(/wrong shape/);
  });

  it('needs a transcript for model selection', async () => {
    const noText: ProjectIndex = { A: { audio: index.A.audio } };
    await expect(findClips(fake('{}'), view, noText, { topic: '', count: 3, target: 10 })).rejects.toThrow(/transcript/);
  });
});
