import type { MediaLayer, Project } from '../types';

/* Composition audio for export: every visible media layer contributes its
 * clip's sound, honouring startTime, trim-in (sourceIn) and duration, and the
 * solo rule. Mixed offline at 48 kHz stereo into one AudioBuffer the encoder
 * can consume in chunks. Clips without a decodable audio track (silent
 * screen recordings, codecs this browser can't decode) are skipped, never
 * fatal. Returns null when nothing audible is on the timeline. */

export const AUDIO_RATE = 48_000;

/** Fade lengths clamped so fade-in + fade-out never exceed the clip. */
function fades(l: MediaLayer): { fin: number; fout: number } {
  const half = l.duration / 2;
  return {
    fin: Math.max(0, Math.min(half, l.fadeIn ?? 0)),
    fout: Math.max(0, Math.min(half, l.fadeOut ?? 0)),
  };
}

/** Linear gain of a clip's audio at composition `time` (volume × fades, 0 when muted). */
export function clipGainAt(l: MediaLayer, time: number): number {
  if (l.muted) return 0;
  const vol = Math.max(0, Math.min(2, l.volume ?? 1));
  const local = time - l.startTime;
  if (local < 0 || local > l.duration) return 0;
  const { fin, fout } = fades(l);
  let f = 1;
  if (fin > 0 && local < fin) f = Math.min(f, local / fin);
  if (fout > 0 && local > l.duration - fout) f = Math.min(f, (l.duration - local) / fout);
  return vol * Math.max(0, f);
}

/** Whether a clip contributes any sound at all (muted / zero volume don't). */
export const clipIsAudible = (l: MediaLayer) => !l.muted && (l.volume ?? 1) > 0;

export async function mixProjectAudio(project: Project, signal?: AbortSignal): Promise<AudioBuffer | null> {
  if (typeof OfflineAudioContext === 'undefined') return null;
  const media = project.layers.filter((l): l is MediaLayer => l.type === 'media' && l.visible);
  const solo = project.layers.some((l) => l.solo);
  const used = (solo ? media.filter((l) => l.solo) : media).filter(clipIsAudible);
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
    // Volume + fades as a gain envelope in composition time.
    const g = ctx.createGain();
    const t0 = Math.max(0, l.startTime);
    const t1 = t0 + dur;
    const vol = Math.max(0, Math.min(2, l.volume ?? 1));
    const { fin, fout } = fades({ ...l, duration: dur });
    g.gain.setValueAtTime(fin > 0 ? 0 : vol, t0);
    if (fin > 0) g.gain.linearRampToValueAtTime(vol, t0 + fin);
    if (fout > 0) {
      g.gain.setValueAtTime(vol, t1 - fout);
      g.gain.linearRampToValueAtTime(0, t1);
    }
    src.connect(g).connect(ctx.destination);
    src.start(t0, offset, dur);
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
