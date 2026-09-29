// One video → many edits. Picks candidate moments (deterministically, or
// from an AI provider's suggestions) and builds a finished, still fully
// editable sequence for each: cut, tightened, reframed, captioned.

import type { AspectId, CaptionStyleId, EditView, ProjectIndex, Sequence, TimeRange } from './types';
import type { CommandInput } from './commands/schema';
import { CommandSchema } from './commands/schema';
import { applyCommand } from './commands/execute';
import { clipLength, clipStarts, sequenceDuration } from './timeline';
import { rangeMeanDb, SILENT_DB } from './dsp';
import { newSequence } from './project';

export type Pace = 'clean' | 'punchy' | 'cinematic';

export interface RepurposeOptions {
  target: number; // seconds per output
  aspect: AspectId;
  pace: Pace;
  captions: boolean;
  captionStyle: CaptionStyleId;
}

export interface Candidate extends TimeRange {
  title: string;
  why: string;
  score: number;
}

export const PACE_PRESET: Record<Pace, 'natural' | 'balanced' | 'aggressive'> = {
  cinematic: 'natural',
  clean: 'balanced',
  punchy: 'aggressive',
};

interface Unit extends TimeRange {
  text: string;
  energy: number;
  sentenceEnd: boolean;
}

/** The edit, cut into units: transcript sentences where known, else 2 s windows. */
export function timelineUnits(view: EditView, index: ProjectIndex): Unit[] {
  const starts = clipStarts(view.clips);
  const units: Unit[] = [];
  view.clips.forEach((c, i) => {
    const idx = index[c.assetId];
    const audio = idx?.audio;
    const segs = idx?.transcript?.segments.filter((s) => s.t1 > c.in && s.t0 < c.out) ?? [];
    const energy = (a: number, b: number) => (audio ? rangeMeanDb(audio, a, b) : SILENT_DB);
    if (segs.length) {
      for (const s of segs) {
        const a = Math.max(c.in, s.t0);
        const b = Math.min(c.out, s.t1);
        if (b - a < 0.3) continue;
        units.push({ start: starts[i] + a - c.in, end: starts[i] + b - c.in, text: s.text.trim(), energy: energy(a, b), sentenceEnd: /[.!?…]["')\]]?$/.test(s.text.trim()) });
      }
    } else {
      const len = clipLength(c);
      for (let o = 0; o < len - 0.5; o += 2) {
        const b = Math.min(len, o + 2);
        units.push({ start: starts[i] + o, end: starts[i] + b, text: '', energy: energy(c.in + o, c.in + b), sentenceEnd: false });
      }
    }
  });
  return units.sort((a, b) => a.start - b.start);
}

/**
 * Deterministic candidates: runs of consecutive units about `target` long,
 * scored by measured loudness (with a small bonus for ending on a full
 * sentence), best non-overlapping first. Honest about what it is: it finds
 * energetic, complete stretches — it does not judge what is interesting.
 */
export function candidateMoments(view: EditView, index: ProjectIndex, count: number, target: number, topicUnits?: Set<number>): Candidate[] {
  const units = timelineUnits(view, index);
  if (units.length === 0) return [];
  const windows: Candidate[] = [];
  for (let i = 0; i < units.length; i++) {
    let j = i;
    while (j + 1 < units.length && units[j + 1].end - units[i].start <= target * 1.25 && units[j + 1].start - units[j].end < 1.5) j++;
    const start = units[i].start;
    const end = units[j].end;
    const len = end - start;
    if (len < Math.min(target * 0.5, 3)) continue;
    let p = 0;
    let topicHits = 0;
    for (let k = i; k <= j; k++) {
      p += Math.pow(10, units[k].energy / 10) * (units[k].end - units[k].start);
      if (topicUnits?.has(k)) topicHits++;
    }
    const meanDb = 10 * Math.log10(Math.max(1e-10, p / len));
    const fit = 1 - Math.min(1, Math.abs(len - target) / target);
    const score = meanDb + 6 * fit + (units[j].sentenceEnd ? 2 : 0) + topicHits * 20;
    if (topicUnits && topicHits === 0) continue;
    const text = units
      .slice(i, j + 1)
      .map((u) => u.text)
      .join(' ')
      .trim();
    windows.push({
      start,
      end,
      score,
      title: text ? (text.length > 72 ? text.slice(0, 70).replace(/\s+\S*$/, '') + '…' : text) : `Moment at ${Math.floor(start / 60)}:${String(Math.floor(start % 60)).padStart(2, '0')}`,
      why: topicUnits
        ? `Mentions the topic; ${Math.round(len)}s, measured level ${meanDb.toFixed(0)} dB`
        : `${Math.round(len)}s of the most energetic speech (measured level ${meanDb.toFixed(0)} dB)${units[j].sentenceEnd ? ', ends on a full sentence' : ''}`,
    });
  }
  windows.sort((a, b) => b.score - a.score);
  const chosen: Candidate[] = [];
  for (const w of windows) {
    if (chosen.length >= count) break;
    if (chosen.some((c) => w.start < c.end && w.end > c.start)) continue;
    chosen.push(w);
  }
  return chosen.sort((a, b) => a.start - b.start);
}

/** Units (by index) whose text mentions any keyword of `topic`. */
export function topicUnitSet(view: EditView, index: ProjectIndex, topic: string): Set<number> {
  const STOP = new Set('a an the and or of to in on about for with is are was it this that i we you my our find clips clip moments where talk talks'.split(' '));
  const terms = topic
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => w.replace(/(ing|ed|es|s)$/, ''));
  const out = new Set<number>();
  if (terms.length === 0) return out;
  timelineUnits(view, index).forEach((u, i) => {
    const words = u.text.toLowerCase().split(/[^\p{L}\p{N}]+/u).map((w) => w.replace(/(ing|ed|es|s)$/, ''));
    if (terms.some((t) => words.some((w) => w === t || (t.length > 3 && w.startsWith(t))))) out.add(i);
  });
  return out;
}

/** Build one finished short from a moment. Pure; returns a new sequence. */
export function buildShort(
  view: EditView,
  index: ProjectIndex,
  moment: TimeRange,
  name: string,
  opts: RepurposeOptions,
  newId: () => string,
): { sequence: Sequence; notes: string[] } {
  const cmds: CommandInput[] = [{ type: 'keep_ranges', ranges: [{ start: moment.start, end: moment.end }] }, { type: 'remove_silence', preset: PACE_PRESET[opts.pace] }];
  let cur: EditView = { ...view, audio: [], overlays: [] };
  const notes: string[] = [];
  const run = (c: CommandInput) => {
    const r = applyCommand(cur, CommandSchema.parse(c), { index, newId });
    cur = r.doc;
    notes.push(...r.notes);
  };
  cmds.forEach(run);
  if (sequenceDuration(cur.clips) > opts.target * 1.1) run({ type: 'select_highlights', targetDuration: opts.target });
  run({ type: 'set_aspect', aspect: opts.aspect });
  run({ type: 'reframe', mode: 'content' });
  const hasTranscript = cur.clips.some((c) => index[c.assetId]?.transcript);
  if (opts.captions && hasTranscript) run({ type: 'set_captions', enabled: true, style: opts.captionStyle });
  const base = newSequence(name, opts.aspect, cur.clips.map((c) => ({ ...c, id: newId() })));
  return {
    sequence: { ...base, fps: view.fps, captions: cur.captions, sourceSequenceId: view.id, note: `From ${fmt(moment.start)}–${fmt(moment.end)} of “${view.name}”` },
    notes,
  };
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Hooks without a model: complete sentences ranked by measured energy. */
export function loudestSentences(view: EditView, index: ProjectIndex, count = 5): Candidate[] {
  return timelineUnits(view, index)
    .filter((u) => u.text && u.end - u.start >= 1 && u.end - u.start <= 12)
    .sort((a, b) => b.energy - a.energy)
    .slice(0, count)
    .map((u) => ({ start: u.start, end: u.end, title: u.text, why: `Measured level ${u.energy.toFixed(0)} dB — loud, not judged for quality`, score: u.energy }));
}
