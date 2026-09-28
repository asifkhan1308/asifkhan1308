// Turns a request in plain language into a validated EditPlan.
//
//   request ──▶ provider (proposes JSON) ──▶ schema validation ──▶ preview ──▶ apply
//
// The model is the brain, the engine is the hands, the timeline is the truth.

import { z } from 'zod';
import type { EditView, ProjectIndex } from '../engine/types';
import { COMMAND_DOCS, extractJson, validatePlan, type EditPlan, type CommandInput } from '../engine/commands/schema';
import { clipLength, clipStarts, sequenceDuration } from '../engine/timeline';
import { rangeLevelDb } from '../engine/dsp';
import { AIError, type AIProvider, type FootageContext, type Moment } from './types';
import { candidateMoments, loudestSentences, topicUnitSet, type Candidate } from '../engine/repurpose';

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Everything a provider may see. Media bytes are never included. */
export function buildContext(doc: EditView, index: ProjectIndex, playhead: number): FootageContext {
  const starts = clipStarts(doc.clips);
  const transcript: FootageContext['transcript'] = [];
  doc.clips.forEach((c, i) => {
    const tr = index[c.assetId]?.transcript;
    if (!tr) return;
    for (const s of tr.segments) {
      if (s.t1 <= c.in || s.t0 >= c.out) continue;
      const a = Math.max(s.t0, c.in);
      const b = Math.min(s.t1, c.out);
      transcript.push({ start: r2(starts[i] + a - c.in), end: r2(starts[i] + b - c.in), text: s.text.trim() });
    }
  });
  return {
    project: { name: `${doc.projectName} — ${doc.name}`, aspect: doc.aspect, duration: r2(sequenceDuration(doc.clips)) },
    clips: doc.clips.map((c, i) => {
      const audio = index[c.assetId]?.audio;
      return {
        id: c.id,
        assetId: c.assetId,
        timelineStart: r2(starts[i]),
        timelineEnd: r2(starts[i] + clipLength(c)),
        sourceIn: r2(c.in),
        sourceOut: r2(c.out),
        media: doc.assets[c.assetId]?.name ?? 'unknown',
        levelDb: audio ? r2(rangeLevelDb(audio, c.in, c.out)) : null,
      };
    }),
    transcript,
    playhead: r2(playhead),
  };
}

/** Keep prompts bounded: long transcripts are summarised by truncation with a note. */
function contextJson(ctx: FootageContext, maxChars = 60000): string {
  let s = JSON.stringify(ctx);
  if (s.length <= maxChars) return s;
  const keep = { ...ctx, transcript: ctx.transcript.slice() };
  while (JSON.stringify(keep).length > maxChars && keep.transcript.length > 0) keep.transcript.pop();
  s = JSON.stringify({ ...keep, note: `Transcript truncated to the first ${keep.transcript.length} of ${ctx.transcript.length} sentences.` });
  return s;
}

export const PLAN_SYSTEM = `You are the planning assistant inside Kaatchat, a video editor.
You never edit anything yourself. You reply with ONE JSON object describing edit commands; Kaatchat validates them, shows a preview, and the person decides whether to apply.

Reply format (JSON only, no prose outside it):
{"summary": "<one or two sentences in plain language>", "commands": [<command>, ...]}

Allowed commands (use exactly these shapes; any other field is rejected):
${Object.values(COMMAND_DOCS)
  .map((d) => `- ${d}`)
  .join('\n')}

Rules:
- TIMELINE seconds are positions in the current edit; SOURCE seconds are positions inside one media file. Use the ones each command asks for.
- Use only clip ids and asset ids that appear in the context.
- Prefer measured operations (remove_silence, smart_cuts, match_levels, reframe, select_highlights) over guessing times.
- To pick specific moments from the transcript, use keep_ranges with TIMELINE times from the transcript.
- If the request needs something Kaatchat cannot do (e.g. generating images, music, B-roll), return "commands": [] and say so honestly in the summary.
- Never claim a step ran; you are only proposing.`;

