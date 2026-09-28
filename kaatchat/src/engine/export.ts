// Export: decode, compose and encode on this device. Progress is the number
// of frames actually encoded out of the total.

import {
  ALL_FORMATS,
  AudioBufferSink,
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
import type { AspectId, Clip, ProjectDoc, ProjectIndex } from './types';
import { ASPECTS } from './types';
import { clipLength, clipStarts, sequenceDuration } from './timeline';
import { drawCaption, drawClipFrame, CAPTION_FONT } from './render';
import { captionCues, cueAt } from './transcript';
import { applyGain, mapChannels, planesOf, StreamResampler } from './audio';
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

export function projectExportSize(doc: ProjectDoc) {
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
const SAMPLE_RATE = 48000;

export async function exportProject(doc: ProjectDoc, index: ProjectIndex, opts: ExportOptions, ctl: JobControl): Promise<ExportResult> {
  const started = performance.now();
  if (doc.clips.length === 0) throw new Error('The timeline is empty — nothing to export.');
  const missing = [...new Set(doc.clips.map((c) => c.assetId))].filter((id) => !media.get(id));
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
  const hasAudio = doc.clips.some((c) => doc.assets[c.assetId]?.hasAudio);
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
        const want = Math.round(clipEnd * SAMPLE_RATE) - samplesDone;
        const pushed = await addClipAudio(audioSource, blob, asset.hasAudio && asset.kind === 'video', clip, want, ctl.signal);
        samplesDone += pushed;
      }
    }
    throwIfAborted(ctl.signal);
    ctl.progress(1, 'Finishing file');
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => undefined);
    throw e;
  }

  const buf = (output.target as BufferTarget).buffer;
  if (!buf) throw new Error('The encoder produced no data.');
  const safe = doc.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'kaatchat';
  return {
    blob: new Blob([buf], { type: opts.format === 'mp4' ? 'video/mp4' : 'video/webm' }),
    fileName: `${safe} ${width}x${height}.${opts.format}`,
    videoCodec,
    audioCodec,
    seconds: total,
    elapsedMs: performance.now() - started,
  };
}

/** Add exactly `want` stereo samples for this clip; silence where there is no audio. */
async function addClipAudio(src: AudioBufferSource, blob: Blob, hasAudio: boolean, clip: Clip, want: number, signal: AbortSignal): Promise<number> {
  let pushed = 0;
  const emit = async (planes: Float32Array[]) => {
    const n = Math.min(planes[0].length, want - pushed);
    if (n <= 0) return;
    const ab = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
    for (let ch = 0; ch < 2; ch++) ab.copyToChannel(planes[ch].subarray(0, n) as Float32Array<ArrayBuffer>, ch);
    await src.add(ab);
    pushed += n;
  };

  if (hasAudio) {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (track && (await track.canDecode())) {
        const sr = await track.getSampleRate();
        const rs = new StreamResampler(sr, SAMPLE_RATE, 2);
        let cursor = clip.in; // source seconds consumed so far
        for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers(clip.in, clip.out)) {
          throwIfAborted(signal);
          let planes = mapChannels(planesOf(buffer), 2).map((p) => p.slice());
          let ts = timestamp;
          // Skip audio before the in-point / already consumed.
          const skip = Math.round((cursor - ts) * sr);
          if (skip > 0) {
            if (skip >= planes[0].length) continue;
            planes = planes.map((p) => p.subarray(skip));
            ts = cursor;
          } else if (skip < -8) {
            // A gap in the source: fill with silence.
            await emit(rs.push([new Float32Array(-skip), new Float32Array(-skip)]));
          }
          const endAt = Math.round((clip.out - ts) * sr);
          if (endAt <= 0) break;
          if (endAt < planes[0].length) planes = planes.map((p) => p.subarray(0, endAt));
          applyGain(planes, clip.gainDb);
          await emit(rs.push(planes));
          cursor = ts + planes[0].length / sr;
          if (pushed >= want) break;
        }
      }
    } finally {
      input.dispose();
    }
  }
  // Pad (or top up after resampling rounding) with silence.
  while (pushed < want) {
    const n = Math.min(SAMPLE_RATE, want - pushed);
    await emit([new Float32Array(n), new Float32Array(n)]);
  }
  return pushed;
}
