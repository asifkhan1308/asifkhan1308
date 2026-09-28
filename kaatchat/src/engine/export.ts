// Export: decode, compose and encode on this device. Progress is the number
// of frames actually encoded out of the total.

import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  WebMOutputFormat,
  type AudioCodec,
  type VideoCodec,
} from 'mediabunny';
import type { AspectId, Clip, EditView, ProjectIndex } from './types';
import { ASPECTS } from './types';
import { clipLength, clipStarts, sequenceDuration } from './timeline';
import { drawCaption, drawClipFrame, CAPTION_FONT } from './render';
import { captionCues, cueAt } from './transcript';
import { TimelineMixer, SAMPLE_RATE } from './mixer';
import { throwIfAborted, type JobControl } from './jobs';
import { media } from './media';

export interface ExportPreset {
  id: string;
  group: 'Instagram' | 'YouTube' | 'TikTok' | 'Project' | 'Custom';
  label: string;
  width: number;
  height: number;
  aspect?: AspectId;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'ig-reel', group: 'Instagram', label: 'Reel 1080p', width: 1080, height: 1920, aspect: '9:16' },
  { id: 'ig-reel-4k', group: 'Instagram', label: 'Reel 4K', width: 2160, height: 3840, aspect: '9:16' },
  { id: 'ig-feed', group: 'Instagram', label: 'Feed 4:5', width: 1080, height: 1350, aspect: '4:5' },
  { id: 'ig-square', group: 'Instagram', label: 'Square', width: 1080, height: 1080, aspect: '1:1' },
  { id: 'ig-story', group: 'Instagram', label: 'Story', width: 1080, height: 1920, aspect: '9:16' },
  { id: 'yt-shorts', group: 'YouTube', label: 'Shorts 1080p', width: 1080, height: 1920, aspect: '9:16' },
  { id: 'yt-shorts-4k', group: 'YouTube', label: 'Shorts 4K', width: 2160, height: 3840, aspect: '9:16' },
  { id: 'yt-1080', group: 'YouTube', label: '1080p', width: 1920, height: 1080, aspect: '16:9' },
  { id: 'yt-1440', group: 'YouTube', label: '1440p', width: 2560, height: 1440, aspect: '16:9' },
  { id: 'yt-4k', group: 'YouTube', label: '4K', width: 3840, height: 2160, aspect: '16:9' },
  { id: 'tt-1080', group: 'TikTok', label: '1080p', width: 1080, height: 1920, aspect: '9:16' },
  { id: 'tt-4k', group: 'TikTok', label: '4K', width: 2160, height: 3840, aspect: '9:16' },
];

export type Quality = 'standard' | 'high' | 'max';

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  format: 'mp4' | 'webm';
  quality: Quality;
  /** 'project' keeps each clip's framing; fit/fill override it. */
  framing: 'project' | 'fit' | 'fill';
  captions: boolean;
}