export interface PlanOutcome {
  plan: EditPlan;
  via: 'rules' | 'model';
  repaired: boolean;
}

export async function requestPlan(
  provider: AIProvider,
  doc: EditView,
  index: ProjectIndex,
  request: string,
  playhead: number,
  signal?: AbortSignal,
): Promise<PlanOutcome> {
  if (provider.info.id === 'builtin') {
    const plan = rulePlan(request, doc, index, playhead);
    if (!plan)
      throw new AIError(
        'The built-in commands did not understand that. Try “remove silence”, “make a 30 second reel”, “make it vertical”, “add captions”, or connect an AI provider in Settings.',
        'bad-output',
      );
    return { plan, via: 'rules', repaired: false };
  }

  const ctx = buildContext(doc, index, playhead);
  const user = `Context:\n${contextJson(ctx)}\n\nRequest: ${request}`;
  const reply = await provider.generateText({ system: PLAN_SYSTEM, user, json: true, signal });
  const first = parsePlanReply(reply);
  if (first.plan) return { plan: first.plan, via: 'model', repaired: false };

  // One repair round: show the model exactly what failed validation.
  const retry = await provider.generateText({
    system: PLAN_SYSTEM,
    user: `${user}\n\nYour previous reply was rejected:\n${first.errors.join('\n')}\nReply again with a single valid JSON object.`,
    json: true,
    signal,
  });
  const second = parsePlanReply(retry);
  if (second.plan) return { plan: second.plan, via: 'model', repaired: true };
  throw new AIError(`The model's plan did not pass validation, so nothing was changed. ${second.errors.slice(0, 3).join('; ')}`, 'bad-output');
}

export function parsePlanReply(reply: string): { plan?: EditPlan; errors: string[] } {
  let raw: unknown;
  try {
    raw = extractJson(reply);
  } catch (e) {
    return { errors: [e instanceof Error ? e.message : 'Unreadable reply'] };
  }
  const v = validatePlan(raw);
  return v.ok ? { plan: v.plan, errors: [] } : { errors: v.errors };
}

// ---------------------------------------------------------------------------
// Built-in rules: no model, honest about what it understands.
// ---------------------------------------------------------------------------

