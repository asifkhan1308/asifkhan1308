import { useRef, useState } from 'react';
import { useV1 } from '../store';
import ContextMenu from './ContextMenu';
import { clipExtras, layerMenu } from './menuBuilders';
import type { AnimatedProperty, Layer } from '../types';

type ClipDrag = 'body' | 'in' | 'out';
interface MenuState { x: number; y: number; layerId: string; onTrack: boolean }

export default function V1Timeline() {
  const project = useV1((s) => s.project);
  const currentTime = useV1((s) => s.currentTime);
  const setCurrentTime = useV1((s) => s.setCurrentTime);
  const isPlaying = useV1((s) => s.isPlaying);
  const setIsPlaying = useV1((s) => s.setIsPlaying);
  const selectedId = useV1((s) => s.selectedLayerId);
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

  const marks = Array.from({ length: Math.floor(comp.duration) + 1 }).map((_, i) => i);

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
      </div>

      <div className="v1-tl-grid">
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
              <span>{s}s</span>
            </div>
          ))}
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
          project.layers.map((layer) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              duration={comp.duration}
              currentTime={currentTime}
              selected={layer.id === selectedId}
              onSelect={() => selectLayer(layer.id)}
              onToggleVisible={() => setVisible(layer.id, !layer.visible)}
              onToggleLock={() => setLocked(layer.id, !layer.locked)}
              onToggleSolo={() => setSolo(layer.id, !layer.solo)}
              onDuplicate={() => duplicate(layer.id)}
              onDelete={() => removeLayer(layer.id)}
              onSplit={() => splitLayerAt(layer.id, currentTime)}
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
        anchor={menu ? { x: menu.x, y: menu.y } : null}
        onClose={() => setMenu(null)}
        items={
          menu
            ? [
                ...(menu.onTrack ? clipExtras(menu.layerId) : []),
                ...layerMenu(menu.layerId),
              ]
            : []
        }
      />
    </div>
  );
}

function LayerRow({
  layer,
  duration,
  currentTime,
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
  duration: number;
  currentTime: number;
  selected: boolean;
  onSelect: () => void;
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
    const onMove = (ev: PointerEvent) => {
      const t = toTime(ev.clientX);
      const dt = t - t0;
      if (mode === 'body') onClipDrag('body', start0 + dt, end0 + dt);
      else if (mode === 'in') onClipDrag('in', start0 + dt, end0);
      else if (mode === 'out') onClipDrag('out', start0, end0 + dt);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  // All keyframes across the layer's transform (and shape/text extras), merged
  // onto one strip so the user sees at a glance where a layer animates.
  const kfTimes: number[] = [];
  const bucket = (ap: AnimatedProperty<unknown> | undefined) =>
    ap?.keyframes?.forEach((k) => kfTimes.push(k.time));
  bucket(layer.transform.position as unknown as AnimatedProperty<unknown>);
  bucket(layer.transform.scale as unknown as AnimatedProperty<unknown>);
  bucket(layer.transform.rotation as unknown as AnimatedProperty<unknown>);
  bucket(layer.transform.anchor as unknown as AnimatedProperty<unknown>);
  bucket(layer.transform.opacity as unknown as AnimatedProperty<unknown>);
  if (layer.type === 'rectangle' || layer.type === 'ellipse') bucket(layer.size as unknown as AnimatedProperty<unknown>);
  if (layer.type === 'rectangle') bucket(layer.cornerRadius as unknown as AnimatedProperty<unknown>);
  if (layer.type === 'text') bucket(layer.fontSize as unknown as AnimatedProperty<unknown>);

  const left = (layer.startTime / duration) * 100;
  const width = (layer.duration / duration) * 100;

  return (
    <>
      <div
        className={`v1-tl-layer-row-head${selected ? ' selected' : ''}`}
        onClick={onSelect}
        onContextMenu={onContextHead}
      >
        <div className="v1-tl-flags">
          <button className={`flag ${layer.visible ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onToggleVisible(); }} title="Visible">👁</button>
          <button className={`flag ${layer.locked ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onToggleLock(); }} title="Locked">🔒</button>
          <button className={`flag ${layer.solo ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onToggleSolo(); }} title="Solo">S</button>
        </div>
        <div className="v1-tl-layer-meta">
          <div className="v1-tl-layer-name">{layer.name}</div>
          <div className="v1-tl-layer-type">{layer.type}</div>
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
        {kfTimes.map((t, i) => (
          <button
            key={`${t}-${i}`}
            className={`v1-tl-kf${Math.abs(t - currentTime) < 0.05 ? ' now' : ''}`}
            style={{ left: `${(t / duration) * 100}%` }}
            onClick={(e) => { e.stopPropagation(); onSeek(t); }}
            title={`${t.toFixed(2)}s`}
          />
        ))}
      </div>
    </>
  );
}
