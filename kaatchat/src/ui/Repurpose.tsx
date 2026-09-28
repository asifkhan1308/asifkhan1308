import { useRef, useState } from 'react';
import type { EditorSession } from '../app/session';
import { getActiveProvider, useAISettings } from '../app/aiState';
import { findClips, suggestHooks } from '../ai/planner';
import { PROVIDERS } from '../ai/providers';
import type { Candidate, Pace, RepurposeOptions } from '../engine/repurpose';
import type { AspectId, CaptionStyleId } from '../engine/types';
import { Icon, fmtTime, toast } from './bits';

const LENGTHS = [15, 30, 45, 60, 90];
const FORMATS: { id: string; label: string; aspect: AspectId }[] = [
  { id: 'reel', label: 'Reel / Short / TikTok', aspect: '9:16' },
  { id: 'feed', label: 'Feed 4:5', aspect: '4:5' },
  { id: 'square', label: 'Square', aspect: '1:1' },
  { id: 'wide', label: '16:9', aspect: '16:9' },
];
const PACES: { id: Pace; label: string; hint: string }[] = [
  { id: 'clean', label: 'Clean', hint: 'Balanced silence removal' },
  { id: 'punchy', label: 'Punchy', hint: 'Cut hard, cut early' },
  { id: 'cinematic', label: 'Cinematic', hint: 'Keep the pauses that matter' },
];

