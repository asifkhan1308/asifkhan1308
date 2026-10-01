import { useRef, useEffect, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import type { Template, Project } from '../types';

interface CanvasProps {
  template: Template;
  project: Project;
}

export default function Canvas({ template, project }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const currentTime = useEditorStore((s) => s.currentTime);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const mediaAssets = useEditorStore((s) => s.mediaAssets);
  const [media, setMedia] = useState<HTMLImageElement | HTMLVideoElement | null>(null);
  const animFrameRef = useRef<number | undefined>(undefined);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (mediaAssets.length === 0) return;
    const asset = mediaAssets[0];
    const img = new Image();
    img.src = asset.url;
    img.onload = () => setMedia(img);
  }, [mediaAssets]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !media) return;

    let lastTimestamp = Date.now();

    const render = () => {
      const now = Date.now();
      const elapsed = now - lastTimestamp;
      lastTimestamp = now;

      if (isPlaying) {
        startTimeRef.current += elapsed;
      }

      const progress = (startTimeRef.current % (template.duration * 1000)) / (template.duration * 1000);
      setCurrentTime(progress * template.duration);

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        template.animationFunction(ctx, media, project.parameters, progress, project.aspectRatio);
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, template, project.parameters, media]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = x / rect.width;
    startTimeRef.current = progress * template.duration * 1000;
    setCurrentTime(progress * template.duration);
  };

  const handleScrubberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const progress = parseFloat(e.target.value);
    startTimeRef.current = progress * template.duration * 1000;
    setCurrentTime(progress * template.duration);
    setIsPlaying(false);
  };

  const progress = currentTime / template.duration;

  return (
    <div className="canvas-section">
      <div className="canvas-container">
        <canvas ref={canvasRef} onClick={handleCanvasClick} width={1280} height={720} className="canvas" />
        <div className="canvas-overlay">
          <div className="time-display">
            {currentTime.toFixed(2)}s / {template.duration.toFixed(2)}s
          </div>
        </div>
      </div>
      <div className="timeline-controls">
        <input
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={progress}
          onChange={handleScrubberChange}
          className="scrubber"
        />
        <div className="timeline-info">
          <span className="time-badge">{currentTime.toFixed(2)}s</span>
        </div>
      </div>
    </div>
  );
}
