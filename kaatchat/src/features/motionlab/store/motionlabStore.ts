import { create } from 'zustand';
import type {
  Project,
  MediaAsset,
  AspectRatio,
  BackgroundSettings,
  AnimationState,
  TransformState,
  HistoryEntry,
  TextLayer,
} from '../types';

interface MotionLabStore {
  // Project
  currentProject: Project | null;
  projects: Project[];
  createProject: (name: string, templateId: string) => void;
  loadProject: (id: string) => void;
  saveProject: () => void;
  deleteProject: (id: string) => void;

  // Media
  mediaAssets: MediaAsset[];
  selectedMediaId: string | null;
  addMediaAsset: (media: MediaAsset) => void;
  removeMediaAsset: (id: string) => void;
  selectMedia: (id: string | null) => void;

  // Template & Settings
  selectedTemplateId: string | null;
  selectTemplate: (templateId: string) => void;
  updateParameter: (parameterId: string, value: any) => void;
  setAspectRatio: (ratio: AspectRatio) => void;
  setBackground: (background: BackgroundSettings) => void;
  setAnimation: (animation: Partial<AnimationState>) => void;
  setTransform: (transform: Partial<TransformState>) => void;

  // Text layers
  selectedTextLayerId: string | null;
  addTextLayer: (text?: string) => void;
  updateTextLayer: (id: string, patch: Partial<TextLayer>) => void;
  removeTextLayer: (id: string) => void;
  selectTextLayer: (id: string | null) => void;

  // Playback
  isPlaying: boolean;
  currentTime: number;
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;

  // History
  history: HistoryEntry[];
  historyIndex: number;
  pushHistory: (action: string) => void;
  undo: () => void;
  redo: () => void;
}

