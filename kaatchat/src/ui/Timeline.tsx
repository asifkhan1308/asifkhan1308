import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EditorSession } from '../app/session';
import { useStoreVersion } from '../app/hooks';
import { clipLength, clipStarts, sequenceDuration } from '../engine/timeline';
import type { AudioAnalysis, Clip } from '../engine/types';
import { Icon, fmtTime } from './bits';

interface Props {
  session: EditorSession;
  time: number;
  selected: string | null;
  onSelect(id: string | null): void;
  onSeek(t: number): void;
  onSplit(): void;
  onDelete(): void;
}

type Drag =
  | { kind: 'trim'; clipId: string; side: 'l' | 'r'; startX: number; delta: number }
  | { kind: 'move'; clipId: string; startX: number; delta: number }
  | { kind: 'scrub' };

export function Timeline({ session, time, selected, onSelect, onSeek, onSplit, onDelete }: Props) {
  useStoreVersion(session);
  const { store } = session;
  const doc = store.doc;
  const duration = sequenceDuration(doc.clips);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState(0); // 0 = fit
  const [drag, setDrag] = useState<Drag | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitPps = Math.max(2, (width - 40) / Math.max(1, duration));
  const pps = zoom === 0 ? fitPps : fitPps * Math.pow(2, zoom);
  const innerW = Math.max(width, duration * pps + 60);
  const starts = clipStarts(doc.clips);
  const toTime = (clientX: number) => {
    const el = scrollRef.current!;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - 12;
    return Math.max(0, Math.min(duration, x / pps));
  };

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || drag) return;
    const x = 12 + time * pps;
    if (x < el.scrollLeft + 20 || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.3);
  }, [time, pps, drag]);

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      if (drag.kind === 'scrub') onSeek(toTime(e.clientX));
      else setDrag({ ...drag, delta: e.clientX - drag.startX });
    };
    const up = () => {
      if (drag.kind === 'trim' && Math.abs(drag.delta) > 1) {
        const c = doc.clips.find((x) => x.id === drag.clipId);
        if (c) {
          const dt = drag.delta / pps;
          store.run(
            [{ type: 'trim_clip', clipId: c.id, ...(drag.side === 'l' ? { in: Math.max(0, c.in + dt) } : { out: Math.max(0, c.out + dt) }) }],
            'Trim clip',
          );
        }
      } else if (drag.kind === 'move' && Math.abs(drag.delta) > 4) {
        const from = doc.clips.findIndex((x) => x.id === drag.clipId);
        const c = doc.clips[from];
        const centre = starts[from] + clipLength(c) / 2 + drag.delta / pps;
        let to = doc.clips.findIndex((x, i) => centre < starts[i] + clipLength(x) / 2);
        if (to < 0) to = doc.clips.length;
        if (to > from) to--;
        if (to !== from) store.run([{ type: 'move_clip', clipId: c.id, toIndex: to }], 'Move clip');
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, pps, doc]);

  const tickStep = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s * pps >= 70) ?? 1200;
  const ticks: number[] = [];
  for (let t = 0; t <= duration + 0.001; t += tickStep) ticks.push(t);

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="tl-bar">
        <button className="btn sm" onClick={onSplit} disabled={!doc.clips.length} title="Split at playhead (S)">
          <Icon name="scissors" size={14} /> Split
        </button>
        <button className="btn sm" onClick={onDelete} disabled={!selected} title="Delete selected clip (Del)">
          <Icon name="trash" size={14} /> Delete
        </button>
        <span className="faint small mono label">
          {doc.clips.length} clip{doc.clips.length === 1 ? '' : 's'} · {fmtTime(duration)}
        </span>
        <span className="spacer" />
        <label className="row small muted">
          <span className="label">Zoom</span>
          <input
            className="range"
            style={{ width: 120 }}
            type="range"
            min={0}
            max={6}
            step={0.25}
            value={zoom}
            onChange={(e) => setZoom(+e.target.value)}
            aria-label="Timeline zoom"
          />
        </label>
      </div>
      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-inner" style={{ width: innerW }}>
          <div
            className="ruler"
            onPointerDown={(e) => {
              onSeek(toTime(e.clientX));
              setDrag({ kind: 'scrub' });
            }}
          >
            {ticks.map((t) => (
              <span key={t} style={{ left: 12 + t * pps }}>
                {tickStep < 1 ? `${fmtTime(t)}.${Math.round((t % 1) * 10)}` : fmtTime(t)}
              </span>
            ))}
          </div>
          <div
            className="track"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) {
                onSelect(null);
                onSeek(toTime(e.clientX));
              }
            }}
          >
            {doc.clips.map((c, i) => {
              let left = 12 + starts[i] * pps;
              let w = clipLength(c) * pps;
              if (drag && drag.kind !== 'scrub' && drag.clipId === c.id) {
                if (drag.kind === 'move') left += drag.delta;
                else if (drag.side === 'l') {
                  const d = Math.max(-c.in * pps, Math.min(w - 4, drag.delta));
                  left += d;
                  w -= d;
                } else {
                  const maxOut = (doc.assets[c.assetId]?.duration ?? c.out) - c.out;
                  w = Math.max(4, w + Math.min(maxOut * pps, drag.delta));
                }
              }
              return (
                <ClipView
                  key={c.id}
                  clip={c}
                  name={doc.assets[c.assetId]?.name ?? 'Missing media'}
                  thumbs={store.index[c.assetId]?.thumbs}
                  audio={store.index[c.assetId]?.audio}
                  left={left}
                  width={w}
                  selected={selected === c.id}
                  dragging={drag?.kind === 'move' && drag.clipId === c.id}
                  onPointerDown={(e, part) => {
                    e.stopPropagation();
                    onSelect(c.id);
                    if (part === 'body') {
                      onSeek(toTime(e.clientX));
                      setDrag({ kind: 'move', clipId: c.id, startX: e.clientX, delta: 0 });
                    } else setDrag({ kind: 'trim', clipId: c.id, side: part, startX: e.clientX, delta: 0 });
                  }}
                />
              );
            })}
          </div>
          <div className="playhead" style={{ left: 12 + time * pps }} />
        </div>
      </div>
    </section>
  );
}

