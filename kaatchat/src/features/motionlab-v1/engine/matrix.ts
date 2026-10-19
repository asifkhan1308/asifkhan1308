import { resolveAnimated } from './interp';
import type { Layer, V2 } from '../types';

/* ──────────────────────────────────────────────────────────────────────────
 * 2D affine matrices for layer parenting.
 * Mat = [a, b, c, d, e, f] in the canvas convention:
 *   x' = a·x + c·y + e,   y' = b·x + d·y + f
 * A layer's local matrix is translate(position)·rotate·scale·translate(−anchor);
 * its world matrix is parentWorld · local. Like After Effects, a parent's
 * transform (not its opacity, visibility or time range) carries its children.
 * ────────────────────────────────────────────────────────────────────────── */

export type Mat = [number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** m × n: apply n first, then m. */
export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export const apply = (m: Mat, p: V2): V2 => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
/** Apply only the linear part (for direction vectors / drag deltas). */
export const applyLinear = (m: Mat, v: V2): V2 => [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];

export function invert(m: Mat): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export function localMatrix(layer: Layer, time: number): Mat {
  const tr = layer.transform;
  const [px, py] = resolveAnimated(tr.position, time);
  const [sx, sy] = resolveAnimated(tr.scale, time);
  const [ax, ay] = resolveAnimated(tr.anchor, time);
  const r = (resolveAnimated(tr.rotation, time) * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const a = cos * sx, b = sin * sx, c = -sin * sy, d = cos * sy;
  return [a, b, c, d, px - (a * ax + c * ay), py - (b * ax + d * ay)];
}

/** Ancestors root-first. Missing parents end the chain; cycles are cut. */
export function ancestors(layer: Layer, layers: Layer[]): Layer[] {
  const chain: Layer[] = [];
  const seen = new Set<string>([layer.id]);
  let pid = layer.parentId;
  while (pid && !seen.has(pid) && chain.length < 64) {
    const p = layers.find((l) => l.id === pid);
    if (!p) break;
    seen.add(p.id);
    chain.unshift(p);
    pid = p.parentId;
  }
  return chain;
}

export function parentMatrix(layer: Layer, layers: Layer[] | undefined, time: number): Mat {
  if (!layers || !layer.parentId) return IDENTITY;
  return ancestors(layer, layers).reduce<Mat>((m, p) => mul(m, localMatrix(p, time)), IDENTITY);
}

export const worldMatrix = (layer: Layer, layers: Layer[] | undefined, time: number): Mat =>
  mul(parentMatrix(layer, layers, time), localMatrix(layer, time));

/** True if making `parentId` the parent of `id` would create a loop. */
export function wouldCycle(id: string, parentId: string, layers: Layer[]): boolean {
  if (id === parentId) return true;
  let cur: string | undefined = parentId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === id) return true;
    seen.add(cur);
    cur = layers.find((l) => l.id === cur)?.parentId;
  }
  return false;
}

/** Split a matrix (no skew assumed) back into position / rotation / scale for a given anchor. */
export function decompose(m: Mat, anchor: V2): { position: V2; rotation: number; scale: V2 } {
  const sx = Math.hypot(m[0], m[1]);
  const rotation = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  const sy = sx === 0 ? 0 : (m[0] * m[3] - m[1] * m[2]) / sx;
  return { position: apply(m, anchor), rotation, scale: [sx, sy] };
}
