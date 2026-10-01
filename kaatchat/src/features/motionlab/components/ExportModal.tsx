import { useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { templateRegistry } from '../templates/registry';
import type { ExportSettings } from '../types';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ExportModal({ isOpen, onClose }: ExportModalProps) {
  const currentProject = useEditorStore((s) => s.currentProject);
  const [settings, setSettings] = useState<ExportSettings>({
    format: 'mp4',
    resolution: '1080p',
    frameRate: 30,
    quality: 'high',
  });
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);

  if (!isOpen || !currentProject) return null;

  const resolutions: Record<string, [number, number]> = {
    '720p': [1280, 720],
    '1080p': [1920, 1080],
    '2k': [2560, 1440],
    '4k': [3840, 2160],
    '8k': [7680, 4320],
  };

  const template = templateRegistry.find((t) => t.id === currentProject.templateId);
  if (!template) return null;

  const [width, height] = resolutions[settings.resolution];
  const duration = currentProject.animation.duration;
  const totalFrames = Math.ceil(duration * settings.frameRate);
  const estimatedSize = Math.round((width * height * totalFrames) / (1024 * 1024 * 100));

  const handleExport = async () => {
    setIsExporting(true);
    setProgress(0);

    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Cannot get canvas context');

      const frames: ImageData[] = [];

      for (let i = 0; i < totalFrames; i++) {
        const progress = i / totalFrames;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);

        template.animationFunction(ctx, { width: 400, height: 300 } as any, currentProject.parameters, progress, currentProject.aspectRatio);

        const imageData = ctx.getImageData(0, 0, width, height);
        frames.push(imageData);

        setProgress(Math.round((i / totalFrames) * 50));
      }

      setProgress(50);

      const blob = new Blob([JSON.stringify({ frames, width, height, frameRate: settings.frameRate })], {
        type: 'application/json',
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentProject.name}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setProgress(100);
      setTimeout(() => {
        onClose();
        setIsExporting(false);
        setProgress(0);
      }, 1000);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
      setIsExporting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Export Animation</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        {!isExporting ? (
          <>
            <div className="modal-content">
              <div className="export-options">
                <div className="option-group">
                  <label>Format</label>
                  <select value={settings.format} onChange={(e) => setSettings({ ...settings, format: e.target.value as any })}>
                    <option value="mp4">MP4 (H.264)</option>
                    <option value="webm">WebM (VP9)</option>
                  </select>
                </div>

                <div className="option-group">
                  <label>Resolution</label>
                  <select value={settings.resolution} onChange={(e) => setSettings({ ...settings, resolution: e.target.value as any })}>
                    <option value="720p">720p (1280×720)</option>
                    <option value="1080p">1080p (1920×1080)</option>
                    <option value="2k">2K (2560×1440)</option>
                    <option value="4k">4K (3840×2160)</option>
                    <option value="8k">8K (7680×4320)</option>
                  </select>
                </div>

                <div className="option-group">
                  <label>Frame Rate</label>
                  <select value={settings.frameRate} onChange={(e) => setSettings({ ...settings, frameRate: parseInt(e.target.value) as any })}>
                    <option value={24}>24 FPS</option>
                    <option value={30}>30 FPS</option>
                    <option value={60}>60 FPS</option>
                  </select>
                </div>

                <div className="option-group">
                  <label>Quality</label>
                  <select value={settings.quality} onChange={(e) => setSettings({ ...settings, quality: e.target.value as any })}>
                    <option value="draft">Draft (faster)</option>
                    <option value="high">High</option>
                    <option value="maximum">Maximum (slower)</option>
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
                <div className="info-row">
                  <span>Est. File Size:</span>
                  <strong>{estimatedSize}MB</strong>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={handleExport}>Export</button>
            </div>
          </>
        ) : (
          <div className="export-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="progress-text">
              Rendering... {progress}%
            </div>
            <div className="progress-frame">
              Frame {Math.round((progress / 50) * totalFrames)} / {totalFrames}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
