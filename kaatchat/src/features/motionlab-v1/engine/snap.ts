import type { AnimatedProperty, Layer } from '../types';

/* Timeline snapping. Pure helpers so the drag code stays small and the
 * rules are unit-testable: a time snaps to the nearest target within a
 * threshold (seconds), otherwise it is returned unchanged. */

export interface Snap { t: number; hit: number | null }

export function snapTime(t: number, targets: number[], threshold: number): Snap {
  let best: number | null = null;
  for (const x of targets) {
    if (Math.abs(x - t) <= threshold && (best === null || Math.abs(x - t) < Math.abs(best - t))) best = x;
  }
  return best === null ? { t, hit: null } : { t: best, hit: best };
}

/** Snap a span moved as a whole: whichever edge lands closer to a target wins. */
export function snapSpan(start: number, end: number, targets: number[], threshold: number): { start: number; hit: number | null } {
  const a = snapTime(start, targets, threshold);
  const b = snapTime(end, targets, threshold);
  const da = a.hit === null ? Infinity : Math.abs(a.t - start);
  const db = b.hit === null ? Infinity : Math.abs(b.t - end);
  if (da === Infinity && db === Infinity) return { start, hit: null };
  return da <= db ? { start: a.t, hit: a.hit } : { start: start + (b.t - end), hit: b.hit };
}

/** Every keyframe time on a layer, across all animated props. */
export function layerKeyTimes(layer: Layer): number[] {
  const out: number[] = [];
  const add = (ap: unknown) => (ap as AnimatedProperty<unknown> | undefined)?.keyframes?.forEach((k) => out.push(k.time));
  const tr = layer.transform;
  [tr.position, tr.scale, tr.rotation, tr.anchor, tr.opacity].forEach(add);
  if (layer.type === 'rectangle' || layer.type === 'ellipse') add(layer.size);
  if (layer.type === 'rectangle') add(layer.cornerRadius);
  if (layer.type === 'text') { add(layer.fontSize); add(layer.reveal); }
  // Effect keyframes show on the timeline too (and move with diamond drags).
  if (layer.effects) for (const v of Object.values(layer.effects)) if (v && typeof v === 'object') add(v);
  return out;
}

/** Comp bounds, other layers' clip edges and keyframes, plus extras (e.g. playhead). */
export function snapTargets(layers: Layer[], duration: number, excludeId: string | null, extra: number[] = []): number[] {
  const out = [0, duration, ...extra];
  for (const l of layers) {
    if (l.id === excludeId) continue;
    out.push(l.startTime, l.startTime + l.duration, ...layerKeyTimes(l));
  }
  return out;
}