const ClipView = memo(function ClipView({
  clip,
  name,
  thumbs,
  audio,
  left,
  width,
  selected,
  dragging,
  onPointerDown,
}: {
  clip: Clip;
  name: string;
  thumbs?: { t: number; url: string }[];
  audio?: AudioAnalysis;
  left: number;
  width: number;
  selected: boolean;
  dragging: boolean;
  onPointerDown(e: React.PointerEvent, part: 'l' | 'r' | 'body'): void;
}) {
  const waveRef = useRef<HTMLCanvasElement>(null);
  const len = clipLength(clip);

  useEffect(() => {
    const c = waveRef.current;
    if (!c) return;
    const w = Math.max(1, Math.round(width));
    const h = 26;
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    if (!audio) return;
    ctx.fillStyle = 'rgba(66, 211, 146, .75)';
    for (let x = 0; x < w; x++) {
      const t0 = clip.in + (x / w) * len;
      const t1 = clip.in + ((x + 1) / w) * len;
      let peak = -100;
      for (let i = Math.floor(t0 * audio.rate); i < Math.ceil(t1 * audio.rate); i++) peak = Math.max(peak, audio.rmsDb[i] ?? -100);
      const a = Math.max(0, (peak + 60) / 60);
      const bh = Math.max(1, a * (h - 4));
      ctx.fillRect(x, (h - bh) / 2, 1, bh);
    }
  }, [audio, clip.in, len, width]);

  // Filmstrip: pick the thumbnail nearest each slot.
  const slotW = 48;
  const slots = Math.max(1, Math.ceil(width / slotW));
  const strip =
    thumbs && thumbs.length
      ? Array.from({ length: Math.min(slots, 60) }, (_, k) => {
          const t = clip.in + ((k + 0.5) / slots) * len;
          let best = thumbs[0];
          for (const th of thumbs) if (Math.abs(th.t - t) < Math.abs(best.t - t)) best = th;
          return best.url;
        })
      : [];

  return (
    <div
      className={`clip${selected ? ' selected' : ''}`}
      style={{ left, width: Math.max(4, width), opacity: dragging ? 0.8 : 1, zIndex: dragging ? 4 : undefined }}
      onPointerDown={(e) => onPointerDown(e, 'body')}
      role="button"
      aria-pressed={selected}
      aria-label={`${name}, ${len.toFixed(1)} seconds`}
      tabIndex={0}
    >
      <div className="strip">
        {strip.map((u, k) => (
          <img key={k} src={u} alt="" style={{ width: slotW }} draggable={false} />
        ))}
      </div>
      <canvas className="wave" ref={waveRef} />
      <span className="label ellipsis">
        {name}
        {clip.gainDb !== 0 && <span className="mono faint"> {clip.gainDb > 0 ? '+' : ''}{clip.gainDb}dB</span>}
      </span>
      <div className="handle l" onPointerDown={(e) => onPointerDown(e, 'l')} aria-hidden="true" />
      <div className="handle r" onPointerDown={(e) => onPointerDown(e, 'r')} aria-hidden="true" />
    </div>
  );
});
