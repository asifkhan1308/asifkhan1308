import { useEffect, useState } from 'react';
import V1TopBar from './components/TopBar';
import V1Toolbar from './components/Toolbar';
import V1Canvas from './components/Canvas';
import V1Inspector from './components/Inspector';
import V1Timeline from './components/Timeline';
import V1ExportDialog from './components/ExportDialog';
import { useV1 } from './store';
import './MotionLabV1.css';

/**
 * MOTIONLAB V1 — layer-based motion editor.
 * Canvas + Timeline + Inspector workspace, every property on every layer
 * can be keyframed via the generic AnimatedProperty system.
 */
export default function MotionLabV1() {
  const [showExport, setShowExport] = useState(false);
  const setIsPlaying = useV1((s) => s.setIsPlaying);
  const isPlaying = useV1((s) => s.isPlaying);
  const removeLayer = useV1((s) => s.removeLayer);
  const duplicate = useV1((s) => s.duplicate);
  const selectedLayerId = useV1((s) => s.selectedLayerId);
  const setCurrentTime = useV1((s) => s.setCurrentTime);
  const duration = useV1((s) => s.project.composition.duration);
  const currentTime = useV1((s) => s.currentTime);
  const fps = useV1((s) => s.project.composition.fps);

  // Essential keyboard shortcuts.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying(!isPlaying);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedLayerId) {
          e.preventDefault();
          removeLayer(selectedLayerId);
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
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
  }, [isPlaying, selectedLayerId, duration, currentTime, fps, setIsPlaying, removeLayer, duplicate, setCurrentTime]);

  return (
    <div className="motionlab-v1">
      <V1TopBar onExport={() => setShowExport(true)} />
      <div className="v1-body">
        <V1Toolbar />
        <V1Canvas />
        <V1Inspector />
      </div>
      <V1Timeline />
      {showExport && <V1ExportDialog onClose={() => setShowExport(false)} />}
    </div>
  );
}
