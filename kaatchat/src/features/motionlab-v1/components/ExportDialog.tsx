import { useState } from 'react';
import { useV1 } from '../store';
import { useMediaElements } from '../engine/useMedia';
import { exportProjectToVideo } from '../engine/exportVideo';

export default function V1ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useV1((s) => s.project);
  const mediaBy = useMediaElements(project.assets);
  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4');
  const [quality, setQuality] = useState<'low' | 'medium' | 'high' | 'ultra'>('high');
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setState('running');
    setError(null);
    try {
      const result = await exportProjectToVideo({
        project,
        format,
        quality,
        mediaBy,
        onProgress: (r, m) => {
          setProgress(Math.round(r * 100));
          setMessage(m);
        },
      });
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setState('done');
      setTimeout(onClose, 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
      setState('error');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Export composition</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-content">
          <div className="export-options">
            <div className="option-group">
              <label>Format</label>
              <select value={format} onChange={(e) => setFormat(e.target.value as 'mp4' | 'webm')}>
                <option value="mp4">MP4</option>
                <option value="webm">WebM</option>
              </select>
            </div>
            <div className="option-group">
              <label>Quality</label>
              <select value={quality} onChange={(e) => setQuality(e.target.value as 'low' | 'medium' | 'high' | 'ultra')}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="ultra">Ultra</option>
              </select>
            </div>
          </div>
          <div className="export-info">
            <div className="info-row"><span>Resolution</span><strong>{project.composition.width}×{project.composition.height}</strong></div>
            <div className="info-row"><span>Frame rate</span><strong>{project.composition.fps} fps</strong></div>
            <div className="info-row"><span>Duration</span><strong>{project.composition.duration.toFixed(1)}s</strong></div>
            <div className="info-row"><span>Layers</span><strong>{project.layers.length}</strong></div>
          </div>
          {state === 'running' && (
            <div className="export-progress">
              <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
              <div className="progress-text">{message || 'Rendering…'} ({progress}%)</div>
            </div>
          )}
          {error && <div className="export-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={state === 'running'}>Close</button>
          <button className="btn-primary" onClick={run} disabled={state === 'running' || project.layers.length === 0}>
            {state === 'running' ? 'Rendering…' : state === 'done' ? 'Done ✓' : 'Render'}
          </button>
        </div>
      </div>
    </div>
  );
}