const createDefaultProject = (templateId: string): Project => ({
  id: Math.random().toString(36).substring(7),
  name: 'Untitled Motion',
  templateId,
  aspectRatio: '16:9',
  parameters: {},
  background: { type: 'solid', color: '#000000', opacity: 1 },
  animation: { duration: 5, delay: 0, speed: 1, loop: true },
  transform: { x: 0, y: 0, scale: 1, rotation: 0, perspective: 1000 },
  textLayers: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const makeTextLayer = (text: string, duration: number): TextLayer => ({
  id: `t_${Math.random().toString(36).slice(2, 9)}`,
  text,
  x: 0.5,
  y: 0.82,
  size: 0.08,
  color: '#ffffff',
  fontFamily: 'Inter, -apple-system, system-ui, sans-serif',
  fontWeight: 700,
  align: 'center',
  start: 0,
  end: duration,
  animation: 'fade-in',
});

/** Older projects loaded from storage may lack textLayers; keep them safe to render. */
const normalizeProject = (p: Project): Project =>
  p.textLayers ? p : { ...p, textLayers: [] };

export const useMotionLabStore = create<MotionLabStore>((set) => ({
  currentProject: null,
  projects: [],
  mediaAssets: [],
  selectedMediaId: null,
  selectedTemplateId: null,
  isPlaying: false,
  currentTime: 0,
  history: [],
  historyIndex: -1,

  createProject: (name: string, templateId: string) => {
    const project = createDefaultProject(templateId);
    project.name = name;
    set((state) => ({
      currentProject: project,
      projects: [...state.projects, project],
      history: [{ action: 'create', projectState: project, timestamp: Date.now() }],
      historyIndex: 0,
    }));
  },

  loadProject: (id: string) => {
    set((state) => {
      const found = state.projects.find((p) => p.id === id);
      return { currentProject: found ? normalizeProject(found) : null };
    });
  },

  saveProject: () => {
    set((state) => {
      if (!state.currentProject) return state;
      const updated = { ...state.currentProject, updatedAt: Date.now() };
      return {
        currentProject: updated,
        projects: state.projects.map((p) => (p.id === updated.id ? updated : p)),
      };
    });
  },

  deleteProject: (id: string) => {
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      currentProject: state.currentProject?.id === id ? null : state.currentProject,
    }));
  },

  addMediaAsset: (media: MediaAsset) => {
    set((state) => ({
      mediaAssets: [...state.mediaAssets, media],
      selectedMediaId: media.id,
    }));
  },

  removeMediaAsset: (id: string) => {
    set((state) => ({
      mediaAssets: state.mediaAssets.filter((m) => m.id !== id),
      selectedMediaId: state.selectedMediaId === id ? null : state.selectedMediaId,
    }));
  },

  selectMedia: (id: string | null) => {
    set({ selectedMediaId: id });
  },

  selectTemplate: (templateId: string) => {
    set((state) => {
      if (!state.currentProject) {
        const newProject = createDefaultProject(templateId);
        return {
          selectedTemplateId: templateId,
          currentProject: newProject,
          projects: [...state.projects, newProject],
        };
      }
      const updated = { ...state.currentProject, templateId };
      return {
        selectedTemplateId: templateId,
        currentProject: updated,
        projects: state.projects.map((p) => (p.id === updated.id ? updated : p)),
      };
    });
  },

  updateParameter: (parameterId: string, value: any) => {
    set((state) => {
      if (!state.currentProject) return state;
      const updated = {
        ...state.currentProject,
        parameters: { ...state.currentProject.parameters, [parameterId]: value },
      };
      return {
        currentProject: updated,
        projects: state.projects.map((p) => (p.id === updated.id ? updated : p)),
      };
    });
  },

  setAspectRatio: (ratio: AspectRatio) => {
    set((state) => {
      if (!state.currentProject) return state;
      const updated = { ...state.currentProject, aspectRatio: ratio };
      return {
        currentProject: updated,
        projects: state.projects.map((p) => (p.id === updated.id ? updated : p)),
      };
    });
  },

  setBackground: (background: BackgroundSettings) => {
    set((state) => {
      if (!state.currentProject) return state;
      const updated = { ...state.currentProject, background };
      return {
        currentProject: updated,
        projects: state.projects.map((p) => (p.id === updated.id ? updated : p)),
      };
    });
  },

  setAnimation: (animation: Partial<AnimationState>) => {
    set((state) => {
      if (!state.currentProject) return state;
      const updated = {
        ...state.currentProject,
        animation: { ...state.currentProject.animation, ...animation },
      };
      return {
        currentProject: updated,
        projects: state.projects.map((p) => (p.id === updated.id ? updated : p)),
      };
    });
  },

  setTransform: (transform: Partial<TransformState>) => {
    set((state) => {
      if (!state.currentProject) return state;
      const updated = {
        ...state.currentProject,
        transform: { ...state.currentProject.transform, ...transform },
      };
      return {
        currentProject: updated,
        projects: state.projects.map((p) => (p.id === updated.id ? updated : p)),
      };
    });
  },

  selectedTextLayerId: null,

  addTextLayer: (text = 'Your text') => {
    set((state) => {
      if (!state.currentProject) return state;
      const layer = makeTextLayer(text, state.currentProject.animation.duration);
      const updated = normalizeProject({
        ...state.currentProject,
        textLayers: [...(state.currentProject.textLayers ?? []), layer],
      });
      return {
        currentProject: updated,
        projects: state.projects.map((p) => (p.id === updated.id ? updated : p)),
        selectedTextLayerId: layer.id,
      };
    });
  },

  updateTextLayer: (id: string, patch: Partial<TextLayer>) => {
    set((state) => {
      if (!state.currentProject) return state;
      const updated = normalizeProject({
        ...state.currentProject,
        textLayers: (state.currentProject.textLayers ?? []).map((l) =>
          l.id === id ? { ...l, ...patch } : l,
        ),
      });
      return {
        currentProject: updated,
        projects: state.projects.map((p) => (p.id === updated.id ? updated : p)),
      };
    });
  },

  removeTextLayer: (id: string) => {
    set((state) => {
      if (!state.currentProject) return state;
      const updated = normalizeProject({
        ...state.currentProject,
        textLayers: (state.currentProject.textLayers ?? []).filter((l) => l.id !== id),
      });
      return {
        currentProject: updated,
        projects: state.projects.map((p) => (p.id === updated.id ? updated : p)),
        selectedTextLayerId:
          state.selectedTextLayerId === id ? null : state.selectedTextLayerId,
      };
    });
  },

  selectTextLayer: (id: string | null) => {
    set({ selectedTextLayerId: id });
  },

  setIsPlaying: (playing: boolean) => {
    set({ isPlaying: playing });
  },

  setCurrentTime: (time: number) => {
    set({ currentTime: time });
  },

  pushHistory: (action: string) => {
    set((state) => {
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      if (state.currentProject) {
        newHistory.push({ action, projectState: state.currentProject, timestamp: Date.now() });
      }
      return {
        history: newHistory,
        historyIndex: newHistory.length - 1,
      };
    });
  },

  undo: () => {
    set((state) => {
      if (state.historyIndex <= 0) return state;
      const newIndex = state.historyIndex - 1;
      const entry = state.history[newIndex];
      return {
        currentProject: entry.projectState,
        historyIndex: newIndex,
      };
    });
  },

  redo: () => {
    set((state) => {
      if (state.historyIndex >= state.history.length - 1) return state;
      const newIndex = state.historyIndex + 1;
      const entry = state.history[newIndex];
      return {
        currentProject: entry.projectState,
        historyIndex: newIndex,
      };
    });
  },
}));
