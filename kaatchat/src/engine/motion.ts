// Motion: keyframe interpolation, easing, animation presets, overlay
// drawing, effects and transitions. Shared by preview and export.

import type { Clip, Easing, Effects, Keyframe, Overlay, OverlayAnimation, TransitionKind } from './types';
import { NEUTRAL_EFFECTS } from './types';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// ---------------------------------------------------------------------------
// Easing and keyframes
// ---------------------------------------------------------------------------

export function ease(kind: Easing | undefined, x: number): number {
  const t = Math.min(1, Math.max(0, x));
  switch (kind ?? 'ease-in-out') {
    case 'linear':
      return t;
    case 'ease-in':
      return t * t * t;
    case 'ease-out':
      return 1 - Math.pow(1 - t, 3);
    case 'ease-in-out':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'back-out': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    case 'elastic-out':
      return t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  }
}

export type Animatable = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'blur';
export const ANIMATABLE: Animatable[] = ['x', 'y', 'scale', 'rotation', 'opacity', 'blur'];

/** Value of one property at local time `t`, from the keyframes that set it. */
export function interpolate(keys: readonly Keyframe[], prop: Animatable, t: number, base: number): number {
  const ks = keys.filter((k) => k[prop] !== undefined).sort((a, b) => a.t - b.t);
  if (ks.length === 0) return base;
  if (t <= ks[0].t) return ks[0][prop]!;
  const last = ks[ks.length - 1];
  if (t >= last.t) return last[prop]!;
  for (let i = 1; i < ks.length; i++) {
    const a = ks[i - 1];
    const b = ks[i];
    if (t <= b.t) {
      const x = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return a[prop]! + (b[prop]! - a[prop]!) * ease(b.easing, x);
    }
  }
  return last[prop]!;
}

export interface OverlayState {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  blur: number;
  /** Fraction of characters shown (typewriter). */
  reveal: number;
  /** Extra letter spacing in em (tracking). */
  tracking: number;
  /** Per-word pop, index of the word being emphasised (kinetic). */
  kineticWord: number;
  /** 0..1 progress of the word pop for kinetic text. */
  kineticPop: number;
}

/** Base + keyframed values at `t`, before in/out animation presets. What the inspector edits. */
export function keyedState(o: Overlay, t: number) {
  return {
    x: interpolate(o.keyframes, 'x', t, o.x),
    y: interpolate(o.keyframes, 'y', t, o.y),
    scale: interpolate(o.keyframes, 'scale', t, o.scale),
    rotation: interpolate(o.keyframes, 'rotation', t, o.rotation),
    opacity: interpolate(o.keyframes, 'opacity', t, o.opacity),
  };
}

/** Everything about an overlay at local time `t` (seconds from its start). */
export function overlayState(o: Overlay, t: number): OverlayState {
  const st: OverlayState = {
    x: interpolate(o.keyframes, 'x', t, o.x),
    y: interpolate(o.keyframes, 'y', t, o.y),
    scale: interpolate(o.keyframes, 'scale', t, o.scale),
    rotation: interpolate(o.keyframes, 'rotation', t, o.rotation),
    opacity: interpolate(o.keyframes, 'opacity', t, o.opacity),
    blur: interpolate(o.keyframes, 'blur', t, 0),
    reveal: 1,
    tracking: 0,
    kineticWord: -1,
    kineticPop: 0,
  };
  const d = Math.max(0.05, Math.min(o.animDuration, o.duration / 2));
  const pIn = t < d ? t / d : 1;
  const pOut = t > o.duration - d ? (o.duration - t) / d : 1;
  applyAnim(st, o.animIn, pIn, 1, o);
  applyAnim(st, o.animOut, pOut, -1, o);
  if ((o.animIn === 'kinetic' || o.animOut === 'kinetic') && o.text) {
    const words = o.text.split(/\s+/).filter(Boolean).length;
    const per = Math.max(0.15, (o.duration - 2 * d) / Math.max(1, words));
    const k = Math.floor(Math.max(0, t - d) / per);
    st.kineticWord = Math.min(words - 1, k);
    st.kineticPop = ease('ease-out', ((t - d) % per) / Math.min(per, 0.25));
  }
  return st;
}

