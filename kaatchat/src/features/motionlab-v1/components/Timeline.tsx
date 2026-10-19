import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { selectionOf, useV1 } from '../store';
import { useShallow } from 'zustand/react/shallow';
import ContextMenu from './ContextMenu';
import { clipExtras, layerMenu } from './menuBuilders';
import { layerKeyTimes, snapSpan, snapTargets, snapTime } from '../engine/snap';
import type { Layer } from '../types';

type ClipDrag = 'body' | 'in' | 'out';
interface MenuState { x: number; y: number; layerId: string; onTrack: boolean }

const HEAD_W = 220;
const ZOOM_MIN = 1;
const ZOOM_MAX = 40;
const SNAP_PX = 8;
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

/** Shared by rows: snapping on/off and the guide line shown while snapped. */
export interface SnapCtx { enabled: boolean; show: (t: number | null) => void }

export default function V1Timeline() {
  const project = useV1((s) => s.project);
  const currentTime = useV1((s) => s.currentTime);
  const setCurrentTime = useV1((s) => s.setCurrentTime);
  const isPlaying = useV1((s) => s.isPlaying);
  const setIsPlaying = useV1((s) => s.setIsPlaying);
  // Multi-select: every selected row highlights; shift / ⌘-click toggles.
  const selection = useV1(useShallow((s) => selectionOf(s)));
  const selectLayer = useV1((s) => s.selectLayer);
  const setVisible = useV1((s) => s.setVisible);
  const setLocked = useV1((s) => s.setLocked);
  const setSolo = useV1((s) => s.setSolo);
  const removeLayer = useV1((s) => s.removeLayer);
  const duplicate = useV1((s) => s.duplicate);
  const moveLayerInTime = useV1((s) => s.moveLayerInTime);
  const trimLayerIn = useV1((s) => s.trimLayerIn);
  const trimLayerOut = useV1((s) => s.trimLayerOut);
  const splitLayerAt = useV1((s) => s.splitLayerAt);

  const comp = project.composition;
  const trackRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; to: number } | null>(null);
  const reorderLayer = useV1((s) => s.reorderLayer);
  const renameLayer = useV1((s) => s.renameLayer);
  const openMenu = (layerId: string, onTrack: boolean) => (e: React.MouseEvent) => {
    e.preventDefault();
    selectLayer(layerId);
    setMenu({ x: e.clientX, y: e.clientY, layerId, onTrack });
  };

  const scrubTo = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const r = (clientX - rect.left) / rect.width;
    setCurrentTime(Math.max(0, Math.min(1, r)) * comp.duration);
  };

  const fmt = (t: number) => `${Math.floor(t).toString().padStart(2, '0')}:${Math.floor((t * 100) % 100).toString().padStart(2, '0')}`;

  /* Zoom: the track column is `zoom ×` the visible width; the grid scrolls
   * horizontally and the layer-name column stays sticky. */
  const gridRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [snapOn, setSnapOn] = useState(true);
  // Timeline markers (M): on the ruler; click jumps, double-click renames,
  // right-click for rename / delete.
  const markers = useV1((s) => s.project.markers);
  const [markerMenu, setMarkerMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [editingMarker, setEditingMarker] = useState<string | null>(null);
  // V1.5 review feedback: markers on the ruler + a list to work through.
  const comments = useV1((s) => s.project.comments);
  const [showFeedback, setShowFeedback] = useState(false);
  const openComments = (comments ?? []).filter((c) => !c.resolved);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [trackW, setTrackW] = useState(800);
  const pendingScroll = useRef<number | null>(null);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTrackW(el.clientWidth || 800));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Zoom about a time that stays under the same screen x (cursor or playhead). */
  const zoomTo = (next: number, anchorT = useV1.getState().currentTime, anchorX?: number) => {
    const grid = gridRef.current;
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
    if (!grid || z === zoom) return;
    const viewW = grid.clientWidth - HEAD_W;
    const screenX = anchorX ?? HEAD_W + Math.max(0, Math.min(viewW, (anchorT / comp.duration) * viewW * zoom - grid.scrollLeft));
    pendingScroll.current = HEAD_W + (anchorT / comp.duration) * viewW * z - screenX;
    setZoom(z);
  };
  useLayoutEffect(() => {
    if (pendingScroll.current !== null && gridRef.current) {
      gridRef.current.scrollLeft = Math.max(0, pendingScroll.current);
      pendingScroll.current = null;
    }
  }, [zoom]);

  // ⌘/Ctrl + wheel (and trackpad pinch) zooms around the cursor.
  const zoomRef = useRef({ zoom, zoomTo });
  zoomRef.current = { zoom, zoomTo };
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const track = trackRef.current;
      if (!track) return;
      const r = track.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * useV1.getState().project.composition.duration;
      const { zoom: z, zoomTo: zt } = zoomRef.current;
      zt(z * Math.exp(-e.deltaY * 0.01), t, e.clientX - grid.getBoundingClientRect().left);
    };
    grid.addEventListener('wheel', onWheel, { passive: false });
    return () => grid.removeEventListener('wheel', onWheel);
  }, []);

  // While playing zoomed in, page the view so the playhead stays visible.
  useEffect(() => {
    const grid = gridRef.current;
    if (!isPlaying || zoom === 1 || !grid) return;
    const x = (currentTime / comp.duration) * trackW;
    const viewW = grid.clientWidth - HEAD_W;
    if (x < grid.scrollLeft || x > grid.scrollLeft + viewW - 20) grid.scrollLeft = Math.max(0, x - 40);
  }, [currentTime, isPlaying, zoom, trackW, comp.duration]);

  const pxPerSec = trackW / comp.duration;
  const step = TICK_STEPS.find((s) => s * pxPerSec >= 60) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const marks = Array.from({ length: Math.floor(comp.duration / step + 1e-9) + 1 }).map((_, i) => +(i * step).toFixed(3));
  const tickLabel = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${step < 1 ? s.toFixed(step < 0.5 ? 2 : 1) : s}s`);
  const snap: SnapCtx = { enabled: snapOn, show: setSnapLine };

  return (
    <div className="v1-timeline">
      <div className="v1-tl-controls">
        <button className="btn-icon" onClick={() => setCurrentTime(0)} title="Jump to start">⏮</button>
        <button className="btn-icon" onClick={() => setCurrentTime(Math.max(0, currentTime - 1 / comp.fps))} title="Previous frame">◀</button>
        <button className="btn-play" onClick={() => setIsPlaying(!isPlaying)} title="Play/pause (Space)">
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button className="btn-icon" onClick={() => setCurrentTime(Math.min(comp.duration, currentTime + 1 / comp.fps))} title="Next frame">▶</button>
        <button className="btn-icon" onClick={() => setCurrentTime(comp.duration)} title="Jump to end">⏭</button>
        <div className="v1-tl-time">{fmt(currentTime)} / {fmt(comp.duration)}</div>
        {comments && comments.length > 0 && (
          <div className="v1-tl-feedback-wrap">
            <button
              className={`v1-tl-feedback-btn${showFeedback ? ' on' : ''}`}
              aria-expanded={showFeedback}
              onClick={() => setShowFeedback(!showFeedback)}
              title="Review feedback"
            >
              Feedback {openComments.length}/{comments.length}
            </button>
            {showFeedback && (
              <div className="v1-tl-feedback" role="dialog" aria-label="Review feedback">
                {comments.map((c) => (
                  <div key={c.id} className={`v1-tl-fb-item${c.resolved ? ' resolved' : ''}`}>
                    <button className="v1-tl-fb-at" onClick={() => setCurrentTime(c.time)} title="Jump to this moment">
                      {`${Math.floor(c.time / 60)}:${(c.time % 60).toFixed(1).padStart(4, '0')}`}
                    </button>
                    <span className="v1-tl-fb-text"><b>{c.author}</b> {c.text}</span>
                    <label className="v1-tl-fb-done" title="Mark resolved">
                      <input
                        type="checkbox"
                        checked={!!c.resolved}
                        onChange={(e) => useV1.getState().setCommentResolved(c.id, e.target.checked)}
                      />
                    </label>
                    <button className="btn-icon xs" title="Delete comment" onClick={() => useV1.getState().removeComment(c.id)}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="v1-tl-view">
          <button
            className={`v1-tl-snap${snapOn ? ' on' : ''}`}
            aria-pressed={snapOn}
            onClick={() => setSnapOn(!snapOn)}
            title="Snap to playhead, clip edges and keyframes (hold Alt to bypass)"
          >Snap</button>
          <button className="btn-icon xs" onClick={() => zoomTo(zoom / 1.5)} disabled={zoom <= ZOOM_MIN} title="Zoom out (⌘/Ctrl + scroll)">−</button>
          <input
            className="v1-tl-zoom"
            type="range"
            min={0}
            max={1}
            step={0.001}
            aria-label="Timeline zoom"
            value={Math.log(zoom) / Math.log(ZOOM_MAX)}
            onChange={(e) => zoomTo(Math.exp(Number(e.target.value) * Math.log(ZOOM_MAX)))}
          />
          <button className="btn-icon xs" onClick={() => zoomTo(zoom * 1.5)} disabled={zoom >= ZOOM_MAX} title="Zoom in (⌘/Ctrl + scroll)">+</button>
          <button className="btn-icon xs v1-tl-fit" onClick={() => zoomTo(1)} disabled={zoom === 1} title="Fit timeline">Fit</button>
        </div>
      </div>

      <div
        className="v1-tl-grid"
        ref={gridRef}
        style={{ gridTemplateColumns: `${HEAD_W}px calc((100% - ${HEAD_W}px) * ${zoom})` }}
      >
        <div className="v1-tl-layers-header">Layers</div>
        <div
          className="v1-tl-ruler"
          onMouseDown={(e) => {
            scrubTo(e.clientX);
            const onMove = (ev: MouseEvent) => scrubTo(ev.clientX);
            const onUp = () => {
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          }}
          ref={trackRef}
        >
          {marks.map((s) => (
            <div key={s} className="v1-tl-tick" style={{ left: `${(s / comp.duration) * 100}%` }}>
              <span>{tickLabel(s)}</span>
            </div>
          ))}
          {(markers ?? []).map((m) => (
            editingMarker === m.id ? (
              <input
                key={m.id}
                className="v1-tl-marker-edit"
                style={{ left: `${(m.time / comp.duration) * 100}%` }}
                defaultValue={m.label}
                autoFocus
                aria-label="Marker name"
                onFocus={(e) => e.currentTarget.select()}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') { useV1.getState().renameMarker(m.id, e.currentTarget.value); setEditingMarker(null); }
                  if (e.key === 'Escape') setEditingMarker(null);
                }}
                onBlur={(e) => { useV1.getState().renameMarker(m.id, e.currentTarget.value); setEditingMarker(null); }}
              />
            ) : (
              <button
                key={m.id}
                className="v1-tl-marker"
                style={{ left: `${(m.time / comp.duration) * 100}%` }}
                title={`${m.label} — click to jump, double-click to rename`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => setCurrentTime(m.time)}
                onDoubleClick={() => setEditingMarker(m.id)}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMarkerMenu({ x: e.clientX, y: e.clientY, id: m.id }); }}
              >
                <span>{m.label}</span>
              </button>
            )
          ))}
          {openComments.map((c) => (
            <button
              key={c.id}
              className="v1-tl-comment"
              style={{ left: `${(c.time / comp.duration) * 100}%` }}
              title={`${c.author}: ${c.text}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => { setCurrentTime(c.time); setShowFeedback(true); }}
            />
          ))}
          {snapLine !== null && (
            <div className="v1-tl-snapline" style={{ left: `${(snapLine / comp.duration) * 100}%` }} aria-hidden />
          )}
          <div
            className="v1-tl-playhead"
            style={{ left: `${(currentTime / comp.duration) * 100}%` }}
            aria-hidden
          />
        </div>

        {project.layers.length === 0 ? (
          <div className="v1-tl-empty">Your timeline is empty. Add a layer from the left toolbar.</div>
        ) : null}
        {project.layers.length > 0 && (
          project.layers.map((layer, i) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              index={i}
              count={project.layers.length}
              dropMark={
                dropAt && dropAt.to === i && project.layers[i].id !== dropAt.id
                  ? (dropAt.to > project.layers.findIndex((l) => l.id === dropAt.id) ? 'after' : 'before')
                  : null
              }
              dragging={dropAt?.id === layer.id}
              onReorderPreview={(to) => setDropAt(to === null ? null : { id: layer.id, to })}
              onReorder={(to) => { setDropAt(null); reorderLayer(layer.id, to); }}
              renaming={renamingId === layer.id}
              onStartRename={() => setRenamingId(layer.id)}
              onRenameDone={(name) => {
                setRenamingId(null);
                if (name !== null && name.trim() && name.trim() !== layer.name) renameLayer(layer.id, name.trim());
              }}
              duration={comp.duration}
              currentTime={currentTime}
              snap={snap}
              selected={selection.includes(layer.id)}
              onSelect={(e) => {
                if (e && (e.shiftKey || e.metaKey || e.ctrlKey)) useV1.getState().toggleSelect(layer.id);
                else selectLayer(layer.id);
              }}
              onToggleVisible={() => setVisible(layer.id, !layer.visible)}
              onToggleLock={() => setLocked(layer.id, !layer.locked)}
              onToggleSolo={() => setSolo(layer.id, !layer.solo)}
              onDuplicate={() => duplicate(layer.id)}
              onDelete={() => removeLayer(layer.id)}
              onSplit={() => splitLayerAt(layer.id, useV1.getState().currentTime)}
              onSeek={(t) => setCurrentTime(t)}
              onClipDrag={(mode, newStart, newEnd) => {
                if (mode === 'body') moveLayerInTime(layer.id, newStart);
                else if (mode === 'in') trimLayerIn(layer.id, newStart);
                else if (mode === 'out') trimLayerOut(layer.id, newEnd);
              }}
              onContextHead={openMenu(layer.id, false)}
              onContextTrack={openMenu(layer.id, true)}
            />
          ))
        )}
      </div>
      <ContextMenu
        anchor={markerMenu ? { x: markerMenu.x, y: markerMenu.y } : null}
        onClose={() => setMarkerMenu(null)}
        items={markerMenu ? [
          { label: 'Rename marker…', run: () => setEditingMarker(markerMenu.id) },
          { label: 'Delete marker', danger: true, run: () => useV1.getState().removeMarker(markerMenu.id) },
        ] : []}
      />
      <ContextMenu
        anchor={menu ? { x: menu.x, y: menu.y } : null}
        onClose={() => setMenu(null)}
        items={
          menu
            ? [
                ...(menu.onTrack ? clipExtras(menu.layerId) : []),
                ...layerMenu(menu.layerId, { onRename: () => setRenamingId(menu.layerId) }),
              ]
            : []
        }
      />
    </div>
  );
}

