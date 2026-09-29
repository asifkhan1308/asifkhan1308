// Factories for overlays (titles, lower thirds, shapes, logos).

import type { Overlay, OverlayAnimation } from './types';

export type TextPosition = 'top' | 'center' | 'bottom' | 'lower-third';

const POS: Record<TextPosition, { x: number; y: number; align: Overlay['align'] }> = {
  top: { x: 0.5, y: 0.14, align: 'center' },
  center: { x: 0.5, y: 0.5, align: 'center' },
  bottom: { x: 0.5, y: 0.82, align: 'center' },
  'lower-third': { x: 0.3, y: 0.8, align: 'left' },
};

export function textOverlay(
  id: string,
  text: string,
  start: number,
  duration: number,
  opts: { position?: TextPosition; anim?: OverlayAnimation; size?: number; color?: string; background?: string | null; font?: string; weight?: number; role?: Overlay['role'] } = {},
): Overlay {
  const p = POS[opts.position ?? 'center'];
  return {
    id,
    kind: 'text',
    name: text.split('\n')[0].slice(0, 32) || 'Text',
    start,
    duration,
    x: p.x,
    y: p.y,
    scale: 1,
    rotation: 0,
    opacity: 1,
    keyframes: [],
    animIn: opts.anim ?? 'fade',
    animOut: opts.anim === 'kinetic' || opts.anim === 'typewriter' ? 'fade' : (opts.anim ?? 'fade'),
    animDuration: 0.4,
    text,
    font: opts.font ?? 'Inter',
    size: opts.size ?? (opts.position === 'lower-third' ? 0.045 : 0.075),
    weight: opts.weight ?? 800,
    color: opts.color ?? '#FFFFFF',
    background: opts.background ?? null,
    align: p.align,
    role: opts.role ?? 'user',
  };
}

export function shapeOverlay(id: string, start: number, duration: number): Overlay {
  return {
    id,
    kind: 'shape',
    name: 'Shape',
    start,
    duration,
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotation: 0,
    opacity: 0.9,
    keyframes: [],
    animIn: 'scale',
    animOut: 'fade',
    animDuration: 0.35,
    shape: 'rect',
    width: 0.4,
    height: 0.12,
    radius: 0.2,
    fill: '#111111',
    role: 'user',
  };
}

export function imageOverlay(id: string, assetId: string, name: string, start: number, duration: number): Overlay {
  return {
    id,
    kind: 'image',
    name,
    start,
    duration,
    x: 0.86,
    y: 0.12,
    scale: 1,
    rotation: 0,
    opacity: 1,
    keyframes: [],
    animIn: 'fade',
    animOut: 'fade',
    animDuration: 0.4,
    assetId,
    width: 0.14,
    role: 'user',
  };
}