function applyAnim(st: OverlayState, a: OverlayAnimation, p: number, dir: 1 | -1, o: Overlay) {
  if (p >= 1 || a === 'none') return;
  const e = ease(a === 'pop' ? 'back-out' : 'ease-out', p);
  switch (a) {
    case 'fade':
      st.opacity *= e;
      break;
    case 'slide-up':
      st.opacity *= e;
      st.y += (1 - e) * 0.08;
      break;
    case 'slide-left':
      st.opacity *= e;
      st.x += dir * (1 - e) * 0.12;
      break;
    case 'scale':
      st.opacity *= e;
      st.scale *= 0.6 + 0.4 * e;
      break;
    case 'pop':
      st.opacity *= Math.min(1, p * 3);
      st.scale *= Math.max(0.01, e);
      break;
    case 'blur':
      st.opacity *= e;
      st.blur = Math.max(st.blur, 1 - e);
      break;
    case 'typewriter':
      st.reveal = Math.min(st.reveal, p);
      break;
    case 'tracking':
      st.opacity *= e;
      st.tracking = Math.max(st.tracking, (1 - e) * 0.6);
      break;
    case 'kinetic':
      st.opacity *= Math.min(1, p * 2);
      st.scale *= 0.85 + 0.15 * e;
      break;
  }
  void o;
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

export const OVERLAY_FONTS: Record<string, string> = {
  Inter: '"Inter Variable", Inter, system-ui, sans-serif',
  'JetBrains Mono': '"JetBrains Mono", ui-monospace, monospace',
  'system-serif': 'Georgia, "Times New Roman", serif',
  'system-sans': 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

export function drawOverlay(ctx: Ctx, o: Overlay, t: number, W: number, H: number, image?: CanvasImageSource & { width: number; height: number }) {
  if (t < 0 || t > o.duration) return;
  const st = overlayState(o, t);
  if (st.opacity <= 0.001 || st.scale <= 0.001) return;
  const short = Math.min(W, H);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, st.opacity));
  if (st.blur > 0.001) ctx.filter = `blur(${(st.blur * short * 0.02).toFixed(2)}px)`;
  ctx.translate(st.x * W, st.y * H);
  ctx.rotate((st.rotation * Math.PI) / 180);
  ctx.scale(st.scale, st.scale);

  // Element size in pixels, for masks.
  let ew = 0;
  let eh = 0;
  if (o.kind === 'text' && o.text) {
    const px = Math.max(4, (o.size ?? 0.06) * short);
    ctx.font = `${o.weight ?? 700} ${px}px ${OVERLAY_FONTS[o.font ?? 'Inter'] ?? OVERLAY_FONTS.Inter}`;
    ctx.textBaseline = 'middle';
    const lines = o.text.split('\n');
    const total = o.text.replace(/\n/g, '').length;
    let shown = Math.round(total * st.reveal);
    const spacing = st.tracking * px;
    const widths = lines.map((l) => measure(ctx, l, spacing));
    ew = Math.max(...widths);
    const lh = px * 1.2;
    eh = lh * lines.length;
    const pad = px * 0.35;
    applyMask(ctx, o, ew + pad * 2, eh + pad * 2);
    if (o.background) {
      ctx.fillStyle = o.background;
      roundRect(ctx, -ew / 2 - pad, -eh / 2 - pad, ew + pad * 2, eh + pad * 2, px * 0.25);
      ctx.fill();
    }
    ctx.fillStyle = o.color ?? '#FFFFFF';
    let wordIndex = 0;
    lines.forEach((line, li) => {
      const y = -eh / 2 + lh * (li + 0.5);
      const lw = widths[li];
      let x = o.align === 'left' ? -ew / 2 : o.align === 'right' ? ew / 2 - lw : -lw / 2;
      const text = line.slice(0, Math.max(0, shown));
      shown -= line.length;
      if (st.kineticWord >= 0) {
        for (const word of text.split(/(\s+)/)) {
          if (!word) continue;
          const ww = measure(ctx, word, spacing);
          if (/\S/.test(word)) {
            const active = wordIndex === st.kineticWord;
            const past = wordIndex < st.kineticWord;
            ctx.save();
            ctx.globalAlpha *= active || past ? 1 : 0.35;
            if (active) {
              const s = 1 + 0.18 * (1 - st.kineticPop);
              ctx.translate(x + ww / 2, y);
              ctx.scale(s, s);
              ctx.translate(-(x + ww / 2), -y);
            }
            drawSpaced(ctx, word, x, y, spacing);
            ctx.restore();
            wordIndex++;
          }
          x += ww;
        }
      } else drawSpaced(ctx, text, x, y, spacing);
    });
  } else if (o.kind === 'shape') {
    ew = (o.width ?? 0.3) * W;
    eh = (o.height ?? 0.1) * H;
    applyMask(ctx, o, ew, eh);
    ctx.fillStyle = o.fill ?? '#FFFFFF';
    if (o.shape === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(0, 0, ew / 2, eh / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      roundRect(ctx, -ew / 2, -eh / 2, ew, eh, (o.radius ?? 0) * Math.min(ew, eh));
      ctx.fill();
    }
  } else if (o.kind === 'image' && image && image.width) {
    const target = (o.width ?? 0.2) * W;
    ew = target;
    eh = (target * image.height) / image.width;
    applyMask(ctx, o, ew, eh);
    ctx.drawImage(image, -ew / 2, -eh / 2, ew, eh);
  }
  ctx.restore();
}

function measure(ctx: Ctx, s: string, spacing: number) {
  return ctx.measureText(s).width + spacing * Math.max(0, s.length - 1);
}

function drawSpaced(ctx: Ctx, s: string, x: number, y: number, spacing: number) {
  if (spacing < 0.01) {
    ctx.fillText(s, x, y);
    return;
  }
  for (const ch of s) {
    ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + spacing;
  }
}

/** A rectangular reveal mask, clipped in element space. */
function applyMask(ctx: Ctx, o: Overlay, w: number, h: number) {
  const m = o.mask;
  if (!m || m.amount >= 1) return;
  const a = Math.max(0, m.amount);
  ctx.beginPath();
  if (m.from === 'left') ctx.rect(-w / 2, -h / 2, w * a, h);
  else if (m.from === 'right') ctx.rect(w / 2 - w * a, -h / 2, w * a, h);
  else if (m.from === 'top') ctx.rect(-w / 2, -h / 2, w, h * a);
  else ctx.rect(-w / 2, h / 2 - h * a, w, h * a);
  ctx.clip();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function overlaysAt<T extends Overlay>(overlays: readonly T[], t: number): T[] {
  return overlays.filter((o) => t >= o.start && t <= o.start + o.duration);
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export const LOOKS: Record<string, { label: string; effects: Partial<Effects> }> = {
  none: { label: 'None', effects: {} },
  clean: { label: 'Clean', effects: { contrast: 0.06, saturation: 0.05, sharpen: 0.15 } },
  cinematic: { label: 'Cinematic', effects: { contrast: 0.12, saturation: -0.12, exposure: -0.1, vignette: 0.28, grain: 0.1, tint: '#2E6A78', tintAmount: 0.08 } },
  punchy: { label: 'Punchy', effects: { contrast: 0.2, saturation: 0.2, sharpen: 0.25, vignette: 0.12 } },
  warm: { label: 'Warm', effects: { saturation: 0.08, tint: '#FF9A3C', tintAmount: 0.1 } },
  cool: { label: 'Cool', effects: { saturation: -0.04, tint: '#3C8CFF', tintAmount: 0.1 } },
  bw: { label: 'Black & white', effects: { saturation: -1, contrast: 0.15 } },
  vintage: { label: 'Vintage', effects: { contrast: -0.08, saturation: -0.25, tint: '#C8A06E', tintAmount: 0.16, grain: 0.22, vignette: 0.3 } },
  product: { label: 'Product', effects: { exposure: 0.1, contrast: 0.08, saturation: 0.06, sharpen: 0.3 } },
};

export function effectsOf(c: Clip): Effects {
  return { ...NEUTRAL_EFFECTS, ...(c.effects ?? {}) };
}

export function isNeutral(e: Effects): boolean {
  return (Object.keys(NEUTRAL_EFFECTS) as (keyof Effects)[]).every((k) => e[k] === NEUTRAL_EFFECTS[k]);
}

/** CSS filter string for the per-pixel colour effects. */
export function effectsFilter(e: Effects, shortEdge: number): string {
  const parts: string[] = [];
  const bright = (1 + e.brightness) * Math.pow(2, e.exposure);
  if (Math.abs(bright - 1) > 1e-3) parts.push(`brightness(${bright.toFixed(3)})`);
  if (Math.abs(e.contrast) > 1e-3) parts.push(`contrast(${(1 + e.contrast).toFixed(3)})`);
  if (Math.abs(e.saturation) > 1e-3) parts.push(`saturate(${Math.max(0, 1 + e.saturation).toFixed(3)})`);
  if (e.blur > 1e-3) parts.push(`blur(${(e.blur * shortEdge * 0.02).toFixed(2)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

let grainTile: OffscreenCanvas | null = null;
function grain(): OffscreenCanvas {
  if (grainTile) return grainTile;
  grainTile = new OffscreenCanvas(256, 256);
  const g = grainTile.getContext('2d')!;
  const img = g.createImageData(256, 256);
  let seed = 1234567;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = (seed >> 16) & 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return grainTile;
}

/** Effects drawn on top of the frame after it is composed: tint, vignette, grain, sharpen. */
export function drawPostEffects(ctx: Ctx, e: Effects, W: number, H: number, frameIndex: number) {
  if (e.sharpen > 1e-3) sharpen(ctx, W, H, e.sharpen);
  if (e.tintAmount > 1e-3) {
    ctx.save();
    ctx.globalCompositeOperation = 'color';
    ctx.globalAlpha = Math.min(1, e.tintAmount);
    ctx.fillStyle = e.tint;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  if (e.vignette > 1e-3) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${Math.min(0.9, e.vignette).toFixed(3)})`);
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  if (e.grain > 1e-3) {
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = Math.min(0.6, e.grain * 0.5);
    const tile = grain();
    const pattern = ctx.createPattern(tile, 'repeat');
    if (pattern) {
      // Shift the tile each frame so grain moves; deterministic for export.
      const ox = (frameIndex * 97) % 256;
      const oy = (frameIndex * 57) % 256;
      ctx.translate(-ox, -oy);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, W + 256, H + 256);
    }
    ctx.restore();
  }
}

/** Unsharp mask on the luma-ish channels. */
function sharpen(ctx: Ctx, W: number, H: number, amount: number) {
  const img = ctx.getImageData(0, 0, W, H);
  const src = img.data;
  const out = new Uint8ClampedArray(src);
  const k = amount * 1.2;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = src[i + c];
        const avg = (src[i - 4 + c] + src[i + 4 + c] + src[i - W * 4 + c] + src[i + W * 4 + c]) / 4;
        out[i + c] = v + k * (v - avg);
      }
    }
  }
  img.data.set(out);
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export const TRANSITIONS: Record<TransitionKind, string> = {
  dissolve: 'Dissolve',
  fade: 'Fade through black',
  slide: 'Slide',
  zoom: 'Zoom',
  blur: 'Blur',
  whip: 'Whip pan',
};

