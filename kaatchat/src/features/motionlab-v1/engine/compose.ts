import type { Asset, Effects, Layer, Project, Transform, V2 } from '../types';
import { worldMatrix } from './matrix';
import { resolveAnimated } from './interp';

/* Resolve effects into a CSS filter string + the two overlay amounts
 * (vignette, grain) that are drawn separately in composition space. */
function resolveEffectsFilter(e: Effects | undefined, time: number, pixelScale = 1): {
  filter: string;
  shadow: number;
  shadowColor: string;
  glow: number;
  glowColor: string;
  vignette: number;
  grain: number;
  tintColor: string;
  tintAmount: number;
} {
  if (!e) return { filter: 'none', shadow: 0, shadowColor: '#000000', glow: 0, glowColor: '#ffffff', vignette: 0, grain: 0, tintColor: '#ffffff', tintAmount: 0 };
  const b = resolveAnimated(e.brightness, time);
  const c = resolveAnimated(e.contrast, time);
  const s = resolveAnimated(e.saturation, time);
  const bl = resolveAnimated(e.blur, time);
  const parts: string[] = [];
  if (b) parts.push(`brightness(${1 + b})`);
  if (c) parts.push(`contrast(${1 + c})`);
  if (s) parts.push(`saturate(${Math.max(0, 1 + s)})`);
  if (bl > 0) parts.push(`blur(${bl * 20 * pixelScale}px)`); // filters ignore the ctx transform
  return {
    filter: parts.length ? parts.join(' ') : 'none',
    shadow: e.shadow ? Math.max(0, Math.min(1, resolveAnimated(e.shadow, time))) : 0,
    shadowColor: e.shadowColor ?? '#000000',
    glow: e.glow ? Math.max(0, Math.min(1, resolveAnimated(e.glow, time))) : 0,
    glowColor: e.glowColor ?? '#ffffff',
    vignette: resolveAnimated(e.vignette, time),
    grain: resolveAnimated(e.grain, time),
    tintColor: e.tintColor,
    tintAmount: resolveAnimated(e.tintAmount, time),
  };
}

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
  /** Backing pixels per composition pixel when the caller has scaled the
   *  context (reduced-resolution preview). Keeps blur radii consistent. */
  pixelScale?: number;
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
  // Layers used as a track matte are not drawn themselves (like AE).
  const matteSources = new Set(layers.map((l) => l.matte?.layerId).filter((id): id is string => !!id));

  /** One layer: opacity, effects filter, world transform, then its pixels. */
  const paint = (c: CanvasRenderingContext2D, layer: Layer) => {
    const t = resolveTransform(layer.transform, time);
    if (t.opacity <= 0) return;
    const fx = resolveEffectsFilter(layer.effects, time, opts.pixelScale ?? 1);
    c.save();
    c.globalAlpha = Math.max(0, Math.min(1, t.opacity));
    // Apply colour/brightness/contrast/blur as a canvas filter for the whole
    // layer draw (cheap compared to per-pixel work; honoured by Chromium/Safari).
    if (fx.filter !== 'none') c.filter = fx.filter;
    // parentWorld · translate(position) · rotate · scale · translate(−anchor):
    // anchor last so rotation + scale pivot around it; parents carry children.
    c.transform(...worldMatrix(layer, layers, time));
    // Shadows are in device pixels (they ignore the transform): scale them.
    const px = opts.pixelScale ?? 1;
    if (fx.glow > 0) {
      // Glow-only pass: draw far off-canvas and throw the shadow back on, so
      // only the glow lands (no double-drawn layer), then the normal draw.
      const OFF = 100000;
      const m = c.getTransform();
      c.setTransform(new DOMMatrix().translate(OFF, 0).multiply(m));
      c.shadowColor = withAlpha(fx.glowColor, Math.min(1, fx.glow * 1.2));
      c.shadowBlur = 70 * fx.glow * px;
      c.shadowOffsetX = -OFF;
      c.shadowOffsetY = 0;
      drawPixels(c, layer);
      c.setTransform(m);
    }
    if (fx.shadow > 0) {
      c.shadowColor = withAlpha(fx.shadowColor, 0.65 * fx.shadow);
      c.shadowBlur = 40 * fx.shadow * px;
      c.shadowOffsetX = 0;
      c.shadowOffsetY = 20 * fx.shadow * px;
    } else {
      c.shadowColor = 'transparent';
      c.shadowBlur = 0;
      c.shadowOffsetX = 0;
      c.shadowOffsetY = 0;
    }
    drawPixels(c, layer);
    c.restore();
  };

  const drawPixels = (c: CanvasRenderingContext2D, layer: Layer) => {
    switch (layer.type) {
      case 'text':
        drawText(c, layer, time);
        break;
      case 'rectangle':
        drawRectangle(c, layer, time);
        break;
      case 'ellipse':
        drawEllipse(c, layer, time);
        break;
      case 'media':
      case 'image':
        drawMedia(c, layer, assets, opts.mediaBy);
        break;
      case 'null':
      default:
        break;
    }
  };

  for (const layer of draw) {
    if (!isLayerActive(layer, time)) continue;
    if (matteSources.has(layer.id)) continue;
    const t = resolveTransform(layer.transform, time);
    if (t.opacity <= 0) continue;

    const fx = resolveEffectsFilter(layer.effects, time, opts.pixelScale ?? 1);

    const src = layer.matte ? layers.find((l) => l.id === layer.matte!.layerId && l.id !== layer.id) : undefined;
    if (layer.matte && src) {
      // Track matte: render the layer and its matte off-screen at the same
      // pixel transform, keep the layer only where the matte is (or isn't),
      // then lay the result down. The matte counts while it is in its time
      // range, even when hidden (AE hides matte layers automatically).
      const srcActive = time >= src.startTime && time <= src.startTime + src.duration;
      if (!srcActive && layer.matte.mode === 'alpha') continue; // nothing to show through
      const cw = ctx.canvas.width, ch = ctx.canvas.height;
      const base = ctx.getTransform();
      const A = layerBuffer(0, cw, ch);
      A.setTransform(base);
      paint(A, layer);
      if (srcActive) {
        const B = layerBuffer(1, cw, ch);
        B.setTransform(base);
        paint(B, src);
        A.setTransform(1, 0, 0, 1, 0, 0);
        A.globalCompositeOperation = layer.matte.mode === 'alpha' ? 'destination-in' : 'destination-out';
        A.drawImage(B.canvas, 0, 0);
        A.globalCompositeOperation = 'source-over';
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(A.canvas, 0, 0);
      ctx.restore();
    } else {
      paint(ctx, layer);
    }

    // Tint, grain and vignette compose over the whole composition after the
    // layer draw so transforms don't affect them.
    if (fx.tintAmount > 0) drawTint(ctx, fx.tintColor, fx.tintAmount, w, h);
    if (fx.grain > 0) drawGrain(ctx, fx.grain, w, h, time);
    if (fx.vignette > 0) drawVignette(ctx, fx.vignette, w, h);
  }
}

