// Media import and measurement. Everything is decoded on this device with
// WebCodecs (via Mediabunny); nothing is uploaded.

import { ALL_FORMATS, AudioBufferSink, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { AudioAnalysis, FramingAnalysis, MediaAsset, Transcript } from './types';
import { EnvelopeBuilder, frameFocus } from './dsp';
import { mapChannels, planesOf, StreamResampler } from './audio';
import { estimateBeats, OnsetDetector } from './beats';
import { NoiseProfiler, type NoiseProfile } from './denoise';
import { wordsToSegments } from './transcript';
import { MAX_STORED_BYTES, putMedia } from './persist';
import { throwIfAborted, type JobControl } from './jobs';
import { uid } from './id';

// ---------------------------------------------------------------------------
// Blob registry: the bytes behind each asset for this session.
// ---------------------------------------------------------------------------

const blobs = new Map<string, Blob>();
const urls = new Map<string, string>();

export const media = {
  get: (id: string) => blobs.get(id) ?? null,
  set(id: string, b: Blob) {
    blobs.set(id, b);
    const u = urls.get(id);
    if (u) URL.revokeObjectURL(u);
    urls.delete(id);
  },
  url(id: string): string | null {
    const b = blobs.get(id);
    if (!b) return null;
    let u = urls.get(id);
    if (!u) {
      u = URL.createObjectURL(b);
      urls.set(id, u);
    }
    return u;
  },
  clear() {
    for (const u of urls.values()) URL.revokeObjectURL(u);
    urls.clear();
    blobs.clear();
  },
};

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|ogv)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i;
export const IMAGE_STILL_SECONDS = 5;
export { ACCEPT } from './formats';

export class ImportError extends Error {}

function kindOf(file: File): 'video' | 'image' | 'audio' | null {
  if (file.type.startsWith('video/') || VIDEO_EXT.test(file.name)) return 'video';
  if (file.type.startsWith('image/') || IMAGE_EXT.test(file.name)) return 'image';
  if (file.type.startsWith('audio/') || AUDIO_EXT.test(file.name)) return 'audio';
  return null;
}

/** Read metadata and register the file. Does not run analysis. */
export async function importFile(file: File): Promise<MediaAsset> {
  const kind = kindOf(file);
  if (!kind) throw new ImportError(`“${file.name}” is not a video, image or audio file Kaatchat can read.`);
  const id = uid();
  let asset: MediaAsset;
  if (kind === 'image') {
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      throw new ImportError(`“${file.name}” could not be decoded as an image.`);
    }
    asset = baseAsset(id, file, 'image', { duration: IMAGE_STILL_SECONDS, width: bmp.width, height: bmp.height, fps: 30, hasAudio: false });
    bmp.close();
  } else if (kind === 'audio') {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      if (!(await input.canRead())) throw new ImportError(`“${file.name}” is not in an audio format Kaatchat can read.`);
      const a = await input.getPrimaryAudioTrack();
      if (!a) throw new ImportError(`“${file.name}” has no audio track.`);
      if (!(await a.canDecode())) throw new ImportError(`This browser cannot decode the audio in “${file.name}” (${(await a.getCodec()) ?? 'unknown codec'}).`);
      asset = baseAsset(id, file, 'audio', { duration: await input.computeDuration(), width: 0, height: 0, fps: 0, hasAudio: true });
    } finally {
      input.dispose();
    }
  } else {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      if (!(await input.canRead())) throw new ImportError(`“${file.name}” is not in a container format Kaatchat can read.`);
      const v = await input.getPrimaryVideoTrack();
      if (!v) {
        // An audio-only file with a video extension (e.g. .webm, .m4a-in-mp4).
        const a = await input.getPrimaryAudioTrack();
        if (a && (await a.canDecode())) {
          asset = baseAsset(id, file, 'audio', { duration: await input.computeDuration(), width: 0, height: 0, fps: 0, hasAudio: true });
          input.dispose();
          media.set(id, file);
          return storeAsset(asset, file);
        }
        throw new ImportError(`“${file.name}” has no video track.`);
      }
      if (!(await v.canDecode()))
        throw new ImportError(`This browser cannot decode the video in “${file.name}” (${(await v.getCodec()) ?? 'unknown codec'}).`);
      const a = await input.getPrimaryAudioTrack();
      const duration = await input.computeDuration();
      const stats = await v.computePacketStats(120).catch(() => null);
      asset = baseAsset(id, file, 'video', {
        duration,
        width: await v.getDisplayWidth(),
        height: await v.getDisplayHeight(),
        fps: stats?.averagePacketRate ? Math.round(stats.averagePacketRate * 100) / 100 : 30,
        hasAudio: !!a && (await a.canDecode()),
      });
    } finally {
      input.dispose();
    }
  }
  media.set(id, file);
  return storeAsset(asset, file);
}

