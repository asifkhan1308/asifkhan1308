import { useEditorStore } from '../store/editorStore';
import { resolveKeyframedValue } from '../engine/drawText';
import type { KeyframeProp, TextLayer } from '../types';

const FONTS = [
  { label: 'Inter', value: 'Inter, -apple-system, system-ui, sans-serif' },
  { label: 'System', value: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: 'JetBrains Mono, ui-monospace, Menlo, monospace' },
];

export default function TextLayerPanel() {
  const project = useEditorStore((s) => s.currentProject);
  const selectedId = useEditorStore((s) => s.selectedTextLayerId);
  const addTextLayer = useEditorStore((s) => s.addTextLayer);
  const updateTextLayer = useEditorStore((s) => s.updateTextLayer);
  const removeTextLayer = useEditorStore((s) => s.removeTextLayer);
  const selectTextLayer = useEditorStore((s) => s.selectTextLayer);
  const addKeyframe = useEditorStore((s) => s.addKeyframe);
  const removeKeyframe = useEditorStore((s) => s.removeKeyframe);
  const currentTime = useEditorStore((s) => s.currentTime);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);

  if (!project) return null;

  const layers: TextLayer[] = project.textLayers ?? [];
  const selected = layers.find((l) => l.id === selectedId) ?? layers[0] ?? null;
  const duration = project.animation.duration;

  const update = (patch: Partial<TextLayer>) => {
    if (selected) updateTextLayer(selected.id, patch);
  };

  /** Snapshot the current animated value at the current time so the diamond
   *  button records what the user is actually seeing on the canvas. */
  const snapshotValue = (layer: TextLayer, prop: KeyframeProp): number => {
    const base =
      prop === 'x'
        ? layer.x
        : prop === 'y'
          ? layer.y
          : prop === 'size'
            ? layer.size
            : prop === 'opacity'
              ? layer.opacity ?? 1
              : layer.rotation ?? 0;
    return resolveKeyframedValue(base, layer.keyframes?.[prop], currentTime);
  };

  const toggleKeyframeAtNow = (layer: TextLayer, prop: KeyframeProp) => {
    const existing = layer.keyframes?.[prop] ?? [];
    const match = existing.find((k) => Math.abs(k.time - currentTime) < 0.05);
    if (match) removeKeyframe(layer.id, prop, match.time);
    else addKeyframe(layer.id, prop, currentTime, snapshotValue(layer, prop));
  };

  const KeyframeStrip = ({ layer, prop }: { layer: TextLayer; prop: KeyframeProp }) => {
    const frames = layer.keyframes?.[prop] ?? [];
    const hasNow = frames.some((k) => Math.abs(k.time - currentTime) < 0.05);
    return (
      <div className="kf-strip">
        <button
          type="button"
          className={`kf-diamond${hasNow ? ' active' : ''}`}
          onClick={() => toggleKeyframeAtNow(layer, prop)}
          title={hasNow ? 'Remove keyframe at current time' : 'Add keyframe at current time'}
          aria-label={hasNow ? 'Remove keyframe' : 'Add keyframe'}
        >
          ◆
        </button>
        <div className="kf-track" title={`${frames.length} keyframe${frames.length === 1 ? '' : 's'}`}>
          {frames.map((k) => (
            <button
              type="button"
              key={k.time}
              className={`kf-marker${Math.abs(k.time - currentTime) < 0.05 ? ' now' : ''}`}
              style={{ left: `${Math.min(100, Math.max(0, (k.time / duration) * 100))}%` }}
              onClick={(e) => {
                if (e.altKey) removeKeyframe(layer.id, prop, k.time);
                else setCurrentTime(k.time);
              }}
              title={`${k.time.toFixed(2)}s · ${k.value.toFixed(3)} (alt-click to delete)`}
              aria-label={`Keyframe at ${k.time.toFixed(2)} seconds`}
            />
          ))}
          <div
            className="kf-playhead"
            style={{ left: `${Math.min(100, Math.max(0, (currentTime / duration) * 100))}%` }}
            aria-hidden
          />
        </div>
      </div>
    );
  };

  return (
    <div className="textlayer-panel">
      <div className="panel-header text-panel-header">
        <span>Text</span>
        <button className="btn-add-text" onClick={() => addTextLayer()}>
          + Add
        </button>
      </div>

      {layers.length === 0 ? (
        <div className="empty-text-hint">
          No text yet. Add overlays and type will appear on the canvas and in exports.
        </div>
      ) : (
        <>
          <div className="text-layer-list">
            {layers.map((l) => (
              <button
                key={l.id}
                className={`text-layer-row${l.id === selected?.id ? ' active' : ''}`}
                onClick={() => selectTextLayer(l.id)}
                title={`${l.text} · ${l.start.toFixed(1)}–${l.end.toFixed(1)}s`}
              >
                <span className="text-layer-dot" style={{ background: l.color }} />
                <span className="text-layer-label">{l.text || 'Untitled'}</span>
                <span className="text-layer-time">
                  {l.start.toFixed(1)}–{l.end.toFixed(1)}s
                </span>
              </button>
            ))}
          </div>

          {selected && (
            <div className="text-editor">
              <div className="parameter">
                <label className="param-label">Content</label>
                <textarea
                  className="text-input"
                  value={selected.text}
                  onChange={(e) => update({ text: e.target.value })}
                  rows={2}
                />
              </div>

              <div className="parameter">
                <label className="param-label">Font</label>
                <select
                  className="select-full"
                  value={selected.fontFamily}
                  onChange={(e) => update({ fontFamily: e.target.value })}
                >
                  {FONTS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="param-row">
                <div className="parameter half">
                  <label className="param-label">Weight</label>
                  <select
                    className="select-full"
                    value={selected.fontWeight}
                    onChange={(e) =>
                      update({ fontWeight: parseInt(e.target.value, 10) as TextLayer['fontWeight'] })
                    }
                  >
                    <option value={400}>Regular</option>
                    <option value={500}>Medium</option>
                    <option value={600}>Semibold</option>
                    <option value={700}>Bold</option>
                    <option value={800}>Heavy</option>
                  </select>
                </div>
                <div className="parameter half">
                  <label className="param-label">Align</label>
                  <select
                    className="select-full"
                    value={selected.align}
                    onChange={(e) => update({ align: e.target.value as TextLayer['align'] })}
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </div>
              </div>

              <div className="parameter">
                <label className="param-label">Size · {(selected.size * 100).toFixed(0)}%</label>
                <input
                  type="range"
                  min="0.02"
                  max="0.25"
                  step="0.005"
                  value={selected.size}
                  onChange={(e) => update({ size: parseFloat(e.target.value) })}
                  className="slider"
                />
                <KeyframeStrip layer={selected} prop="size" />
              </div>

              <div className="param-row">
                <div className="parameter half">
                  <label className="param-label">X · {Math.round(selected.x * 100)}%</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={selected.x}
                    onChange={(e) => update({ x: parseFloat(e.target.value) })}
                    className="slider"
                  />
                  <KeyframeStrip layer={selected} prop="x" />
                </div>
                <div className="parameter half">
                  <label className="param-label">Y · {Math.round(selected.y * 100)}%</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={selected.y}
                    onChange={(e) => update({ y: parseFloat(e.target.value) })}
                    className="slider"
                  />
                  <KeyframeStrip layer={selected} prop="y" />
                </div>
              </div>

              <div className="param-row">
                <div className="parameter half">
                  <label className="param-label">Opacity · {Math.round((selected.opacity ?? 1) * 100)}%</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={selected.opacity ?? 1}
                    onChange={(e) => update({ opacity: parseFloat(e.target.value) })}
                    className="slider"
                  />
                  <KeyframeStrip layer={selected} prop="opacity" />
                </div>
                <div className="parameter half">
                  <label className="param-label">Rotation · {Math.round(selected.rotation ?? 0)}°</label>
                  <input
                    type="range"
                    min="-180"
                    max="180"
                    step="1"
                    value={selected.rotation ?? 0}
                    onChange={(e) => update({ rotation: parseFloat(e.target.value) })}
                    className="slider"
                  />
                  <KeyframeStrip layer={selected} prop="rotation" />
                </div>
              </div>

              <div className="parameter">
                <label className="param-label">Color</label>
                <input
                  type="color"
                  value={selected.color}
                  onChange={(e) => update({ color: e.target.value })}
                  className="color-input"
                />
              </div>

              <div className="parameter">
                <label className="param-label">Animation</label>
                <select
                  className="select-full"
                  value={selected.animation}
                  onChange={(e) => update({ animation: e.target.value as TextLayer['animation'] })}
                >
                  <option value="none">None</option>
                  <option value="fade-in">Fade in/out</option>
                  <option value="slide-up">Slide up</option>
                  <option value="typewriter">Typewriter</option>
                </select>
              </div>

              <div className="param-row">
                <div className="parameter half">
                  <label className="param-label">Start · {selected.start.toFixed(1)}s</label>
                  <input
                    type="range"
                    min="0"
                    max={duration}
                    step="0.1"
                    value={selected.start}
                    onChange={(e) =>
                      update({
                        start: Math.min(parseFloat(e.target.value), selected.end - 0.1),
                      })
                    }
                    className="slider"
                  />
                </div>
                <div className="parameter half">
                  <label className="param-label">End · {selected.end.toFixed(1)}s</label>
                  <input
                    type="range"
                    min="0"
                    max={duration}
                    step="0.1"
                    value={selected.end}
                    onChange={(e) =>
                      update({
                        end: Math.max(parseFloat(e.target.value), selected.start + 0.1),
                      })
                    }
                    className="slider"
                  />
                </div>
              </div>

              <button className="btn-remove-text" onClick={() => removeTextLayer(selected.id)}>
                Remove layer
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
