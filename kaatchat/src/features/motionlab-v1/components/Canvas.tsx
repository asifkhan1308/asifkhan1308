import { useEffect, useRef } from 'react';
import { useV1 } from '../store';
import { composeFrame } from '../engine/compose';
import { useMediaElements } from '../engine/useMedia';
import { usePlaybackClock } from '../engine/playback';
import V1CanvasHandles from './CanvasHandles';
import { syncPreviewMedia } from '../engine/mediaSync';

export default function V1Canvas() {
  const project = useV1((s) => s.project);
  const currentTime = useV1((s) => s.currentTime);
  const selectedLayerId = useV1((s) => s.selectedLayerId);
  const selectLayer = useV1((s) => s.selectLayer);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaBy = useMediaElements(project.assets);

  usePlaybackClock();

  const isPlaying = useV1((s) => s.isPlaying);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    if (c.width !== project.composition.width) c.width = project.composition.width;
    if (c.height !== project.composition.height) c.height = project.composition.height;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    syncPreviewMedia(project, currentTime, mediaBy, isPlaying);
    composeFrame(ctx, project, currentTime, { mediaBy });
  }, [project, currentTime, mediaBy, isPlaying]);

  // A paused seek decodes asynchronously; redraw once the frame is ready so
  // scrubbing a video shows the right frame, not the previous one.
  useEffect(() => {
    const redraw = () => {
      const c = canvasRef.current;
      const ctx = c?.getContext('2d');
      if (!ctx) return;
      const s = useV1.getState();
      composeFrame(ctx, s.project, s.currentTime, { mediaBy });
    };
    const vids = [...mediaBy.values()].filter((e): e is HTMLVideoElement => e instanceof HTMLVideoElement);
    vids.forEach((v) => v.addEventListener('seeked', redraw));
    return () => vids.forEach((v) => v.removeEventListener('seeked', redraw));
  }, [mediaBy]);

  return (
    <div className="v1-canvas-wrap">
      <div
        className="v1-canvas-stage"
        style={{ aspectRatio: `${project.composition.width} / ${project.composition.height}` }}
        onPointerDown={(e) => {
          // Clicking the stage (not a handle, not the canvas) deselects. The
          // SVG overlay stops propagation when a handle is grabbed.
          if (e.target === e.currentTarget) selectLayer(null);
        }}
      >
        <canvas ref={canvasRef} className="v1-canvas" />
        <V1CanvasHandles />
      </div>
      <div className="v1-canvas-hint">
        {project.composition.width}×{project.composition.height} · {project.composition.fps}fps · {project.composition.duration}s
        {selectedLayerId ? ' · ⟵ layer selected' : ''}
      </div>
    </div>
  );
}