/**
 * Blend outgoing frame `a` and incoming frame `b` at progress p (0..1).
 * Both are already composed at W×H.
 */
export function drawTransition(ctx: Ctx, kind: TransitionKind, a: CanvasImageSource, b: CanvasImageSource, p: number, W: number, H: number) {
  const e = ease('ease-in-out', p);
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  switch (kind) {
    case 'dissolve':
      ctx.drawImage(a, 0, 0, W, H);
      ctx.globalAlpha = e;
      ctx.drawImage(b, 0, 0, W, H);
      break;
    case 'fade':
      if (p < 0.5) {
        ctx.globalAlpha = 1 - e * 2;
        ctx.drawImage(a, 0, 0, W, H);
      } else {
        ctx.globalAlpha = e * 2 - 1;
        ctx.drawImage(b, 0, 0, W, H);
      }
      break;
    case 'slide':
      ctx.drawImage(a, -e * W, 0, W, H);
      ctx.drawImage(b, W - e * W, 0, W, H);
      break;
    case 'zoom': {
      const sa = 1 + e * 0.35;
      ctx.globalAlpha = 1 - e;
      ctx.drawImage(a, (W - W * sa) / 2, (H - H * sa) / 2, W * sa, H * sa);
      const sb = 1.35 - e * 0.35;
      ctx.globalAlpha = e;
      ctx.drawImage(b, (W - W * sb) / 2, (H - H * sb) / 2, W * sb, H * sb);
      break;
    }
    case 'blur': {
      const r = Math.sin(p * Math.PI) * Math.min(W, H) * 0.03;
      ctx.filter = `blur(${r.toFixed(2)}px)`;
      ctx.drawImage(a, 0, 0, W, H);
      ctx.globalAlpha = e;
      ctx.drawImage(b, 0, 0, W, H);
      break;
    }
    case 'whip': {
      const f = ease('ease-in-out', p);
      const r = Math.sin(p * Math.PI) * W * 0.02;
      ctx.filter = `blur(${r.toFixed(2)}px)`;
      ctx.drawImage(a, -f * W * 1.1, 0, W, H);
      ctx.drawImage(b, W * 1.1 - f * W * 1.1, 0, W, H);
      break;
    }
  }
  ctx.restore();
}

/** Where a transition window sits: [boundary − d/2, boundary + d/2]. */
export interface TransitionWindow {
  kind: TransitionKind;
  start: number;
  end: number;
  boundary: number;
  fromIndex: number; // outgoing clip index
}

export function transitionWindows(clips: readonly Clip[], starts: readonly number[]): TransitionWindow[] {
  const out: TransitionWindow[] = [];
  for (let i = 1; i < clips.length; i++) {
    const tr = clips[i].transition;
    if (!tr || tr.duration <= 0) continue;
    const prevLen = clips[i - 1].out - clips[i - 1].in;
    const nextLen = clips[i].out - clips[i].in;
    const d = Math.min(tr.duration, prevLen, nextLen);
    const b = starts[i];
    out.push({ kind: tr.kind, start: b - d / 2, end: b + d / 2, boundary: b, fromIndex: i - 1 });
  }
  return out;
}
