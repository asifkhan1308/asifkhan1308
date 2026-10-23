import { useEffect, useState } from 'react';
import { useV1 } from '../store';
import { useMediaElements } from '../engine/useMedia';
import { exportProjectToVideo } from '../engine/exportVideo';
import { exportProjectToGif, GIF_FPS, GIF_WIDTHS } from '../engine/exportGif';
import { composeFrameBlurred } from '../engine/compose';
import { seekMediaForExport } from '../engine/mediaSync';

export default function V1ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useV1((s) => s.project);
  const mediaBy = useMediaElements(project.assets);
  // Render only once every linked asset has decoded; otherwise early frames
  // would bake placeholder tiles into the file.
  const mediaReady = project.assets.filter((a) => a.url).every((a) => mediaBy.has(a.id));
  const [format, setFormat] = useState<'mp4' | 'webm' | 'gif'>('mp4');
  const [gifWidth, setGifWidth] = useState<number>(Math.min(480, project.composition.width));
  const [gifFps, setGifFps] = useState<number>(15);
  const [quality, setQuality] = useState<'low' | 'medium' | 'high' | 'ultra'>('high');
  // Like After Effects: when a work area is set, render that by default.
  const workArea = project.composition.workArea;
  const [onlyWorkArea, setOnlyWorkArea] = useState(!!workArea);
  const fmtT = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  // Escape closes, except mid-render (Close is disabled then too).
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && state !== 'running') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [state, onClose]);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Still frame at the playhead, at full composition resolution.
  const savePng = async () => {
    const { width, height } = project.composition;
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const t = useV1.getState().currentTime;
    await seekMediaForExport(project, t, mediaBy);
    composeFrameBlurred(ctx, project, t, { mediaBy });
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const safe = project.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'motionlab';
    a.download = `${safe} ${t.toFixed(2)}s.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  const run = async () => {
    setState('running');
    setError(null);
    try {
      const common = {
        project,
        mediaBy,
        ...(workArea && onlyWorkArea ? { range: workArea } : {}),
        onProgress: (r: number, m: string) => {
          setProgress(Math.round(r * 100));
          setMessage(m);
        },
      };
      const result = format === 'gif'
        ? await exportProjectToGif({ ...common, width: gifWidth, fps: gifFps })
        : await exportProjectToVideo({ ...common, format, quality });
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
          {workArea && (
            <label className="v1-export-range">
              <input type="checkbox" checked={onlyWorkArea} onChange={(e) => setOnlyWorkArea(e.target.checked)} />
              <span>Work area only ({fmtT(workArea.start)} – {fmtT(workArea.end)})</span>
            </label>
          )}
          <div className="export-options">
            <div className="option-group">
              <label>Format</label>
              <select aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value as 'mp4' | 'webm' | 'gif')}>
                <option value="mp4">MP4</option>
                <option value="webm">WebM</option>
                <option value="gif">GIF (looping, no sound)</option>
              </select>
            </div>
            {format === 'gif' ? (
              <>
                <div className="option-group">
                  <label>Width</label>
                  <select aria-label="GIF width" value={gifWidth} onChange={(e) => setGifWidth(Number(e.target.value))}>
                    {[...GIF_WIDTHS.filter((w) => w < project.composition.width), project.composition.width].map((w) => (
                      <option key={w} value={w}>{w}px{w === project.composition.width ? ' (full)' : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="option-group">
                  <label>Frame rate</label>
                  <select aria-label="GIF frame rate" value={gifFps} onChange={(e) => setGifFps(Number(e.target.value))}>
                    {GIF_FPS.map((f) => <option key={f} value={f}>{f} fps</option>)}
                  </select>
                </div>
              </>
            ) : (
              <div className="option-group">
                <label>Quality</label>
                <select value={quality} onChange={(e) => setQuality(e.target.value as 'low' | 'medium' | 'high' | 'ultra')}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="ultra">Ultra</option>
                </select>
              </div>
            )}
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
          <button className="btn-secondary v1-save-png" onClick={() => void savePng()} disabled={state === 'running' || !mediaReady}
            title="The frame at the playhead, full resolution (thumbnails, posters)">
            Save frame as PNG
          </button>
          <button className="btn-primary" onClick={run} disabled={state === 'running' || project.layers.length === 0 || !mediaReady}>
            {!mediaReady ? 'Loading media…' : state === 'running' ? 'Rendering…' : state === 'done' ? 'Done ✓' : 'Render'}
          </button>
        </div>
      </div>
    </div>
  );
}
