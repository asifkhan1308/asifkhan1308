import type { TextLayer } from '../types';

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

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
  ctx.save();
  for (const layer of layers) {
    if (time < layer.start || time > layer.end) continue;
    const localT = Math.max(0, Math.min(1, (time - layer.start) / Math.max(0.001, layer.end - layer.start)));

    const fontPx = Math.max(10, layer.size * height);
    ctx.font = `${layer.fontWeight} ${fontPx}px ${layer.fontFamily}`;
    ctx.textAlign = layer.align as CanvasTextAlign;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = layer.color;

    let alpha = 1;
    let x = layer.x * width;
    const y = layer.y * height;
    let drawText = layer.text;

    switch (layer.animation) {
      case 'fade-in': {
        const inD = Math.min(0.3, localT + 1);
        const outStart = 0.85;
        alpha = localT < 0.15 ? easeOut(localT / 0.15) : localT > outStart ? 1 - easeOut((localT - outStart) / 0.15) : 1;
        void inD;
        break;
      }
      case 'slide-up': {
        const slideIn = Math.min(0.25, localT);
        const r = slideIn / 0.25;
        alpha = r;
        x = layer.x * width;
        ctx.translate(0, (1 - easeOut(r)) * fontPx * 0.8);
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

    ctx.globalAlpha = alpha;
    // Soft shadow for readability over any background without a halo.
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = fontPx * 0.08;
    ctx.shadowOffsetY = fontPx * 0.015;
    ctx.fillText(drawText, x, y);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.globalAlpha = 1;
    if (layer.animation === 'slide-up') ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  ctx.restore();
}