function LayerRowImpl({
  layer,
  index,
  count,
  dropMark,
  dragging,
  onReorderPreview,
  onReorder,
  renaming,
  onStartRename,
  onRenameDone,
  duration,
  currentTime,
  snap,
  selected,
  onSelect,
  onToggleVisible,
  onToggleLock,
  onToggleSolo,
  onDuplicate,
  onDelete,
  onSplit,
  onSeek,
  onClipDrag,
  onContextHead,
  onContextTrack,
}: {
  layer: Layer;
  index: number;
  count: number;
  dropMark: 'before' | 'after' | null;
  dragging: boolean;
  onReorderPreview: (to: number | null) => void;
  onReorder: (to: number) => void;
  renaming: boolean;
  onStartRename: () => void;
  onRenameDone: (name: string | null) => void;
  duration: number;
  currentTime: number;
  snap: SnapCtx;
  selected: boolean;
  onSelect: (e?: React.MouseEvent) => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  onToggleSolo: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSplit: () => void;
  onSeek: (t: number) => void;
  onClipDrag: (mode: ClipDrag, newStartTime: number, newEndTime: number) => void;
  onContextHead: (e: React.MouseEvent) => void;
  onContextTrack: (e: React.MouseEvent) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  /* Drag the layer's name cell up/down to restack it. Starts after 4 px of
   * vertical travel so plain clicks still select. */
  const beginReorder = (e: React.PointerEvent) => {
    if (e.button !== 0 || renaming) return;
    if ((e.target as Element).closest('button, input')) return;
    const head = e.currentTarget as HTMLElement;
    const rowH = head.getBoundingClientRect().height || 32;
    const y0 = e.clientY;
    let to: number | null = null;
    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - y0;
      if (to === null && Math.abs(dy) < 4) return;
      const next = Math.max(0, Math.min(count - 1, index + Math.round(dy / rowH)));
      if (next !== to) { to = next; onReorderPreview(next); }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (to === null) return;
      if (to !== index) onReorder(to);
      else onReorderPreview(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /* Drag a keyframe diamond: moves every prop keyed at that time, snapped
   * to whole frames. A press without movement is a click → seek. */
  const beginKfDrag = (e: React.PointerEvent, t0: number) => {
    e.stopPropagation();
    e.preventDefault();
    if (layer.locked) { onSeek(t0); return; }
    onSelect();
    const track = trackRef.current;
    if (!track) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const rect = track.getBoundingClientRect();
    const fps = useV1.getState().project.composition.fps;
    const x0 = e.clientX;
    let cur = t0;
    let dragged = false;
    // Snap to other layers and this layer's clip edges (not the playhead: it follows the key).
    const targets = snapTargets(useV1.getState().project.layers, duration, layer.id, [layer.startTime, layer.startTime + layer.duration, ...markerTimes()]);
    const thr = (SNAP_PX / rect.width) * duration;
    const onMove = (ev: PointerEvent) => {
      if (!dragged && Math.abs(ev.clientX - x0) < 3) return;
      dragged = true;
      const raw = t0 + ((ev.clientX - x0) / rect.width) * duration;
      const sn = snap.enabled && !ev.altKey ? snapTime(raw, targets, thr) : { t: raw, hit: null };
      snap.show(sn.hit);
      const snapped = Math.max(0, Math.min(duration, sn.hit !== null ? sn.t : Math.round(raw * fps) / fps));
      if (Math.abs(snapped - cur) < 1e-6) return;
      useV1.getState().moveKeyframesAt(layer.id, cur, snapped);
      cur = snapped;
      onSeek(snapped);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      snap.show(null);
      if (!dragged) onSeek(t0);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const beginClipDrag = (mode: ClipDrag) => (e: React.PointerEvent) => {
    if (layer.locked) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    (e.target as Element).setPointerCapture(e.pointerId);
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const toTime = (clientX: number) =>
      Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
    const start0 = layer.startTime;
    const end0 = layer.startTime + layer.duration;
    const t0 = toTime(e.clientX);
    const st = useV1.getState();
    const targets = snapTargets(st.project.layers, duration, layer.id, [st.currentTime, ...markerTimes()]);
    const thr = (SNAP_PX / rect.width) * duration;
    const onMove = (ev: PointerEvent) => {
      const t = toTime(ev.clientX);
      const dt = t - t0;
      const on = snap.enabled && !ev.altKey;
      if (mode === 'body') {
        const sn = on ? snapSpan(start0 + dt, end0 + dt, targets, thr) : { start: start0 + dt, hit: null };
        snap.show(sn.hit);
        onClipDrag('body', sn.start, sn.start + (end0 - start0));
      } else {
        const edge = mode === 'in' ? start0 + dt : end0 + dt;
        const sn = on ? snapTime(edge, targets, thr) : { t: edge, hit: null };
        snap.show(sn.hit);
        if (mode === 'in') onClipDrag('in', sn.t, end0);
        else onClipDrag('out', start0, sn.t);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      snap.show(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  // All keyframes across the layer's transform (and shape/text extras), merged
  // onto one strip so the user sees at a glance where a layer animates.
  const kfTimes = keyTimesOf(layer);

  const left = (layer.startTime / duration) * 100;
  const width = (layer.duration / duration) * 100;

  return (
    <>
      <div
        className={`v1-tl-layer-row-head${selected ? ' selected' : ''}${dragging ? ' dragging' : ''}${dropMark ? ` drop-${dropMark}` : ''}`}
        onClick={onSelect}
        onPointerDown={beginReorder}
        onContextMenu={onContextHead}
      >
        <div className="v1-tl-flags">
          <button className={`flag ${layer.visible ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onToggleVisible(); }} title="Visible">👁</button>
          <button className={`flag ${layer.locked ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onToggleLock(); }} title="Locked">🔒</button>
          <button className={`flag ${layer.solo ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onToggleSolo(); }} title="Solo">S</button>
        </div>
        <div className="v1-tl-layer-meta">
          {renaming ? (
            <input
              className="v1-tl-rename"
              defaultValue={layer.name}
              autoFocus
              aria-label="Layer name"
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') onRenameDone(e.currentTarget.value);
                else if (e.key === 'Escape') onRenameDone(null);
              }}
              onBlur={(e) => onRenameDone(e.currentTarget.value)}
            />
          ) : (
            <div
              className="v1-tl-layer-name"
              title="Double-click to rename"
              onDoubleClick={(e) => { e.stopPropagation(); onStartRename(); }}
            >{layer.name}</div>
          )}
          <div className="v1-tl-layer-type">
            {/* Parented layers show their parent here (type stays in the tooltip + Inspector). */}
            {layer.parentId ? <ParentTag id={layer.parentId} type={layer.type} /> : <TypeTag layer={layer} />}
          </div>
        </div>
        <div className="v1-tl-row-actions">
          <button className="btn-icon xs" onClick={(e) => { e.stopPropagation(); onSplit(); }} title="Split at playhead (K)">⫲</button>
          <button className="btn-icon xs" onClick={(e) => { e.stopPropagation(); onDuplicate(); }} title="Duplicate">⎘</button>
          <button className="btn-icon xs" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete">×</button>
        </div>
      </div>
      <div
        className={`v1-tl-layer-row-track${selected ? ' selected' : ''}`}
        onClick={onSelect}
        onContextMenu={onContextTrack}
        ref={trackRef}
      >
        <div
          className="v1-tl-clip"
          style={{ left: `${left}%`, width: `${width}%` }}
          onPointerDown={beginClipDrag('body')}
          title={`${layer.startTime.toFixed(2)}s – ${(layer.startTime + layer.duration).toFixed(2)}s`}
        >
          <div
            className="v1-tl-clip-trim v1-tl-clip-trim-in"
            onPointerDown={beginClipDrag('in')}
            title="Trim in"
          />
          <div className="v1-tl-clip-label">{layer.name}</div>
          <div
            className="v1-tl-clip-trim v1-tl-clip-trim-out"
            onPointerDown={beginClipDrag('out')}
            title="Trim out"
          />
        </div>
        {kfTimes.map((t) => (
          <button
            key={t.toFixed(4)}
            className={`v1-tl-kf${Math.abs(t - currentTime) < 0.05 ? ' now' : ''}`}
            style={{ left: `${(t / duration) * 100}%` }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => beginKfDrag(e, t)}
            title={`${t.toFixed(2)}s — drag to move, click to jump`}
          />
        ))}
      </div>
    </>
  );
}

/* Rows are the bulk of the timeline: during playback only the playhead
 * moves, so a row re-renders only when its own data changes or the playhead
 * enters/leaves one of its keyframes (the "now" highlight). Handler props
 * are fresh closures every render but read live state (or the layer, which
 * is compared), so they are ignored here. */
type RowProps = Parameters<typeof LayerRowImpl>[0];
const nowKey = (p: RowProps) => keyTimesOf(p.layer).find((t) => Math.abs(t - p.currentTime) < 0.05) ?? -1;
const LayerRow = memo(LayerRowImpl, (a, b) =>
  a.layer === b.layer &&
  a.index === b.index &&
  a.count === b.count &&
  a.duration === b.duration &&
  a.selected === b.selected &&
  a.dropMark === b.dropMark &&
  a.dragging === b.dragging &&
  a.renaming === b.renaming &&
  a.snap.enabled === b.snap.enabled &&
  nowKey(a) === nowKey(b));

/** Marker times for snapping (read live so drags see new markers). */
const markerTimes = () => (useV1.getState().project.markers ?? []).map((m) => m.time);

/** Layer type label; media layers holding an audio file read "audio". */
function TypeTag({ layer }: { layer: Layer }) {
  const audio = useV1((s) => layer.type === 'media' && s.project.assets.find((a) => a.id === layer.assetId)?.kind === 'audio');
  return <>{audio ? '♪ audio' : layer.type}</>;
}

/** "↳ Parent name" next to a child's type label. Subscribes to the name only. */
function ParentTag({ id, type }: { id: string; type: string }) {
  const name = useV1((s) => s.project.layers.find((l) => l.id === id)?.name);
  return name ? <span className="v1-tl-parent" title={`${type} · parented to ${name}`}>↳ {name}</span> : <>{type}</>;
}

/** Sorted, de-duplicated keyframe times per layer object (cached: layers are immutable). */
const keyTimesCache = new WeakMap<Layer, number[]>();
function keyTimesOf(layer: Layer): number[] {
  let t = keyTimesCache.get(layer);
  if (!t) { t = uniqueTimes(layerKeyTimes(layer)); keyTimesCache.set(layer, t); }
  return t;
}

/* Diamonds from different props at the same time collapse into one marker. */
function uniqueTimes(times: number[]): number[] {
  const out: number[] = [];
  for (const t of [...times].sort((a, b) => a - b)) {
    if (!out.length || Math.abs(out[out.length - 1] - t) >= 0.01) out.push(t);
  }
  return out;
}
