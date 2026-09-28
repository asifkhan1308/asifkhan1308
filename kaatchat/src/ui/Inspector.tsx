import { useState } from 'react';
import type { EditorSession } from '../app/session';
import { rangeLevelDb } from '../engine/dsp';
import { clipLength } from '../engine/timeline';
import { Icon, fmtTime, toast } from './bits';
import type { AudioClip, Clip } from '../engine/types';

export function Inspector({ session, clipId }: { session: EditorSession; clipId: string | null; time: number }) {
  const { store } = session;
  const doc = store.doc;
  const idx = doc.clips.findIndex((c) => c.id === clipId);
  const clip = idx >= 0 ? doc.clips[idx] : null;
  const [gain, setGain] = useState<number | null>(null);

  const music = doc.audio.find((a) => a.id === clipId);
  if (music) return <MusicInspector session={session} id={music.id} />;
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