export function rulePlan(text: string, doc: EditView, index: ProjectIndex, playhead: number): EditPlan | null {
  const t = text.toLowerCase();
  const cmds: CommandInput[] = [];
  const said: string[] = [];
  const hasTranscript = doc.clips.some((c) => index[c.assetId]?.transcript);
  const secMatch = /(\d+(?:\.\d+)?)\s*(?:-|\s)?(s\b|sec|secs|second|seconds|min|mins|minute|minutes)/.exec(t);
  const seconds = secMatch ? parseFloat(secMatch[1]) * (/^m/.test(secMatch[2]) ? 60 : 1) : null;
  const preset = /aggressive|tight|all\b|every|fast|punchy/.test(t) ? 'aggressive' : /gentle|natural|light|soft/.test(t) ? 'natural' : 'balanced';

  const wantsReel = /\b(reel|reels|short|shorts|tiktok|story|stories)\b/.test(t);
  const aspect = /9\s*[:x/]\s*16|vertical|portrait mode|\breel|\bshort|tiktok|story/.test(t)
    ? '9:16'
    : /1\s*[:x/]\s*1|square/.test(t)
      ? '1:1'
      : /4\s*[:x/]\s*5|instagram feed|\bfeed\b/.test(t)
        ? '4:5'
        : /16\s*[:x/]\s*9|landscape|horizontal|widescreen|youtube video/.test(t)
          ? '16:9'
          : null;

  if (/silence|silent|pause|dead air|quiet|gaps?\b|boring|khamoshi|chup/.test(t) && !/keep.*pause/.test(t)) {
    cmds.push({ type: 'remove_silence', preset });
    said.push(`cut quiet stretches (${preset})`);
  } else if (/smart cut|trim (the )?(start|end|head|tail|edges)|tighten/.test(t)) {
    cmds.push({ type: 'smart_cuts', preset });
    said.push('trim dead air at clip edges');
  }
  if (/filler|\bum+\b|\buh+\b|\berm\b/.test(t)) {
    cmds.push({ type: 'remove_fillers' });
    said.push('remove filler words');
  }
  if (wantsReel || /highlight|best (moments|parts|bits)|best \d+/.test(t)) {
    if (!cmds.some((c) => c.type === 'remove_silence')) cmds.push({ type: 'remove_silence', preset: 'aggressive' });
    const target = seconds ?? (wantsReel ? 30 : 60);
    if (sequenceDuration(doc.clips) > target) {
      cmds.push({ type: 'select_highlights', targetDuration: target });
      said.push(`keep the ${target}s with the most energy`);
    }
  } else if (seconds && /(make|cut|trim).*(to|into|down)|under|shorter/.test(t)) {
    cmds.push({ type: 'select_highlights', targetDuration: seconds });
    said.push(`cut down to ${seconds}s by measured energy`);
  }
  if (aspect) {
    cmds.push({ type: 'set_aspect', aspect });
    if (aspect !== doc.aspect || wantsReel) cmds.push({ type: 'reframe', mode: 'content' });
    said.push(`${aspect} with a content-aware crop`);
  } else if (/reframe|recrop|re-crop|keep .* in (view|frame)/.test(t)) {
    cmds.push({ type: 'reframe', mode: 'content' });
    said.push('content-aware crop');
  }
  if (/level|loudness|volume|normali[sz]e|match (the )?audio|even out/.test(t)) {
    cmds.push({ type: 'match_levels', targetDb: -18 });
    said.push('match loudness to −18 dBFS');
  }
  if (/caption|subtitle|subtitles/.test(t)) {
    const off = /(remove|no|turn off|hide|disable)\s+(the\s+)?(captions|subtitles)/.test(t);
    const style = /kinetic|animated/.test(t) ? 'kinetic' : /podcast/.test(t) ? 'podcast' : /minimal/.test(t) ? 'minimal' : /clean/.test(t) ? 'clean' : undefined;
    cmds.push({ type: 'set_captions', enabled: !off, ...(style ? { style } : {}) });
    said.push(off ? 'captions off' : `captions on${hasTranscript ? '' : ' (after transcription)'}`);
  } else if (wantsReel && hasTranscript) {
    cmds.push({ type: 'set_captions', enabled: true, style: 'bold' });
    said.push('bold captions');
  }
  if (/(sync|snap|cut|match).*(beat|music|rhythm|bpm)|on the beat|beat sync/.test(t)) {
    cmds.push({ type: 'sync_to_beat', window: 0.25 });
    said.push('nudge cuts onto the beat');
  }
  if (/duck|lower (the )?music|music (under|below)/.test(t)) {
    cmds.push({ type: 'duck_music', enabled: !/no duck|stop duck|turn off duck/.test(t), duckDb: -12 });
    said.push('duck music under speech');
  }
  if (/\bfade/.test(t)) {
    cmds.push({ type: 'set_fades', fadeIn: 0.2, fadeOut: 0.2 });
    said.push('short audio fades on every clip');
  }
  if (/(faster|quicker|tighter|snappier) cuts|cuts? (faster|quicker|tighter)|more punchy|punchier/.test(t) && !cmds.some((c) => c.type === 'remove_silence')) {
    cmds.push({ type: 'remove_silence', preset: 'aggressive' }, { type: 'smart_cuts', preset: 'aggressive' });
    said.push('tighter cuts (aggressive silence removal)');
  }
  if (/\bsplit\b/.test(t) && cmds.length === 0) {
    cmds.push({ type: 'split_clip', at: playhead });
    said.push('split at the playhead');
  }
  if (cmds.length === 0) return null;
  const v = validatePlan({ summary: `Built-in: ${said.join(', ')}.`, commands: cmds });
  return v.ok ? v.plan! : null;
}

// ---------------------------------------------------------------------------
// Ask your footage
// ---------------------------------------------------------------------------

const MomentsSchema = z.object({
  moments: z
    .array(
      z.object({
        start: z.number().finite().min(0),
        end: z.number().finite().min(0),
        title: z.string().max(140),
        why: z.string().max(400).default(''),
      }),
    )
    .max(20),
});

