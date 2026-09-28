import { useState } from 'react';
import type { EditorSession } from '../app/session';
import { rangeLevelDb } from '../engine/dsp';
import { clipLength } from '../engine/timeline';
import { Icon, fmtTime, toast } from './bits';
import type { AudioClip, Clip, Easing, Effects, Overlay, OverlayAnimation, TransitionKind } from '../engine/types';
import type { Command } from '../engine/commands/schema';
import { LOOKS, TRANSITIONS, effectsOf, isNeutral, keyedState, OVERLAY_FONTS, type Animatable } from '../engine/motion';

export function Inspector({ session, clipId, time }: { session: EditorSession; clipId: string | null; time: number }) {
  const { store } = session;
  const doc = store.doc;
  const idx = doc.clips.findIndex((c) => c.id === clipId);
  const clip = idx >= 0 ? doc.clips[idx] : null;
  const [gain, setGain] = useState<number | null>(null);

  const music = doc.audio.find((a) => a.id === clipId);
  if (music) return <MusicInspector session={session} id={music.id} />;
  const overlay = doc.overlays.find((o) => o.id === clipId);
  if (overlay) return <OverlayInspector session={session} id={overlay.id} time={time} />;
  if (!clip) return <p className="muted small">Select a clip on the timeline to adjust its trim, level and framing.</p>;
  const asset = doc.assets[clip.assetId];
  const index = store.index[clip.assetId];
  const level = index?.audio ? rangeLevelDb(index.audio, clip.in, clip.out) : null;
  const thumb = index?.thumbs?.find((t) => t.t >= clip.in)?.url ?? index?.thumbs?.[0]?.url;

  const setFocus = (x: number, y: number) =>
    store.mutate('Adjust framing', (d) => ({ ...d, clips: d.clips.map((c) => (c.id === clip.id ? { ...c, fit: 'fill', focusX: x, focusY: y } : c)) }));

  return (
    <div className="inspector">
      <h3 className="ellipsis" title={asset?.name}>
        {asset?.name ?? 'Missing media'}
      </h3>
      <span className="faint small mono">
        Clip {idx + 1} of {doc.clips.length} · {fmtTime(clipLength(clip), true, doc.fps)}
      </span>

      <div className="row">
        <label className="field grow">
          In (source s)
          <input
            className="input mono"
            type="number"
            step={0.01}
            min={0}
            defaultValue={clip.in.toFixed(2)}
            key={`in-${clip.id}-${clip.in}`}
            onBlur={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v) && Math.abs(v - clip.in) > 0.001) store.run([{ type: 'trim_clip', clipId: clip.id, in: Math.max(0, v) }], 'Trim in');
            }}
          />
        </label>
        <label className="field grow">
          Out (source s)
          <input
            className="input mono"
            type="number"
            step={0.01}
            min={0}
            defaultValue={clip.out.toFixed(2)}
            key={`out-${clip.id}-${clip.out}`}
            onBlur={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v) && Math.abs(v - clip.out) > 0.001) store.run([{ type: 'trim_clip', clipId: clip.id, out: Math.max(0, v) }], 'Trim out');
            }}
          />
        </label>
      </div>

      {asset?.hasAudio && (
        <label className="field">
          <span className="row">
            <span className="grow">Clip gain</span>
            <span className="mono">{(gain ?? clip.gainDb).toFixed(1)} dB</span>
          </span>
          <input
            className="range"
            type="range"
            min={-24}
            max={24}
            step={0.5}
            value={gain ?? clip.gainDb}
            onChange={(e) => setGain(+e.target.value)}
            onPointerUp={() => {
              if (gain !== null && gain !== clip.gainDb) store.run([{ type: 'set_clip_gain', clipId: clip.id, gainDb: gain }], 'Clip gain');
              setGain(null);
            }}
            onKeyUp={() => {
              if (gain !== null && gain !== clip.gainDb) store.run([{ type: 'set_clip_gain', clipId: clip.id, gainDb: gain }], 'Clip gain');
              setGain(null);
            }}
          />
          <span className="faint tiny">{level !== null ? `Measured level ${level.toFixed(1)} dBFS (loudest 40% of frames)` : 'Level not measured yet'}</span>
        </label>
      )}

      {asset?.hasAudio && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Num label="Fade in (s)" value={clip.fadeIn ?? 0} max={5} onCommit={(v) => patchClip(store, clip.id, { fadeIn: v }, 'Fade in')} />
          <Num label="Fade out (s)" value={clip.fadeOut ?? 0} max={5} onCommit={(v) => patchClip(store, clip.id, { fadeOut: v }, 'Fade out')} />
          <label className="row small" style={{ alignSelf: 'flex-end', height: 32 }}>
            <input type="checkbox" className="check" checked={!!clip.muted} onChange={(e) => patchClip(store, clip.id, { muted: e.target.checked }, e.target.checked ? 'Mute clip' : 'Unmute clip')} />
            Mute
          </label>
        </div>
      )}

      <div className="field">
        <span className="row">
          <span className="grow muted small">Framing in {doc.aspect}</span>
          <button className="btn sm" aria-pressed={clip.fit === 'fill'} onClick={() => store.mutate('Fill frame', (d) => ({ ...d, clips: d.clips.map((c) => (c.id === clip.id ? { ...c, fit: 'fill' } : c)) }))}>
            Fill
          </button>
          <button className="btn sm" aria-pressed={clip.fit === 'fit'} onClick={() => store.mutate('Fit frame', (d) => ({ ...d, clips: d.clips.map((c) => (c.id === clip.id ? { ...c, fit: 'fit' } : c)) }))}>
            Fit
          </button>
        </span>
        <div
          className="focuspad"
          style={{ backgroundImage: thumb ? `url(${thumb})` : undefined, aspectRatio: asset ? `${asset.width} / ${asset.height}` : undefined }}
          role="slider"
          aria-label="Crop focus point"
          aria-valuetext={`x ${Math.round(clip.focusX * 100)}%, y ${Math.round(clip.focusY * 100)}%`}
          tabIndex={0}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setFocus(Math.round(((e.clientX - r.left) / r.width) * 1000) / 1000, Math.round(((e.clientY - r.top) / r.height) * 1000) / 1000);
          }}
          onKeyDown={(e) => {
            const d = e.shiftKey ? 0.1 : 0.02;
            const k: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] };
            if (!k[e.key]) return;
            e.preventDefault();
            const clamp = (v: number) => Math.min(1, Math.max(0, Math.round(v * 1000) / 1000));
            setFocus(clamp(clip.focusX + k[e.key][0]), clamp(clip.focusY + k[e.key][1]));
          }}
        >
          <i style={{ left: `${clip.focusX * 100}%`, top: `${clip.focusY * 100}%` }} />
        </div>
        <span className="faint tiny">Click to choose what stays in view when the frame is cropped.</span>
      </div>

      <ClipLook session={session} clipId={clip.id} index={idx} />

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn sm" disabled={idx === 0} onClick={() => store.run([{ type: 'move_clip', clipId: clip.id, toIndex: idx - 1 }], 'Move clip')}>
          <Icon name="left" size={13} /> Earlier
        </button>
        <button className="btn sm" disabled={idx === doc.clips.length - 1} onClick={() => store.run([{ type: 'move_clip', clipId: clip.id, toIndex: idx + 1 }], 'Move clip')}>
          Later <Icon name="right" size={13} />
        </button>
        <span className="spacer" />
        <button className="btn sm danger" onClick={() => store.run([{ type: 'delete_clip', clipId: clip.id }], 'Delete clip')}>
          <Icon name="trash" size={13} /> Delete
        </button>
      </div>
    </div>
  );
}

