import type { Template } from '../types';

/* -------------------------------------------------------------------------
 * Generative geometric templates: no media required. Each one draws shapes
 * directly on the canvas so users can produce motion without uploading
 * anything. Templates are pure functions over (ctx, _media, params, progress).
 * ------------------------------------------------------------------------- */

const bg = (ctx: CanvasRenderingContext2D, w: number, h: number, color = '#000') => {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
};

/** Pulse Circles — concentric circles expanding outward, trailing fade. */
export const pulseCircles: Template = {
  id: 'gen-pulse-circles',
  name: 'Pulse Circles',
  category: 'generative',
  description: 'Concentric circles pulse outward from the centre. Pure code — no media needed.',
  duration: 4,
  supportedMediaTypes: [],
  parameters: [
    { id: 'count', label: 'Rings', type: 'slider', min: 1, max: 8, step: 1, default: 4 },
    { id: 'thickness', label: 'Thickness', type: 'slider', min: 1, max: 20, step: 0.5, default: 4 },
    { id: 'color', label: 'Colour', type: 'color', default: '#ffffff' },
  ],
  animationFunction: (ctx, _media, params, progress) => {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    bg(ctx, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) * 0.5;
    const count = Number(params.count ?? 4);
    const thickness = Number(params.thickness ?? 4);
    const color = String(params.color ?? '#ffffff');
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    for (let i = 0; i < count; i++) {
      const phase = ((progress + i / count) % 1);
      const r = phase * maxR;
      const alpha = 1 - phase;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
};

/** Grid Fade — dot matrix with wave-based alpha ripple. */
export const gridFade: Template = {
  id: 'gen-grid-fade',
  name: 'Grid Fade',
  category: 'generative',
  description: 'A grid of dots with a diagonal wave of brightness sweeping across.',
  duration: 5,
  supportedMediaTypes: [],
  parameters: [
    { id: 'density', label: 'Density', type: 'slider', min: 8, max: 40, step: 1, default: 18 },
    { id: 'dotSize', label: 'Dot size', type: 'slider', min: 1, max: 10, step: 0.5, default: 3 },
    { id: 'color', label: 'Colour', type: 'color', default: '#ffffff' },
  ],
  animationFunction: (ctx, _media, params, progress) => {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    bg(ctx, w, h);
    const density = Number(params.density ?? 18);
    const dot = Number(params.dotSize ?? 3);
    const color = String(params.color ?? '#ffffff');
    const stepX = w / (density + 1);
    const stepY = h / (density + 1);
    ctx.fillStyle = color;
    for (let i = 1; i <= density; i++) {
      for (let j = 1; j <= density; j++) {
        const d = (i + j) / (density * 2);
        const phase = (progress - d + 1) % 1;
        const alpha = Math.max(0, Math.sin(phase * Math.PI));
        ctx.globalAlpha = alpha * 0.9 + 0.1;
        ctx.beginPath();
        ctx.arc(i * stepX, j * stepY, dot, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  },
};

/** Bar Chart Intro — bars rise with stagger. */
export const barChartIntro: Template = {
  id: 'gen-bar-intro',
  name: 'Bar Chart Intro',
  category: 'generative',
  description: 'Rising bars with staggered easing. Great as a lower-third animation.',
  duration: 3,
  supportedMediaTypes: [],
  parameters: [
    { id: 'bars', label: 'Bars', type: 'slider', min: 3, max: 20, step: 1, default: 8 },
    { id: 'gap', label: 'Gap', type: 'slider', min: 2, max: 30, step: 1, default: 10 },
    { id: 'color', label: 'Colour', type: 'color', default: '#ffffff' },
  ],
  animationFunction: (ctx, _media, params, progress) => {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    bg(ctx, w, h);
    const bars = Number(params.bars ?? 8);
    const gap = Number(params.gap ?? 10);
    const color = String(params.color ?? '#ffffff');
    const barW = (w * 0.7 - gap * (bars - 1)) / bars;
    const xStart = w * 0.15;
    const yBase = h * 0.85;
    const maxH = h * 0.55;
    ctx.fillStyle = color;
    for (let i = 0; i < bars; i++) {
      const stagger = i / bars * 0.4;
      const local = Math.max(0, Math.min(1, (progress - stagger) / 0.6));
      const ease = 1 - Math.pow(1 - local, 3);
      const amp = 0.3 + Math.sin((i / bars) * Math.PI) * 0.7;
      const bh = maxH * amp * ease;
      ctx.fillRect(xStart + i * (barW + gap), yBase - bh, barW, bh);
    }
  },
};

/** Wave Lines — sine wave stack scrolling horizontally. */
export const waveLines: Template = {
  id: 'gen-wave-lines',
  name: 'Wave Lines',
  category: 'generative',
  description: 'Stacked sine waves scrolling across. Hypnotic background motion.',
  duration: 6,
  supportedMediaTypes: [],
  parameters: [
    { id: 'lines', label: 'Lines', type: 'slider', min: 3, max: 24, step: 1, default: 10 },
    { id: 'amplitude', label: 'Amplitude', type: 'slider', min: 10, max: 200, step: 2, default: 60 },
    { id: 'color', label: 'Colour', type: 'color', default: '#ffffff' },
  ],
  animationFunction: (ctx, _media, params, progress) => {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    bg(ctx, w, h);
    const lines = Number(params.lines ?? 10);
    const amp = Number(params.amplitude ?? 60);
    const color = String(params.color ?? '#ffffff');
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (let i = 0; i < lines; i++) {
      const yMid = (h / (lines + 1)) * (i + 1);
      const phase = progress * Math.PI * 2 + (i / lines) * Math.PI;
      ctx.globalAlpha = 0.3 + 0.7 * (i / lines);
      ctx.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const y = yMid + Math.sin((x / w) * Math.PI * 4 + phase) * amp * (0.4 + 0.6 * (i / lines));
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
};

/** Rotating Polygon — polygon morphing sides and rotating. */
export const rotatingPolygon: Template = {
  id: 'gen-rotating-polygon',
  name: 'Rotating Polygon',
  category: 'generative',
  description: 'A regular polygon that rotates and smoothly interpolates sides.',
  duration: 5,
  supportedMediaTypes: [],
  parameters: [
    { id: 'sides', label: 'Sides', type: 'slider', min: 3, max: 12, step: 1, default: 6 },
    { id: 'size', label: 'Size', type: 'slider', min: 0.2, max: 0.9, step: 0.01, default: 0.5 },
    { id: 'color', label: 'Colour', type: 'color', default: '#ffffff' },
  ],
  animationFunction: (ctx, _media, params, progress) => {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    bg(ctx, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const sides = Math.max(3, Math.round(Number(params.sides ?? 6)));
    const size = Number(params.size ?? 0.5);
    const r = Math.min(w, h) * size * 0.5;
    const color = String(params.color ?? '#ffffff');
    const rot = progress * Math.PI * 2;
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i <= sides; i++) {
      const a = rot + (i / sides) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  },
};

/** Dot Spiral — particles tracing an unfolding spiral. */
export const dotSpiral: Template = {
  id: 'gen-dot-spiral',
  name: 'Dot Spiral',
  category: 'generative',
  description: 'Points trace an outward spiral, each with its own appearance stagger.',
  duration: 6,
  supportedMediaTypes: [],
  parameters: [
    { id: 'points', label: 'Points', type: 'slider', min: 20, max: 200, step: 2, default: 80 },
    { id: 'turns', label: 'Turns', type: 'slider', min: 1, max: 10, step: 0.25, default: 4 },
    { id: 'color', label: 'Colour', type: 'color', default: '#ffffff' },
  ],
  animationFunction: (ctx, _media, params, progress) => {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    bg(ctx, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const points = Number(params.points ?? 80);
    const turns = Number(params.turns ?? 4);
    const color = String(params.color ?? '#ffffff');
    const maxR = Math.min(w, h) * 0.42;
    ctx.fillStyle = color;
    const visible = Math.floor(points * progress);
    for (let i = 0; i < visible; i++) {
      const t = i / points;
      const a = t * Math.PI * 2 * turns + progress * Math.PI;
      const r = t * maxR;
      const localAge = (visible - i) / points;
      ctx.globalAlpha = Math.max(0.15, 1 - localAge);
      const size = 2 + (1 - t) * 4;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
};
