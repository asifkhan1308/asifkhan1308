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
import type { Project } from '../types';
import { composeFrame } from './compose';

export interface V1ExportOptions {
  project: Project;
  format: 'mp4' | 'webm';
  quality: 'low' | 'medium' | 'high' | 'ultra';
  mediaBy: Map<string, HTMLImageElement | HTMLVideoElement>;
  onProgress?: (ratio: number, message: string) => void;
  signal?: AbortSignal;
}

export interface V1ExportResult {
  blob: Blob;
  fileName: string;
  width: number;
  height: number;
  durationSeconds: number;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const qualityOf = (q: V1ExportOptions['quality']) =>
  q === 'ultra' ? QUALITY_VERY_HIGH : q === 'high' ? QUALITY_HIGH : QUALITY_MEDIUM;

export async function exportProjectToVideo(opts: V1ExportOptions): Promise<V1ExportResult> {
  const comp = opts.project.composition;
  const width = even(comp.width);
  const height = even(comp.height);
  const fps = comp.fps;
  const duration = Math.max(0.1, comp.duration);
  const totalFrames = Math.max(1, Math.round(duration * fps));

  const vCandidates: VideoCodec[] =
    opts.format === 'mp4' ? ['avc', 'hevc', 'vp9', 'av1'] : ['vp9', 'vp8', 'av1'];
  const videoCodec = await getFirstEncodableVideoCodec(vCandidates, { width, height });
  if (!videoCodec)
    throw new Error(`This device cannot encode ${width}×${height} ${opts.format.toUpperCase()} video.`);

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
  if (!ctx) throw new Error('Could not get a 2D context for rendering.');

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
      composeFrame(ctx, opts.project, time, { mediaBy: opts.mediaBy });
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
  const safe = opts.project.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'motionlab';
  return {
    blob,
    fileName: `${safe} ${width}x${height}.${opts.format}`,
    width,
    height,
    durationSeconds: duration,
  };
}
