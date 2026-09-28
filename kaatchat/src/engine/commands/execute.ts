// Pure command executor: (document, index, command) -> new document.
// No side effects, so a plan can be dry-run for "Preview changes" and then
// applied for real inside one undo step.

import type { Clip, EditView, ProjectIndex, TimeRange } from '../types';
import { ASPECTS } from '../types';
import type { Command, EditPlan } from './schema';
import {
  clipLength,
  keepTimelineRanges,
  locate,
  moveClip,
  normalizeRanges,
  removeSourceRanges,
  removeTimelineRanges,
  sequenceDuration,
  splitAt,
  trimClip,
} from '../timeline';
import { detectSilences, rangeFocus, rangeLevelDb, rangeMeanDb, SILENCE_PRESETS, SILENT_DB } from '../dsp';

export class CommandError extends Error {}

export interface ExecContext {
  index: ProjectIndex;
  newId: () => string;
}

export interface ExecResult {
  doc: EditView;
  notes: string[];
}

const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'ah', 'hmm', 'mm', 'mhm']);

export const normalizeWord = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

function requireClip(doc: EditView, clipId: string): Clip {
  const c = doc.clips.find((x) => x.id === clipId);
  if (!c) throw new CommandError(`No clip with id "${clipId}".`);
  return c;
}

function withClips(doc: EditView, clips: Clip[]): EditView {
  return { ...doc, clips };
}

