// Export: decode, compose and encode on this device. Progress is the number
// of frames actually encoded out of the total.

import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  canEncodeAudio,
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
import { clipLength, clipStarts, locate, sequenceDuration } from './timeline';
import { drawCaption, drawClipFrame, CAPTION_FONT } from './render';
import { drawOverlay, drawTransition, overlaysAt, transitionWindows } from './motion';
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
  width: number;
  height: number;
  /** Timeline length that was rendered. */
  seconds: number;
  /** Duration of the finished file, read back from it. */
  durationSec: number;
  /** Wall-clock time the export took — not a property of the video. */
  elapsedMs: number;
}

let aacReady: Promise<void> | null = null;
/**
 * MP4 audio is AAC. WebCodecs only offers an AAC encoder on some platforms
 * (not Linux Chromium, not Firefox), so when it is missing we register
 * Mediabunny's AAC-LC encoder (FFmpeg's, compiled to WebAssembly). It is loaded
 * on first MP4 export only; a native encoder is always preferred.
 */
export function ensureAacEncoder(): Promise<void> {
  aacReady ??= (async () => {
    if (await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: SAMPLE_RATE })) return;
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
    registerAacEncoder();
  })().catch((e) => {
    aacReady = null; // let a later export retry
    console.warn('AAC encoder unavailable, MP4 audio will use another codec:', e);
  });
  return aacReady;
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
  if (hasAudio && opts.format === 'mp4') await ensureAacEncoder();
  const audioCodec = hasAudio ? await getFirstEncodableAudioCodec(aCandidates, { numberOfChannels: 2, sampleRate: SAMPLE_RATE }) : null;

  const output = new Output({
    format: opts.format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const videoSource = new CanvasSource(canvas, { codec: videoCodec, bitrate: quality, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: fps });
  // Explicit stereo bitrates: the generic quality presets give AAC as little as ~80 kb/s.
  const audioBitrate = opts.quality === 'max' ? 256_000 : opts.quality === 'high' ? 192_000 : 128_000;
  const audioSource = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: audioBitrate }) : null;
  if (audioSource) output.addAudioTrack(audioSource);

  const cues = opts.captions && doc.captions.enabled ? captionCues(doc, index) : [];
  if (cues.length) await document.fonts?.load(`800 64px ${CAPTION_FONT}`).catch(() => undefined);
  const total = sequenceDuration(doc.clips);
  const totalFrames = Math.max(1, Math.round(total * fps));
  const starts = clipStarts(doc.clips);
  let framesDone = 0;
  let samplesDone = 0;

  const framedClips: Clip[] = doc.clips.map((c) => (opts.framing === 'project' ? c : { ...c, fit: opts.framing }));
  const windows = transitionWindows(doc.clips, starts);
  const providers = framedClips.map((c, i) => {
    // Frames this clip contributes, including transition handles either side.
    const inW = windows.find((w) => w.fromIndex === i - 1);
    const outW = windows.find((w) => w.fromIndex === i);
    const from = inW ? inW.start : starts[i];
    const to = outW ? outW.end : starts[i] + clipLength(c);
    const k0 = Math.max(0, Math.round(from * fps));
    const k1 = i === doc.clips.length - 1 ? totalFrames : Math.min(totalFrames, Math.round(to * fps) + 1);
    const asset = doc.assets[c.assetId];
    return new FrameProvider(media.get(c.assetId)!, asset.kind === 'image', asset.name, (k) => c.in + (k / fps - starts[i]), asset.duration, k0, k1);
  });
  const imageCache = await loadOverlayImages(doc);
  const scratchA = new OffscreenCanvas(width, height);
  const scratchB = new OffscreenCanvas(width, height);
  const ctxA = scratchA.getContext('2d', { alpha: false })!;
  const ctxB = scratchB.getContext('2d', { alpha: false })!;

  const flushAudio = async (untilSeconds: number) => {
    if (!audioSource) return;
    const until = Math.round(untilSeconds * SAMPLE_RATE);
    while (samplesDone < until) {
      const next = Math.min(until, samplesDone + SAMPLE_RATE);
      const planes = await mixer.render(samplesDone, next, ctl.signal);
      const ab = new AudioBuffer({ length: next - samplesDone, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
      ab.copyToChannel(planes[0] as Float32Array<ArrayBuffer>, 0);
      ab.copyToChannel(planes[1] as Float32Array<ArrayBuffer>, 1);
      await audioSource.add(ab);
      samplesDone = next;
    }
  };

  await output.start();
  try {
    for (let k = 0; k < totalFrames; k++) {
      throwIfAborted(ctl.signal);
      const t = k / fps;
      const w = windows.find((x) => t >= x.start && t < x.end);
      if (w) {
        const a = await providers[w.fromIndex].frame(k);
        const b = await providers[w.fromIndex + 1].frame(k);
        drawClipFrame(ctxA, a.src, a.w, a.h, framedClips[w.fromIndex], width, height, k);
        drawClipFrame(ctxB, b.src, b.w, b.h, framedClips[w.fromIndex + 1], width, height, k);
        drawTransition(ctx, w.kind, scratchA, scratchB, (t - w.start) / (w.end - w.start), width, height);
      } else {
        const i = locate(doc.clips, t)!.index;
        const f = await providers[i].frame(k);
        drawClipFrame(ctx, f.src, f.w, f.h, framedClips[i], width, height, k);
      }
      for (const o of overlaysAt(doc.overlays, t)) drawOverlay(ctx, o, t - o.start, width, height, o.assetId ? imageCache.get(o.assetId) : undefined);
      if (cues.length) drawCaption(ctx, cueAt(cues, t), t, doc.captions.style, width, height, CAPTION_FONT, doc.captions.accent);
      await videoSource.add(t, 1 / fps);
      framesDone++;
      ctl.progress(framesDone / totalFrames, `Frame ${framesDone} of ${totalFrames} · ${videoCodec.toUpperCase()}`);
      // Release decoders we are done with; keep audio roughly in step with video.
      providers.forEach((p) => p.releaseBefore(k));
      if (k % fps === fps - 1) await flushAudio((k + 1) / fps);
    }
    await flushAudio(total);
    throwIfAborted(ctl.signal);
    ctl.progress(1, 'Finishing file');
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => undefined);
    throw e;
  } finally {
    mixer.dispose();
    providers.forEach((p) => p.dispose());
    imageCache.forEach((b) => b.close());
  }

  const buf = (output.target as BufferTarget).buffer;
  if (!buf) throw new Error('The encoder produced no data.');
  const blob = new Blob([buf], { type: opts.format === 'mp4' ? 'video/mp4' : 'video/webm' });
  // Report what the file actually holds, not what we intended to write.
  const check = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const durationSec = await check.computeDuration().finally(() => check.dispose());
  const safe = (doc.name === 'Main edit' ? doc.projectName : `${doc.projectName} ${doc.name}`).replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'kaatchat';
  return {
    blob,
    fileName: `${safe} ${width}x${height}.${opts.format}`,
    videoCodec,
    audioCodec,
    width,
    height,
    seconds: total,
    durationSec,
    elapsedMs: performance.now() - started,
  };
}

