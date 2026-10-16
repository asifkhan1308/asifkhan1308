import type { MediaLayer, Project } from '../types';

/* Composition audio for export: every visible media layer contributes its
 * clip's sound, honouring startTime, trim-in (sourceIn) and duration, and the
 * solo rule. Mixed offline at 48 kHz stereo into one AudioBuffer the encoder
 * can consume in chunks. Clips without a decodable audio track (silent
 * screen recordings, codecs this browser can't decode) are skipped, never
 * fatal. Returns null when nothing audible is on the timeline. */

export const AUDIO_RATE = 48_000;

export async function mixProjectAudio(project: Project, signal?: AbortSignal): Promise<AudioBuffer | null> {
  if (typeof OfflineAudioContext === 'undefined') return null;
  const media = project.layers.filter((l): l is MediaLayer => l.type === 'media' && l.visible);
  const solo = project.layers.some((l) => l.solo);
  const used = solo ? media.filter((l) => l.solo) : media;
  if (!used.length) return null;

  const decodeCtx = new OfflineAudioContext(2, 1, AUDIO_RATE);
  const decoded = new Map<string, AudioBuffer | null>();
  for (const l of used) {
    if (decoded.has(l.assetId)) continue;
    if (signal?.aborted) throw new DOMException('Export aborted', 'AbortError');
    const asset = project.assets.find((a) => a.id === l.assetId);
    if (!asset?.url) {
      decoded.set(l.assetId, null);
      continue;
    }
    try {
      const bytes = await (await fetch(asset.url)).arrayBuffer();
      decoded.set(l.assetId, await decodeCtx.decodeAudioData(bytes));
    } catch {
      decoded.set(l.assetId, null);
    }
  }

  const length = Math.max(1, Math.ceil(project.composition.duration * AUDIO_RATE));
  const ctx = new OfflineAudioContext(2, length, AUDIO_RATE);
  let audible = false;
  for (const l of used) {
    const buf = decoded.get(l.assetId);
    if (!buf) continue;
    const offset = Math.max(0, l.sourceIn);
    const dur = Math.min(l.duration, buf.duration - offset);
    if (dur <= 0) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(Math.max(0, l.startTime), offset, dur);
    audible = true;
  }
  return audible ? ctx.startRendering() : null;
}

/** Copy [from, to) samples of a rendered mix into a fresh AudioBuffer chunk. */
export function sliceAudio(mix: AudioBuffer, from: number, to: number): AudioBuffer {
  const out = new AudioBuffer({ length: to - from, numberOfChannels: 2, sampleRate: mix.sampleRate });
  for (let ch = 0; ch < 2; ch++) {
    const src = mix.getChannelData(Math.min(ch, mix.numberOfChannels - 1));
    out.copyToChannel(src.subarray(from, to) as Float32Array<ArrayBuffer>, ch);
  }
  return out;
}