export function applyCommand(doc: EditView, cmd: Command, ctx: ExecContext): ExecResult {
  const { index, newId } = ctx;
  switch (cmd.type) {
    case 'split_clip': {
      const before = doc.clips.length;
      const clips = splitAt(doc.clips, cmd.at, newId);
      return { doc: withClips(doc, clips), notes: clips.length > before ? ['Split 1 clip'] : ['Nothing to split there'] };
    }
    case 'trim_clip': {
      const c = requireClip(doc, cmd.clipId);
      const asset = doc.assets[c.assetId];
      return {
        doc: withClips(doc, trimClip(doc.clips, c.id, asset.duration, { in: cmd.in, out: cmd.out })),
        notes: ['Trimmed 1 clip'],
      };
    }
    case 'delete_clip': {
      requireClip(doc, cmd.clipId);
      return { doc: withClips(doc, doc.clips.filter((c) => c.id !== cmd.clipId)), notes: ['Deleted 1 clip'] };
    }
    case 'move_clip': {
      requireClip(doc, cmd.clipId);
      return { doc: withClips(doc, moveClip(doc.clips, cmd.clipId, cmd.toIndex)), notes: ['Moved 1 clip'] };
    }
    case 'remove_ranges': {
      const total = normalizeRanges(cmd.ranges).reduce((a, r) => a + r.end - r.start, 0);
      return {
        doc: withClips(doc, removeTimelineRanges(doc.clips, cmd.ranges, newId)),
        notes: [`Cut ${cmd.ranges.length} range(s), ${total.toFixed(1)}s`],
      };
    }
    case 'keep_ranges': {
      return {
        doc: withClips(doc, keepTimelineRanges(doc.clips, cmd.ranges, newId)),
        notes: [`Kept ${cmd.ranges.length} range(s)`],
      };
    }
    case 'remove_silence':
    case 'smart_cuts': {
      const preset = SILENCE_PRESETS[cmd.preset];
      let clips = doc.clips;
      let count = 0;
      let removed = 0;
      let unmeasured = 0;
      for (const c of doc.clips) {
        const audio = index[c.assetId]?.audio;
        if (!audio) {
          if (doc.assets[c.assetId]?.hasAudio) unmeasured++;
          continue;
        }
        let ranges = detectSilences(audio, preset, c.in, c.out);
        if (cmd.type === 'smart_cuts') {
          // Only dead air touching the head or the tail of the clip.
          ranges = ranges.filter((r) => r.start <= c.in + 0.001 || r.end >= c.out - 0.001);
        }
        if (ranges.length === 0) continue;
        // A clip that is entirely silent is left alone rather than erased.
        const silent = ranges.reduce((a, r) => a + r.end - r.start, 0);
        if (silent >= clipLength(c) - 0.05) continue;
        const next = removeSourceRangesForClip(clips, c.id, ranges, newId);
        count += ranges.length;
        removed += silent;
        clips = next;
      }
      const notes = [
        count
          ? `${cmd.type === 'smart_cuts' ? 'Trimmed' : 'Removed'} ${count} quiet stretch${count === 1 ? '' : 'es'} (${removed.toFixed(1)}s)`
          : 'No quiet stretches found at this threshold',
      ];
      if (unmeasured) notes.push(`${unmeasured} clip(s) skipped — audio not measured yet`);
      return { doc: withClips(doc, clips), notes };
    }
    case 'match_levels': {
      let n = 0;
      const clips = doc.clips.map((c) => {
        const audio = index[c.assetId]?.audio;
        if (!audio) return c;
        const level = rangeLevelDb(audio, c.in, c.out);
        if (level <= SILENT_DB + 1) return c;
        n++;
        const gainDb = Math.max(-24, Math.min(24, cmd.targetDb - level));
        return { ...c, gainDb: Math.round(gainDb * 10) / 10 };
      });
      return { doc: withClips(doc, clips), notes: [`Levelled ${n} clip(s) to ${cmd.targetDb} dBFS`] };
    }
    case 'set_aspect': {
      return { doc: { ...doc, aspect: cmd.aspect }, notes: [`Aspect ${cmd.aspect} (${ASPECTS[cmd.aspect].name})`] };
    }
    case 'reframe': {
      let measured = 0;
      const clips = doc.clips.map((c) => {
        if (cmd.mode === 'fit') return { ...c, fit: 'fit' as const };
        if (cmd.mode === 'center') return { ...c, fit: 'fill' as const, focusX: 0.5, focusY: 0.5 };
        const framing = index[c.assetId]?.framing;
        if (framing) measured++;
        const f = rangeFocus(framing, c.in, c.out);
        return { ...c, fit: 'fill' as const, focusX: round3(f.x), focusY: round3(f.y) };
      });
      const notes =
        cmd.mode === 'content'
          ? [`Content-aware crop on ${measured} of ${clips.length} clip(s)`]
          : [cmd.mode === 'fit' ? 'Fit whole frame' : 'Centre crop'];
      return { doc: withClips(doc, clips), notes };
    }
    case 'remove_fillers': {
      let clips = doc.clips;
      let n = 0;
      let hadTranscript = false;
      for (const assetId of new Set(doc.clips.map((c) => c.assetId))) {
        const tr = index[assetId]?.transcript;
        if (!tr) continue;
        hadTranscript = true;
        const ranges: TimeRange[] = [];
        for (const seg of tr.segments)
          for (const w of seg.words) if (FILLERS.has(normalizeWord(w.text))) ranges.push({ start: w.t0, end: w.t1 });
        n += ranges.length;
        clips = removeSourceRanges(clips, assetId, ranges, newId);
      }
      if (!hadTranscript) throw new CommandError('Removing fillers needs a transcript. Transcribe the footage first.');
      return { doc: withClips(doc, clips), notes: [`Removed ${n} filler word(s)`] };
    }
    case 'remove_words': {
      if (!doc.assets[cmd.assetId]) throw new CommandError(`No media with id "${cmd.assetId}".`);
      return {
        doc: withClips(doc, removeSourceRanges(doc.clips, cmd.assetId, cmd.ranges, newId)),
        notes: [`Cut ${cmd.ranges.length} transcript selection(s)`],
      };
    }
    case 'set_captions': {
      const captions = {
        ...doc.captions,
        enabled: cmd.enabled,
        style: cmd.style ?? doc.captions.style,
        maxWords: cmd.maxWords ?? doc.captions.maxWords,
      };
      const hasAny = doc.clips.some((c) => index[c.assetId]?.transcript);
      const notes = [cmd.enabled ? `Captions on (${captions.style})` : 'Captions off'];
      if (cmd.enabled && !hasAny) notes.push('No transcript yet — captions appear once footage is transcribed');
      return { doc: { ...doc, captions }, notes };
    }
    case 'set_clip_gain': {
      requireClip(doc, cmd.clipId);
      return {
        doc: withClips(doc, doc.clips.map((c) => (c.id === cmd.clipId ? { ...c, gainDb: cmd.gainDb } : c))),
        notes: [`Clip gain ${cmd.gainDb} dB`],
      };
    }
    case 'select_highlights': {
      const ranges = pickHighlights(doc, index, cmd.targetDuration);
      if (ranges.length === 0) throw new CommandError('Nothing measured to choose highlights from yet.');
      const total = ranges.reduce((a, r) => a + r.end - r.start, 0);
      return {
        doc: withClips(doc, keepTimelineRanges(doc.clips, ranges, newId)),
        notes: [`Kept ${ranges.length} loudness-ranked moment(s), ${total.toFixed(1)}s`],
      };
    }
    case 'rename_project':
      return { doc: { ...doc, projectName: cmd.name }, notes: [`Renamed to "${cmd.name}"`] };
  }
}

