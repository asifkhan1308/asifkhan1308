import type { AspectId, Clip, EditView, ProjectDoc, Sequence } from './types';
import { DEFAULT_MIX } from './types';
import { uid } from './id';
import { clampProjectOverlays } from './timeline';

export function newSequence(name = 'Main edit', aspect: AspectId = '16:9', clips: Clip[] = []): Sequence {
  return {
    id: uid(),
    name,
    createdAt: Date.now(),
    aspect,
    fps: 30,
    clips,
    audio: [],
    overlays: [],
    captions: { enabled: false, style: 'bold', maxWords: 4 },
    mix: { ...DEFAULT_MIX },
  };
}

export function newProject(name = 'Untitled project'): ProjectDoc {
  const now = Date.now();
  const seq = newSequence();
  return { version: 3, id: uid(), name, createdAt: now, updatedAt: now, assets: {}, sequences: [seq], activeSequenceId: seq.id, brand: null };
}

export function activeSequence(p: ProjectDoc): Sequence {
  return p.sequences.find((s) => s.id === p.activeSequenceId) ?? p.sequences[0];
}

/** The active sequence as an editable view. */
export function toView(p: ProjectDoc): EditView {
  return { ...activeSequence(p), assets: p.assets, projectName: p.name, brand: p.brand };
}

/** Write an edited view back into the project. */
export function fromView(p: ProjectDoc, v: EditView): ProjectDoc {
  const { assets, projectName, brand, ...seq } = v;
  const id = activeSequence(p).id;
  return {
    ...p,
    name: projectName,
    assets,
    brand,
    sequences: p.sequences.map((s) => (s.id === id ? { ...seq, id } : s)),
  };
}

/** Accept a stored or imported project (v2 or v3), rejecting anything malformed. */
/** Validates and migrates a stored project; layers are kept inside their edit, as on every edit. */
export function reviveProject(raw: unknown): ProjectDoc {
  return clampProjectOverlays(reviveUnclamped(raw));
}

function reviveUnclamped(raw: unknown): ProjectDoc {
  if (!raw || typeof raw !== 'object') throw new Error('Not a Kaatchat project.');
  const d = raw as Record<string, unknown>;
  if (typeof d.id !== 'string' || typeof d.assets !== 'object' || !d.assets) throw new Error('Not a Kaatchat project file.');

  if (d.version === 2) {
    // v2 had one timeline at the top level.
    if (!Array.isArray(d.clips)) throw new Error('Not a Kaatchat 2 project file.');
    const seq = newSequence('Main edit', (d.aspect as AspectId) ?? '16:9', d.clips as Clip[]);
    seq.fps = typeof d.fps === 'number' ? d.fps : 30;
    seq.captions = { ...seq.captions, ...((d.captions as object) ?? {}) };
    return {
      version: 3,
      id: d.id,
      name: typeof d.name === 'string' ? d.name : 'Untitled project',
      createdAt: typeof d.createdAt === 'number' ? d.createdAt : Date.now(),
      updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : Date.now(),
      assets: d.assets as ProjectDoc['assets'],
      sequences: [seq],
      activeSequenceId: seq.id,
      brand: null,
    };
  }

  if (d.version !== 3 || !Array.isArray(d.sequences) || d.sequences.length === 0) throw new Error('Not a Kaatchat project file.');
  const base = newSequence();
  const sequences = (d.sequences as Partial<Sequence>[]).map((s) => {
    if (typeof s.id !== 'string' || !Array.isArray(s.clips)) throw new Error('A sequence in this project is damaged.');
    return {
      ...base,
      ...s,
      audio: Array.isArray(s.audio) ? s.audio : [],
      overlays: Array.isArray(s.overlays) ? s.overlays : [],
      captions: { ...base.captions, ...(s.captions ?? {}) },
      mix: { ...DEFAULT_MIX, ...(s.mix ?? {}) },
    } as Sequence;
  });
  const active = sequences.some((s) => s.id === d.activeSequenceId) ? (d.activeSequenceId as string) : sequences[0].id;
  return { ...(d as unknown as ProjectDoc), sequences, activeSequenceId: active, brand: (d.brand as ProjectDoc['brand']) ?? null };
}
