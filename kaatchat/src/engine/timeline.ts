// Pure timeline operations. Every function returns a new array; inputs are
// never mutated, which is what makes whole-document undo cheap and safe.

import type { Clip, Overlay, ProjectDoc, TimeRange } from './types';

export const MIN_CLIP = 1 / 30; // shortest clip we keep, seconds
const EPS = 1e-6;

export const clipLength = (c: Clip) => c.out - c.in;

export function sequenceDuration(clips: readonly Clip[]): number {
  let d = 0;
  for (const c of clips) d += clipLength(c);
  return d;
}

/** Shortest title / graphic layer we keep, seconds. */
export const MIN_OVERLAY = 0.1;

/**
 * Keeps every layer inside a timeline of `duration` seconds: it keeps its
 * start and its end is trimmed to the end of the edit. A layer that would be
 * left shorter than MIN_OVERLAY (or starts past the end) is kept at its own
 * length, up to the whole edit, and pulled back so it ends there. An empty
 * timeline (duration 0) has no length to clamp to, so layers are left as they
 * are. Returns the same array when nothing changes.
 */
export function clampOverlays(overlays: readonly Overlay[], duration: number): Overlay[] {
  if (!(duration > EPS)) return overlays as Overlay[];
  const min = Math.min(MIN_OVERLAY, duration);
  let changed = false;
  const out = overlays.map((o) => {
    const own = Math.min(Math.max(Number.isFinite(o.duration) ? o.duration : min, min), duration);
    let start = Math.max(Number.isFinite(o.start) ? o.start : 0, 0);
    let len = Math.min(own, duration - start);
    if (len < min - EPS) {
      len = own;
      start = duration - own;
    }
    if (Math.abs(start - o.start) < EPS && Math.abs(len - o.duration) < EPS) return o;
    changed = true;
    return { ...o, start, duration: len };
  });
  return changed ? out : (overlays as Overlay[]);
}

/** `clampOverlays` for every sequence of a project; returns `p` itself when nothing changes. */
export function clampProjectOverlays(p: ProjectDoc): ProjectDoc {
  let changed = false;
  const sequences = p.sequences.map((s) => {
    const overlays = clampOverlays(s.overlays, sequenceDuration(s.clips));
    if (overlays === s.overlays) return s;
    changed = true;
    return { ...s, overlays };
  });
  return changed ? { ...p, sequences } : p;
}

/** Timeline start time of every clip. */
export function clipStarts(clips: readonly Clip[]): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const c of clips) {
    starts.push(t);
    t += clipLength(c);
  }
  return starts;
}

export interface Located {
  index: number;
  clip: Clip;
  /** Seconds from the start of the clip. */
  offset: number;
  /** Source time inside the clip's asset. */
  sourceTime: number;
  clipStart: number;
}

/** Find what is under timeline time `t`. Past the end resolves to the last frame. */
export function locate(clips: readonly Clip[], t: number): Located | null {
  if (clips.length === 0) return null;
  let start = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const len = clipLength(c);
    if (t < start + len - EPS || i === clips.length - 1) {
      const offset = Math.min(Math.max(0, t - start), len);
      return { index: i, clip: c, offset, sourceTime: c.in + offset, clipStart: start };
    }
    start += len;
  }
  return null;
}

export function splitAt(clips: readonly Clip[], t: number, newId: () => string): Clip[] {
  const hit = locate(clips, t);
  if (!hit) return clips.slice();
  const { index, clip, offset } = hit;
  if (offset < MIN_CLIP || clipLength(clip) - offset < MIN_CLIP) return clips.slice();
  const a: Clip = { ...clip, out: clip.in + offset };
  const b: Clip = { ...clip, id: newId(), in: clip.in + offset };
  return [...clips.slice(0, index), a, b, ...clips.slice(index + 1)];
}

export function trimClip(
  clips: readonly Clip[],
  id: string,
  assetDuration: number,
  next: { in?: number; out?: number },
): Clip[] {
  return clips.map((c) => {
    if (c.id !== id) return c;
    let i = next.in ?? c.in;
    let o = next.out ?? c.out;
    i = Math.max(0, Math.min(i, assetDuration));
    o = Math.max(0, Math.min(o, assetDuration));
    if (o - i < MIN_CLIP) {
      if (next.in !== undefined) i = o - MIN_CLIP;
      else o = i + MIN_CLIP;
    }
    return { ...c, in: Math.max(0, i), out: Math.min(assetDuration, o) };
  });
}

export function moveClip(clips: readonly Clip[], id: string, toIndex: number): Clip[] {
  const from = clips.findIndex((c) => c.id === id);
  if (from < 0) return clips.slice();
  const out = clips.slice();
  const [c] = out.splice(from, 1);
  const to = Math.max(0, Math.min(out.length, toIndex));
  out.splice(to, 0, c);
  return out;
}

/** Sort, clamp and merge overlapping ranges. */
export function normalizeRanges(ranges: readonly TimeRange[]): TimeRange[] {
  const sorted = ranges
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .map((r) => ({ start: Math.max(0, r.start), end: r.end }))
    .sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + EPS) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

/** Subtract `cut` ranges from [start,end); returns what is left. */
export function subtractRanges(start: number, end: number, cut: readonly TimeRange[]): TimeRange[] {
  const keep: TimeRange[] = [];
  let cursor = start;
  for (const r of normalizeRanges(cut)) {
    if (r.end <= cursor) continue;
    if (r.start >= end) break;
    if (r.start > cursor) keep.push({ start: cursor, end: Math.min(r.start, end) });
    cursor = Math.max(cursor, r.end);
    if (cursor >= end) break;
  }
  if (cursor < end) keep.push({ start: cursor, end });
  return keep.filter((r) => r.end - r.start >= MIN_CLIP);
}