/** Sequential frames of one clip (with transition handles), decoded once. */
class FrameProvider {
  private input: Input | null = null;
  private it: AsyncGenerator<{ canvas: HTMLCanvasElement | OffscreenCanvas } | null> | null = null;
  private bmp: ImageBitmap | null = null;
  private next: number;
  private last: { src: CanvasImageSource; w: number; h: number } = { src: blank(), w: 0, h: 0 };
  private closed = false;

  constructor(
    private blob: Blob,
    private isImage: boolean,
    private name: string,
    private sourceAt: (k: number) => number,
    private duration: number,
    private k0: number,
    private k1: number,
  ) {
    this.next = k0;
  }

  private async open() {
    if (this.isImage) {
      this.bmp = await createImageBitmap(this.blob);
      this.last = { src: this.bmp, w: this.bmp.width, h: this.bmp.height };
      return;
    }
    this.input = new Input({ source: new BlobSource(this.blob), formats: ALL_FORMATS });
    const track = await this.input.getPrimaryVideoTrack();
    if (!track) throw new Error(`“${this.name}” has no video track.`);
    const first = await this.input.getFirstTimestamp([track]).catch(() => 0);
    const sink = new CanvasSink(track, { poolSize: 3 });
    const times: number[] = [];
    for (let k = this.k0; k < this.k1; k++) times.push(first + Math.max(0, Math.min(this.duration - 1e-3, this.sourceAt(k))));
    this.it = sink.canvasesAtTimestamps(times) as AsyncGenerator<{ canvas: HTMLCanvasElement | OffscreenCanvas } | null>;
  }

  async frame(k: number) {
    if (this.closed) return this.last;
    if (!this.input && !this.bmp) await this.open();
    if (this.isImage) return this.last;
    while (this.next <= k && this.next < this.k1 && this.it) {
      const r = await this.it.next();
      this.next++;
      if (r.done) break;
      if (r.value) this.last = { src: r.value.canvas, w: r.value.canvas.width, h: r.value.canvas.height };
    }
    return this.last;
  }

  releaseBefore(k: number) {
    if (k >= this.k1 && !this.closed) this.dispose();
  }

  dispose() {
    this.closed = true;
    void this.it?.return?.(null);
    this.input?.dispose();
    this.bmp?.close();
    this.input = null;
  }
}

function blank(): OffscreenCanvas {
  return new OffscreenCanvas(2, 2);
}

/** Overlay images (logos etc.) decoded once for the whole export. */
async function loadOverlayImages(doc: EditView): Promise<Map<string, ImageBitmap>> {
  const out = new Map<string, ImageBitmap>();
  for (const o of doc.overlays) {
    if (!o.assetId || out.has(o.assetId)) continue;
    const blob = media.get(o.assetId);
    if (!blob) continue;
    try {
      out.set(o.assetId, await createImageBitmap(blob));
    } catch {
      /* not an image; skipped */
    }
  }
  return out;
}