/** '#rrggbb' / '#rgb' + alpha → rgba(); other CSS colours pass through. */
function withAlpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const h = m[1].length === 3 ? m[1].split('').map((ch) => ch + ch).join('') : m[1];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a))})`;
}

/* Two reusable off-screen buffers for track mattes (no per-frame allocation).
 * Cleared on each use; sized to the target canvas in device pixels. */
const buffers: CanvasRenderingContext2D[] = [];
function layerBuffer(i: number, w: number, h: number): CanvasRenderingContext2D {
  let c = buffers[i];
  if (!c) {
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
    c = buffers[i] = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  }
  if (c.canvas.width !== w) c.canvas.width = w;
  if (c.canvas.height !== h) c.canvas.height = h;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.filter = 'none';
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, w, h);
  return c;
}

function drawVignette(ctx: CanvasRenderingContext2D, amount: number, w: number, h: number) {
  const cx = w / 2;
  const cy = h / 2;
  const g = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, Math.max(w, h) * 0.7);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${Math.min(1, amount)})`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function drawTint(ctx: CanvasRenderingContext2D, color: string, amount: number, w: number, h: number) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, amount));
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function drawGrain(ctx: CanvasRenderingContext2D, amount: number, w: number, h: number, seed: number) {
  // Draw sparse noise flecks. Cheap stand-in for GPU grain — plenty for V1.
  const n = Math.round(amount * w * h * 0.0003);
  ctx.save();
  ctx.globalAlpha = Math.min(0.4, amount * 0.6);
  // Mulberry32-style deterministic seed so each frame looks different but a
  // scrub to the same time reproduces identical grain.
  let s = Math.floor(seed * 1000) | 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < n; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = rand() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgb(${r},${r},${r})`;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, layer: import('../types').TextLayer, time: number) {
  const size = resolveAnimated(layer.fontSize, time);
  ctx.font = `${layer.fontWeight} ${size}px ${layer.fontFamily}`;
  ctx.textAlign = layer.align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = layer.fill;
  const lines = layer.text.split('\n');
  const lineH = size * layer.lineHeight;
  const p = layer.revealMode && layer.reveal ? Math.max(0, Math.min(1, resolveAnimated(layer.reveal, time))) : 1;
  if (p < 1) {
    drawTextReveal(ctx, layer, lines, lineH, p);
    return;
  }
  lines.forEach((line, i) => {
    if (layer.stroke && layer.strokeWidth > 0) {
      ctx.lineWidth = layer.strokeWidth;
      ctx.strokeStyle = layer.stroke;
      ctx.strokeText(line, 0, i * lineH);
    }
    ctx.fillText(line, 0, i * lineH);
  });
}

/* Text animator. Pieces (characters or words) are placed at their final
 * positions — measured from the full line — so centred / right-aligned text
 * doesn't slide while it types on. Each piece gets an alpha from the reveal
 * progress: typewriter is a hard cut, letters / words fade over a short
 * window so the front edge looks soft. */
function drawTextReveal(
  ctx: CanvasRenderingContext2D,
  layer: import('../types').TextLayer,
  lines: string[],
  lineH: number,
  p: number,
) {
  const mode = layer.revealMode!;
  const pieces = lines.map((line) => (mode === 'words' ? line.match(/\S+\s*/g) ?? [] : [...line]));
  const total = pieces.reduce((n, ps) => n + ps.length, 0);
  if (!total) return;
  const soft = mode === 'typewriter' ? 0 : mode === 'words' ? 1.5 : 4;
  const front = p * (total + soft);
  const baseAlpha = ctx.globalAlpha;
  ctx.textAlign = 'left';
  let k = 0;
  lines.forEach((line, li) => {
    const lw = ctx.measureText(line).width;
    const x0 = layer.align === 'center' ? -lw / 2 : layer.align === 'right' ? -lw : 0;
    let prefix = '';
    for (const piece of pieces[li]) {
      const a = soft === 0 ? (k < Math.floor(front + 1e-9) ? 1 : 0) : Math.max(0, Math.min(1, (front - k) / soft));
      if (a > 0) {
        const x = x0 + ctx.measureText(prefix).width;
        ctx.globalAlpha = baseAlpha * a;
        if (layer.stroke && layer.strokeWidth > 0) {
          ctx.lineWidth = layer.strokeWidth;
          ctx.strokeStyle = layer.stroke;
          ctx.strokeText(piece, x, li * lineH);
        }
        ctx.fillText(piece, x, li * lineH);
      }
      prefix += piece;
      k++;
    }
  });
  ctx.globalAlpha = baseAlpha;
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
