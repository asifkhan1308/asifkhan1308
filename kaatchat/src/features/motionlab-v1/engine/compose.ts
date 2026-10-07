import type { Asset, Layer, Project, Transform, V2 } from '../types';
import { resolveAnimated } from './interp';

export interface ResolvedTransform {
  position: V2;
  scale: V2;
  rotation: number;
  anchor: V2;
  opacity: number;
}

export function resolveTransform(t: Transform, time: number): ResolvedTransform {
  return {
    position: resolveAnimated(t.position, time),
    scale: resolveAnimated(t.scale, time),
    rotation: resolveAnimated(t.rotation, time),
    anchor: resolveAnimated(t.anchor, time),
    opacity: resolveAnimated(t.opacity, time),
  };
}

/** Returns true when the layer's active window includes this time. */
export const isLayerActive = (layer: Layer, time: number) =>
  layer.visible && time >= layer.startTime && time <= layer.startTime + layer.duration;

export interface ComposeOptions {
  /** Pre-resolved HTMLImageElement / HTMLVideoElement for each asset id. */
  mediaBy?: Map<string, HTMLImageElement | HTMLVideoElement>;
}

/**
 * Paint the whole composition at `time` into `ctx`. The caller sizes the
 * canvas to match the composition's resolution before calling. Layer order
 * follows the project's layer array; last layer draws on top.
 */
export function composeFrame(
  ctx: CanvasRenderingContext2D,
  project: Project,
  time: number,
  opts: ComposeOptions = {},
): void {
  const { composition, layers, assets } = project;
  const w = composition.width;
  const h = composition.height;

  ctx.fillStyle = composition.background;
  ctx.fillRect(0, 0, w, h);

  const soloLayers = layers.filter((l) => l.solo);
  const draw = soloLayers.length > 0 ? soloLayers : layers;

  for (const layer of draw) {
    if (!isLayerActive(layer, time)) continue;
    const t = resolveTransform(layer.transform, time);
    if (t.opacity <= 0) continue;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, t.opacity));
    ctx.translate(t.position[0], t.position[1]);
    if (t.rotation) ctx.rotate((t.rotation * Math.PI) / 180);
    if (t.scale[0] !== 1 || t.scale[1] !== 1) ctx.scale(t.scale[0], t.scale[1]);
    // Anchor is subtracted after transforms so rotation + scale pivot around it.
    ctx.translate(-t.anchor[0], -t.anchor[1]);

    switch (layer.type) {
      case 'text':
        drawText(ctx, layer, time);
        break;
      case 'rectangle':
        drawRectangle(ctx, layer, time);
        break;
      case 'ellipse':
        drawEllipse(ctx, layer, time);
        break;
      case 'media':
      case 'image':
        drawMedia(ctx, layer, assets, opts.mediaBy);
        break;
      case 'null':
      default:
        break;
    }
    ctx.restore();
  }
}

function drawText(ctx: CanvasRenderingContext2D, layer: import('../types').TextLayer, time: number) {
  const size = resolveAnimated(layer.fontSize, time);
  ctx.font = `${layer.fontWeight} ${size}px ${layer.fontFamily}`;
  ctx.textAlign = layer.align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = layer.fill;
  const lines = layer.text.split('\n');
  const lineH = size * layer.lineHeight;
  lines.forEach((line, i) => {
    if (layer.stroke && layer.strokeWidth > 0) {
      ctx.lineWidth = layer.strokeWidth;
      ctx.strokeStyle = layer.stroke;
      ctx.strokeText(line, 0, i * lineH);
    }
    ctx.fillText(line, 0, i * lineH);
  });
}

function drawRectangle(
  ctx: CanvasRenderingContext2D,
  layer: import('../types').RectangleLayer,
  time: number,
) {
  const [w, h] = resolveAnimated(layer.size, time);
  const r = Math.max(0, Math.min(Math.min(w, h) / 2, resolveAnimated(layer.cornerRadius, time)));
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, r);
  } else {
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
  }
  ctx.fillStyle = layer.fill;
  ctx.fill();
  if (layer.stroke && layer.strokeWidth > 0) {
    ctx.lineWidth = layer.strokeWidth;
    ctx.strokeStyle = layer.stroke;
    ctx.stroke();
  }
}

function drawEllipse(
  ctx: CanvasRenderingContext2D,
  layer: import('../types').EllipseLayer,
  time: number,
) {
  const [w, h] = resolveAnimated(layer.size, time);
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fillStyle = layer.fill;
  ctx.fill();
  if (layer.stroke && layer.strokeWidth > 0) {
    ctx.lineWidth = layer.strokeWidth;
    ctx.strokeStyle = layer.stroke;
    ctx.stroke();
  }
}

function drawMedia(
  ctx: CanvasRenderingContext2D,
  layer: import('../types').MediaLayer | import('../types').ImageLayer,
  assets: Asset[],
  mediaBy?: Map<string, HTMLImageElement | HTMLVideoElement>,
) {
  const asset = assets.find((a) => a.id === layer.assetId);
  if (!asset) return;
  const el = mediaBy?.get(layer.assetId);
  if (!el) {
    // Placeholder tile when media isn't loaded yet so the layer is still visible.
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, 0, asset.width, asset.height);
    return;
  }
  try {
    ctx.drawImage(el, 0, 0, asset.width, asset.height);
  } catch {
    /* a mid-decode video can throw; skip this frame */
  }
}