type Store = EditorSession['store'];

function patchClip(store: Store, id: string, patch: Partial<Clip>, label: string) {
  store.mutate(label, (d) => ({ ...d, clips: d.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
}

function Num({ label, value, min = 0, max, step = 0.05, onCommit }: { label: string; value: number; min?: number; max: number; step?: number; onCommit(v: number): void }) {
  return (
    <label className="field" style={{ width: 96 }}>
      {label}
      <input
        className="input mono"
        type="number"
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        key={value}
        onBlur={(e) => {
          const v = Math.max(min, Math.min(max, parseFloat(e.target.value)));
          if (Number.isFinite(v) && v !== value) onCommit(Math.round(v * 100) / 100);
        }}
      />
    </label>
  );
}

function MusicInspector({ session, id }: { session: EditorSession; id: string }) {
  const { store } = session;
  const doc = store.doc;
  const a = doc.audio.find((x) => x.id === id);
  if (!a) return null;
  const asset = doc.assets[a.assetId];
  const beats = store.index[a.assetId]?.beats;
  const patch = (p: Partial<AudioClip>, label: string) => store.mutate(label, (d) => ({ ...d, audio: d.audio.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  return (
    <div className="inspector">
      <h3 className="ellipsis">♪ {asset?.name ?? 'Missing music'}</h3>
      <span className="faint small mono">
        {fmtTime(a.out - a.in)} · starts at {fmtTime(a.start)}
        {beats ? ` · ${beats.bpm} bpm (confidence ${Math.round(beats.confidence * 100)}%)` : ' · no steady beat detected'}
      </span>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <Num label="Start (s)" value={a.start} max={36000} step={0.1} onCommit={(v) => patch({ start: v }, 'Move music')} />
        <Num label="In (s)" value={a.in} max={Math.max(0, a.out - 0.5)} step={0.1} onCommit={(v) => patch({ in: v }, 'Trim music')} />
        <Num label="Out (s)" value={a.out} min={a.in + 0.5} max={asset?.duration ?? a.out} step={0.1} onCommit={(v) => patch({ out: v }, 'Trim music')} />
      </div>
      <Num label="Gain (dB)" value={a.gainDb} min={-40} max={12} step={0.5} onCommit={(v) => patch({ gainDb: v }, 'Music gain')} />
      <div className="row">
        <Num label="Fade in (s)" value={a.fadeIn} max={10} onCommit={(v) => patch({ fadeIn: v }, 'Music fade in')} />
        <Num label="Fade out (s)" value={a.fadeOut} max={10} onCommit={(v) => patch({ fadeOut: v }, 'Music fade out')} />
      </div>
      <label className="row small">
        <input type="checkbox" className="check" checked={a.duck} onChange={(e) => patch({ duck: e.target.checked }, e.target.checked ? 'Duck music' : 'No ducking')} />
        Duck under speech ({doc.mix.duckDb} dB, measured from the main track)
      </label>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button
          className="btn sm"
          disabled={!beats}
          title={beats ? 'Nudge cuts onto the beat (±0.25 s)' : 'No beat detected in this music'}
          onClick={() => {
            try {
              const notes = store.run([{ type: 'sync_to_beat', window: 0.25 }], 'Sync to beat');
              toast(notes.join(' · '));
            } catch (e) {
              toast(e instanceof Error ? e.message : String(e), 'err');
            }
          }}
        >
          Sync cuts to beat
        </button>
        <span className="spacer" />
        <button className="btn sm danger" onClick={() => store.mutate('Remove music', (d) => ({ ...d, audio: d.audio.filter((x) => x.id !== id) }))}>
          <Icon name="trash" size={13} /> Remove
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- look, transition, punch-in

const EFFECT_SLIDERS: { key: keyof Effects; label: string; min: number; max: number; step: number }[] = [
  { key: 'exposure', label: 'Exposure', min: -2, max: 2, step: 0.05 },
  { key: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.02 },
  { key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.02 },
  { key: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.02 },
  { key: 'blur', label: 'Blur', min: 0, max: 1, step: 0.02 },
  { key: 'sharpen', label: 'Sharpen', min: 0, max: 1, step: 0.02 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.02 },
  { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.02 },
  { key: 'tintAmount', label: 'Tint', min: 0, max: 1, step: 0.02 },
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.02 },
];

function Slider({ label, value, min, max, step, onCommit, format }: { label: string; value: number; min: number; max: number; step: number; onCommit(v: number): void; format?: (v: number) => string }) {
  const [v, setV] = useState<number | null>(null);
  const shown = v ?? value;
  const commit = () => {
    if (v !== null && v !== value) onCommit(v);
    setV(null);
  };
  return (
    <label className="field slider">
      <span className="row">
        <span className="grow">{label}</span>
        <span className="mono">{format ? format(shown) : shown.toFixed(2)}</span>
      </span>
      <input className="range" type="range" min={min} max={max} step={step} value={shown} onChange={(e) => setV(+e.target.value)} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
    </label>
  );
}

function ClipLook({ session, clipId, index }: { session: EditorSession; clipId: string; index: number }) {
  const { store } = session;
  const clip = store.doc.clips.find((c) => c.id === clipId)!;
  const e = effectsOf(clip);
  const [open, setOpen] = useState(false);
  const setEffects = (patch: Partial<Effects>, label: string) => patchClip(store, clip.id, { effects: { ...(clip.effects ?? {}), ...patch } }, label);
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row">
        <label className="field grow">
          Look
          <select
            className="select"
            value=""
            onChange={(ev) => ev.target.value && store.run([{ type: 'set_look', look: ev.target.value as Extract<Command, { type: 'set_look' }>['look'], clipIds: [clip.id] }], `${LOOKS[ev.target.value].label} look`)}
          >
            <option value="">{isNeutral(e) ? 'None' : 'Custom'} — choose…</option>
            {Object.entries(LOOKS).map(([k, l]) => (
              <option key={k} value={k}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn sm" style={{ alignSelf: 'flex-end' }} aria-expanded={open} onClick={() => setOpen((x) => !x)}>
          Effects
        </button>
      </div>
      {open && (
        <div className="col" style={{ gap: 6 }}>
          {EFFECT_SLIDERS.map((f) => (
            <Slider key={f.key} label={f.label} value={e[f.key] as number} min={f.min} max={f.max} step={f.step} onCommit={(v) => setEffects({ [f.key]: v }, f.label)} />
          ))}
          <label className="row small">
            Tint colour
            <input type="color" value={e.tint} onChange={(ev) => setEffects({ tint: ev.target.value }, 'Tint colour')} aria-label="Tint colour" />
          </label>
          <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => patchClip(store, clip.id, { effects: undefined }, 'Reset effects')}>
            Reset effects
          </button>
        </div>
      )}
      <Slider label="Punch-in" value={clip.scale ?? 1} min={1} max={1.6} step={0.01} format={(v) => `${Math.round((v - 1) * 100)}%`} onCommit={(v) => patchClip(store, clip.id, { scale: v }, 'Punch-in')} />
      {index > 0 && (
        <div className="row">
          <label className="field grow">
            Transition in
            <select
              className="select"
              value={clip.transition?.kind ?? 'cut'}
              onChange={(ev) =>
                patchClip(store, clip.id, { transition: ev.target.value === 'cut' ? undefined : { kind: ev.target.value as TransitionKind, duration: clip.transition?.duration ?? 0.5 } }, 'Transition')
              }
            >
              <option value="cut">Cut</option>
              {Object.entries(TRANSITIONS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {clip.transition && (
            <Num label="Length (s)" value={clip.transition.duration} min={0.1} max={3} step={0.05} onCommit={(v) => patchClip(store, clip.id, { transition: { ...clip.transition!, duration: v } }, 'Transition length')} />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- overlays

const ANIMS: OverlayAnimation[] = ['none', 'fade', 'slide-up', 'slide-left', 'scale', 'pop', 'typewriter', 'blur', 'tracking', 'kinetic'];

function OverlayInspector({ session, id, time }: { session: EditorSession; id: string; time: number }) {
  const { store } = session;
  const o = store.doc.overlays.find((x) => x.id === id);
  if (!o) return null;
  const local = Math.round(Math.max(0, Math.min(o.duration, time - o.start)) * 100) / 100;
  const inRange = time >= o.start && time <= o.start + o.duration;
  const st = keyedState(o, local);
  const patch = (p: Partial<Overlay>, label: string) => store.mutate(label, (d) => ({ ...d, overlays: d.overlays.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  // With keyframes on a property, edits set a keyframe at the playhead; otherwise they change the base value.
  const setProp = (prop: Animatable, v: number) => {
    const animated = o.keyframes.some((k) => k[prop] !== undefined);
    if (!animated) return patch({ [prop]: v } as Partial<Overlay>, `Set ${prop}`);
    const keys = o.keyframes.slice();
    const at = keys.findIndex((k) => Math.abs(k.t - local) < 0.02);
    if (at >= 0) keys[at] = { ...keys[at], [prop]: v };
    else keys.push({ t: local, [prop]: v, easing: 'ease-in-out' });
    patch({ keyframes: keys.sort((a, b) => a.t - b.t) }, `Keyframe ${prop}`);
  };
  const addKey = () => {
    const keys = o.keyframes.filter((k) => Math.abs(k.t - local) >= 0.02);
    keys.push({ t: local, x: st.x, y: st.y, scale: st.scale, rotation: st.rotation, opacity: st.opacity, easing: 'ease-in-out' });
    patch({ keyframes: keys.sort((a, b) => a.t - b.t) }, 'Add keyframe');
  };
  return (
    <div className="inspector">
      <h3 className="ellipsis">{o.kind === 'text' ? 'Text' : o.kind === 'shape' ? 'Shape' : 'Image'} · {o.name}</h3>
      <div className="row">
        <Num label="Start (s)" value={o.start} max={36000} step={0.1} onCommit={(v) => patch({ start: v }, 'Move layer')} />
        <Num label="Length (s)" value={o.duration} min={0.3} max={3600} step={0.1} onCommit={(v) => patch({ duration: v }, 'Layer length')} />
      </div>

      {o.kind === 'text' && (
        <>
          <label className="field">
            Text
            <textarea className="textarea" rows={2} defaultValue={o.text} key={o.text} onBlur={(e) => e.target.value !== o.text && patch({ text: e.target.value, name: e.target.value.split('\n')[0].slice(0, 32) || 'Text' }, 'Edit text')} />
          </label>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label className="field">
              Font
              <select className="select" value={o.font ?? 'Inter'} onChange={(e) => patch({ font: e.target.value }, 'Font')}>
                {Object.keys(OVERLAY_FONTS).map((f) => (
                  <option key={f} value={f}>
                    {f === 'system-serif' ? 'Serif' : f === 'system-sans' ? 'System' : f}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Weight
              <select className="select" value={o.weight ?? 700} onChange={(e) => patch({ weight: +e.target.value }, 'Weight')}>
                {[400, 500, 600, 700, 800, 900].map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Align
              <select className="select" value={o.align ?? 'center'} onChange={(e) => patch({ align: e.target.value as Overlay['align'] }, 'Align')}>
                <option value="left">Left</option>
                <option value="center">Centre</option>
                <option value="right">Right</option>
              </select>
            </label>
          </div>
          <Slider label="Size" value={o.size ?? 0.06} min={0.02} max={0.25} step={0.005} onCommit={(v) => patch({ size: v }, 'Text size')} />
          <div className="row">
            <label className="row small">
              Colour <input type="color" value={o.color ?? '#ffffff'} onChange={(e) => patch({ color: e.target.value }, 'Text colour')} aria-label="Text colour" />
            </label>
            <label className="row small">
              <input type="checkbox" className="check" checked={!!o.background} onChange={(e) => patch({ background: e.target.checked ? '#111111' : null }, 'Background')} />
              Background
            </label>
            {o.background && <input type="color" value={o.background} onChange={(e) => patch({ background: e.target.value }, 'Background colour')} aria-label="Background colour" />}
          </div>
        </>
      )}
      {o.kind === 'shape' && (
        <>
          <div className="row">
            <label className="field">
              Shape
              <select className="select" value={o.shape ?? 'rect'} onChange={(e) => patch({ shape: e.target.value as 'rect' | 'ellipse' }, 'Shape')}>
                <option value="rect">Rectangle</option>
                <option value="ellipse">Ellipse</option>
              </select>
            </label>
            <label className="row small" style={{ alignSelf: 'flex-end', height: 32 }}>
              Fill <input type="color" value={o.fill ?? '#111111'} onChange={(e) => patch({ fill: e.target.value }, 'Fill')} aria-label="Fill colour" />
            </label>
          </div>
          <Slider label="Width" value={o.width ?? 0.3} min={0.02} max={1} step={0.01} onCommit={(v) => patch({ width: v }, 'Width')} />
          <Slider label="Height" value={o.height ?? 0.1} min={0.02} max={1} step={0.01} onCommit={(v) => patch({ height: v }, 'Height')} />
          <Slider label="Corner radius" value={o.radius ?? 0} min={0} max={0.5} step={0.01} onCommit={(v) => patch({ radius: v }, 'Radius')} />
        </>
      )}
      {o.kind === 'image' && <Slider label="Width" value={o.width ?? 0.2} min={0.03} max={1} step={0.01} onCommit={(v) => patch({ width: v }, 'Width')} />}

      <div className="divider" />
      <span className="muted small">{inRange ? `Values at ${local.toFixed(2)}s into the layer` : 'Move the playhead over this layer to edit keyframes'}</span>
      <Slider label="X" value={st.x} min={0} max={1} step={0.005} onCommit={(v) => setProp('x', v)} />
      <Slider label="Y" value={st.y} min={0} max={1} step={0.005} onCommit={(v) => setProp('y', v)} />
      <Slider label="Scale" value={st.scale} min={0.1} max={4} step={0.01} onCommit={(v) => setProp('scale', v)} />
      <Slider label="Rotation" value={st.rotation} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} onCommit={(v) => setProp('rotation', v)} />
      <Slider label="Opacity" value={st.opacity} min={0} max={1} step={0.01} onCommit={(v) => setProp('opacity', v)} />
      <div className="row">
        <button className="btn sm" disabled={!inRange} onClick={addKey}>
          ◆ Keyframe here
        </button>
        {o.keyframes.length > 0 && (
          <button className="btn sm ghost" onClick={() => patch({ keyframes: [] }, 'Clear keyframes')}>
            Clear keyframes
          </button>
        )}
      </div>
      {o.keyframes.map((k, i) => (
        <div className="row small" key={i}>
          <span className="mono">◆ {k.t.toFixed(2)}s</span>
          <select
            className="select grow"
            value={k.easing ?? 'ease-in-out'}
            aria-label="Easing"
            onChange={(e) => patch({ keyframes: o.keyframes.map((x, j) => (j === i ? { ...x, easing: e.target.value as Easing } : x)) }, 'Easing')}
          >
            {(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'back-out', 'elastic-out'] as Easing[]).map((ez) => (
              <option key={ez} value={ez}>
                {ez}
              </option>
            ))}
          </select>
          <button className="btn ghost sm icon" aria-label="Delete keyframe" onClick={() => patch({ keyframes: o.keyframes.filter((_, j) => j !== i) }, 'Delete keyframe')}>
            <Icon name="x" size={12} />
          </button>
        </div>
      ))}

      <div className="divider" />
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <label className="field">
          In
          <select className="select" value={o.animIn} onChange={(e) => patch({ animIn: e.target.value as OverlayAnimation }, 'Animation in')}>
            {ANIMS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Out
          <select className="select" value={o.animOut} onChange={(e) => patch({ animOut: e.target.value as OverlayAnimation }, 'Animation out')}>
            {ANIMS.filter((a) => a !== 'typewriter' && a !== 'kinetic').map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <Num label="Anim (s)" value={o.animDuration} min={0.05} max={3} step={0.05} onCommit={(v) => patch({ animDuration: v }, 'Animation length')} />
      </div>
      <div className="row">
        <label className="field">
          Mask
          <select className="select" value={o.mask?.from ?? 'none'} onChange={(e) => patch({ mask: e.target.value === 'none' ? null : { from: e.target.value as 'left', amount: o.mask?.amount ?? 0.6 } }, 'Mask')}>
            <option value="none">None</option>
            <option value="left">Reveal from left</option>
            <option value="right">Reveal from right</option>
            <option value="top">Reveal from top</option>
            <option value="bottom">Reveal from bottom</option>
          </select>
        </label>
        {o.mask && <Slider label="Amount" value={o.mask.amount} min={0} max={1} step={0.01} onCommit={(v) => patch({ mask: { ...o.mask!, amount: v } }, 'Mask amount')} />}
      </div>
      <button className="btn sm danger" style={{ alignSelf: 'flex-start' }} onClick={() => store.mutate('Delete layer', (d) => ({ ...d, overlays: d.overlays.filter((x) => x.id !== id) }))}>
        <Icon name="trash" size={13} /> Delete layer
      </button>
    </div>
  );
}
