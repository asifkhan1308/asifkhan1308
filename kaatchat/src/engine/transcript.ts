// Transcripts: building sentences from word timings, importing subtitle
// files, and turning transcripts into caption cues on the timeline.

import type { Clip, EditView, ProjectIndex, Transcript, TranscriptSegment, Word } from './types';
import { clipStarts } from './timeline';

/** Group words into sentence-like segments. */
export function wordsToSegments(words: Word[]): TranscriptSegment[] {
  const segs: TranscriptSegment[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    segs.push({ t0: cur[0].t0, t1: cur[cur.length - 1].t1, text: cur.map((w) => w.text).join(' ').replace(/\s+([,.!?;:])/g, '$1'), words: cur });
    cur = [];
  };
  for (const w of words) {
    const text = w.text.trim();
    if (!text) continue;
    const prev = cur[cur.length - 1];
    if (prev && (w.t0 - prev.t1 > 1.0 || cur.length >= 22)) flush();
    cur.push({ t0: w.t0, t1: Math.max(w.t1, w.t0 + 0.05), text });
    if (/[.!?…]["')\]]?$/.test(text) && cur.length >= 3) flush();
  }
  flush();
  return segs;
}

function parseTime(s: string): number {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(s.trim());
  if (!m) return NaN;
  return (+(m[1] ?? 0)) * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0') / 1000;
}

/**
 * Parse SRT or WebVTT. Word timings are not in these formats, so they are
 * spread across each cue by word length — marked as approximate.
 */
export function parseSubtitles(text: string): Transcript {
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
  const segments: TranscriptSegment[] = [];
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim() !== '');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, z] = lines[ti].split('-->');
    const t0 = parseTime(a);
    const t1 = parseTime(z.split(/\s+/).filter(Boolean)[0] ?? '');
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) continue;
    const body = lines
      .slice(ti + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!body) continue;
    const tokens = body.split(/\s+/);
    const totalChars = tokens.reduce((n, w) => n + w.length + 1, 0);
    let t = t0;
    const words: Word[] = tokens.map((w) => {
      const d = ((w.length + 1) / totalChars) * (t1 - t0);
      const word = { t0: t, t1: t + d, text: w };
      t += d;
      return word;
    });
    segments.push({ t0, t1, text: body, words });
  }
  if (segments.length === 0) throw new Error('No subtitle cues found. Use an .srt or .vtt file.');
  return { model: 'imported subtitles (approximate word timing)', language: 'und', createdAt: Date.now(), segments };
}

export interface CaptionCue {
  start: number; // timeline seconds
  end: number;
  words: { start: number; end: number; text: string }[];
}

/** Caption cues on the timeline, derived from transcripts through the current edit. */
export function captionCues(doc: EditView, index: ProjectIndex): CaptionCue[] {
  const starts = clipStarts(doc.clips);
  const cues: CaptionCue[] = [];
  const maxWords = Math.max(1, doc.captions.maxWords);
  doc.clips.forEach((c: Clip, i) => {
    const tr = index[c.assetId]?.transcript;
    if (!tr) return;
    let group: CaptionCue['words'] = [];
    const push = () => {
      if (group.length) cues.push({ start: group[0].start, end: group[group.length - 1].end, words: group });
      group = [];
    };
    // Segments are in time order: jump to the first that reaches this clip, stop after its end.
    const segs = tr.segments;
    let lo = 0;
    let hi = segs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid].t1 <= c.in) lo = mid + 1;
      else hi = mid;
    }
    for (let k = lo; k < segs.length && segs[k].t0 < c.out; k++) {
      const seg = segs[k];
      if (seg.t1 <= c.in) continue;
      for (const w of seg.words) {
        const mid = (w.t0 + w.t1) / 2;
        if (mid < c.in || mid > c.out) continue;
        const start = starts[i] + Math.max(w.t0, c.in) - c.in;
        const end = starts[i] + Math.min(w.t1, c.out) - c.in;
        const prev = group[group.length - 1];
        if (group.length >= maxWords || (prev && start - prev.end > 0.6)) push();
        group.push({ start, end, text: w.text });
        if (/[.!?]$/.test(w.text)) push();
      }
      push();
    }
    push();
  });
  // Hold each cue until the next one starts (up to 0.5s) so text does not flicker.
  for (let k = 0; k < cues.length - 1; k++) cues[k].end = Math.min(cues[k + 1].start, cues[k].end + 0.5);
  return cues;
}

export function cueAt(cues: CaptionCue[], t: number): CaptionCue | null {
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].end <= t) lo = mid + 1;
    else if (cues[mid].start > t) hi = mid - 1;
    else return cues[mid];
  }
  return null;
}

/**
 * Word timings from sentence-level Whisper chunks, for models that cannot
 * give word-level timestamps: each chunk's time is shared among its words in
 * proportion to their length. Good enough for captions, Find and cutting
 * whole sentences; word-exact cuts need a model with word timestamps.
 */
export function splitChunksIntoWords(chunks: readonly { text: string; start: number; end: number }[]): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  for (const c of chunks) {
    const words = c.text.trim().split(/\s+/).filter(Boolean);
    if (!words.length || !Number.isFinite(c.start)) continue;
    const end = Number.isFinite(c.end) && c.end > c.start ? c.end : c.start + 0.3 * words.length;
    const weights = words.map((w) => w.length + 1);
    const total = weights.reduce((a, b) => a + b, 0);
    let t = c.start;
    words.forEach((w, i) => {
      const dur = ((end - c.start) * weights[i]) / total;
      out.push({ text: ` ${w}`, start: t, end: t + dur });
      t += dur;
    });
  }
  return out;
}