/** One video → many edits. */
export function Repurpose({ session, onSeek, onPlay }: { session: EditorSession; onSeek(t: number): void; onPlay(): void }) {
  const { store } = session;
  const ai = useAISettings();
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(3);
  const [target, setTarget] = useState(30);
  const [format, setFormat] = useState('reel');
  const [pace, setPace] = useState<Pace>('punchy');
  const [captions, setCaptions] = useState(true);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyleId>('bold');
  const [busy, setBusy] = useState<'clips' | 'hooks' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<{ clips: Candidate[]; via: string } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [hooks, setHooks] = useState<{ clips: Candidate[]; via: string } | null>(null);
  const acRef = useRef<AbortController | null>(null);
  const provider = PROVIDERS[ai.active];
  const empty = store.doc.clips.length === 0;

  const opts: RepurposeOptions = { target, aspect: FORMATS.find((f) => f.id === format)!.aspect, pace, captions, captionStyle };

  const run = async (kind: 'clips' | 'hooks') => {
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'clips') {
        const r = await findClips(getActiveProvider(), store.doc, store.index, { topic, count, target }, ac.signal);
        const via =
          r.via === 'model'
            ? `Chosen by ${provider.name}; cut, reframed and captioned by Kaatchat on this device`
            : r.via === 'keyword'
              ? 'Keyword match on the transcript, ranked by measured energy (on this device)'
              : 'Ranked by measured loudness and sentence boundaries (on this device) — not a judgement of what is interesting';
        setFound({ clips: r.clips, via });
        setPicked(new Set(r.clips.map((_, i) => i)));
      } else {
        const r = await suggestHooks(getActiveProvider(), store.doc, store.index, ac.signal);
        setHooks({ clips: r.clips, via: r.via === 'model' ? `Suggested by ${provider.name}. You choose.` : 'Loudest complete sentences (measured). You choose.' });
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') setError('Cancelled.');
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const chosen = found ? found.clips.filter((_, i) => picked.has(i)) : [];

  return (
    <div className="col" style={{ gap: 12 }}>
      <p className="muted small">Turn this edit into separate short edits. Each one is a normal, fully editable sequence.</p>

      <label className="field">
        About (optional)
        <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. AI, money, starting the company" aria-label="Clip topic" />
      </label>

      <div className="field">
        <span>How many</span>
        <div className="suggest">
          {[1, 3, 5, 8].map((n) => (
            <button key={n} className="chip" aria-pressed={count === n} onClick={() => setCount(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Length</span>
        <div className="suggest">
          {LENGTHS.map((n) => (
            <button key={n} className="chip" aria-pressed={target === n} onClick={() => setTarget(n)}>
              {n}s
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Format</span>
        <div className="suggest">
          {FORMATS.map((f) => (
            <button key={f.id} className="chip" aria-pressed={format === f.id} onClick={() => setFormat(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Pace</span>
        <div className="suggest">
          {PACES.map((p) => (
            <button key={p.id} className="chip" aria-pressed={pace === p.id} onClick={() => setPace(p.id)} title={p.hint}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <label className="row small grow">
          <input type="checkbox" className="check" checked={captions} onChange={(e) => setCaptions(e.target.checked)} />
          Captions
        </label>
        {captions && (
          <select className="select" value={captionStyle} onChange={(e) => setCaptionStyle(e.target.value as CaptionStyleId)} aria-label="Caption style">
            <option value="bold">Bold</option>
            <option value="kinetic">Kinetic</option>
            <option value="clean">Clean</option>
            <option value="podcast">Podcast</option>
            <option value="minimal">Minimal</option>
          </select>
        )}
      </div>

      <div className="row">
        <button className="btn primary" disabled={empty || busy !== null} onClick={() => void run('clips')}>
          {busy === 'clips' ? <span className="spin" /> : <Icon name="scissors" size={14} />} Find clips
        </button>
        {busy && (
          <button className="btn sm" onClick={() => acRef.current?.abort()}>
            Cancel
          </button>
        )}
      </div>
      {error && <p className="note err">{error}</p>}

      {found && (
        <section className="col" aria-label="Clip candidates">
          <b className="small">{found.clips.length ? `${found.clips.length} candidate${found.clips.length > 1 ? 's' : ''}` : topic ? `Nothing in the transcript mentions “${topic}”.` : 'Nothing measured yet — wait for analysis to finish.'}</b>
          <span className="faint tiny">{found.via}</span>
          {found.clips.map((c, i) => (
            <div key={i} className="card moment">
              <label className="row small">
                <input
                  type="checkbox"
                  className="check"
                  checked={picked.has(i)}
                  onChange={(e) => {
                    const n = new Set(picked);
                    if (e.target.checked) n.add(i);
                    else n.delete(i);
                    setPicked(n);
                  }}
                />
                <span className="mono faint">
                  {String(i + 1).padStart(2, '0')} · {fmtTime(c.start)} → {fmtTime(c.end)} · {Math.round(c.end - c.start)}s
                </span>
              </label>
              <b className="small">{c.title}</b>
              {c.why && <span className="faint tiny">{c.why}</span>}
              <div className="row">
                <button className="btn sm" onClick={() => { onSeek(c.start); onPlay(); }}>
                  <Icon name="play" size={12} /> Preview
                </button>
              </div>
            </div>
          ))}
          {found.clips.length > 0 && (
            <button
              className="btn primary"
              disabled={chosen.length === 0}
              onClick={() => {
                const made = store.repurpose(chosen, opts, topic.trim() ? topic.trim().slice(0, 24) : 'Clip');
                setFound(null);
                toast(`Created ${made.length} sequence${made.length > 1 ? 's' : ''}. Export them all from Export → All sequences.`, 'info', { label: 'Undo', run: () => store.undo() });
              }}
            >
              Create {chosen.length} sequence{chosen.length === 1 ? '' : 's'}
            </button>
          )}
        </section>
      )}

      <div className="divider" />
      <div className="row">
        <h3 className="grow">Hooks</h3>
        <button className="btn sm" disabled={empty || busy !== null} onClick={() => void run('hooks')}>
          {busy === 'hooks' ? <span className="spin" /> : <Icon name="spark" size={12} />} Suggest hooks
        </button>
      </div>
      <p className="faint tiny">Alternatives for the first seconds of this edit, taken from its own words. Nothing is chosen for you.</p>
      {hooks && (
        <>
          <span className="faint tiny">{hooks.via}</span>
          {hooks.clips.length === 0 && <p className="muted small">No complete sentences to suggest.</p>}
          {hooks.clips.map((h, i) => (
            <div key={i} className="card moment">
              <span className="mono faint tiny">
                {fmtTime(h.start)} → {fmtTime(h.end)}
              </span>
              <b className="small">“{h.title}”</b>
              {h.why && <span className="faint tiny">{h.why}</span>}
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn sm" onClick={() => { onSeek(h.start); onPlay(); }}>
                  <Icon name="play" size={12} /> Preview
                </button>
                <button
                  className="btn sm"
                  onClick={() => {
                    store.run([{ type: 'prepend_range', start: h.start, end: h.end, removeOriginal: false }], 'Use hook', 'ai');
                    setHooks(null);
                    onSeek(0);
                    toast('The edit now opens with this line.', 'info', { label: 'Undo', run: () => store.undo() });
                  }}
                >
                  Use as opening
                </button>
                <button
                  className="btn sm ghost"
                  onClick={() => {
                    store.run([{ type: 'prepend_range', start: h.start, end: h.end, removeOriginal: true }], 'Move hook to start', 'ai');
                    setHooks(null);
                    onSeek(0);
                  }}
                >
                  Move to start
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
