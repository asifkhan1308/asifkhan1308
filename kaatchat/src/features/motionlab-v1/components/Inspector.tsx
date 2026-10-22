import { useRef } from 'react';
import { selectionOf, useV1 } from '../store';
import { cubicBezier, resolveBase } from '../engine/interp';
import type { AnimatedProperty, Bezier, Easing, Gradient, Layer, MatteMode, RevealMode, V2 } from '../types';
import { wouldCycle } from '../engine/matrix';
import { isAudioLayer } from '../engine/bbox';
import type { AlignEdge } from '../engine/guides';

type AnimPath =
  | 'position' | 'scale' | 'rotation' | 'anchor' | 'opacity'
  | 'size' | 'cornerRadius' | 'fontSize' | 'reveal'
  | 'brightness' | 'contrast' | 'saturation' | 'blur' | 'vignette' | 'grain' | 'tintAmount' | 'shadow' | 'glow';

/* Align-to-frame buttons: a frame edge/centre line + the box that snaps to it. */
const ALIGN: Array<{ edge: AlignEdge; title: string; icon: React.ReactNode }> = [
  { edge: 'left', title: 'Align left', icon: <><line x1="2" y1="1" x2="2" y2="15" /><rect x="4" y="4" width="9" height="8" /></> },
  { edge: 'hcenter', title: 'Align horizontal centres', icon: <><line x1="8" y1="1" x2="8" y2="15" /><rect x="3.5" y="4" width="9" height="8" /></> },
  { edge: 'right', title: 'Align right', icon: <><line x1="14" y1="1" x2="14" y2="15" /><rect x="3" y="4" width="9" height="8" /></> },
  { edge: 'top', title: 'Align top', icon: <><line x1="1" y1="2" x2="15" y2="2" /><rect x="4" y="4" width="8" height="9" /></> },
  { edge: 'vcenter', title: 'Align vertical centres', icon: <><line x1="1" y1="8" x2="15" y2="8" /><rect x="4" y="3.5" width="8" height="9" /></> },
  { edge: 'bottom', title: 'Align bottom', icon: <><line x1="1" y1="14" x2="15" y2="14" /><rect x="4" y="3" width="8" height="9" /></> },
];

const SPEEDS = [0.25, 0.5, 1, 2, 4];

const EFFECT_PATHS: AnimPath[] = ['brightness', 'contrast', 'saturation', 'blur', 'vignette', 'grain', 'tintAmount', 'shadow', 'glow'];