async function storeAsset(asset: MediaAsset, file: File): Promise<MediaAsset> {
  if (file.size <= MAX_STORED_BYTES) {
    try {
      await putMedia(asset.id, file);
    } catch {
      asset.storage = 'session';
    }
  } else asset.storage = 'session';
  return asset;
}

function baseAsset(
  id: string,
  file: File,
  kind: MediaAsset['kind'],
  m: Pick<MediaAsset, 'duration' | 'width' | 'height' | 'fps' | 'hasAudio'>,
): MediaAsset {
  return { id, name: file.name, kind, mime: file.type || 'application/octet-stream', size: file.size, storage: 'local', origin: 'import', addedAt: Date.now(), ...m };
}

/** Relinking: the same file (by name and size) chosen again after a reload. */
export function matchesAsset(asset: MediaAsset, file: File) {
  return file.name === asset.name && file.size === asset.size;
}

// ---------------------------------------------------------------------------
// Measurement jobs
// ---------------------------------------------------------------------------

async function withInput<T>(blob: Blob, fn: (input: Input) => Promise<T>): Promise<T> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    return await fn(input);
  } finally {
    input.dispose();
  }
}

/** Loudness envelope. Progress = seconds decoded / duration. */
export async function analyzeAudio(
  blob: Blob,
  ctl: JobControl,
  withBeats = false,
): Promise<{ audio: AudioAnalysis; beats: ReturnType<typeof estimateBeats>; noise: NoiseProfile | null } | null> {
  return withInput(blob, async (input) => {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const duration = await input.computeDuration();
    const sr = await track.getSampleRate();
    const env = new EnvelopeBuilder(sr);
    const onsets = withBeats ? new OnsetDetector(sr) : null;
    // Music files are not voice; their "noise floor" is the music itself.
    const noise = withBeats ? null : new NoiseProfiler(sr);
    const sink = new AudioBufferSink(track);
    let expected = 0; // samples pushed so far
    for await (const { buffer, timestamp } of sink.buffers()) {
      throwIfAborted(ctl.signal);
      const at = Math.round(Math.max(0, timestamp) * sr);
      if (at > expected + 64) {
        env.push(new Float32Array(at - expected));
        expected = at;
      }
      const mono = mapChannels(planesOf(buffer), 1)[0];
      env.push(mono);
      onsets?.push(mono);
      noise?.push(mono);
      expected += mono.length;
      ctl.progress(duration ? timestamp / duration : null, withBeats ? 'Measuring loudness and beat' : 'Measuring loudness');
    }
    return { audio: env.finish(), beats: onsets ? estimateBeats(onsets.flux, onsets.rate) : null, noise: noise?.finish() ?? null };
  });
}

const FRAME_W = 64;
const FRAME_H = 36;
const THUMB_W = 160;
const THUMB_H = 90;

