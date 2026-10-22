import type { MediaLayer, Project } from '../types';
import { isLayerActive } from './compose';
import { clipGainAt } from './audioMix';

/* Keeps <video> elements on the frame their layer should show.
 *
 * compose.ts only draws whatever frame an element currently holds, so time
 * has to be pushed into the element first:
 *   - preview while playing: let the video play natively, correct drift only
 *   - preview while paused / scrubbing: seek precisely
 *   - export: seek every frame and wait for the decoder ('seeked')
 */

type El = HTMLImageElement | HTMLVideoElement;
const isVideo = (e: El): e is HTMLVideoElement =>
  typeof HTMLVideoElement !== 'undefined' && e instanceof HTMLVideoElement;

/** Composition time → source time inside the clip's trimmed window. */
export function sourceTimeAt(layer: MediaLayer, time: number): number {
  const t = layer.sourceIn + (time - layer.startTime) * clipRate(layer);
  return Math.max(layer.sourceIn, Math.min(layer.sourceOut - 0.001, t));
}

/** Source seconds per timeline second: 0 for a freeze frame, else the clip speed. */
export function clipRate(layer: MediaLayer): number {
  if (layer.freeze) return 0;
  const s = layer.speed ?? 1;
  return Number.isFinite(s) && s > 0 ? s : 1;
}

function activeMediaByAsset(project: Project, time: number): Map<string, MediaLayer> {
  const m = new Map<string, MediaLayer>();
  for (const l of project.layers) {
    if (l.type === 'media' && isLayerActive(l, time)) m.set(l.assetId, l);
  }
  return m;
}

export function syncPreviewMedia(
  project: Project,
  time: number,
  mediaBy: Map<string, El>,
  playing: boolean,
): void {
  const active = activeMediaByAsset(project, time);
  for (const [id, el] of mediaBy) {
    if (!isVideo(el)) continue;
    const layer = active.get(id);
    if (!layer) {
      if (!el.paused) el.pause();
      continue;
    }
    const target = sourceTimeAt(layer, time);
    if (playing) {
      // Elements load muted (autoplay policy); unmute once the user has
      // pressed play so clip audio is heard in preview.
      // Per-clip volume/fades. HTMLMediaElement volume caps at 1, so >100%
      // boosts are heard in the export only.
      const gain = clipGainAt(layer, time);
      const rate = clipRate(layer);
      if (rate === 0) {
        // Freeze frame: hold the frame, no sound.
        if (!el.paused) el.pause();
        el.muted = true;
        if (Math.abs(el.currentTime - target) > 0.01) el.currentTime = target;
        continue;
      }
      el.muted = gain <= 0;
      el.volume = Math.max(0, Math.min(1, gain));
      // Speed changes pitch, as in the export mix (tape-style).
      if (el.playbackRate !== rate) el.playbackRate = rate;
      (el as HTMLVideoElement & { preservesPitch?: boolean }).preservesPitch = false;
      if (Math.abs(el.currentTime - target) > 0.25 * rate) el.currentTime = target;
      if (el.paused) void el.play().catch(() => undefined);
    } else {
      if (!el.paused) el.pause();
      el.muted = true;
      if (Math.abs(el.currentTime - target) > 0.01) el.currentTime = target;
    }
  }
}

/** Seek every active video to its exact frame and wait until it is decoded. */
export async function seekMediaForExport(
  project: Project,
  time: number,
  mediaBy: Map<string, El>,
): Promise<void> {
  const waits: Promise<void>[] = [];
  for (const [id, layer] of activeMediaByAsset(project, time)) {
    const el = mediaBy.get(id);
    if (!el || !isVideo(el)) continue;
    if (!el.paused) el.pause();
    const target = sourceTimeAt(layer, time);
    if (Math.abs(el.currentTime - target) < 0.0005 && el.readyState >= 2) continue;
    waits.push(
      new Promise<void>((resolve) => {
        const done = () => {
          el.removeEventListener('seeked', done);
          clearTimeout(timer);
          resolve();
        };
        // A stuck decoder must not hang the whole export.
        const timer = setTimeout(done, 2000);
        el.addEventListener('seeked', done);
        el.currentTime = target;
      }),
    );
  }
  await Promise.all(waits);
}
