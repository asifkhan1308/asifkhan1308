import type { V2 } from '../types';

/* ──────────────────────────────────────────────────────────────────────────
 * Canvas smart guides (Figma-style). While a layer is dragged, its bounding
 * box's left / centre / right and top / middle / bottom snap to the same
 * lines of the composition and of other layers. Pure so it is unit-tested.
 * ────────────────────────────────────────────────────────────────────────── */

export interface Box { minX: number; maxX: number; minY: number; maxY: number }
export interface Targets { x: number[]; y: number[] }
export interface SnapResult { d: V2; gx: number | null; gy: number | null }

export const aabb = (pts: V2[]): Box => ({
  minX: Math.min(...pts.map((p) => p[0])),
  maxX: Math.max(...pts.map((p) => p[0])),
  minY: Math.min(...pts.map((p) => p[1])),
  maxY: Math.max(...pts.map((p) => p[1])),
});

const lines = (lo: number, hi: number) => [lo, (lo + hi) / 2, hi];

/** Guide lines from the composition frame and from other layers' boxes. */
export function guideTargets(comp: { width: number; height: number }, others: Box[]): Targets {
  const x = lines(0, comp.width);
  const y = lines(0, comp.height);
  for (const b of others) {
    x.push(...lines(b.minX, b.maxX));
    y.push(...lines(b.minY, b.maxY));
  }
  return { x, y };
}

function axis(lo: number, hi: number, d: number, targets: number[], thr: number): { off: number; guide: number | null } {
  let best: { off: number; guide: number | null } = { off: 0, guide: null };
  for (const edge of lines(lo + d, hi + d)) {
    for (const t of targets) {
      const off = t - edge;
      if (Math.abs(off) <= thr && (best.guide === null || Math.abs(off) < Math.abs(best.off))) best = { off, guide: t };
    }
  }
  return best;
}

/** Adjust a proposed move `d` so the box lands on the nearest guide (per axis). */
export function snapMove(box: Box, d: V2, t: Targets, thr: number): SnapResult {
  const sx = axis(box.minX, box.maxX, d[0], t.x, thr);
  const sy = axis(box.minY, box.maxY, d[1], t.y, thr);
  return { d: [d[0] + sx.off, d[1] + sy.off], gx: sx.guide, gy: sy.guide };
}

export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** World-space move that puts a box's edge / centre on the frame's. */
export function alignDelta(box: Box, edge: AlignEdge, comp: { width: number; height: number }): V2 {
  switch (edge) {
    case 'left': return [-box.minX, 0];
    case 'hcenter': return [comp.width / 2 - (box.minX + box.maxX) / 2, 0];
    case 'right': return [comp.width - box.maxX, 0];
    case 'top': return [0, -box.minY];
    case 'vcenter': return [0, comp.height / 2 - (box.minY + box.maxY) / 2];
    case 'bottom': return [0, comp.height - box.maxY];
  }
}