const SEARCH_SYSTEM = `You search a video's transcript for the person using Kaatchat.
Reply with JSON only: {"moments":[{"start":<timeline s>,"end":<timeline s>,"title":"<short>","why":"<one sentence>"}]}
Use only times that appear in the transcript. Return at most 8 moments, best first. Return {"moments":[]} if nothing fits — never invent content.`;

export interface SearchOutcome {
  moments: Moment[];
  via: 'keyword' | 'model';
}

export async function searchFootage(
  provider: AIProvider,
  doc: EditView,
  index: ProjectIndex,
  query: string,
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  const ctx = buildContext(doc, index, 0);
  if (ctx.transcript.length === 0)
    throw new AIError('Nothing to search yet. Transcribe your footage first (Media → Transcribe).', 'bad-output');
  if (provider.info.id === 'builtin') return { moments: keywordSearch(ctx.transcript, query), via: 'keyword' };

  const reply = await provider.generateText({
    system: SEARCH_SYSTEM,
    user: `Transcript (timeline seconds):\n${JSON.stringify(ctx.transcript).slice(0, 80000)}\n\nFind: ${query}`,
    json: true,
    signal,
  });
  let parsed;
  try {
    parsed = MomentsSchema.safeParse(extractJson(reply));
  } catch {
    parsed = null;
  }
  if (!parsed?.success) throw new AIError('The model sent search results in the wrong shape, so they were discarded.', 'bad-output');
  const dur = ctx.project.duration;
  const moments = parsed.data.moments
    .map((m) => ({ ...m, start: Math.max(0, Math.min(m.start, dur)), end: Math.max(0, Math.min(m.end, dur)) }))
    .filter((m) => m.end - m.start >= 0.3);
  return { moments, via: 'model' };
}

const STOP = new Set(
  'a an the and or but of to in on at for with about where when what who how is are was were be been i we you he she they it this that there find every time part parts moment moments talk talks talking discuss discusses said say says mention mentions me my our show all'.split(
    ' ',
  ),
);
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, '');

