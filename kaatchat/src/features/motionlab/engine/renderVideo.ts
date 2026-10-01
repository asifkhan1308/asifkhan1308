import {
  BufferTarget,
  CanvasSource,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  WebMOutputFormat,
  type VideoCodec,
} from 'mediabunny';
import type { Template, Project } from '../types';

export interface RenderOptions {
  template: Template;
  project: Project;
  media: HTMLImageElement | HTMLVideoElement | { width: number; height: number } | null;
  width: number;
  height: number;
  fps: 24 | 30 | 60;
  format: 'mp4' | 'webm';
  quality: 'low' | 'medium' | 'high' | 'ultra';
  onProgress?: (ratio: number, message: string) => void;
  signal?: AbortSignal;
}

export interface RenderResult {
  blob: Blob;
  fileName: string;
  width: number;
  height: number;
  durationSeconds: number;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

const qualityOf = (q: RenderOptions['quality']) =>
  q === 'ultra' ? QUALITY_VERY_HIGH : q === 'high' ? QUALITY_HIGH : QUALITY_MEDIUM;

export async function renderMotionToVideo(opts: RenderOptions): Promise<RenderResult> {
  const width = even(opts.width);
  const height = even(opts.height);
  const fps = opts.fps;
  const duration = Math.max(0.1, opts.project.animation.duration);
  const totalFrames = Math.max(1, Math.round(duration * fps));

  const vCandidates: VideoCodec[] =
    opts.format === 'mp4' ? ['avc', 'hevc', 'vp9', 'av1'] : ['vp9', 'vp8', 'av1'];
  const videoCodec = await getFirstEncodableVideoCodec(vCandidates, { width, height });
  if (!videoCodec)
    throw new Error(
      `This device cannot encode ${width}×${height} ${opts.format.toUpperCase()} video. Try a smaller size or the other format.`,
    );

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
  if (!ctx) throw new Error('Could not get a 2D canvas context for rendering.');

  const output = new Output({
    format: opts.format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const videoSource = new CanvasSource(canvas as unknown as HTMLCanvasElement, {
    codec: videoCodec,
    bitrate: qualityOf(opts.quality),
    keyFrameInterval: 2,
  });
  output.addVideoTrack(videoSource, { frameRate: fps });

  await output.start();

  const throwIfAborted = () => {
    if (opts.signal?.aborted) throw new DOMException('Export aborted', 'AbortError');
  };

  try {
    for (let k = 0; k < totalFrames; k++) {
      throwIfAborted();
      const time = k / fps;
      const progress = time / duration;

      ctx.fillStyle = opts.project.background.color ?? '#000000';
      ctx.fillRect(0, 0, width, height);

      try {
        opts.template.animationFunction(
          ctx,
          opts.media as unknown as HTMLImageElement,
          opts.project.parameters as Record<string, unknown>,
          progress,
          { aspect: opts.project.aspectRatio },
        );
      } catch {
        // A single frame failure should not kill the whole render — skip and continue.
      }

      await videoSource.add(time, 1 / fps);
      opts.onProgress?.((k + 1) / totalFrames, `Frame ${k + 1} of ${totalFrames} · ${videoCodec.toUpperCase()}`);
    }
    opts.onProgress?.(1, 'Finishing file');
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => undefined);
    throw e;
  }

  const buf = (output.target as BufferTarget).buffer;
  if (!buf) throw new Error('The encoder produced no data.');
  const blob = new Blob([buf], { type: opts.format === 'mp4' ? 'video/mp4' : 'video/webm' });
  const safe = (opts.project.name || opts.template.name || 'motion').replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'motion';
  return {
    blob,
    fileName: `${safe} ${width}x${height}.${opts.format}`,
    width,
    height,
    durationSeconds: duration,
  };
}
