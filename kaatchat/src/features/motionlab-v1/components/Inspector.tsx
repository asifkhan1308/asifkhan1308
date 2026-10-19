import { useV1 } from '../store';
import { resolveAnimated } from '../engine/interp';
import type { AnimatedProperty, Easing, Layer, V2 } from '../types';
import { wouldCycle } from '../engine/matrix';

type AnimPath =
  | 'position' | 'scale' | 'rotation' | 'anchor' | 'opacity'
  | 'size' | 'cornerRadius' | 'fontSize'
  | 'brightness' | 'contrast' | 'saturation' | 'blur' | 'vignette' | 'grain' | 'tintAmount';

const EFFECT_PATHS: AnimPath[] = ['brightness', 'contrast', 'saturation', 'blur', 'vignette', 'grain', 'tintAmount'];

export default function V1Inspector() {
  const project = useV1((s) => s.project);
  const selectedId = useV1((s) => s.selectedLayerId);
  const currentTime = useV1((s) => s.currentTime);
  const setPropertyBase = useV1((s) => s.setPropertyBase);
  const patchLayer = useV1((s) => s.patchLayer);
  const enableEffects = useV1((s) => s.enableEffects);
  const setEffectTintColor = useV1((s) => s.setEffectTintColor);

  const layer = project.layers.find((l) => l.id === selectedId);

  if (!layer) {
    return (
      <div className="v1-inspector">
        <div className="v1-inspector-empty">
          Nothing selected.
          <br />
          Use the toolbar to add a layer, or click one on the canvas or timeline.
        </div>
      </div>
    );
  }

  const resolve = <T,>(ap: AnimatedProperty<T> | undefined) => (ap ? resolveAnimated(ap, currentTime) : undefined);
  return (
    <div className="v1-inspector">
      <div className="v1-inspector-header">
        <input
          className="v1-layer-name-input"
          value={layer.name}
          onChange={(e) => patchLayer(layer.id, { name: e.target.value })}
        />
        <div className="v1-layer-type">{layer.type}</div>
      </div>

      <section className="v1-section">
        <div className="v1-section-head">Transform</div>

        {/* Parenting: this layer moves, rotates and scales with its parent. */}
        <label className="v1-parent-row">
          <span>Parent</span>
          <select
            className="v1-parent-select"
            aria-label="Parent layer"
            value={layer.parentId ?? ''}
            onChange={(e) => useV1.getState().setParent(layer.id, e.target.value || null)}
          >
            <option value="">None</option>
            {project.layers
              .filter((l) => !wouldCycle(layer.id, l.id, project.layers))
              .map((l) => (
                <option key={l.id} value={l.id}>{l.type === 'null' ? '✦ ' : ''}{l.name}</option>
              ))}
          </select>
        </label>

        <PropRow layer={layer} currentTime={currentTime} label="Position" path="position">
          <NumberPair
            value={resolve(layer.transform.position) as V2}
            onChange={(v) => setPropertyBase<V2>(layer.id, 'position', v)}
            step={1}
          />
        </PropRow>

        <PropRow layer={layer} currentTime={currentTime} label="Scale" path="scale">
          <NumberPair
            value={resolve(layer.transform.scale) as V2}
            onChange={(v) => setPropertyBase<V2>(layer.id, 'scale', v)}
            step={0.01}
            suffix="×"
          />
        </PropRow>

        <PropRow layer={layer} currentTime={currentTime} label="Rotation" path="rotation">
          <NumberField
            value={resolve(layer.transform.rotation) as number}
            onChange={(v) => setPropertyBase<number>(layer.id, 'rotation', v)}
            step={1}
            suffix="°"
          />
        </PropRow>

        <PropRow layer={layer} currentTime={currentTime} label="Anchor" path="anchor">
          <NumberPair
            value={resolve(layer.transform.anchor) as V2}
            onChange={(v) => setPropertyBase<V2>(layer.id, 'anchor', v)}
            step={1}
          />
        </PropRow>

        <PropRow layer={layer} currentTime={currentTime} label="Opacity" path="opacity">
          <SliderField
            value={resolve(layer.transform.opacity) as number}
            onChange={(v) => setPropertyBase<number>(layer.id, 'opacity', v)}
            min={0}
            max={1}
            step={0.01}
            suffix="%"
            display={(v) => `${Math.round(v * 100)}`}
          />
        </PropRow>
      </section>

      {(layer.type === 'rectangle' || layer.type === 'ellipse') && (
        <section className="v1-section">
          <div className="v1-section-head">Shape</div>
          <PropRow layer={layer} currentTime={currentTime} label="Size" path="size">
            <NumberPair
              value={resolve(layer.size) as V2}
              onChange={(v) => setPropertyBase<V2>(layer.id, 'size', v)}
              step={1}
            />
          </PropRow>
          {layer.type === 'rectangle' && (
            <PropRow layer={layer} currentTime={currentTime} label="Radius" path="cornerRadius">
              <NumberField
                value={resolve(layer.cornerRadius) as number}
                onChange={(v) => setPropertyBase<number>(layer.id, 'cornerRadius', v)}
                step={1}
              />
            </PropRow>
          )}
          <div className="v1-prop">
            <div className="v1-prop-head">
              <span className="v1-prop-label">Fill</span>
            </div>
            <input
              type="color"
              className="color-input"
              value={layer.fill}
              onChange={(e) => patchLayer(layer.id, { fill: e.target.value })}
            />
          </div>
        </section>
      )}

      {layer.type !== 'null' && (
        <section className="v1-section">
          <div className="v1-section-head">
            <span>Effects</span>
            {!layer.effects && (
              <button
                type="button"
                className="btn-icon xs"
                style={{ marginLeft: 10 }}
                onClick={() => enableEffects(layer.id)}
                title="Add neutral effects so each parameter is keyframable"
              >
                + Enable
              </button>
            )}
          </div>
          {layer.effects ? (
            <>
              {EFFECT_PATHS.map((p) => (
                <PropRow layer={layer} currentTime={currentTime}
                  key={p}
                  label={p === 'tintAmount' ? 'Tint' : p[0].toUpperCase() + p.slice(1)}
                  path={p}
                >
                  <SliderField
                    value={resolve((layer.effects as unknown as Record<string, import('../types').AnimatedProperty<number>>)[p]) ?? 0}
                    onChange={(v) => setPropertyBase<number>(layer.id, p, v)}
                    min={p === 'brightness' || p === 'contrast' || p === 'saturation' ? -1 : 0}
                    max={1}
                    step={0.01}
                    display={(v) => (p === 'brightness' || p === 'contrast' || p === 'saturation'
                      ? v.toFixed(2)
                      : `${Math.round(v * 100)}%`)}
                  />
                </PropRow>
              ))}
              <div className="v1-prop">
                <div className="v1-prop-head"><span className="v1-prop-label">Tint colour</span></div>
                <input
                  type="color"
                  className="color-input"
                  value={layer.effects.tintColor}
                  onChange={(e) => setEffectTintColor(layer.id, e.target.value)}
                />
              </div>
            </>
          ) : (
            <div className="v1-inspector-empty" style={{ padding: 8, fontSize: 11.5 }}>
              Neutral. Click + Enable to add brightness, contrast, saturation, blur, vignette, grain and tint — all keyframable.
            </div>
          )}
        </section>
      )}

      {layer.type === 'media' && (
        <section className="v1-section">
          <div className="v1-section-head">
            <span>Audio</span>
            <button
              type="button"
              className={`btn-icon xs v1-mute${layer.muted ? ' on' : ''}`}
              style={{ marginLeft: 10 }}
              onClick={() => patchLayer(layer.id, { muted: !layer.muted })}
              aria-pressed={!!layer.muted}
            >
              {layer.muted ? 'Muted' : 'Mute'}
            </button>
          </div>
          <div className="v1-prop">
            <div className="v1-prop-head"><span className="v1-prop-label">Volume</span></div>
            <SliderField
              value={layer.volume ?? 1}
              onChange={(v) => patchLayer(layer.id, { volume: v })}
              min={0}
              max={2}
              step={0.01}
              suffix="%"
              display={(v) => `${Math.round(v * 100)}`}
            />
          </div>
          <div className="v1-pair">
            <div className="v1-prop">
              <div className="v1-prop-head"><span className="v1-prop-label">Fade in</span></div>
              <NumberField
                value={layer.fadeIn ?? 0}
                onChange={(v) => patchLayer(layer.id, { fadeIn: Math.max(0, Math.min(layer.duration / 2, v)) })}
                step={0.1}
                suffix="s"
              />
            </div>
            <div className="v1-prop">
              <div className="v1-prop-head"><span className="v1-prop-label">Fade out</span></div>
              <NumberField
                value={layer.fadeOut ?? 0}
                onChange={(v) => patchLayer(layer.id, { fadeOut: Math.max(0, Math.min(layer.duration / 2, v)) })}
                step={0.1}
                suffix="s"
              />
            </div>
          </div>
        </section>
      )}

      {layer.type === 'text' && (
        <section className="v1-section">
          <div className="v1-section-head">Text</div>
          <div className="v1-prop">
            <div className="v1-prop-head"><span className="v1-prop-label">Content</span></div>
            <textarea
              className="text-input"
              rows={2}
              value={layer.text}
              onChange={(e) => patchLayer(layer.id, { text: e.target.value })}
            />
          </div>
          <PropRow layer={layer} currentTime={currentTime} label="Font size" path="fontSize">
            <NumberField
              value={resolve(layer.fontSize) as number}
              onChange={(v) => setPropertyBase<number>(layer.id, 'fontSize', v)}
              step={1}
              suffix="px"
            />
          </PropRow>
          <div className="v1-prop">
            <div className="v1-prop-head"><span className="v1-prop-label">Weight</span></div>
            <select
              className="select-full"
              value={layer.fontWeight}
              onChange={(e) => patchLayer(layer.id, { fontWeight: Number(e.target.value) as 400 | 500 | 600 | 700 | 800 })}
            >
              <option value={400}>Regular</option>
              <option value={500}>Medium</option>
              <option value={600}>Semibold</option>
              <option value={700}>Bold</option>
              <option value={800}>Heavy</option>
            </select>
          </div>
          <div className="v1-prop">
            <div className="v1-prop-head"><span className="v1-prop-label">Align</span></div>
            <select
              className="select-full"
              value={layer.align}
              onChange={(e) => patchLayer(layer.id, { align: e.target.value as 'left' | 'center' | 'right' })}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
          <div className="v1-prop">
            <div className="v1-prop-head"><span className="v1-prop-label">Fill</span></div>
            <input
              type="color"
              className="color-input"
              value={layer.fill}
              onChange={(e) => patchLayer(layer.id, { fill: e.target.value })}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function animatedPropertyFor(layer: Layer, path: AnimPath): AnimatedProperty<unknown> | undefined {
  switch (path) {
    case 'position':
    case 'scale':
    case 'rotation':
    case 'anchor':
    case 'opacity':
      return (layer.transform as unknown as Record<string, AnimatedProperty<unknown>>)[path];
    case 'size':
      if (layer.type === 'rectangle' || layer.type === 'ellipse') return layer.size as unknown as AnimatedProperty<unknown>;
      return;
    case 'cornerRadius':
      if (layer.type === 'rectangle') return layer.cornerRadius as unknown as AnimatedProperty<unknown>;
      return;
    case 'fontSize':
      if (layer.type === 'text') return layer.fontSize as unknown as AnimatedProperty<unknown>;
      return;
    case 'brightness':
    case 'contrast':
    case 'saturation':
    case 'blur':
    case 'vignette':
    case 'grain':
    case 'tintAmount':
      if (!layer.effects) return;
      return (layer.effects as unknown as Record<string, AnimatedProperty<unknown>>)[path];
  }
}

/* ───── small controls ───── */

function NumberField({ value, onChange, step = 1, suffix }: { value: number; onChange: (v: number) => void; step?: number; suffix?: string }) {
  return (
    <div className="v1-field">
      <input
        type="number"
        value={value == null ? 0 : +value.toFixed(3)}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
      {suffix ? <span className="v1-field-suffix">{suffix}</span> : null}
    </div>
  );
}

function NumberPair({ value, onChange, step = 1, suffix }: { value: V2; onChange: (v: V2) => void; step?: number; suffix?: string }) {
  const [x, y] = value ?? [0, 0];
  return (
    <div className="v1-pair">
      <NumberField value={x} onChange={(nx) => onChange([nx, y])} step={step} suffix={suffix} />
      <NumberField value={y} onChange={(ny) => onChange([x, ny])} step={step} suffix={suffix} />
    </div>
  );
}

function SliderField({
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  display,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  display?: (v: number) => string;
}) {
  return (
    <div className="v1-slider-row">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="slider"
      />
      <span className="v1-slider-value">
        {display ? display(value) : value.toFixed(2)}
        {suffix}
      </span>
    </div>
  );
}

/* Module-level (stable identity) so fields inside don't remount on every
 * render — a component declared inside Inspector lost input focus per key. */
const EASINGS: Array<{ value: Easing; label: string }> = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease in' },
  { value: 'ease-out', label: 'Ease out' },
  { value: 'ease-in-out', label: 'Ease in/out' },
];

function PropRow({
  layer,
  currentTime,
  label,
  path,
  children,
}: {
  layer: Layer;
  currentTime: number;
  label: string;
  path: AnimPath;
  children: React.ReactNode;
}) {
  const toggleKeyframe = useV1((s) => s.toggleKeyframe);
  const setKeyframeEasing = useV1((s) => s.setKeyframeEasing);
  const ap = animatedPropertyFor(layer, path);
  const kfs = ap?.keyframes ?? [];
  // Same 10 ms window the store uses, so "on" always means toggle removes it.
  const atNow = kfs.find((k) => Math.abs(k.time - currentTime) < 0.01);
  const state = kfs.length === 0 ? 'off' : atNow ? 'on' : 'has';
  return (
    <div className="v1-prop">
      <div className="v1-prop-head">
        <span className="v1-prop-label">{label}</span>
        {atNow && kfs[0] !== atNow && (
          <select
            className="v1-easing"
            value={atNow.easing ?? 'ease-in-out'}
            onChange={(e) => setKeyframeEasing(layer.id, path, atNow.time, e.target.value as Easing)}
            title="Easing into this keyframe"
          >
            {EASINGS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}
        <button
          type="button"
          className={`v1-diamond v1-diamond-${state}`}
          onClick={() => toggleKeyframe(layer.id, path)}
          title={state === 'on' ? 'Remove keyframe at playhead' : 'Add keyframe at playhead'}
        >◆</button>
      </div>
      <div className="v1-prop-body">{children}</div>
    </div>
  );
}
