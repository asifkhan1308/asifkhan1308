import type { AnimatedProperty, Bezier, Easing, Keyframe, V2 } from '../types';

const easeIn = (t: number) => t * t * t;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** CSS-style cubic-bezier timing: solve x(s) = t for s, return y(s). */
export function cubicBezier(t: number, [x1, y1, x2, y2]: Bezier): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (s: number) => ((ax * s + bx) * s + cx) * s;
  const dX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  let s = t;
  for (let i = 0; i < 8; i++) {           // Newton: fast when the slope is sane
    const err = X(s) - t;
    if (Math.abs(err) < 1e-7) break;
    const d = dX(s);
    if (Math.abs(d) < 1e-6) break;
    s -= err / d;
  }
  if (!(s >= 0 && s <= 1) || Math.abs(X(s) - t) > 1e-5) {
    let lo = 0, hi = 1;                   // bisection fallback, always converges
    s = t;
    for (let i = 0; i < 40; i++) {
      if (X(s) < t) lo = s; else hi = s;
      s = (lo + hi) / 2;
    }
  }
  return ((ay * s + by) * s + cy) * s;
}

export function applyEasing(t: number, easing: Easing = 'ease-in-out', bezier?: Bezier): number {
  switch (easing) {
    case 'linear':
      return t;
    case 'hold':
      // Keep the previous value until this keyframe, then jump.
      return t >= 1 ? 1 : 0;
    case 'bezier':
      return cubicBezier(t, bezier ?? [0.42, 0, 0.58, 1]);
    case 'ease-in':
      return easeIn(t);
    case 'ease-out':
      return easeOut(t);
    case 'ease-in-out':
    default:
      return easeInOut(t);
  }
}

const lerpNumber = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpV2 = (a: V2, b: V2, t: number): V2 => [
  lerpNumber(a[0], b[0], t),
  lerpNumber(a[1], b[1], t),
];
const isV2 = (v: unknown): v is V2 => Array.isArray(v) && v.length === 2 && typeof v[0] === 'number';

/**
 * Resolve an AnimatedProperty at `time`. If there are no keyframes, returns
 * the default. If one keyframe, returns its value. Otherwise clamps outside
 * the keyframe range and eases between the two surrounding keyframes.
 */
/** The rendered value: keyframes / default plus any wiggle. */
export function resolveAnimated<T>(prop: AnimatedProperty<T>, time: number): T {
  const base = resolveBase(prop, time);
  const w = prop.wiggle;
  if (!w || !(w.amount > 0) || !(w.freq > 0)) return base;
  const seed = w.seed ?? 1;
  if (isV2(base)) {
    const [x, y] = base as unknown as V2;
    return [x + w.amount * wiggleNoise(time * w.freq, seed), y + w.amount * wiggleNoise(time * w.freq, seed + 101)] as unknown as T;
  }
  if (typeof base === 'number') return (base + w.amount * wiggleNoise(time * w.freq, seed)) as unknown as T;
  return base;
}

/** Smooth, repeatable noise in [-1, 1]: random values at whole numbers,
 *  eased between (1D value noise). Same inputs, same output — exports match
 *  the preview frame for frame. */
export function wiggleNoise(x: number, seed: number): number {
  const h = (i: number) => {
    let n = Math.imul(i ^ Math.imul(seed, 0x9e3779b1), 0x85ebca6b);
    n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
    return (((n ^ (n >>> 16)) >>> 0) / 0xffffffff) * 2 - 1;
  };
  const i = Math.floor(x), f = x - i;
  const s = f * f * (3 - 2 * f);
  return h(i) * (1 - s) + h(i + 1) * s;
}

/** The value without wiggle — what the user edits (Inspector, drags, new keys). */
export function resolveBase<T>(prop: AnimatedProperty<T>, time: number): T {
  const kfs = prop.keyframes;
  if (!kfs || kfs.length === 0) return prop.default;
  if (kfs.length === 1) return kfs[0].value;
  const sorted = [...kfs].sort((a, b) => a.time - b.time);
  if (time <= sorted[0].time) return sorted[0].value;
  if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (time >= a.time && time <= b.time) {
      const span = Math.max(1e-6, b.time - a.time);
      const localT = (time - a.time) / span;
      const eased = applyEasing(localT, b.easing ?? 'ease-in-out', b.bezier);
      return (isV2(a.value) && isV2(b.value)
        ? (lerpV2(a.value as V2, b.value as V2, eased) as unknown as T)
        : (lerpNumber(a.value as unknown as number, b.value as unknown as number, eased) as unknown as T));
    }
  }
  return prop.default;
}

/** Insert or replace the keyframe at the given time (within a 10ms window). */
export function upsertKeyframe<T>(prop: AnimatedProperty<T>, time: number, value: T, easing?: Easing): AnimatedProperty<T> {
  const existing = prop.keyframes ?? [];
  const prev = existing.find((k) => Math.abs(k.time - time) <= 0.01);
  const kept = existing.filter((k) => Math.abs(k.time - time) > 0.01);
  // Replacing a key's value keeps how it eases (incl. a custom curve) unless
  // the caller chooses a new easing.
  const e = easing ?? prev?.easing;
  const key: Keyframe<T> = { time, value, easing: e, ...(e === 'bezier' && prev?.bezier ? { bezier: prev.bezier } : {}) };
  const next: Keyframe<T>[] = [...kept, key].sort((a, b) => a.time - b.time);
  return { ...prop, keyframes: next };
}

export function removeKeyframeAt<T>(prop: AnimatedProperty<T>, time: number): AnimatedProperty<T> {
  const existing = prop.keyframes ?? [];
  const kept = existing.filter((k) => Math.abs(k.time - time) > 0.01);
  return { ...prop, keyframes: kept };
}

/** Convenience factory: an AnimatedProperty with no keyframes. */
export const anim = <T>(def: T): AnimatedProperty<T> => ({ default: def });
