// Multicam: line up two recordings of the same moment by their sound, so
// a clip can be switched to another camera angle without drifting.

import type { AudioAnalysis } from './types';

/**
 * Offset (seconds) to ADD to a time in `a` to get the same moment in `b`,
 * found by cross-correlating loudness envelopes (±maxLag). Returns null when
 * the match is too weak to trust.
 */
export function audioOffset(a: AudioAnalysis, b: AudioAnalysis, maxLag = 30): { offset: number; confidence: number } | null {
  if (a.rate !== b.rate) return null;
  const rate = a.rate;
  const norm = (x: number[]) => {
    const lin = x.map((d) => (d <= -90 ? 0 : Math.pow(10, d / 20)));
    const mean = lin.reduce((s, v) => s + v, 0) / Math.max(1, lin.length);
    return lin.map((v) => v - mean);
  };
  const A = norm(a.rmsDb);
  const B = norm(b.rmsDb);
  const maxK = Math.round(maxLag * rate);
  // Normalise by the whole signals so tiny overlaps at extreme lags cannot win.
  const ea = Math.sqrt(A.reduce((x, v) => x + v * v, 0));
  const eb = Math.sqrt(B.reduce((x, v) => x + v * v, 0));
  if (ea === 0 || eb === 0) return null;
  const minOverlap = Math.min(A.length, B.length) * 0.3;
  let best = -Infinity;
  let bestK = 0;
  let sum = 0;
  let count = 0;
  for (let k = -maxK; k <= maxK; k++) {
    const i0 = Math.max(0, -k);
    const i1 = Math.min(A.length, B.length - k);
    if (i1 - i0 < minOverlap) continue;
    let s = 0;
    for (let i = i0; i < i1; i++) s += A[i] * B[i + k];
    const c = s / (ea * eb);
    sum += c;
    count++;
    if (c > best) {
      best = c;
      bestK = k;
    }
  }
  if (count === 0 || best < 0.3) return null;
  const mean = sum / count;
  return { offset: bestK / rate, confidence: Math.max(0, Math.min(1, (best - mean) / (1 - mean + 1e-9))) };
}