/** Content-aware framing samples + filmstrip thumbnails in one decode pass. */
export async function analyzeFrames(
  asset: MediaAsset,
  blob: Blob,
  ctl: JobControl,
): Promise<{ framing: FramingAnalysis; thumbs: { t: number; url: string }[] }> {
  if (asset.kind === 'image') {
    const bmp = await createImageBitmap(blob);
    const thumb = await snapshot(bmp, bmp.width, bmp.height);
    const f = focusOf(bmp, undefined);
    bmp.close();
    return { framing: { samples: [{ t: 0, ...f.focus }] }, thumbs: [{ t: 0, url: thumb }] };
  }
  return withInput(blob, async (input) => {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return { framing: { samples: [] }, thumbs: [] };
    const duration = await input.computeDuration();
    const first = await input.getFirstTimestamp([track]).catch(() => 0);
    const step = Math.max(0.5, duration / 400);
    const times: number[] = [];
    for (let t = first; t < first + duration - 0.01; t += step) times.push(t);
    if (times.length === 0) times.push(first);
    const thumbEvery = Math.max(1, Math.ceil(times.length / 48));
    const sink = new CanvasSink(track, { width: THUMB_W * 2, height: THUMB_H * 2, fit: 'contain', poolSize: 1 });
    const samples: FramingAnalysis['samples'] = [];
    const thumbs: { t: number; url: string }[] = [];
    let prev: Uint8ClampedArray | undefined;
    let k = 0;
    for await (const wc of sink.canvasesAtTimestamps(times)) {
      throwIfAborted(ctl.signal);
      const t = times[k] - first;
      if (wc) {
        const f = focusOf(wc.canvas, prev);
        prev = f.gray;
        samples.push({ t, ...f.focus });
        if (k % thumbEvery === 0) thumbs.push({ t, url: await snapshot(wc.canvas, THUMB_W * 2, THUMB_H * 2) });
      }
      k++;
      ctl.progress(k / times.length, 'Framing and filmstrip');
    }
    return { framing: { samples }, thumbs };
  });
}

let scratch: OffscreenCanvas | null = null;
function focusOf(src: CanvasImageSource, prev: Uint8ClampedArray | undefined) {
  scratch ??= new OffscreenCanvas(FRAME_W, FRAME_H);
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, FRAME_W, FRAME_H);
  const rgba = ctx.getImageData(0, 0, FRAME_W, FRAME_H).data;
  const gray = new Uint8ClampedArray(FRAME_W * FRAME_H);
  for (let i = 0; i < gray.length; i++) gray[i] = (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8;
  const f = frameFocus(gray, FRAME_W, FRAME_H, prev);
  return { gray, focus: { x: round3(f.x), y: round3(f.y), weight: Math.round(f.weight) } };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

async function snapshot(src: CanvasImageSource, w: number, h: number): Promise<string> {
  const c = new OffscreenCanvas(THUMB_W, THUMB_H);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, THUMB_W, THUMB_H);
  const s = Math.min(THUMB_W / w, THUMB_H / h);
  ctx.drawImage(src, (THUMB_W - w * s) / 2, (THUMB_H - h * s) / 2, w * s, h * s);
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------------------
// Transcription (local Whisper in a worker)
// ---------------------------------------------------------------------------

export const WHISPER_MODELS = [
  { id: 'onnx-community/whisper-base', label: 'Whisper Base (multilingual, ~80 MB)', multilingual: true },
  { id: 'onnx-community/whisper-tiny', label: 'Whisper Tiny (multilingual, ~40 MB, faster, less accurate)', multilingual: true },
  { id: 'onnx-community/whisper-base.en', label: 'Whisper Base English (~80 MB)', multilingual: false },
] as const;

/** Decode audio to 16 kHz mono — the format Whisper expects. */
export async function decodeForSpeech(blob: Blob, ctl: JobControl): Promise<Float32Array | null> {
  return withInput(blob, async (input) => {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const duration = await input.computeDuration();
    const rs = new StreamResampler(await track.getSampleRate(), 16000, 1);
    const parts: Float32Array[] = [];
    let n = 0;
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) {
      throwIfAborted(ctl.signal);
      const out = rs.push(mapChannels(planesOf(buffer), 1))[0];
      parts.push(out);
      n += out.length;
      ctl.progress(duration ? (timestamp / duration) * 0.1 : null, 'Preparing audio');
    }
    const all = new Float32Array(n);
    let o = 0;
    for (const p of parts) {
      all.set(p, o);
      o += p.length;
    }
    return all;
  });
}

