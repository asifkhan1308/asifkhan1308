import type { ProjectDoc } from './types';
import { uid } from './id';

export function newProject(name = 'Untitled project'): ProjectDoc {
  const now = Date.now();
  return {
    version: 2,
    id: uid(),
    name,
    createdAt: now,
    updatedAt: now,
    aspect: '16:9',
    fps: 30,
    assets: {},
    clips: [],
    captions: { enabled: false, style: 'bold', maxWords: 4 },
  };
}

/** Accept a stored or imported project, rejecting anything malformed. */
export function reviveProject(raw: unknown): ProjectDoc {
  if (!raw || typeof raw !== 'object') throw new Error('Not a Kaatchat project.');
  const d = raw as Partial<ProjectDoc>;
  if (d.version !== 2 || typeof d.id !== 'string' || !Array.isArray(d.clips) || typeof d.assets !== 'object' || !d.assets)
    throw new Error('Not a Kaatchat 2 project file.');
  const base = newProject();
  return {
    ...base,
    ...d,
    captions: { ...base.captions, ...(d.captions ?? {}) },
  } as ProjectDoc;
}
