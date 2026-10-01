import { importFile } from '../../../engine/media';
import { newProject } from '../../../engine/project';
import { saveProject, listProjects, type ProjectSummary } from '../../../engine/persist';
import type { Clip, ProjectDoc } from '../../../engine/types';
import type { MediaAsset as MotionAsset } from '../types';

/**
 * Shared media library: convert a Kaatchat engine MediaAsset to the MOTIONLAB
 * MediaAsset shape (so canvases, templates and parameter panels can consume it
 * without caring where it came from).
 */
export function toMotionAsset(
  engineAsset: ProjectDoc['assets'][string],
  blob: Blob,
): MotionAsset {
  const url = URL.createObjectURL(blob);
  return {
    id: engineAsset.id,
    type: engineAsset.kind === 'video' ? 'video' : 'image',
    name: engineAsset.name,
    data: blob,
    url,
    width: engineAsset.width,
    height: engineAsset.height,
  };
}

/**
 * Import a File through Kaatchat's engine (metadata read, decode check,
 * IndexedDB persistence) and return a MOTIONLAB-shaped asset. The file is
 * added to the engine's media bin so both features see it. Audio-only files
 * are rejected — MOTIONLAB works on visuals.
 */
export async function importFileToMotion(file: File): Promise<MotionAsset> {
  const asset = await importFile(file);
  if (asset.kind === 'audio')
    throw new Error('Motion Design works with images and video, not audio.');
  return toMotionAsset(asset, file);
}

/** List existing Kaatchat projects a motion render could be sent to. */
export async function listPodcastProjects(): Promise<ProjectSummary[]> {
  try {
    return await listProjects();
  } catch {
    return [];
  }
}

/**
 * Create a fresh Kaatchat project seeded with the rendered motion blob as its
 * first clip. Returns the new project id so the caller can navigate to the
 * editor at `#/p/<id>`. Does the heavy lift via the engine's own import so
 * the file is decoded, probed and persisted exactly as a drag-dropped import.
 */
export async function sendMotionToNewProject(
  blob: Blob,
  fileName: string,
  projectName: string,
): Promise<string> {
  const file = new File([blob], fileName, { type: blob.type });
  // Import first so decode errors surface before a half-made project lingers.
  const asset = await importFile(file);
  const base = newProject(projectName);
  const clip: Clip = {
    id: `c_${Math.random().toString(36).slice(2, 10)}`,
    assetId: asset.id,
    in: 0,
    out: asset.duration,
    gainDb: 0,
    focusX: 0.5,
    focusY: 0.5,
    fit: 'fill',
  };
  const seeded: ProjectDoc = {
    ...base,
    assets: { [asset.id]: asset },
    sequences: base.sequences.map((s, i) => (i === 0 ? { ...s, clips: [...s.clips, clip] } : s)),
  };
  await saveProject(seeded);
  return seeded.id;
}