/** Local keyword search. Named honestly in the UI: it matches words, not meaning. */
export function keywordSearch(transcript: FootageContext['transcript'], query: string): Moment[] {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
  if (terms.length === 0) return [];
  const scored = transcript
    .map((s) => {
      const words = s.text.toLowerCase().split(/[^\p{L}\p{N}]+/u).map(stem);
      const hits = terms.filter((t) => words.some((w) => w === t || (t.length > 3 && w.startsWith(t))));
      return { s, score: hits.length, hits };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.start - b.s.start)
    .slice(0, 8);
  return scored
    .sort((a, b) => a.s.start - b.s.start)
    .map(({ s, hits }) => ({
      start: s.start,
      end: s.end,
      title: s.text.length > 80 ? s.text.slice(0, 77) + '…' : s.text,
      why: `Mentions ${[...new Set(hits)].join(', ')}`,
    }));
}

// ---------------------------------------------------------------------------
// Repurposing: clips and hooks
// ---------------------------------------------------------------------------

const ClipsSchema = z.object({
  clips: z
    .array(
      z.object({
        start: z.number().finite().min(0),
        end: z.number().finite().min(0),
        title: z.string().max(140),
        why: z.string().max(400).default(''),
      }),
    )
    .max(20),
});

const CLIPS_SYSTEM = `You pick short clips from a video's transcript for the person using Kaatchat.
Reply with JSON only: {"clips":[{"start":<timeline s>,"end":<timeline s>,"title":"<short>","why":"<one sentence>"}]}
Each clip must stand on its own: start at the beginning of a sentence and end at the end of one, using only times from the transcript.
Clips must not overlap. Say plainly why each was chosen; do not call anything "viral" or promise performance.`;

export interface ClipOutcome {
  clips: Candidate[];
  via: 'measured' | 'keyword' | 'model';
}

export async function findClips(
  provider: AIProvider,
  view: EditView,
  index: ProjectIndex,
  opts: { topic: string; count: number; target: number },
  signal?: AbortSignal,
): Promise<ClipOutcome> {
  const topic = opts.topic.trim();
  if (provider.info.id === 'builtin') {
    const topicSet = topic ? topicUnitSet(view, index, topic) : undefined;
    if (topicSet && topicSet.size === 0) return { clips: [], via: 'keyword' };
    return { clips: candidateMoments(view, index, opts.count, opts.target, topicSet), via: topic ? 'keyword' : 'measured' };
  }
  const ctx = buildContext(view, index, 0);
  if (ctx.transcript.length === 0)
    throw new AIError('Choosing clips with an AI provider needs a transcript. Transcribe first, or use Built-in (measured) selection.', 'bad-output');
  const reply = await provider.generateText({
    system: CLIPS_SYSTEM,
    user: `Transcript (timeline seconds):\n${JSON.stringify(ctx.transcript).slice(0, 90000)}\n\nFind ${opts.count} clips, each about ${opts.target} seconds (between ${Math.round(opts.target * 0.6)} and ${Math.round(opts.target * 1.5)}).${topic ? ` They should be about: ${topic}.` : ' Pick the strongest self-contained moments.'}`,
    json: true,
    signal,
  });
  let parsed;
  try {
    parsed = ClipsSchema.safeParse(extractJson(reply));
  } catch {
    parsed = null;
  }
  if (!parsed?.success) throw new AIError('The model sent clips in the wrong shape, so they were discarded.', 'bad-output');
  const dur = ctx.project.duration;
  const out: Candidate[] = [];
  for (const c of parsed.data.clips) {
    const start = Math.max(0, Math.min(c.start, dur));
    const end = Math.max(0, Math.min(c.end, dur));
    if (end - start < 2) continue;
    if (out.some((o) => start < o.end && end > o.start)) continue;
    out.push({ start, end, title: c.title, why: c.why, score: 0 });
    if (out.length >= opts.count) break;
  }
  return { clips: out.sort((a, b) => a.start - b.start), via: 'model' };
}

const HOOKS_SYSTEM = `You suggest opening hooks for a short video, taken from its own transcript.
Reply with JSON only: {"hooks":[{"start":<timeline s>,"end":<timeline s>,"text":"<the exact words>","why":"<one sentence>"}]}
Return 3 to 5 alternatives, each one or two complete sentences (under 12 seconds), using only times from the transcript.
These are options for a person to choose between. Do not rank them as "best" or claim they will go viral.`;

const HooksSchema = z.object({
  hooks: z
    .array(z.object({ start: z.number().finite().min(0), end: z.number().finite().min(0), text: z.string().max(400), why: z.string().max(300).default('') }))
    .max(8),
});

export async function suggestHooks(provider: AIProvider, view: EditView, index: ProjectIndex, signal?: AbortSignal): Promise<ClipOutcome> {
  const ctx = buildContext(view, index, 0);
  if (ctx.transcript.length === 0) throw new AIError('Hook suggestions need a transcript. Transcribe first.', 'bad-output');
  if (provider.info.id === 'builtin') return { clips: loudestSentences(view, index), via: 'measured' };
  const reply = await provider.generateText({
    system: HOOKS_SYSTEM,
    user: `Transcript (timeline seconds):\n${JSON.stringify(ctx.transcript).slice(0, 90000)}`,
    json: true,
    signal,
  });
  let parsed;
  try {
    parsed = HooksSchema.safeParse(extractJson(reply));
  } catch {
    parsed = null;
  }
  if (!parsed?.success) throw new AIError('The model sent hooks in the wrong shape, so they were discarded.', 'bad-output');
  const dur = ctx.project.duration;
  const clips = parsed.data.hooks
    .map((h) => ({ start: Math.max(0, Math.min(h.start, dur)), end: Math.max(0, Math.min(h.end, dur)), title: h.text, why: h.why, score: 0 }))
    .filter((h) => h.end - h.start >= 0.5 && h.end - h.start <= 20);
  return { clips, via: 'model' };
}
