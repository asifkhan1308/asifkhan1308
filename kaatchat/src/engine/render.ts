// Frame composition shared by the preview and the exporter, so what you see
// is exactly what you export.

import type { CaptionStyleId, Clip } from './types';
import { cropRect } from './dsp';
import { drawPostEffects, effectsFilter, effectsOf, isNeutral } from './motion';
import type { CaptionCue } from './transcript';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Draw one clip's frame: crop/fit around the focus point, punch-in scale,
 * colour effects (filter), opacity, then post effects (tint, vignette,
 * grain, sharpen).
 */
export function drawClipFrame(
  ctx: Ctx,
  src: CanvasImageSource,
  srcW: number,
  srcH: number,
  clip: Clip,
  outW: number,
  outH: number,
  frameIndex = 0,
) {
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, outW, outH);
  if (!srcW || !srcH) {
    ctx.restore();
    return;
  }
  const r = cropRect(srcW, srcH, outW, outH, clip.fit, clip.focusX, clip.focusY);
  const e = effectsOf(clip);
  const scale = Math.max(1, clip.scale ?? 1);
  let { sx, sy, sw, sh } = r;
  if (scale > 1.0001) {
    // Punch in around the focus point, staying inside the source.
    const nw = sw / scale;
    const nh = sh / scale;
    const cx = Math.min(srcW - nw / 2, Math.max(nw / 2, clip.focusX * srcW));
    const cy = Math.min(srcH - nh / 2, Math.max(nh / 2, clip.focusY * srcH));
    sx = Math.max(sx, Math.min(sx + sw - nw, cx - nw / 2));
    sy = Math.max(sy, Math.min(sy + sh - nh, cy - nh / 2));
    sw = nw;
    sh = nh;
  }
  if (!isNeutral(e)) {
    const f = effectsFilter(e, Math.min(outW, outH));
    if (f !== 'none') ctx.filter = f;
    ctx.globalAlpha = Math.max(0, Math.min(1, e.opacity));
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, r.dx, r.dy, r.dw, r.dh);
  ctx.restore();
  if (!isNeutral(e)) drawPostEffects(ctx, e, outW, outH, frameIndex);
}

/** Default caption highlight — monochrome. The Brand Kit can override it. */
export const ACCENT = '#FFFFFF';

/** Black or white text, whichever reads on `hex`. */
export function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#111111';
  const n = parseInt(m[1], 16);
  const l = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return l > 0.55 ? '#111111' : '#FFFFFF';
}

interface StyleSpec {
  label: string;
  size: number; // fraction of the short edge
  weight: number;
  upper: boolean;
  stroke: boolean;
  box: boolean;
  highlight: boolean;
  pop: boolean;
}

export const CAPTION_STYLES: Record<CaptionStyleId, StyleSpec> = {
  minimal: { label: 'Minimal', size: 0.045, weight: 500, upper: false, stroke: false, box: false, highlight: false, pop: false },
  clean: { label: 'Clean', size: 0.05, weight: 600, upper: false, stroke: false, box: false, highlight: false, pop: false },
  podcast: { label: 'Podcast', size: 0.05, weight: 600, upper: false, stroke: false, box: true, highlight: false, pop: false },
  bold: { label: 'Bold', size: 0.07, weight: 800, upper: true, stroke: true, box: false, highlight: true, pop: false },
  kinetic: { label: 'Kinetic', size: 0.075, weight: 800, upper: true, stroke: true, box: false, highlight: true, pop: true },
};

/**
 * Draw the caption cue active at `t`. Vertical formats sit higher, clear of
 * the app UI that Reels/Shorts/TikTok overlay at the bottom.
 */
export function drawCaption(
  ctx: Ctx,
  cue: CaptionCue | null,
  t: number,
  style: CaptionStyleId,
  outW: number,
  outH: number,
  fontFamily: string,
  accent: string = ACCENT,
) {
  if (!cue) return;
  const s = CAPTION_STYLES[style];
  const short = Math.min(outW, outH);
  const px = Math.round(short * s.size);
  ctx.save();
  ctx.font = `${s.weight} ${px}px ${fontFamily}`;
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  const words = cue.words.map((w) => ({ ...w, text: s.upper ? w.text.toUpperCase() : w.text }));
  const space = ctx.measureText(' ').width;
  const maxW = outW * 0.84;

  // Wrap words into lines.
  const lines: { words: typeof words; width: number }[] = [];
  let line: typeof words = [];
  let lw = 0;
  for (const w of words) {
    const ww = ctx.measureText(w.text).width;
    if (line.length && lw + space + ww > maxW) {
      lines.push({ words: line, width: lw });
      line = [];
      lw = 0;
    }
    lw += (line.length ? space : 0) + ww;
    line.push(w);
  }
  if (line.length) lines.push({ words: line, width: lw });

  const lineH = px * 1.22;
  const vertical = outH > outW;
  const bottom = outH * (vertical ? 0.72 : 0.9);
  let y = bottom - (lines.length - 1) * lineH;

  if (s.box) {
    const widest = Math.max(...lines.map((l) => l.width));
    const padX = px * 0.5;
    const padY = px * 0.3;
    ctx.fillStyle = 'rgba(9,8,15,0.72)';
    roundRect(ctx, (outW - widest) / 2 - padX, y - px - padY + px * 0.12, widest + padX * 2, lineH * lines.length + padY * 2 - px * 0.22, px * 0.3);
    ctx.fill();
  }

  for (const l of lines) {
    let x = (outW - l.width) / 2;
    for (const w of l.words) {
      const ww = ctx.measureText(w.text).width;
      const active = t >= w.start && t < w.end + 0.05;
      ctx.save();
      if (s.pop && active) {
        const k = Math.min(1, (t - w.start) / 0.12);
        const scale = 1 + 0.14 * Math.sin(k * Math.PI * 0.5) * (1 - Math.max(0, (t - w.start - 0.12) / 0.3));
        const cx = x + ww / 2;
        const cy = y - px * 0.35;
        ctx.translate(cx, cy);
        ctx.scale(Math.max(1, scale), Math.max(1, scale));
        ctx.translate(-cx, -cy);
      }
      const lit = s.highlight && active;
      if (lit) {
        const pad = px * 0.14;
        ctx.fillStyle = accent;
        roundRect(ctx, x - pad, y - px * 0.86, ww + pad * 2, px * 1.08, px * 0.16);
        ctx.fill();
      } else if (s.stroke) {
        ctx.lineWidth = Math.max(2, px * 0.14);
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.strokeText(w.text, x, y);
      } else if (!s.box) {
        ctx.shadowColor = 'rgba(0,0,0,0.75)';
        ctx.shadowBlur = px * 0.18;
        ctx.shadowOffsetY = px * 0.04;
      }
      ctx.fillStyle = lit ? inkOn(accent) : '#FFFFFF';
      ctx.fillText(w.text, x, y);
      ctx.restore();
      x += ww + space;
    }
    y += lineH;
  }
  ctx.restore();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export const CAPTION_FONT = '"Inter Variable", Inter, system-ui, sans-serif';
