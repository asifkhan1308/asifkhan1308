import { useEffect, useState } from 'react';
import V1TopBar from './components/TopBar';
import V1Toolbar from './components/Toolbar';
import V1Canvas from './components/Canvas';
import V1Inspector from './components/Inspector';
import V1Timeline from './components/Timeline';
import V1ExportDialog from './components/ExportDialog';
import AIBar from './components/AIBar';
import GenerateModal from './components/GenerateModal';
import { useV1 } from './store';
import './MotionLabV1.css';

/**
 * MOTIONLAB V1 — layer-based motion editor.
 * Canvas + Timeline + Inspector workspace, every property on every layer
 * can be keyframed via the generic AnimatedProperty system.
 */
export default function MotionLabV1() {
  const [showExport, setShowExport] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const setIsPlaying = useV1((s) => s.setIsPlaying);
  const isPlaying = useV1((s) => s.isPlaying);
  const removeLayer = useV1((s) => s.removeLayer);
  const duplicate = useV1((s) => s.duplicate);
  const selectedLayerId = useV1((s) => s.selectedLayerId);
  const setCurrentTime = useV1((s) => s.setCurrentTime);
  const duration = useV1((s) => s.project.composition.duration);
  const currentTime = useV1((s) => s.currentTime);
  const fps = useV1((s) => s.project.composition.fps);
  const undo = useV1((s) => s.undo);
  const redo = useV1((s) => s.redo);
  const saveToStorage = useV1((s) => s.saveToStorage);
  const newProject = useV1((s) => s.newProject);
  const splitLayerAt = useV1((s) => s.splitLayerAt);

  // Essential keyboard shortcuts.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const mod = e.metaKey || e.ctrlKey;
      const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      // Mod shortcuts always run (users expect Cmd+S/Z to work while typing).
      // Non-mod shortcuts (Space, Delete, arrows) stay out of text fields.
      if (inField && !mod) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveToStorage();
        return;
      }
      // Copy/paste keyframes — only outside text fields so normal text
      // copy/paste keeps working while typing.
      if (mod && !inField && selectedLayerId && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'v')) {
        e.preventDefault();
        const st = useV1.getState();
        if (e.key.toLowerCase() === 'c') st.copyKeyframesAt(selectedLayerId, currentTime);
        else st.pasteKeyframesAt(selectedLayerId, currentTime);
        return;
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newProject();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying(!isPlaying);
      } else if (!mod && e.key.toLowerCase() === 'k') {
        // Avid/Premiere Pro convention: K splits at the playhead.
        if (selectedLayerId) {
          e.preventDefault();
          splitLayerAt(selectedLayerId, currentTime);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedLayerId) {
          e.preventDefault();
          removeLayer(selectedLayerId);
        }
      } else if (mod && e.key.toLowerCase() === 'd') {
        if (selectedLayerId) {
          e.preventDefault();
          duplicate(selectedLayerId);
        }
      } else if (e.key === 'Home') {
        setCurrentTime(0);
      } else if (e.key === 'End') {
        setCurrentTime(duration);
      } else if (e.key === 'ArrowLeft') {
        setCurrentTime(Math.max(0, currentTime - 1 / fps));
      } else if (e.key === 'ArrowRight') {
        setCurrentTime(Math.min(duration, currentTime + 1 / fps));
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isPlaying, selectedLayerId, duration, currentTime, fps, setIsPlaying, removeLayer, duplicate, setCurrentTime, undo, redo, saveToStorage, newProject, splitLayerAt]);

  return (
    <div className="motionlab-v1">
      <V1TopBar onExport={() => setShowExport(true)} />
      <AIBar onOpenGenerate={() => setShowGenerate(true)} />
      <div className="v1-body">
        <V1Toolbar />
        <V1Canvas />
        <V1Inspector />
      </div>
      <V1Timeline />
      {showExport && <V1ExportDialog onClose={() => setShowExport(false)} />}
      {showGenerate && <GenerateModal onClose={() => setShowGenerate(false)} />}
    </div>
  );
}
