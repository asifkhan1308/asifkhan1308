import type { Asset, Layer, V2 } from '../types';
import { resolveAnimated } from './interp';
import { resolveTransform } from './compose';

/* ──────────────────────────────────────────────────────────────────────────
 * Layer bounding boxes in composition space.
 *
 * A layer draws in local coordinates (origin at the layer's top-left, before
 * anchor is applied), then the transform composes:
 *   translate(position) · rotate(rotation) · scale(scale) · translate(-anchor)
 *
 * We produce two things:
 *   intrinsicSize(layer)  — the layer's natural [width, height] in local px,
 *                           so handles can also scale shape sizes directly.
 *   worldCorners(layer)   — the four corners of that rect in composition
 *                           coordinates, honouring the full transform.
 *
 * The overlay uses worldCorners to draw the selection box and position
 * handles; the handles themselves modify the transform (or the shape size)
 * through the store and the box moves in sync next frame.
 * ────────────────────────────────────────────────────────────────────────── */

const measure = typeof document !== 'undefined'
  ? (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 2;
      return c.getContext('2d')!;
    })()
  : null;

export function intrinsicSize(layer: Layer, time: number, assets: Asset[]): V2 {
  switch (layer.type) {
    case 'rectangle':
    case 'ellipse': {
      const s = resolveAnimated(layer.size, time);
      return [s[0], s[1]];
    }
    case 'text': {
      if (!measure) return [200, Math.max(10, resolveAnimated(layer.fontSize, time))];
      const size = resolveAnimated(layer.fontSize, time);
      measure.font = `${layer.fontWeight} ${size}px ${layer.fontFamily}`;
      const lines = layer.text.split('\n');
      const w = Math.max(1, ...lines.map((l) => measure.measureText(l).width));
      const h = Math.max(size, size * layer.lineHeight * lines.length);
      return [w, h];
    }
    case 'media':
    case 'image': {
      const a = assets.find((x) => x.id === layer.assetId);
      return a ? [a.width, a.height] : [400, 225];
    }
    case 'null':
    default:
      return [60, 60];
  }
}

export interface WorldBox {
  /** Four corners of the layer's local rect, in composition coordinates.
   *  Order: TL, TR, BR, BL. */
  corners: [V2, V2, V2, V2];
  /** Centre of the box (handy for the rotation handle). */
  center: V2;
  /** Local-space width/height before scale. */
  local: V2;
  /** Composition-space rotation in degrees. */
  rotation: number;
  /** Position (translate component). */
  position: V2;
  /** Resolved scale. */
  scale: V2;
  /** Resolved anchor. */
  anchor: V2;
}

export function worldCorners(layer: Layer, time: number, assets: Asset[]): WorldBox | null {
  if (layer.type === 'null') return null; // handles don't apply to anchors
  const t = resolveTransform(layer.transform, time);
  const [lw, lh] = intrinsicSize(layer, time, assets);
  const rad = (t.rotation * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  // Text draws with the baseline at local origin; shift the local rect up
  // one line so the selection box wraps the glyphs, not the baseline.
  const localTop = layer.type === 'text' ? -resolveAnimated(layer.fontSize, time) * 0.8 : 0;

  const toWorld = (lx: number, ly: number): V2 => {
    // local → anchor-shift → scale → rotate → translate
    const sx = (lx - t.anchor[0]) * t.scale[0];
    const sy = (ly - t.anchor[1]) * t.scale[1];
    const rx = sx * cosA - sy * sinA;
    const ry = sx * sinA + sy * cosA;
    return [t.position[0] + rx, t.position[1] + ry];
  };

  const tl = toWorld(0, localTop);
  const tr = toWorld(lw, localTop);
  const br = toWorld(lw, localTop + lh);
  const bl = toWorld(0, localTop + lh);
  const center: V2 = [(tl[0] + br[0]) / 2, (tl[1] + br[1]) / 2];

  return {
    corners: [tl, tr, br, bl],
    center,
    local: [lw, lh],
    rotation: t.rotation,
    position: t.position,
    scale: t.scale,
    anchor: t.anchor,
  };
}
