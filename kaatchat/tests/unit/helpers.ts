import type { AudioAnalysis, Clip, MediaAsset, ProjectDoc } from '../../src/engine/types';
import { newProject } from '../../src/engine/project';
import { loudestShareDb, percentile, ANALYSIS_RATE } from '../../src/engine/dsp';

let n = 0;
export const seqId = () => `n${++n}`;

export function asset(id: string, duration: number, extra: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id,
    name: `${id}.mp4`,
    kind: 'video',
    mime: 'video/mp4',
    size: 1,
    duration,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    storage: 'local',
    origin: 'import',
    addedAt: 0,
    ...extra,
  };
}

export function clip(id: string, assetId: string, i: number, o: number): Clip {
  return { id, assetId, in: i, out: o, gainDb: 0, focusX: 0.5, focusY: 0.5, fit: 'fill' };
}

export function doc(clips: Clip[], assets: MediaAsset[]): ProjectDoc {
  const d = newProject('Test');
  return { ...d, clips, assets: Object.fromEntries(assets.map((a) => [a.id, a])) };
}

/** Build an envelope from [seconds, dB] runs. */
export function envelope(runs: [number, number][]): AudioAnalysis {
  const rmsDb: number[] = [];
  for (const [sec, db] of runs) for (let i = 0; i < Math.round(sec * ANALYSIS_RATE); i++) rmsDb.push(db);
  return { rate: ANALYSIS_RATE, rmsDb, levelDb: loudestShareDb(rmsDb), p90Db: percentile(rmsDb, 90) };
}
