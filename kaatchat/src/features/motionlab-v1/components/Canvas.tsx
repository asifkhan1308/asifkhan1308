import { useEffect, useRef } from 'react';
import { useV1 } from '../store';
import { composeFrame } from '../engine/compose';
import { useMediaElements } from '../engine/useMedia';
import { usePlaybackClock } from '../engine/playback';

export default function V1Canvas() {
  const project = useV1((s) => s.project);
  const currentTime = useV1((s) => s.currentTime);
  const selectedLayerId = useV1((s) => s.selectedLayerId);
  const selectLayer = useV1((s) => s.selectLayer);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaBy = useMediaElements(project.assets);

  usePlaybackClock();

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = project.composition.width;
    c.height = project.composition.height;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    composeFrame(ctx, project, currentTime, { mediaBy });
  }, [project, currentTime, mediaBy]);

  return (
    <div className="v1-canvas-wrap">
      <div
        className="v1-canvas-stage"
        style={{ aspectRatio: `${project.composition.width} / ${project.composition.height}` }}
        onClick={() => selectLayer(null)}
      >
        <canvas ref={canvasRef} className="v1-canvas" />
      </div>
      <div className="v1-canvas-hint">
        {project.composition.width}×{project.composition.height} · {project.composition.fps}fps · {project.composition.duration}s
        {selectedLayerId ? ' · ⟵ layer selected' : ''}
      </div>
    </div>
  );
}
