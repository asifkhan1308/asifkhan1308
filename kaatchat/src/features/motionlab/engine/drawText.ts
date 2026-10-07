import type { Easing, Keyframe, KeyframeProp, TextLayer } from '../types';

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t * t;
const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const applyEasing = (t: number, easing: Easing | undefined) => {
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
};

/**
 * Resolve a keyframed value at `time`. Returns the base value when no
 * keyframes are set, the single keyframe's value with only one, or the
 * interpolation between the two surrounding keyframes otherwise. Times
 * before the first or after the last keyframe clamp to that endpoint.
 */
export function resolveKeyframedValue(
  base: number,
  keyframes: readonly Keyframe[] | undefined,
  time: number,
): number {
  if (!keyframes || keyframes.length === 0) return base;
  if (keyframes.length === 1) return keyframes[0].value;
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (time <= sorted[0].time) return sorted[0].value;
  if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (time >= a.time && time <= b.time) {
      const span = Math.max(1e-6, b.time - a.time);
      const localT = (time - a.time) / span;
      const eased = applyEasing(localT, b.easing ?? a.easing ?? 'ease-in-out');
      return a.value + (b.value - a.value) * eased;
    }
  }
  return base;
}

const kfProp = (layer: TextLayer, prop: KeyframeProp, base: number, time: number) =>
  resolveKeyframedValue(base, layer.keyframes?.[prop], time);

/**
 * Draw every visible text layer onto `ctx` for the given timeline time.
 * Positions are canvas-relative (0..1), fonts size as a fraction of H.
 * Shared by the live preview canvas and the mediabunny exporter so what
 * the user sees matches what gets encoded.
 */
export function drawTextLayers(
  ctx: CanvasRenderingContext2D,
  layers: readonly TextLayer[] | undefined,
  time: number,
  width: number,
  height: number,
): void {
  if (!layers || layers.length === 0) return;
  for (const layer of layers) {
    if (time < layer.start || time > layer.end) continue;
    const localT = Math.max(0, Math.min(1, (time - layer.start) / Math.max(0.001, layer.end - layer.start)));

    // Resolve keyframed values at this time; fall back to the static base.
    const resolvedX = kfProp(layer, 'x', layer.x, time);
    const resolvedY = kfProp(layer, 'y', layer.y, time);
    const resolvedSize = kfProp(layer, 'size', layer.size, time);
    const resolvedOpacity = kfProp(layer, 'opacity', layer.opacity ?? 1, time);
    const resolvedRotation = kfProp(layer, 'rotation', layer.rotation ?? 0, time);

    const fontPx = Math.max(10, resolvedSize * height);
    ctx.save();
    ctx.font = `${layer.fontWeight} ${fontPx}px ${layer.fontFamily}`;
    ctx.textAlign = layer.align as CanvasTextAlign;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = layer.color;

    const anchorX = resolvedX * width;
    const anchorY = resolvedY * height;
    let entranceAlpha = 1;
    let drawText = layer.text;
    let slideOffset = 0;

    switch (layer.animation) {
      case 'fade-in': {
        const outStart = 0.85;
        entranceAlpha =
          localT < 0.15
            ? easeOut(localT / 0.15)
            : localT > outStart
              ? 1 - easeOut((localT - outStart) / 0.15)
              : 1;
        break;
      }
      case 'slide-up': {
        const r = Math.min(1, localT / 0.25);
        entranceAlpha = r;
        slideOffset = (1 - easeOut(r)) * fontPx * 0.8;
        break;
      }
      case 'typewriter': {
        const chars = Math.ceil(layer.text.length * easeOut(Math.min(1, localT / 0.7)));
        drawText = layer.text.slice(0, chars);
        break;
      }
      case 'none':
      default:
        break;
    }

    // Position + rotate around the anchor so keyframed rotation feels natural.
    ctx.translate(anchorX, anchorY + slideOffset);
    if (resolvedRotation) ctx.rotate((resolvedRotation * Math.PI) / 180);
    ctx.globalAlpha = Math.max(0, Math.min(1, entranceAlpha * resolvedOpacity));
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = fontPx * 0.08;
    ctx.shadowOffsetY = fontPx * 0.015;
    ctx.fillText(drawText, 0, 0);
    ctx.restore();
  }
}
