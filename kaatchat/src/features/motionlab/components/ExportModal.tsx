import { useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { templateRegistry } from '../templates/registry';
import { renderMotionToVideo } from '../engine/renderVideo';
import { sendMotionToNewProject } from '../engine/bridge';
import type { ExportSettings } from '../types';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const RESOLUTIONS: Record<string, [number, number]> = {
  '720p': [1280, 720],
  '1080p': [1920, 1080],
  '2k': [2560, 1440],
  '4k': [3840, 2160],
  '8k': [7680, 4320],
};

export default function ExportModal({ isOpen, onClose }: ExportModalProps) {
  const currentProject = useEditorStore((s) => s.currentProject);
  const mediaAssets = useEditorStore((s) => s.mediaAssets);
  const [settings, setSettings] = useState<ExportSettings>({
    format: 'mp4',
    resolution: '1080p',
    frameRate: 30,
    quality: 'high',
  });
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !currentProject) return null;

  const template = templateRegistry.find((t) => t.id === currentProject.templateId);
  if (!template) return null;

  const [width, height] = RESOLUTIONS[settings.resolution];
  const duration = currentProject.animation.duration;
  const totalFrames = Math.ceil(duration * settings.frameRate);

  const loadMedia = async (): Promise<HTMLImageElement | HTMLVideoElement | { width: number; height: number } | null> => {
    const asset = mediaAssets[0];
    if (!asset) return { width: 400, height: 300 };
    if (asset.type === 'image') {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not load media image for export.'));
        img.src = asset.url;
      });
    }
    return await new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.onloadeddata = () => resolve(v);
      v.onerror = () => reject(new Error('Could not load media video for export.'));
      v.src = asset.url;
    });
  };

  const runRender = async () => {
    setError(null);
    setIsExporting(true);
    setProgress(0);
    const media = await loadMedia();
    return await renderMotionToVideo({
      template,
      project: currentProject,
      media,
      width,
      height,
      fps: settings.frameRate,
      format: settings.format,
      quality: settings.quality,
      onProgress: (ratio, message) => {
        setProgress(Math.round(ratio * 100));
        setProgressLabel(message);
      },
    });
  };

  const handleDownload = async () => {
    try {
      const result = await runRender();
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setProgressLabel('Downloaded');
      setTimeout(() => {
        onClose();
        setIsExporting(false);
        setProgress(0);
        setProgressLabel('');
      }, 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
      setIsExporting(false);
    }
  };

  const handleSendToPodcast = async () => {
    try {
      const result = await runRender();
      setProgressLabel('Opening in Podcast Editor…');
      const projectId = await sendMotionToNewProject(result.blob, result.fileName, currentProject.name);
      location.hash = `#/p/${projectId}`;
      onClose();
      setIsExporting(false);
      setProgress(0);
      setProgressLabel('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send to Podcast Editor failed');
      setIsExporting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Export Motion</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        {!isExporting ? (
          <>
            <div className="modal-content">
              <div className="export-options">
                <div className="option-group">
                  <label>Format</label>
                  <select value={settings.format} onChange={(e) => setSettings({ ...settings, format: e.target.value as ExportSettings['format'] })}>
                    <option value="mp4">MP4 (H.264 / HEVC)</option>
                    <option value="webm">WebM (VP9)</option>
                  </select>
                </div>

                <div className="option-group">
                  <label>Resolution</label>
                  <select value={settings.resolution} onChange={(e) => setSettings({ ...settings, resolution: e.target.value as ExportSettings['resolution'] })}>
                    <option value="720p">720p (1280×720)</option>
                    <option value="1080p">1080p (1920×1080)</option>
                    <option value="2k">2K (2560×1440)</option>
                    <option value="4k">4K (3840×2160)</option>
                    <option value="8k">8K (7680×4320)</option>
                  </select>
                </div>

                <div className="option-group">
                  <label>Frame Rate</label>
                  <select value={settings.frameRate} onChange={(e) => setSettings({ ...settings, frameRate: parseInt(e.target.value, 10) as ExportSettings['frameRate'] })}>
                    <option value={24}>24 FPS</option>
                    <option value={30}>30 FPS</option>
                    <option value={60}>60 FPS</option>
                  </select>
                </div>

                <div className="option-group">
                  <label>Quality</label>
                  <select value={settings.quality} onChange={(e) => setSettings({ ...settings, quality: e.target.value as ExportSettings['quality'] })}>
                    <option value="low">Low (fastest)</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="ultra">Ultra (slowest)</option>
                  </select>
                </div>
              </div>

              <div className="export-info">
                <div className="info-row">
                  <span>Duration:</span>
                  <strong>{duration.toFixed(1)}s</strong>
                </div>
                <div className="info-row">
                  <span>Total Frames:</span>
                  <strong>{totalFrames}</strong>
                </div>
                <div className="info-row">
                  <span>Resolution:</span>
                  <strong>{width}×{height}</strong>
                </div>
              </div>

              {error && <div className="export-error">{error}</div>}
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-secondary" onClick={handleSendToPodcast}>Send to Podcast Editor</button>
              <button className="btn-primary" onClick={handleDownload}>Download</button>
            </div>
          </>
        ) : (
          <div className="export-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="progress-text">
              {progressLabel || 'Rendering…'} ({progress}%)
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