export default function V1Inspector() {
  const project = useV1((s) => s.project);
  const selectedId = useV1((s) => s.selectedLayerId);
  const currentTime = useV1((s) => s.currentTime);
  const setPropertyBase = useV1((s) => s.setPropertyBase);
  const patchLayer = useV1((s) => s.patchLayer);
  const enableEffects = useV1((s) => s.enableEffects);
  const setEffectTintColor = useV1((s) => s.setEffectTintColor);
  const setClipSpeed = useV1((s) => s.setClipSpeed);
  const setFreeze = useV1((s) => s.setFreeze);
  const freezeFrameAt = useV1((s) => s.freezeFrameAt);

  const layer = project.layers.find((l) => l.id === selectedId);
  const selCount = useV1((s) => selectionOf(s).length);

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

  const resolve = <T,>(ap: AnimatedProperty<T> | undefined) => (ap ? resolveBase(ap, currentTime) : undefined);
  const audio = isAudioLayer(layer, project.assets);
  // Align / distribute (shared by the Transform section and, for a
  // multi-selection whose primary layer is audio, under the audio note).
  const alignBlock = (
    <>
    {/* Align: one layer → to the frame; several → to each other (Figma).
        Works for rotated / parented layers. */}
    <div className="v1-align-row" role="group" aria-label={selCount > 1 ? 'Align selection' : 'Align to frame'}>
      <span>{selCount > 1 ? `Align ${selCount}` : 'Align'}</span>
      <div className="v1-align-btns">
        {ALIGN.map((a) => (
          <button key={a.edge} type="button" className="v1-align-btn" title={a.title} aria-label={a.title}
            onClick={() => useV1.getState().alignSelected(a.edge)}>
            <svg viewBox="0 0 16 16" aria-hidden>{a.icon}</svg>
          </button>
        ))}
      </div>
    </div>
    {selCount > 2 && (
      <div className="v1-align-row" role="group" aria-label="Distribute selection">
        <span>Distribute</span>
        <div className="v1-align-btns">
          <button type="button" className="v1-align-btn" title="Distribute horizontally" aria-label="Distribute horizontally"
            onClick={() => useV1.getState().distributeSelected('x')}>
            <svg viewBox="0 0 16 16" aria-hidden><rect x="1" y="5" width="3" height="6" /><rect x="6.5" y="5" width="3" height="6" /><rect x="12" y="5" width="3" height="6" /></svg>
          </button>
          <button type="button" className="v1-align-btn" title="Distribute vertically" aria-label="Distribute vertically"
            onClick={() => useV1.getState().distributeSelected('y')}>
            <svg viewBox="0 0 16 16" aria-hidden><rect x="5" y="1" width="6" height="3" /><rect x="5" y="6.5" width="6" height="3" /><rect x="5" y="12" width="6" height="3" /></svg>
          </button>
        </div>
      </div>
    )}
    </>
  );
  return (
    <div className="v1-inspector">
      {selCount > 1 && (
        <div className="v1-multi-note" role="status">
          {selCount} layers selected — moving, aligning, deleting and duplicating apply to all; the fields below edit “{layer.name}”.
        </div>
      )}
      <div className="v1-inspector-header">
        <input
          className="v1-layer-name-input"
          value={layer.name}
          onChange={(e) => patchLayer(layer.id, { name: e.target.value })}
        />
        <div className="v1-layer-type">{layer.type}</div>
      </div>

      {audio ? (
        <>
          <div className="v1-audio-note">Audio layer — sound only, nothing on the canvas. Use the Audio section to set volume and fades; trim and move it on the timeline.</div>
          {selCount > 1 && <section className="v1-section">{alignBlock}</section>}
        </>
      ) : (
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

        {/* Track matte: show this layer only through (or outside) another layer. */}
        <label className="v1-parent-row">
          <span>Matte</span>
          <select
            className="v1-parent-select v1-matte-select"
            aria-label="Track matte"
            value={layer.matte ? `${layer.matte.mode}:${layer.matte.layerId}` : ''}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) { useV1.getState().setMatte(layer.id, null); return; }
              const i = v.indexOf(':');
              useV1.getState().setMatte(layer.id, { mode: v.slice(0, i) as MatteMode, layerId: v.slice(i + 1) });
            }}
          >
            <option value="">None</option>
            {project.layers.filter((l) => l.id !== layer.id && l.type !== 'null').map((l) => (
              <option key={`a-${l.id}`} value={`alpha:${l.id}`}>Alpha · {l.name}</option>
            ))}
            {project.layers.filter((l) => l.id !== layer.id && l.type !== 'null').map((l) => (
              <option key={`i-${l.id}`} value={`alpha-inverted:${l.id}`}>Inverted · {l.name}</option>
            ))}
          </select>
        </label>

        {alignBlock}

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
      )}

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
          <FillField layer={layer} />
          <StrokeField layer={layer} />
        </section>
      )}

      {layer.type !== 'null' && !audio && (
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
                  label={p === 'tintAmount' ? 'Tint' : p === 'shadow' ? 'Drop shadow' : p[0].toUpperCase() + p.slice(1)}
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
              <div className="v1-prop">
                <div className="v1-prop-head"><span className="v1-prop-label">Shadow / glow colour</span></div>
                <div className="v1-color-pair">
                  <input type="color" className="color-input" aria-label="Shadow colour" value={layer.effects.shadowColor ?? '#000000'}
                    onChange={(e) => patchLayer(layer.id, { effects: { ...layer.effects!, shadowColor: e.target.value } })} />
                  <input type="color" className="color-input" aria-label="Glow colour" value={layer.effects.glowColor ?? '#ffffff'}
                    onChange={(e) => patchLayer(layer.id, { effects: { ...layer.effects!, glowColor: e.target.value } })} />
                </div>
              </div>
            </>
          ) : (
            <div className="v1-inspector-empty" style={{ padding: 8, fontSize: 11.5 }}>
              Neutral. Click + Enable to add brightness, contrast, saturation, blur, vignette, grain, tint, drop shadow and glow — all keyframable.
            </div>
          )}
        </section>
      )}

      {layer.type === 'media' && (
        <section className="v1-section" aria-label="Time">
          <div className="v1-section-head">Time</div>
          <div className="v1-prop">
            <div className="v1-prop-head"><span className="v1-prop-label">Speed</span></div>
            <div className="v1-speed-row">
              {SPEEDS.map((v) => (
                <button key={v} type="button" className={`v1-chip${(layer.speed ?? 1) === v ? ' on' : ''}`}
                  aria-pressed={(layer.speed ?? 1) === v} onClick={() => setClipSpeed(layer.id, v)}>{v}×</button>
              ))}
              <NumberField value={layer.speed ?? 1} onChange={(v) => setClipSpeed(layer.id, v)} step={0.05} suffix="×" />
            </div>
          </div>
          {!audio && (
            <div className="v1-speed-row">
              <button type="button" className={`v1-chip${layer.freeze ? ' on' : ''}`} aria-pressed={!!layer.freeze}
                onClick={() => setFreeze(layer.id, !layer.freeze)} title="Hold this clip's first frame (silent)">
                {layer.freeze ? 'Frozen' : 'Freeze clip'}
              </button>
              <button type="button" className="v1-chip"
                disabled={currentTime <= layer.startTime + 0.02 || currentTime >= layer.startTime + layer.duration - 0.02}
                onClick={() => freezeFrameAt(layer.id, currentTime)} title="Split here and hold this frame for the rest of the clip">
                Freeze frame at playhead
              </button>
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
          {/* Text animator: reveal by character / letter fade / word, keyframable. */}
          <div className="v1-prop">
            <div className="v1-prop-head"><span className="v1-prop-label">Animator</span></div>
            <select
              className="select-full v1-animator-select"
              aria-label="Text animator"
              value={layer.revealMode ?? ''}
              onChange={(e) => useV1.getState().setTextAnimator(layer.id, (e.target.value || null) as RevealMode | null)}
            >
              <option value="">None</option>
              <option value="typewriter">Typewriter</option>
              <option value="letters">Letters fade in</option>
              <option value="words">Words fade in</option>
            </select>
          </div>
          {layer.revealMode && (
            <PropRow layer={layer} currentTime={currentTime} label="Reveal" path="reveal">
              <div className="v1-slider-row">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  aria-label="Reveal amount"
                  value={resolve(layer.reveal ?? { default: 1 }) as number}
                  onChange={(e) => setPropertyBase<number>(layer.id, 'reveal', Number(e.target.value))}
                />
                <span className="v1-slider-value">{Math.round((resolve(layer.reveal ?? { default: 1 }) as number) * 100)}%</span>
              </div>
            </PropRow>
          )}
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
            <div className="v1-prop-head"><span className="v1-prop-label">Font</span></div>
            <select
              className="select-full"
              aria-label="Font family"
              value={FONTS.some((f) => f.css === layer.fontFamily) ? layer.fontFamily : FONTS[0].css}
              onChange={(e) => patchLayer(layer.id, { fontFamily: e.target.value })}
            >
              {FONTS.map((f) => <option key={f.css} value={f.css}>{f.label}</option>)}
            </select>
          </div>
          <div className="v1-prop v1-prop-pair">
            <label>
              <span className="v1-prop-label">Letter spacing</span>
              <NumberField value={layer.letterSpacing} onChange={(v) => patchLayer(layer.id, { letterSpacing: Math.max(-20, Math.min(200, v)) })} step={1} suffix="px" />
            </label>
            <label>
              <span className="v1-prop-label">Line height</span>
              <NumberField value={layer.lineHeight} onChange={(v) => patchLayer(layer.id, { lineHeight: Math.max(0.5, Math.min(4, v)) })} step={0.05} suffix="×" />
            </label>
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
          <FillField layer={layer} />
          <StrokeField layer={layer} />
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
    case 'reveal':
      if (layer.type === 'text') return (layer.reveal ?? undefined) as unknown as AnimatedProperty<unknown>;
      return;
    case 'brightness':
    case 'contrast':
    case 'saturation':
    case 'blur':
    case 'vignette':
    case 'grain':
    case 'tintAmount':
    case 'shadow':
    case 'glow':
      if (!layer.effects) return;
      return (layer.effects as unknown as Record<string, AnimatedProperty<unknown>>)[path];
  }
}

/* ───── small controls ───── */

/* System font stacks that exist everywhere (works offline, no downloads). */
const FONTS: Array<{ label: string; css: string }> = [
  { label: 'Sans (Inter / system)', css: 'Inter, -apple-system, system-ui, sans-serif' },
  { label: 'Rounded', css: 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif' },
  { label: 'Serif', css: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', css: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
  { label: 'Condensed', css: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", sans-serif' },
  { label: 'Display (heavy)', css: 'Impact, "Arial Black", "Helvetica Neue", sans-serif' },
];

/** Outline: off, or a colour + width (shapes and text). */
function StrokeField({ layer }: { layer: Layer & { stroke: string | null; strokeWidth: number } }) {
  const patch = (p: Partial<{ stroke: string | null; strokeWidth: number }>) => useV1.getState().patchLayer(layer.id, p as Partial<Layer>);
  const on = !!layer.stroke && layer.strokeWidth > 0;
  return (
    <div className="v1-prop">
      <div className="v1-prop-head">
        <span className="v1-prop-label">Stroke</span>
        <div className="v1-seg" role="group" aria-label="Stroke">
          <button type="button" className={!on ? 'on' : ''} aria-pressed={!on} onClick={() => patch({ stroke: null })}>Off</button>
          <button type="button" className={on ? 'on' : ''} aria-pressed={on}
            onClick={() => !on && patch({ stroke: layer.stroke ?? '#000000', strokeWidth: layer.strokeWidth > 0 ? layer.strokeWidth : 4 })}>On</button>
        </div>
      </div>
      {on && (
        <div className="v1-grad">
          <input type="color" className="color-input" aria-label="Stroke colour" value={layer.stroke!} onChange={(e) => patch({ stroke: e.target.value })} />
          <NumberField value={layer.strokeWidth} onChange={(v) => patch({ strokeWidth: Math.max(0, Math.min(200, v)) })} step={1} suffix="px" />
        </div>
      )}
    </div>
  );
}

/** Fill: solid colour (as before) or a two-colour linear gradient + angle. */
function FillField({ layer }: { layer: Layer & { fill: string; gradient?: Gradient } }) {
  const patch = (p: Partial<{ fill: string; gradient: Gradient | undefined }>) => useV1.getState().patchLayer(layer.id, p as Partial<Layer>);
  const g = layer.gradient;
  return (
    <div className="v1-prop">
      <div className="v1-prop-head">
        <span className="v1-prop-label">Fill</span>
        <div className="v1-seg" role="group" aria-label="Fill type">
          <button type="button" className={!g ? 'on' : ''} aria-pressed={!g} onClick={() => patch({ gradient: undefined })}>Solid</button>
          <button type="button" className={g ? 'on' : ''} aria-pressed={!!g}
            onClick={() => !g && patch({ gradient: { from: layer.fill, to: '#000000', angle: 90 } })}>Gradient</button>
        </div>
      </div>
      {!g ? (
        <input type="color" className="color-input" aria-label="Fill colour" value={layer.fill} onChange={(e) => patch({ fill: e.target.value })} />
      ) : (
        <div className="v1-grad">
          <span className="v1-grad-preview" style={{ background: `linear-gradient(${g.angle + 90}deg, ${g.from}, ${g.to})` }} aria-hidden />
          <input type="color" className="color-input" aria-label="Gradient start" value={g.from} onChange={(e) => patch({ gradient: { ...g, from: e.target.value } })} />
          <input type="color" className="color-input" aria-label="Gradient end" value={g.to} onChange={(e) => patch({ gradient: { ...g, to: e.target.value } })} />
          <div className="v1-field v1-grad-angle">
            <input type="number" aria-label="Gradient angle" value={g.angle} step={15}
              onChange={(e) => patch({ gradient: { ...g, angle: ((Number(e.target.value) || 0) % 360 + 360) % 360 } })} />
            <span className="v1-field-suffix">°</span>
          </div>
        </div>
      )}
    </div>
  );
}

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
  { value: 'hold', label: 'Hold (jump)' },
];
/* Named cubic-bezier curves (select value "curve:<name>"); "bezier" = custom. */
const CURVES: Array<{ name: string; label: string; bez: Bezier }> = [
  { name: 'overshoot', label: 'Overshoot', bez: [0.34, 1.56, 0.64, 1] },
  { name: 'snappy', label: 'Snappy', bez: [0.2, 0.9, 0.1, 1] },
  { name: 'gentle', label: 'Gentle', bez: [0.45, 0.05, 0.55, 0.95] },
  { name: 'anticipate', label: 'Anticipate', bez: [0.6, -0.28, 0.74, 0.05] },
];
const sameBez = (a?: Bezier, b?: Bezier) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) < 1e-3);

/* Small graph editor for a keyframe's cubic-bezier: drag the two handles.
 * x is time (0..1), y is progress (may overshoot −0.5..1.5 for bouncy moves). */
function CurveEditor({ bez, onChange }: { bez: Bezier; onChange: (b: Bezier) => void }) {
  const W = 168, H = 120, P = 14;
  const yLo = -0.5, yHi = 1.5;
  const sx = (x: number) => P + x * (W - 2 * P);
  const sy = (y: number) => H - P - ((y - yLo) / (yHi - yLo)) * (H - 2 * P);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = (which: 0 | 1) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = svgRef.current!.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, ((ev.clientX - r.left) * (W / r.width) - P) / (W - 2 * P)));
      const y = Math.max(yLo, Math.min(yHi, yLo + ((H - P - (ev.clientY - r.top) * (H / r.height)) / (H - 2 * P)) * (yHi - yLo)));
      const r2 = (v: number) => Math.round(v * 100) / 100;
      const next: Bezier = which === 0 ? [r2(x), r2(y), bez[2], bez[3]] : [bez[0], bez[1], r2(x), r2(y)];
      onChange(next);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const pts = Array.from({ length: 41 }, (_, i) => {
    const t = i / 40;
    return `${sx(t)},${sy(cubicBezier(t, bez))}`;
  }).join(' ');
  return (
    <div className="v1-curve">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="v1-curve-svg" aria-label="Easing curve">
        <line className="v1-curve-guide" x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(0)} />
        <line className="v1-curve-guide" x1={sx(0)} y1={sy(1)} x2={sx(1)} y2={sy(1)} />
        <line className="v1-curve-stem" x1={sx(0)} y1={sy(0)} x2={sx(bez[0])} y2={sy(bez[1])} />
        <line className="v1-curve-stem" x1={sx(1)} y1={sy(1)} x2={sx(bez[2])} y2={sy(bez[3])} />
        <polyline className="v1-curve-line" points={pts} />
        <circle className="v1-curve-handle h1" cx={sx(bez[0])} cy={sy(bez[1])} r={5} onPointerDown={drag(0)} />
        <circle className="v1-curve-handle h2" cx={sx(bez[2])} cy={sy(bez[3])} r={5} onPointerDown={drag(1)} />
      </svg>
      <code className="v1-curve-code">cubic-bezier({bez.join(', ')})</code>
    </div>
  );
}