function removeSourceRangesForClip(clips: Clip[], clipId: string, ranges: TimeRange[], newId: () => string): Clip[] {
  const out: Clip[] = [];
  for (const c of clips) {
    if (c.id !== clipId) out.push(c);
    else out.push(...removeSourceRanges([c], c.assetId, ranges, newId));
  }
  return out;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Deterministic highlight picker: candidate windows (transcript sentences when
 * available, else 4s windows) ranked by measured loudness, kept in time order.
 */
export function pickHighlights(doc: EditView, index: ProjectIndex, target: number): TimeRange[] {
  type Cand = { start: number; end: number; score: number };
  const cands: Cand[] = [];
  let t = 0;
  for (const c of doc.clips) {
    const len = clipLength(c);
    const idx = index[c.assetId];
    const audio = idx?.audio;
    const segs = idx?.transcript?.segments.filter((s) => s.t1 > c.in && s.t0 < c.out);
    if (segs && segs.length) {
      for (const s of segs) {
        const a = Math.max(c.in, s.t0);
        const b = Math.min(c.out, s.t1);
        if (b - a < 0.8) continue;
        const score = audio ? rangeMeanDb(audio, a, b) : 0;
        cands.push({ start: t + (a - c.in), end: t + (b - c.in), score });
      }
    } else if (audio) {
      for (let o = 0; o < len; o += 4) {
        const b = Math.min(len, o + 4);
        if (b - o < 1) continue;
        cands.push({ start: t + o, end: t + b, score: rangeMeanDb(audio, c.in + o, c.in + b) });
      }
    }
    t += len;
  }
  if (cands.length === 0) return [];
  const chosen: Cand[] = [];
  let total = 0;
  for (const cand of cands.slice().sort((a, b) => b.score - a.score)) {
    if (total >= target - 0.05) break;
    const room = target - total;
    const len = cand.end - cand.start;
    chosen.push(len > room ? { ...cand, end: cand.start + room } : cand);
    total += Math.min(len, room);
  }
  return normalizeRanges(chosen);
}

export interface PlanPreview {
  doc: EditView;
  steps: { command: Command; notes: string[]; error?: string }[];
  ok: boolean;
  before: { duration: number; clips: number; aspect: string };
  after: { duration: number; clips: number; aspect: string };
}

/** Dry-run a plan. The whole plan fails if any step fails (atomic apply). */
export function previewPlan(doc: EditView, plan: EditPlan, ctx: ExecContext): PlanPreview {
  let cur = doc;
  let ok = true;
  const steps: PlanPreview['steps'] = [];
  for (const command of plan.commands) {
    if (!ok) {
      steps.push({ command, notes: [], error: 'Skipped — an earlier step failed' });
      continue;
    }
    try {
      const r = applyCommand(cur, command, ctx);
      cur = r.doc;
      steps.push({ command, notes: r.notes });
    } catch (e) {
      ok = false;
      steps.push({ command, notes: [], error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (ok && cur.clips.length === 0 && doc.clips.length > 0) {
    ok = false;
    steps.push({ command: plan.commands[plan.commands.length - 1], notes: [], error: 'This plan would remove every clip.' });
  }
  const stat = (d: EditView) => ({ duration: sequenceDuration(d.clips), clips: d.clips.length, aspect: d.aspect });
  return { doc: cur, steps, ok, before: stat(doc), after: stat(cur) };
}

/** Timeline time under the playhead, for commands that need "here". */
export function clipAt(doc: EditView, t: number): Clip | null {
  return locate(doc.clips, t)?.clip ?? null;
}
