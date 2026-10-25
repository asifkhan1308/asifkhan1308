import type { Project } from '../types';
import { composeFrameBlurred, ensureTextFonts, textsOf } from './compose';
import { seekMediaForExport } from './mediaSync';

/* Animated GIF export (looping, no sound). Frames are rendered like the video
 * export, scaled to the chosen width, reduced to 256 colours each, and
 * written with gifenc. GIF frame delays are in 1/100 s, so timing is kept
 * by rounding the running total, not each frame. */

export interface GifExportOptions {
  project: Project;
  /** Output width in pixels (height follows the comp's aspect). */
  width: number;
  /** Frames per second (GIFs above ~25 fps play slower in many viewers). */
  fps: number;
  mediaBy: Map<string, HTMLImageElement | HTMLVideoElement>;
  range?: { start: number; end: number };
  onProgress?: (ratio: number, message: string) => void;
  signal?: AbortSignal;
}

export const GIF_WIDTHS = [320, 480, 640, 800] as const;
export const GIF_FPS = [10, 15, 20, 25] as const;

/** Per-frame delays in 1/100 s whose running total tracks real time. */
export function gifDelays(frames: number, fps: number): number[] {
  const out: number[] = [];
  let shown = 0;
  for (let k = 1; k <= frames; k++) {
    const target = Math.round((k * 100) / fps);
    out.push(Math.max(2, target - shown));            // browsers treat < 2 cs as slow; keep ≥ 2
    shown += out[out.length - 1];
  }
  return out;
}

export async function exportProjectToGif(opts: GifExportOptions): Promise<{ blob: Blob; fileName: string; width: number; height: number; frames: number }> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const comp = opts.project.composition;
  const width = Math.max(16, Math.min(comp.width, Math.round(opts.width)));
  const height = Math.max(16, Math.round((width * comp.height) / comp.width));
  const fps = Math.max(1, Math.min(50, opts.fps));
  const start = Math.max(0, Math.min(comp.duration, opts.range?.start ?? 0));
  const end = Math.max(start + 0.1, Math.min(comp.duration, opts.range?.end ?? comp.duration));
  const frames = Math.max(1, Math.round((end - start) * fps));
  const delays = gifDelays(frames, fps);

  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  if (!ctx) throw new Error('Could not get a 2D context for rendering.');
  const scale = width / comp.width;

  await ensureTextFonts(textsOf(opts.project));
  const gif = GIFEncoder();
  for (let k = 0; k < frames; k++) {
    if (opts.signal?.aborted) throw new DOMException('Export aborted', 'AbortError');
    const time = start + k / fps;
    await seekMediaForExport(opts.project, time, opts.mediaBy);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    composeFrameBlurred(ctx, opts.project, time, { mediaBy: opts.mediaBy, pixelScale: scale });
    const { data } = ctx.getImageData(0, 0, width, height);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay: delays[k] * 10, ...(k === 0 ? { repeat: 0 } : {}) });
    opts.onProgress?.((k + 1) / frames, `Frame ${k + 1} of ${frames} · GIF`);
    if (k % 8 === 7) await new Promise((r) => setTimeout(r, 0));   // keep the page responsive
  }
  gif.finish();
  const bytes = gif.bytes();
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'image/gif' });
  const safe = opts.project.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'motionlab';
  return { blob, fileName: `${safe} ${width}x${height}.gif`, width, height, frames };
}