/* Wiggle starting strengths per property (property units: px, °, 0–1). */
const WIGGLE_DEFAULT: Partial<Record<string, number>> = { position: 20, rotation: 8, scale: 0.05, opacity: 0.2, anchor: 10, fontSize: 4 };
const PCT_PATHS = new Set<string>(['scale', 'opacity']);

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
  const setWiggle = useV1((s) => s.setWiggle);
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
            value={
              atNow.easing === 'bezier'
                ? (CURVES.find((c) => sameBez(c.bez, atNow.bezier)) ? `curve:${CURVES.find((c) => sameBez(c.bez, atNow.bezier))!.name}` : 'bezier')
                : (atNow.easing ?? 'ease-in-out')
            }
            onChange={(e) => {
              const v = e.target.value;
              const named = v.startsWith('curve:') ? CURVES.find((c) => `curve:${c.name}` === v) : undefined;
              if (named) setKeyframeEasing(layer.id, path, atNow.time, 'bezier', named.bez);
              else setKeyframeEasing(layer.id, path, atNow.time, v as Easing);
            }}
            title="Easing into this keyframe"
          >
            {EASINGS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
            {CURVES.map((c) => (
              <option key={c.name} value={`curve:${c.name}`}>{c.label}</option>
            ))}
            <option value="bezier">Custom curve…</option>
          </select>
        )}
        <button
          type="button"
          className={`v1-wiggle-btn${ap?.wiggle ? ' on' : ''}`}
          aria-pressed={!!ap?.wiggle}
          onClick={() => setWiggle(layer.id, path, ap?.wiggle ? null : { amount: WIGGLE_DEFAULT[path] ?? 5, freq: 2 })}
          title={ap?.wiggle ? 'Remove wiggle' : 'Wiggle: smooth random motion on top of this value'}
        >∿</button>
        <button
          type="button"
          className={`v1-diamond v1-diamond-${state}`}
          onClick={() => toggleKeyframe(layer.id, path)}
          title={state === 'on' ? 'Remove keyframe at playhead' : 'Add keyframe at playhead'}
        >◆</button>
      </div>
      {atNow && kfs[0] !== atNow && atNow.easing === 'bezier' && (
        <CurveEditor
          bez={atNow.bezier ?? [0.42, 0, 0.58, 1]}
          onChange={(b) => setKeyframeEasing(layer.id, path, atNow.time, 'bezier', b)}
        />
      )}
      {ap?.wiggle && (
        <div className="v1-wiggle-row">
          <label>
            Wiggle ±
            <input type="number" aria-label={`${label} wiggle amount`} min={0} step={PCT_PATHS.has(path) ? 1 : 0.5}
              value={+(ap.wiggle.amount * (PCT_PATHS.has(path) ? 100 : 1)).toFixed(2)}
              onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setWiggle(layer.id, path, { ...ap.wiggle!, amount: PCT_PATHS.has(path) ? v / 100 : v }); }} />
            {PCT_PATHS.has(path) ? '%' : path === 'rotation' ? '°' : 'px'}
          </label>
          <label>
            <input type="number" aria-label={`${label} wiggle speed`} min={0.1} max={30} step={0.5}
              value={ap.wiggle.freq}
              onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) setWiggle(layer.id, path, { ...ap.wiggle!, freq: v }); }} />
            ×/s
          </label>
        </div>
      )}
      <div className="v1-prop-body">{children}</div>
    </div>
  );
}
