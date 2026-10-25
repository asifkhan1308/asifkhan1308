import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { composeFrame, ensureTextFonts, textsOf } from '../engine/compose';
import { appLink, decodeProject, encodeFeedback, usesMedia } from '../engine/share';
import type { Project, ReviewComment } from '../types';
import '../MotionLabV1.css';

/* ──────────────────────────────────────────────────────────────────────────
 * V1.5 review player (#/review/<code>). Read-only: play, scrub, and leave
 * comments pinned to exact moments, then send them back as a link. Renders
 * with the same composeFrame the editor and exporter use, so the reviewer
 * sees exactly what the creator sees (imported media appears as a
 * placeholder — links never carry media bytes).
 * ────────────────────────────────────────────────────────────────────────── */

const NAME_KEY = 'motionlab.reviewer';
const draftKey = (id: string) => `motionlab.review.${id}`;
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode: keep in memory */ } },
};
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const uid = () => `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export default function ReviewPage({ code }: { code: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [err, setErr] = useState('');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [name, setName] = useState(() => store.get(NAME_KEY) ?? '');
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState('');
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    decodeProject(code)
      .then((p) => {
        if (!live) return;
        setProject(p);
        try { setComments(JSON.parse(store.get(draftKey(p.id)) ?? '[]') as ReviewComment[]); } catch { /* fresh start */ }
        document.title = `Review · ${p.name}`;
      })
      .catch((e) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [code]);

  const duration = project?.composition.duration ?? 0;

  const [fontsTick, setFontsTick] = useState(0);
  // Draw the current frame (backing store capped for speed; CSS scales it).
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !project) return;
    const { width, height } = project.composition;
    const k = Math.min(1, 1280 / width);
    const w = Math.round(width * k), h = Math.round(height * k);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    composeFrame(ctx, project, time, { pixelScale: k });
  }, [project, time, fontsTick]);
  useEffect(() => {
    let live = true;
    if (project) void ensureTextFonts(textsOf(project)).then(() => { if (live) setFontsTick((n) => n + 1); });
    return () => { live = false; };
  }, [project]);

  // Playback clock.
  useEffect(() => {
    if (!playing || !duration) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTime((t) => (t + dt >= duration ? 0 : t + dt));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);

  const save = useCallback((list: ReviewComment[]) => {
    setComments(list);
    setReply('');
    if (project) store.set(draftKey(project.id), JSON.stringify(list));
  }, [project]);

  const add = () => {
    if (!draft.trim()) return;
    setPlaying(false);
    const author = name.trim() || 'Reviewer';
    store.set(NAME_KEY, name.trim());
    save([...comments, { id: uid(), time: +time.toFixed(2), text: draft.trim(), author, createdAt: Date.now() }].sort((a, b) => a.time - b.time));
    setDraft('');
  };

  const send = async () => {
    if (!project || !comments.length) return;
    const code = await encodeFeedback({ projectId: project.id, projectName: project.name, comments });
    setReply(appLink(`/studio/feedback/${code}`));
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(reply); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { (document.querySelector('.v1-review-reply') as HTMLTextAreaElement | null)?.select(); }
  };

  // Space plays/pauses, except while typing.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); setPlaying((p) => !p); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const media = useMemo(() => (project ? usesMedia(project) : false), [project]);

  if (err) {
    return (
      <div className="motionlab-v1 v1-review">
        <div className="v1-review-empty" role="alert">
          <h1>Can’t open this review link</h1>
          <p>{err}</p>
          <a href="#/">Go to Kaatchat</a>
        </div>
      </div>
    );
  }
  if (!project) return <div className="motionlab-v1 v1-review" aria-busy="true" />;

  return (
    <div className="motionlab-v1 v1-review">
      <header className="v1-review-head">
        <span className="logo">MOTIONLAB</span>
        <span className="v1-review-title">{project.name}</span>
        <span className="v1-review-tag">Review · read-only</span>
      </header>
      <main className="v1-review-main">
        <section className="v1-review-stage">
          <canvas
            ref={canvasRef}
            className="v1-review-canvas"
            style={{ aspectRatio: `${project.composition.width} / ${project.composition.height}` }}
            onClick={() => setPlaying((p) => !p)}
          />
          {media && (
            <p className="v1-review-note">This edit uses imported footage, which links don’t carry — it appears as a grey placeholder.</p>
          )}
          <div className="v1-review-controls">
            <button className="btn-play" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '⏸' : '▶'}</button>
            <div className="v1-review-scrub">
              <input
                type="range"
                min={0}
                max={duration}
                step={0.01}
                value={time}
                aria-label="Playhead"
                onChange={(e) => { setPlaying(false); setTime(Number(e.target.value)); }}
              />
              {comments.map((c) => (
                <button
                  key={c.id}
                  className="v1-review-marker"
                  style={{ left: `${(c.time / duration) * 100}%` }}
                  title={`${fmt(c.time)} · ${c.text}`}
                  onClick={() => { setPlaying(false); setTime(c.time); }}
                />
              ))}
            </div>
            <span className="v1-review-time">{fmt(time)} / {fmt(duration)}</span>
          </div>
        </section>

        <aside className="v1-review-side">
          <h2>Comments</h2>
          <input className="v1-review-name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea
            className="v1-review-input"
            rows={3}
            placeholder={`Comment at ${fmt(time)}…`}
            value={draft}
            onFocus={() => setPlaying(false)}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(); } }}
          />
          <button className="btn-primary v1-review-add" onClick={add} disabled={!draft.trim()}>Add comment at {fmt(time)}</button>

          <ol className="v1-review-list">
            {comments.length === 0 && <li className="v1-review-none">No comments yet. Pause where something needs changing and write it down.</li>}
            {comments.map((c) => (
              <li key={c.id}>
                <button className="v1-review-at" onClick={() => { setPlaying(false); setTime(c.time); }}>{fmt(c.time)}</button>
                <span className="v1-review-text"><b>{c.author}</b> {c.text}</span>
                <button className="btn-icon xs" title="Delete" onClick={() => save(comments.filter((x) => x.id !== c.id))}>×</button>
              </li>
            ))}
          </ol>

          <div className="v1-review-send">
            <button className="btn-primary v1-review-send-btn" onClick={() => void send()} disabled={!comments.length}>
              Send feedback ({comments.length})
            </button>
            {reply && (
              <>
                <p>Send this link back to the creator — opening it pins your comments to their timeline.</p>
                <textarea className="v1-review-reply" readOnly rows={3} value={reply} onFocus={(e) => e.currentTarget.select()} />
                <button className="btn-secondary" onClick={() => void copy()}>{copied ? 'Copied ✓' : 'Copy link'}</button>
              </>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
