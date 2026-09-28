import { useState } from 'react';
import type { EditorSession } from '../app/session';
import { rangeLevelDb } from '../engine/dsp';
import { clipLength } from '../engine/timeline';
import { Icon, fmtTime } from './bits';

export function Inspector({ session, clipId }: { session: EditorSession; clipId: string | null; time: number }) {
  const { store } = session;
  const doc = store.doc;
  const idx = doc.clips.findIndex((c) => c.id === clipId);
  const clip = idx >= 0 ? doc.clips[idx] : null;
  const [gain, setGain] = useState<number | null>(null);

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