/**
 * Remove SOURCE ranges of one asset from every clip that uses it. A clip that
 * spans a removed range becomes several clips. Other assets are untouched.
 */
export function removeSourceRanges(
  clips: readonly Clip[],
  assetId: string,
  ranges: readonly TimeRange[],
  newId: () => string,
): Clip[] {
  if (ranges.length === 0) return clips.slice();
  const out: Clip[] = [];
  for (const c of clips) {
    if (c.assetId !== assetId) {
      out.push(c);
      continue;
    }
    const pieces = subtractRanges(c.in, c.out, ranges);
    pieces.forEach((p, i) => out.push({ ...c, id: i === 0 ? c.id : newId(), in: p.start, out: p.end }));
  }
  return out;
}

/** Map a timeline range onto per-clip source ranges. */
export function timelineToSource(
  clips: readonly Clip[],
  range: TimeRange,
): { clipIndex: number; assetId: string; start: number; end: number }[] {
  const res: { clipIndex: number; assetId: string; start: number; end: number }[] = [];
  let t = 0;
  clips.forEach((c, i) => {
    const len = clipLength(c);
    const a = Math.max(range.start, t);
    const b = Math.min(range.end, t + len);
    if (b > a) res.push({ clipIndex: i, assetId: c.assetId, start: c.in + (a - t), end: c.in + (b - t) });
    t += len;
  });
  return res;
}

/** Cut timeline ranges out of the sequence (ripple delete). */
export function removeTimelineRanges(
  clips: readonly Clip[],
  ranges: readonly TimeRange[],
  newId: () => string,
): Clip[] {
  const cuts = normalizeRanges(ranges);
  if (cuts.length === 0) return clips.slice();
  const starts = clipStarts(clips);
  const out: Clip[] = [];
  clips.forEach((c, i) => {
    const s = starts[i];
    const local = cuts.map((r) => ({ start: r.start - s + c.in, end: r.end - s + c.in }));
    const pieces = subtractRanges(c.in, c.out, local);
    pieces.forEach((p, k) => out.push({ ...c, id: k === 0 ? c.id : newId(), in: p.start, out: p.end }));
  });
  return out;
}

/** Keep only the given timeline ranges, in timeline order. */
export function keepTimelineRanges(
  clips: readonly Clip[],
  ranges: readonly TimeRange[],
  newId: () => string,
): Clip[] {
  const keep = normalizeRanges(ranges);
  const out: Clip[] = [];
  const used = new Set<string>();
  for (const r of keep) {
    for (const piece of timelineToSource(clips, r)) {
      const c = clips[piece.clipIndex];
      if (piece.end - piece.start < MIN_CLIP) continue;
      const id = used.has(c.id) ? newId() : c.id;
      used.add(id);
      out.push({ ...c, id, in: piece.start, out: piece.end });
    }
  }
  return out;
}

/** Every timeline time at which source time `t` of `assetId` is shown. */
export function sourceToTimeline(clips: readonly Clip[], assetId: string, t: number): number[] {
  const hits: number[] = [];
  let start = 0;
  for (const c of clips) {
    if (c.assetId === assetId && t >= c.in - EPS && t <= c.out + EPS) hits.push(start + (t - c.in));
    start += clipLength(c);
  }
  return hits;
}

/**
 * Where an asset's source times sit on the timeline, answered in O(log n):
 * the asset's clips sorted by source start, with a running maximum of their
 * ends so overlapping (duplicated) ranges are still found. Build it once per
 * edit, then look up thousands of transcript words per frame.
 */
export class SourceIndex {
  private byAsset = new Map<string, { ins: Float64Array; outs: Float64Array; starts: Float64Array; maxOut: Float64Array }>();

  constructor(clips: readonly Clip[]) {
    const groups = new Map<string, { in: number; out: number; start: number }[]>();
    let start = 0;
    for (const c of clips) {
      let g = groups.get(c.assetId);
      if (!g) groups.set(c.assetId, (g = []));
      g.push({ in: c.in, out: c.out, start });
      start += clipLength(c);
    }
    for (const [id, g] of groups) {
      g.sort((a, b) => a.in - b.in || a.start - b.start);
      const n = g.length;
      const e = { ins: new Float64Array(n), outs: new Float64Array(n), starts: new Float64Array(n), maxOut: new Float64Array(n) };
      let m = -Infinity;
      g.forEach((r, i) => {
        e.ins[i] = r.in;
        e.outs[i] = r.out;
        e.starts[i] = r.start;
        m = Math.max(m, r.out);
        e.maxOut[i] = m;
      });
      this.byAsset.set(id, e);
    }
  }

  /** The earliest timeline time showing source time `t` of the asset, or null when it was cut. Same answer as `sourceToTimeline(...)[0]`. */
  first(assetId: string, t: number): number | null {
    const e = this.byAsset.get(assetId);
    if (!e) return null;
    // Last range starting at or before t.
    let lo = 0;
    let hi = e.ins.length - 1;
    let k = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (e.ins[mid] <= t + EPS) {
        k = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    let best: number | null = null;
    for (let i = k; i >= 0 && e.maxOut[i] >= t - EPS; i--) {
      if (t <= e.outs[i] + EPS) {
        const at = e.starts[i] + (t - e.ins[i]);
        if (best === null || at < best) best = at;
      }
    }
    return best;
  }
}
