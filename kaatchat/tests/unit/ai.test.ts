import { describe, expect, it } from 'vitest';
import { buildContext, keywordSearch, parsePlanReply, requestPlan, rulePlan, searchFootage } from '../../src/ai/planner';
import { createProvider } from '../../src/ai/providers';
import { providerFetch } from '../../src/ai/transport';
import { AIError, type AIProvider, type ChatRequest } from '../../src/ai/types';
import type { ProjectIndex, Transcript } from '../../src/engine/types';
import { asset, clip, doc, envelope } from './helpers';

const transcript: Transcript = {
  model: 't',
  language: 'en',
  createdAt: 0,
  segments: [
    { t0: 0, t1: 4, text: 'Welcome back to the channel.', words: [] },
    { t0: 4, t1: 9, text: 'Today we talk about AI and the future of design.', words: [] },
    { t0: 9, t1: 14, text: 'Money matters when you start a company.', words: [] },
  ],
};
const d = doc([clip('c1', 'A', 0, 60)], [asset('A', 60)]);
const index: ProjectIndex = { A: { audio: envelope([[60, -20]]), transcript } };

function fake(replies: (string | Error)[]): AIProvider & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  return {
    calls,
    info: { ...createProvider('openai', { enabled: true, model: 'x' }).info },
    async generateText(req) {
      calls.push(req);
      const r = replies.shift();
      if (r instanceof Error) throw r;
      if (req.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return r ?? '';
    },
    async testConnection() {
      return 'ok';
    },
  };
}

describe('context sent to providers', () => {
  it('contains timings, levels and transcript text — no media', () => {
    const ctx = buildContext(d, index, 3);
    expect(ctx.clips[0]).toMatchObject({ id: 'c1', timelineStart: 0, timelineEnd: 60 });
    expect(ctx.clips[0].levelDb).toBeCloseTo(-20, 0);
    expect(ctx.transcript).toHaveLength(3);
    const s = JSON.stringify(ctx);
    expect(s).not.toMatch(/blob:|data:|base64/);
  });
});

describe('built-in rules', () => {
  it('understands a reel request', () => {
    const p = rulePlan('Turn this into a 30 second Reel', d, index, 0)!;
    const types = p.commands.map((c) => c.type);
    expect(types).toEqual(['remove_silence', 'select_highlights', 'set_aspect', 'reframe', 'set_captions']);
    expect(p.commands[1]).toMatchObject({ targetDuration: 30 });
  });

  it('understands simple edits, including Hinglish', () => {
    expect(rulePlan('remove all boring pauses', d, index, 0)!.commands[0]).toMatchObject({ type: 'remove_silence', preset: 'aggressive' });
    expect(rulePlan('make it square', d, index, 0)!.commands[0]).toMatchObject({ type: 'set_aspect', aspect: '1:1' });
    expect(rulePlan('turn off captions', d, index, 0)!.commands[0]).toMatchObject({ type: 'set_captions', enabled: false });
    expect(rulePlan('khamoshi hatao', d, index, 0)!.commands[0].type).toBe('remove_silence');
  });

  it('admits when it does not understand', async () => {
    expect(rulePlan('make it look like a premium commercial', d, index, 0)).toBeNull();
    const builtin = createProvider('builtin', { enabled: true, model: 'rules' });
    await expect(requestPlan(builtin, d, index, 'generate b-roll of mountains', 0)).rejects.toThrow(/did not understand/);
  });
});

describe('model plans', () => {
  it('accepts a valid reply', async () => {
    const p = fake(['{"summary":"Vertical","commands":[{"type":"set_aspect","aspect":"9:16"}]}']);
    const r = await requestPlan(p, d, index, 'vertical please', 0);
    expect(r.plan.commands).toEqual([{ type: 'set_aspect', aspect: '9:16' }]);
    expect(r.repaired).toBe(false);
    expect(p.calls[0].system).toMatch(/never edit anything yourself/);
  });

  it('repairs a malformed reply once, telling the model what failed', async () => {
    const p = fake(['{"summary":"x","commands":[{"type":"explode"}]}', '{"summary":"ok","commands":[]}']);
    const r = await requestPlan(p, d, index, 'do it', 0);
    expect(r.repaired).toBe(true);
    expect(p.calls[1].user).toMatch(/rejected/);
  });

  it('gives up after a second invalid reply and changes nothing', async () => {
    const p = fake(['nope', '{"summary":"x","commands":[{"type":"set_aspect","aspect":"2:1"}]}']);
    await expect(requestPlan(p, d, index, 'do it', 0)).rejects.toThrow(/did not pass validation/);
  });

  it('surfaces provider errors and cancellation', async () => {
    await expect(requestPlan(fake([new AIError('bad key', 'auth')]), d, index, 'x', 0)).rejects.toMatchObject({ kind: 'auth' });
    const ac = new AbortController();
    ac.abort();
    await expect(requestPlan(fake(['{}']), d, index, 'x', 0, ac.signal)).rejects.toThrow(/Abort/);
  });

  it('parses fenced JSON', () => {
    expect(parsePlanReply('```json\n{"summary":"s","commands":[{"type":"remove_fillers"}]}\n```').plan).toBeTruthy();
  });
});

describe('ask your footage', () => {
  it('keyword search finds matching sentences with timeline times', () => {
    const m = keywordSearch(buildContext(d, index, 0).transcript, 'Find every time I talk about AI');
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ start: 4, end: 9 });
  });

  it('validates and clamps model results', async () => {
    const p = fake(['{"moments":[{"start":9,"end":999,"title":"Money","why":"talks money"},{"start":1,"end":1.1,"title":"blip"}]}']);
    const r = await searchFootage(p, d, index, 'money');
    expect(r.moments).toHaveLength(1);
    expect(r.moments[0].end).toBe(60);
  });

  it('refuses to search without a transcript', async () => {
    const builtin = createProvider('builtin', { enabled: true, model: 'rules' });
    await expect(searchFootage(builtin, d, {}, 'ai')).rejects.toThrow(/Transcribe/);
  });
});

describe('transport', () => {
  it('refuses to call a cloud provider without a key', async () => {
    await expect(providerFetch('openai')('https://api.openai.com/v1/models')).rejects.toMatchObject({ kind: 'no-key' });
  });

  it('local provider only talks to localhost', async () => {
    const p = createProvider('local', { enabled: true, model: 'm', baseUrl: 'https://evil.example.com' });
    await expect(p.generateText({ system: '', user: '', json: true })).rejects.toThrow(/localhost/);
  });
});
