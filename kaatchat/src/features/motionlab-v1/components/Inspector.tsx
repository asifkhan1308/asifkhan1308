import { useV1 } from '../store';
import { resolveAnimated } from '../engine/interp';
import type { AnimatedProperty, Layer, V2 } from '../types';

type AnimPath = 'position' | 'scale' | 'rotation' | 'anchor' | 'opacity' | 'size' | 'cornerRadius' | 'fontSize';

export default function V1Inspector() {
  const project = useV1((s) => s.project);
  const selectedId = useV1((s) => s.selectedLayerId);
  const currentTime = useV1((s) => s.currentTime);
  const setPropertyBase = useV1((s) => s.setPropertyBase);
  const toggleKeyframe = useV1((s) => s.toggleKeyframe);
  const patchLayer = useV1((s) => s.patchLayer);

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
  const diamondState = (ap: AnimatedProperty<unknown> | undefined) => {
    if (!ap?.keyframes || ap.keyframes.length === 0) return 'off';
    const atNow = ap.keyframes.some((k) => Math.abs(k.time - currentTime) < 0.05);
    return atNow ? 'on' : 'has';
  };

  const Row = ({
    label,
    path,
    children,
  }: {
    label: string;
    path: AnimPath;
    children: React.ReactNode;
  }) => {
    const ap = animatedPropertyFor(layer, path);
    const state = diamondState(ap);
    return (
      <div className="v1-prop">
        <div className="v1-prop-head">
          <span className="v1-prop-label">{label}</span>
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
  };

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

        <Row label="Position" path="position">
          <NumberPair
            value={resolve(layer.transform.position) as V2}
            onChange={(v) => setPropertyBase<V2>(layer.id, 'position', v)}
            step={1}
          />
        </Row>

        <Row label="Scale" path="scale">
          <NumberPair
            value={resolve(layer.transform.scale) as V2}
            onChange={(v) => setPropertyBase<V2>(layer.id, 'scale', v)}
            step={0.01}
            suffix="×"
          />
        </Row>

        <Row label="Rotation" path="rotation">
          <NumberField
            value={resolve(layer.transform.rotation) as number}
            onChange={(v) => setPropertyBase<number>(layer.id, 'rotation', v)}
            step={1}
            suffix="°"
          />
        </Row>

        <Row label="Anchor" path="anchor">
          <NumberPair
            value={resolve(layer.transform.anchor) as V2}
            onChange={(v) => setPropertyBase<V2>(layer.id, 'anchor', v)}
            step={1}
          />
        </Row>

        <Row label="Opacity" path="opacity">
          <SliderField
            value={resolve(layer.transform.opacity) as number}
            onChange={(v) => setPropertyBase<number>(layer.id, 'opacity', v)}
            min={0}
            max={1}
            step={0.01}
            suffix="%"
            display={(v) => `${Math.round(v * 100)}`}
          />
        </Row>
      </section>

      {(layer.type === 'rectangle' || layer.type === 'ellipse') && (
        <section className="v1-section">
          <div className="v1-section-head">Shape</div>
          <Row label="Size" path="size">
            <NumberPair
              value={resolve(layer.size) as V2}
              onChange={(v) => setPropertyBase<V2>(layer.id, 'size', v)}
              step={1}
            />
          </Row>
          {layer.type === 'rectangle' && (
            <Row label="Radius" path="cornerRadius">
              <NumberField
                value={resolve(layer.cornerRadius) as number}
                onChange={(v) => setPropertyBase<number>(layer.id, 'cornerRadius', v)}
                step={1}
              />
            </Row>
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
          <Row label="Font size" path="fontSize">
            <NumberField
              value={resolve(layer.fontSize) as number}
              onChange={(v) => setPropertyBase<number>(layer.id, 'fontSize', v)}
              step={1}
              suffix="px"
            />
          </Row>
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
