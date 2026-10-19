import { useEffect, useRef, useState } from 'react';
import { useV1 } from '../store';
import { composeFrame, composeFrameBlurred } from '../engine/compose';
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

  /* Preview resolution follows the on-screen size (× devicePixelRatio,
   * capped at the comp size): a 1080p comp shown 900 px wide paints ~4×
   * fewer pixels per frame. Export renders on its own full-size canvas. */
  const [displayW, setDisplayW] = useState(0);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => setDisplayW(c.clientWidth));
    ro.observe(c);
    return () => ro.disconnect();
  }, []);
  const comp = project.composition;

  /* Fit the stage inside the canvas area at the composition's exact aspect
   * ratio (the old CSS formula assumed 16:9 and a fixed header height, so the
   * preview was stretched whenever the ✦ Ask bar or a non-16:9 comp was in
   * play). Measures the available box; the hint line sits underneath. */
  const wrapRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const hint = (el.querySelector('.v1-canvas-hint') as HTMLElement | null)?.offsetHeight ?? 0;
      const aw = Math.max(40, el.clientWidth - padX);
      const ah = Math.max(40, el.clientHeight - padY - hint - 12);
      const k = Math.min(aw / comp.width, ah / comp.height);
      setFit({ w: Math.floor(comp.width * k), h: Math.floor(comp.height * k) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [comp.width, comp.height]);

  const scale = displayW > 0 ? Math.min(1, (displayW * (window.devicePixelRatio || 1)) / comp.width) : 1;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const w = Math.max(1, Math.round(comp.width * scale));
    const h = Math.max(1, Math.round(comp.height * scale));
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    syncPreviewMedia(project, currentTime, mediaBy, isPlaying);
    ctx.setTransform(w / comp.width, 0, 0, h / comp.height, 0, 0);
    // Motion blur costs N renders per frame: show it on paused frames only.
    const render = isPlaying ? composeFrame : composeFrameBlurred;
    render(ctx, project, currentTime, { mediaBy, pixelScale: w / comp.width });
  }, [project, comp, scale, currentTime, mediaBy, isPlaying]);

  // A paused seek decodes asynchronously; redraw once the frame is ready so
  // scrubbing a video shows the right frame, not the previous one. Also
  // redraw when media first becomes drawable (fresh import / reopen), or the
  // first frame stays blank until the playhead moves.
  useEffect(() => {
    const redraw = () => {
      const c = canvasRef.current;
      const ctx = c?.getContext('2d');
      if (!ctx) return;
      const s = useV1.getState();
      const k = c!.width / s.project.composition.width;
      ctx.setTransform(k, 0, 0, c!.height / s.project.composition.height, 0, 0);
      (s.isPlaying ? composeFrame : composeFrameBlurred)(ctx, s.project, s.currentTime, { mediaBy, pixelScale: k });
    };
    const els = [...mediaBy.values()];
    const events = ['seeked', 'loadeddata', 'load'];
    els.forEach((el) => events.forEach((ev) => el.addEventListener(ev, redraw)));
    return () => els.forEach((el) => events.forEach((ev) => el.removeEventListener(ev, redraw)));
  }, [mediaBy]);

  return (
    <div className="v1-canvas-wrap" ref={wrapRef}>
      <div
        className="v1-canvas-stage"
        style={{
          aspectRatio: `${project.composition.width} / ${project.composition.height}`,
          ...(fit ? { width: fit.w, height: fit.h, maxHeight: 'none' } : {}),
        }}
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
