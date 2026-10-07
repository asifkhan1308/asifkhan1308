import type { AnimatedProperty, Easing, Keyframe, V2 } from '../types';

const easeIn = (t: number) => t * t * t;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export function applyEasing(t: number, easing: Easing = 'ease-in-out'): number {
  switch (easing) {
    case 'linear':
      return t;
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
export function resolveAnimated<T>(prop: AnimatedProperty<T>, time: number): T {
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
      const eased = applyEasing(localT, b.easing ?? 'ease-in-out');
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
  const kept = existing.filter((k) => Math.abs(k.time - time) > 0.01);
  const next: Keyframe<T>[] = [...kept, { time, value, easing }].sort((a, b) => a.time - b.time);
  return { ...prop, keyframes: next };
}

export function removeKeyframeAt<T>(prop: AnimatedProperty<T>, time: number): AnimatedProperty<T> {
  const existing = prop.keyframes ?? [];
  const kept = existing.filter((k) => Math.abs(k.time - time) > 0.01);
  return { ...prop, keyframes: kept };
}

/** Convenience factory: an AnimatedProperty with no keyframes. */
export const anim = <T>(def: T): AnimatedProperty<T> => ({ default: def });