export function projectExportSize(doc: EditView) {
  const a = ASPECTS[doc.aspect];
  return { width: a.width, height: a.height };
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  videoCodec: VideoCodec;
  audioCodec: AudioCodec | null;
  seconds: number;
  elapsedMs: number;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export async function exportProject(doc: EditView, index: ProjectIndex, opts: ExportOptions, ctl: JobControl): Promise<ExportResult> {
  const started = performance.now();
  if (doc.clips.length === 0) throw new Error('The timeline is empty — nothing to export.');
  const missing = [...new Set([...doc.clips.map((c) => c.assetId), ...doc.audio.map((a) => a.assetId)])].filter((id) => !media.get(id));
  if (missing.length)
    throw new Error(`${missing.length} media file(s) need relinking before export: ${missing.map((id) => doc.assets[id]?.name).join(', ')}. Your originals are untouched.`);

  const width = even(opts.width);
  const height = even(opts.height);
  const fps = opts.fps;
  const quality = opts.quality === 'max' ? QUALITY_VERY_HIGH : opts.quality === 'high' ? QUALITY_HIGH : QUALITY_MEDIUM;
  const vCandidates: VideoCodec[] = opts.format === 'mp4' ? ['avc', 'hevc', 'vp9', 'av1'] : ['vp9', 'vp8', 'av1'];
  const aCandidates: AudioCodec[] = opts.format === 'mp4' ? ['aac', 'opus'] : ['opus', 'vorbis'];
  const videoCodec = await getFirstEncodableVideoCodec(vCandidates, { width, height });
  if (!videoCodec)
    throw new Error(`This device cannot encode ${width}×${height} ${opts.format.toUpperCase()} video. Try a smaller size or the other format.`);
  const mixer = new TimelineMixer(doc, index);
  const hasAudio = doc.clips.some((c) => doc.assets[c.assetId]?.hasAudio) || doc.audio.length > 0;
  const audioCodec = hasAudio ? await getFirstEncodableAudioCodec(aCandidates, { numberOfChannels: 2, sampleRate: SAMPLE_RATE }) : null;

  const output = new Output({
    format: opts.format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const videoSource = new CanvasSource(canvas, { codec: videoCodec, bitrate: quality, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: fps });
  const audioSource = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: quality }) : null;
  if (audioSource) output.addAudioTrack(audioSource);

  const cues = opts.captions && doc.captions.enabled ? captionCues(doc, index) : [];
  if (cues.length) await document.fonts?.load(`800 64px ${CAPTION_FONT}`).catch(() => undefined);
  const total = sequenceDuration(doc.clips);
  const totalFrames = Math.max(1, Math.round(total * fps));
  const starts = clipStarts(doc.clips);
  let framesDone = 0;
  let samplesDone = 0;

  await output.start();
  try {
    for (let i = 0; i < doc.clips.length; i++) {
      throwIfAborted(ctl.signal);
      const clip = doc.clips[i];
      const framed: Clip = opts.framing === 'project' ? clip : { ...clip, fit: opts.framing };
      const clipStart = starts[i];
      const clipEnd = clipStart + clipLength(clip);
      const k0 = Math.round(clipStart * fps);
      const k1 = i === doc.clips.length - 1 ? totalFrames : Math.round(clipEnd * fps);
      const blob = media.get(clip.assetId)!;
      const asset = doc.assets[clip.assetId];

      const drawAndAdd = async (k: number) => {
        const t = k / fps;
        if (cues.length) drawCaption(ctx, cueAt(cues, t), t, doc.captions.style, width, height, CAPTION_FONT);
        await videoSource.add(t, 1 / fps);
        framesDone++;
        ctl.progress(framesDone / totalFrames, `Frame ${framesDone} of ${totalFrames} · ${videoCodec.toUpperCase()}`);
      };

      // ---- video
      if (asset.kind === 'image') {
        const bmp = await createImageBitmap(blob);
        try {
          for (let k = k0; k < k1; k++) {
            throwIfAborted(ctl.signal);
            drawClipFrame(ctx, bmp, bmp.width, bmp.height, framed, width, height);
            await drawAndAdd(k);
          }
        } finally {
          bmp.close();
        }
      } else if (k1 > k0) {
        const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
        try {
          const track = await input.getPrimaryVideoTrack();
          if (!track) throw new Error(`“${asset.name}” has no video track.`);
          const first = await input.getFirstTimestamp([track]).catch(() => 0);
          const sink = new CanvasSink(track, { poolSize: 2 });
          const times = Array.from({ length: k1 - k0 }, (_, j) => first + Math.min(clip.out - 1e-3, clip.in + (k0 + j) / fps - clipStart));
          let last: CanvasImageSource | null = null;
          let lastW = 0;
          let lastH = 0;
          let j = 0;
          for await (const wc of sink.canvasesAtTimestamps(times)) {
            throwIfAborted(ctl.signal);
            if (wc) {
              last = wc.canvas;
              lastW = wc.canvas.width;
              lastH = wc.canvas.height;
            }
            if (last) drawClipFrame(ctx, last, lastW, lastH, framed, width, height);
            else {
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, width, height);
            }
            await drawAndAdd(k0 + j++);
          }
        } finally {
          input.dispose();
        }
      }

      // ---- audio (sample-exact to the timeline)
      if (audioSource) {
        const until = Math.round(clipEnd * SAMPLE_RATE);
        while (samplesDone < until) {
          const next = Math.min(until, samplesDone + SAMPLE_RATE);
          const planes = await mixer.render(samplesDone, next, ctl.signal);
          const ab = new AudioBuffer({ length: next - samplesDone, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
          ab.copyToChannel(planes[0] as Float32Array<ArrayBuffer>, 0);
          ab.copyToChannel(planes[1] as Float32Array<ArrayBuffer>, 1);
          await audioSource.add(ab);
          samplesDone = next;
        }
      }
    }
    throwIfAborted(ctl.signal);
    ctl.progress(1, 'Finishing file');
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => undefined);
    throw e;
  } finally {
    mixer.dispose();
  }

  const buf = (output.target as BufferTarget).buffer;
  if (!buf) throw new Error('The encoder produced no data.');
  const safe = (doc.name === 'Main edit' ? doc.projectName : `${doc.projectName} ${doc.name}`).replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'kaatchat';
  return {
    blob: new Blob([buf], { type: opts.format === 'mp4' ? 'video/mp4' : 'video/webm' }),
    fileName: `${safe} ${width}x${height}.${opts.format}`,
    videoCodec,
    audioCodec,
    seconds: total,
    elapsedMs: performance.now() - started,
  };
}