let worker: Worker | null = null;

/** No word from the worker for this long while it loads the model means the download has stalled. */
export const SPEECH_MODEL_STALL_MS = 120_000;

/** Turns a model-loading failure into something the user can act on. */
export function speechModelError(model: string, message: string): string {
  if (/fetch|network|internet|ERR_|timed? ?out|stalled|Could not locate|404|403|CORS|load/i.test(message))
    return `Couldn't download the speech model “${model}” (${message}). Check your internet connection or firewall and try Transcribe again — the model downloads once and is then kept on this device. You can also load an existing .srt/.vtt subtitle file instead.`;
  return `Transcription failed: ${message}`;
}

export async function transcribe(blob: Blob, model: string, language: string | undefined, ctl: JobControl): Promise<Transcript> {
  const audio = await decodeForSpeech(blob, ctl);
  if (!audio) throw new Error('This file has no audio track to transcribe.');
  worker ??= new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  const id = uid();
  const seconds = audio.length / 16000;
  return new Promise<Transcript>((resolve, reject) => {
    const started = performance.now();
    let stall: ReturnType<typeof setTimeout> | undefined;
    const kill = () => {
      // Whisper cannot be interrupted mid-chunk; a fresh worker is started next time.
      w.terminate();
      if (worker === w) worker = null;
    };
    const fail = (err: Error) => {
      cleanup();
      kill();
      reject(err);
    };
    // Until transcription starts, the worker reports download progress; silence means a stalled download.
    const watch = () => {
      clearTimeout(stall);
      stall = setTimeout(() => fail(new Error(speechModelError(model, `download stalled — nothing received for ${SPEECH_MODEL_STALL_MS / 1000}s`))), SPEECH_MODEL_STALL_MS);
    };
    const onAbort = () => {
      cleanup();
      kill();
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    const onCrash = (e: Event) => fail(new Error(speechModelError(model, e instanceof ErrorEvent && e.message ? e.message : 'the speech worker could not start')));
    const cleanup = () => {
      clearTimeout(stall);
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onCrash);
      w.removeEventListener('messageerror', onCrash);
      ctl.signal.removeEventListener('abort', onAbort);
    };
    const onMsg = (e: MessageEvent) => {
      const m = e.data as import('./transcribe.worker').WorkerOut;
      if (m.id !== id) return;
      if (m.type === 'status') {
        if (m.phase === 'download') {
          watch();
          ctl.progress(m.progress, `Downloading speech model ${m.detail ?? ''}`.trim());
        } else {
          clearTimeout(stall); // transcription itself reports no progress; long audio takes minutes
          ctl.progress(null, `Transcribing ${Math.round(seconds)}s of audio on this device (${Math.round((performance.now() - started) / 1000)}s elapsed)`);
        }
      } else if (m.type === 'error') {
        cleanup();
        reject(new Error(speechModelError(model, m.message)));
      } else {
        cleanup();
        const words = m.chunks
          .filter((c) => Number.isFinite(c.start))
          .map((c) => ({ t0: c.start, t1: Math.max(c.end, c.start + 0.05), text: c.text.trim() }));
        resolve({ model, language: m.language, createdAt: Date.now(), segments: wordsToSegments(words) });
      }
    };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onCrash);
    w.addEventListener('messageerror', onCrash);
    ctl.signal.addEventListener('abort', onAbort, { once: true });
    ctl.progress(null, 'Loading speech model');
    watch();
    const msg: import('./transcribe.worker').WorkerIn = { type: 'transcribe', id, model, audio, language };
    w.postMessage(msg, [audio.buffer]);
  });
}
