import { useEffect, useRef, useState } from 'react';
import type { EditorSession } from '../app/session';
import { useStoreVersion } from '../app/hooks';
import { useAISettings, getActiveProvider } from '../app/aiState';
import { requestPlan, searchFootage } from '../ai/planner';
import { AIError, type Moment } from '../ai/types';
import { PROVIDERS } from '../ai/providers';
import type { EditPlan, Command } from '../engine/commands/schema';
import type { PlanPreview } from '../engine/commands/execute';
import { Icon, fmtTime, toast } from './bits';
import { t, type StringKey } from '../i18n';
import { Inspector } from './Inspector';
import { Repurpose } from './Repurpose';
import { BrandPanel } from './Brand';

export type StudioTab = 'ask' | 'find' | 'clips' | 'brand' | 'clip' | 'history';

interface Props {
  session: EditorSession;
  tab: StudioTab;
  setTab(t: StudioTab): void;
  ask: { text: string; n: number } | null;
  time: number;
  selected: string | null;
  onSeek(t: number): void;
  onPlay(): void;
}

export function Studio(p: Props) {
  useStoreVersion(p.session);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [p.tab]);
  return (
    <>
      <div className="tabs" role="tablist" aria-label={t('ai.studio')}>
        {(
          [
            ['ask', t('ai.tab.ask')],
            ['find', t('ai.tab.find')],
            ['clips', 'Repurpose'],
            ['brand', 'Brand'],
            ['clip', 'Clip'],
            ['history', t('ai.tab.history')],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className="tab" role="tab" aria-selected={p.tab === id} onClick={() => p.setTab(id)}>
            {id === 'ask' && <Icon name="spark" size={12} />} {label}
          </button>
        ))}
      </div>
      <div className="panel-body" role="tabpanel" ref={bodyRef}>
        {/* Ask stays mounted so a running request or pending plan survives tab switches. */}
        <div hidden={p.tab !== 'ask'} className="col" style={{ gap: 12 }}>
          <Ask {...p} />
        </div>
        {p.tab === 'find' && <Find {...p} />}
        {p.tab === 'clips' && <Repurpose session={p.session} onSeek={p.onSeek} onPlay={p.onPlay} />}
        {p.tab === 'brand' && <BrandPanel session={p.session} />}
        {p.tab === 'clip' && <Inspector session={p.session} clipId={p.selected} time={p.time} />}
        {p.tab === 'history' && <History session={p.session} />}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Ask

/** Shown in the person's language; the request sent is always the English one the built-in rules know. */
const SUGGESTIONS: { key: StringKey; request: string }[] = [
  { key: 's.pauses', request: 'Remove all boring pauses' },
  { key: 's.reel', request: 'Turn this into a 30 second Reel' },
  { key: 's.vertical', request: 'Make it vertical' },
  { key: 's.levels', request: 'Match the audio levels' },
  { key: 's.captions', request: 'Add captions' },
  { key: 's.fillers', request: 'Remove um and uh' },
  { key: 's.best', request: 'Keep the best 60 seconds' },
  { key: 's.dissolve', request: 'Add dissolve transitions' },
  { key: 's.cinematic', request: 'Make it cinematic' },
  { key: 's.punch', request: 'Punch in on alternate clips' },
  { key: 's.beat', request: 'Sync the cuts to the beat' },
  { key: 's.noise', request: 'Remove the background noise' },
  { key: 's.talking', request: 'Clean up this talking head' },
  { key: 's.brand', request: 'Use my brand' },
];

/** Features named in the roadmap that this build does not have. Shown, disabled, with the reason. */
const NOT_IN_BUILD = [
  { label: 'Generate B-roll', why: 'Needs an image/video generation provider adapter — not in this build.' },
  { label: 'Generate image', why: 'Needs an image generation provider adapter — not in this build.' },
  { label: 'Generate music', why: 'Needs a music generation provider adapter — not in this build. Import your own music instead.' },
];

/** Plans that only change settings are applied in one click (still undoable). */
const SIMPLE: Command['type'][] = ['set_aspect', 'set_captions', 'rename_project', 'match_levels', 'reframe'];
const isSimple = (plan: EditPlan) => plan.commands.length > 0 && plan.commands.length <= 2 && plan.commands.every((c) => SIMPLE.includes(c.type));

const describe = (c: Command): string => {
  switch (c.type) {
    case 'remove_silence':
      return `Remove quiet stretches (${c.preset})`;
    case 'smart_cuts':
      return `Trim dead air at clip edges (${c.preset})`;
    case 'match_levels':
      return `Match loudness to ${c.targetDb} dBFS`;
    case 'set_aspect':
      return `Set aspect to ${c.aspect}`;
    case 'reframe':
      return c.mode === 'content' ? 'Content-aware crop (keeps the busiest region in view)' : c.mode === 'fit' ? 'Fit the whole frame' : 'Centre crop';
    case 'remove_fillers':
      return 'Remove filler words (um, uh, erm…)';
    case 'remove_words':
      return `Cut ${c.ranges.length} transcript selection(s)`;
    case 'set_captions':
      return c.enabled ? `Captions on${c.style ? ` (${c.style})` : ''}` : 'Captions off';
    case 'select_highlights':
      return `Keep the most energetic ${c.targetDuration}s`;
    case 'keep_ranges':
      return `Keep ${c.ranges.length} moment(s): ${c.ranges.slice(0, 3).map((r) => `${fmtTime(r.start)}–${fmtTime(r.end)}`).join(', ')}${c.ranges.length > 3 ? '…' : ''}`;
    case 'remove_ranges':
      return `Cut ${c.ranges.length} range(s)`;
    case 'prepend_range':
      return `Open with ${fmtTime(c.start)}–${fmtTime(c.end)}${c.removeOriginal ? ' (moved)' : ''}`;
    case 'split_clip':
      return `Split at ${fmtTime(c.at)}`;
    case 'trim_clip':
      return 'Trim a clip';
    case 'delete_clip':
      return 'Delete a clip';
    case 'move_clip':
      return `Move a clip to position ${c.toIndex + 1}`;
    case 'set_clip_gain':
      return `Set clip gain to ${c.gainDb} dB`;
    case 'rename_project':
      return `Rename project to “${c.name}”`;
    case 'add_text':
      return `Add text “${c.text.slice(0, 40)}” (${c.animation}, ${c.position})`;
    case 'set_look':
      return `${c.look} look`;
    case 'set_transitions':
      return c.kind === 'cut' ? 'Plain cuts' : `${c.kind} transitions (${c.duration}s)`;
    case 'punch_in':
      return c.pattern === 'none' ? 'Remove punch-ins' : `Punch in ${Math.round((c.amount - 1) * 100)}% (${c.pattern})`;
    case 'apply_brand':
      return 'Apply your Brand Kit';
    case 'switch_angle':
      return 'Switch a clip to another camera';
    case 'sync_to_beat':
      return `Nudge cuts onto the beat (±${c.window}s)`;
    case 'set_fades':
      return `Audio fades ${c.fadeIn}s / ${c.fadeOut}s`;
    case 'duck_music':
      return c.enabled ? `Duck music ${c.duckDb} dB under speech` : 'Turn off ducking';
    case 'reduce_noise':
      return c.strength > 0 ? `${c.mode === 'voice' ? 'Isolate the voice (AI)' : 'Reduce background noise'} (${Math.round(c.strength * 100)}%)` : 'Turn off noise reduction';
  }
};

function Ask({ session, ask, time }: Props) {
  const { store } = session;
  const ai = useAISettings();
  const info = PROVIDERS[ai.active];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ request: string; plan: EditPlan; preview: PlanPreview; via: string } | null>(null);
  const acRef = useRef<AbortController | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);

  const apply = (plan: EditPlan, request: string) => {
    try {
      const p = store.applyPlan(plan, request.length > 48 ? request.slice(0, 46) + '…' : request, 'ai');
      setPending(null);
      toast(p.steps.flatMap((s) => s.notes).slice(0, 3).join(' · ') || 'Applied', 'info', { label: 'Undo', run: () => store.undo() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const run = async (request: string) => {
    const r = request.trim();
    if (!r || busy) return;
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    setBusy(true);
    setError(null);
    setPending(null);
    try {
      const out = await requestPlan(getActiveProvider(), store.doc, store.index, r, time, ac.signal);
      if (out.plan.commands.length === 0) {
        setError(out.plan.summary || 'The assistant proposed no changes.');
        return;
      }
      const preview = store.preview(out.plan);
      if (preview.ok && isSimple(out.plan)) apply(out.plan, r);
      else setPending({ request: r, plan: out.plan, preview, via: out.via === 'rules' ? 'Built-in commands' : `${info.name} · ${ai.providers[ai.active].model}${out.repaired ? ' (repaired once)' : ''}` });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') setError('Cancelled. Nothing was changed.');
      else if (e instanceof AIError) setError(e.message);
      else setError(`Something went wrong: ${e instanceof Error ? e.message : e}. Nothing was changed.`);
    } finally {
      setBusy(false);
    }
  };

  // Requests from the command bar.
  useEffect(() => {
    if (ask) {
      setText(ask.text);
      void run(ask.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask?.n]);

  return (
    <>
      <div className="row small">
        <span className={`badge ${info.network === 'internet' ? 'warn' : 'ok'}`}>{info.network === 'internet' ? 'Cloud' : 'On this device'}</span>
        <span className="grow ellipsis muted">{info.name}</span>
        <a className="small" href="#/settings">
          Change
        </a>
      </div>
      {info.network === 'internet' && !online && <p className="note warn">{t('common.requiresInternet')} — switch to Built-in or Local AI in Settings to keep working offline.</p>}
      <form
        className="col"
        onSubmit={(e) => {
          e.preventDefault();
          void run(text);
        }}
      >
        <textarea
          className="textarea"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What do you want to create or change?"
          aria-label="Request"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void run(text);
            }
          }}
        />
        <div className="row">
          {busy ? (
            <>
              <span className="spin" />
              <span className="muted small grow">{info.network === 'none' ? 'Planning…' : `Waiting for ${info.name}…`}</span>
              <button type="button" className="btn sm" onClick={() => acRef.current?.abort()}>
                {t('ai.cancel')}
              </button>
            </>
          ) : (
            <button className="btn primary" type="submit" disabled={!text.trim() || store.doc.clips.length === 0}>
              <Icon name="spark" size={14} /> {t('ai.plan')}
            </button>
          )}
        </div>
      </form>

      {error && <p className="note err">{error}</p>}

      {pending && (
        <PlanCard
          pending={pending}
          onApply={() => apply(pending.plan, pending.request)}
          onCancel={() => setPending(null)}
          onRegenerate={() => void run(pending.request)}
          onModify={() => {
            setText(pending.request);
            setPending(null);
          }}
        />
      )}

      {!pending && !busy && (
        <>
          <h3>{t('ai.suggestions')}</h3>
          <div className="suggest">
            {SUGGESTIONS.map((s) => (
              <button key={s.key} className="chip" onClick={() => { setText(t(s.key)); void run(s.request); }} disabled={store.doc.clips.length === 0}>
                {t(s.key)}
              </button>
            ))}
          </div>
          <h3 className="faint">{t('ai.notInBuild')}</h3>
          <div className="suggest">
            {NOT_IN_BUILD.map((s) => (
              <span key={s.label} className="chip" aria-disabled="true" title={s.why} style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                {s.label}
              </span>
            ))}
          </div>
          <p className="faint tiny">Kaatchat will not pretend to generate media it cannot generate. Hover for what each one needs.</p>
        </>
      )}
    </>
  );
}

function PlanCard({
  pending,
  onApply,
  onCancel,
  onRegenerate,
  onModify,
}: {
  pending: { request: string; plan: EditPlan; preview: PlanPreview; via: string };
  onApply(): void;
  onCancel(): void;
  onRegenerate(): void;
  onModify(): void;
}) {
  const { plan, preview } = pending;
  return (
    <section className="card plan" aria-label="Proposed changes">
      <p className="small">{plan.summary}</p>
      <h3>{t('ai.wants')}</h3>
      <ol>
        {preview.steps.map((s, i) => (
          <li key={i}>
            {describe(s.command)}
            {s.notes.length > 0 && <div className="faint tiny">{s.notes.join(' · ')}</div>}
            {s.error && <div className="step-err tiny">{s.error}</div>}
          </li>
        ))}
      </ol>
      <div className="stat" aria-label="Before and after">
        <div>
          <span className="faint tiny">Length</span>
          <b>
            {fmtTime(preview.before.duration)} → {fmtTime(preview.after.duration)}
          </b>
        </div>
        <div>
          <span className="faint tiny">Clips</span>
          <b>
            {preview.before.clips} → {preview.after.clips}
          </b>
        </div>
        <div>
          <span className="faint tiny">Aspect</span>
          <b>
            {preview.before.aspect} → {preview.after.aspect}
          </b>
        </div>
      </div>
      <p className="faint tiny">Planned by {pending.via}. Measured by Kaatchat on this device. One undo reverts all of it.</p>
      {!preview.ok && <p className="note err">This plan cannot be applied as proposed, so nothing will change.</p>}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={onApply} disabled={!preview.ok}>
          <Icon name="check" size={14} /> {t('ai.apply')}
        </button>
        <button className="btn" onClick={onCancel}>
          {t('ai.cancel')}
        </button>
        <span className="spacer" />
        <button className="btn ghost sm" onClick={onModify}>
          Modify
        </button>
        <button className="btn ghost sm" onClick={onRegenerate}>
          Regenerate
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Find

function Find({ session, onSeek, onPlay }: Props) {
  const { store } = session;
  const ai = useAISettings();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<{ moments: Moment[]; via: string } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const acRef = useRef<AbortController | null>(null);

  const search = async () => {
    if (!q.trim()) return;
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    setBusy(true);
    setError(null);
    try {
      const out = await searchFootage(getActiveProvider(), store.doc, store.index, q.trim(), ac.signal);
      setRes({ moments: out.moments, via: out.via === 'keyword' ? 'Keyword search on this device (matches words, not meaning)' : `${PROVIDERS[ai.active].name}` });
      setPicked(new Set(out.moments.map((_, i) => i)));
    } catch (e) {
      setRes(null);
      if (e instanceof DOMException && e.name === 'AbortError') setError('Cancelled.');
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const chosen = res ? res.moments.filter((_, i) => picked.has(i)) : [];

  return (
    <>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input className="input grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ai.findPlaceholder')} aria-label="Search your footage" />
        <button className="btn icon" type="submit" aria-label="Search" disabled={busy}>
          {busy ? <span className="spin" /> : <Icon name="search" />}
        </button>
      </form>
      {error && <p className="note err">{error}</p>}
      {res && (
        <>
          <div className="row small">
            <b className="grow">
              {res.moments.length ? `Found ${res.moments.length} moment${res.moments.length > 1 ? 's' : ''}` : 'Nothing matched'}
            </b>
          </div>
          <span className="faint tiny">{res.via}</span>
          {res.moments.map((m, i) => (
            <div className="card moment" key={i}>
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
                  {fmtTime(m.start)} → {fmtTime(m.end)}
                </span>
              </label>
              <b className="small">{m.title}</b>
              {m.why && <span className="faint tiny">{m.why}</span>}
              <div className="row">
                <button className="btn sm" onClick={() => onSeek(m.start)}>
                  {t('ai.jump')}
                </button>
                <button
                  className="btn sm"
                  onClick={() => {
                    onSeek(m.start);
                    onPlay();
                  }}
                >
                  <Icon name="play" size={12} /> Preview
                </button>
              </div>
            </div>
          ))}
          {res.moments.length > 0 && (
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button
                className="btn primary"
                disabled={chosen.length === 0}
                onClick={() => {
                  store.run([{ type: 'keep_ranges', ranges: chosen.map((m) => ({ start: m.start, end: m.end })) }], `Keep ${chosen.length} found moment(s)`, 'ai');
                  setRes(null);
                  toast(`Timeline now holds ${chosen.length} moment(s).`, 'info', { label: 'Undo', run: () => store.undo() });
                }}
              >
                {t('ai.addToTimeline')}
              </button>
              <button
                className="btn"
                disabled={chosen.length === 0}
                onClick={() => {
                  store.run([{ type: 'remove_ranges', ranges: chosen.map((m) => ({ start: m.start, end: m.end })) }], `Cut ${chosen.length} found moment(s)`, 'ai');
                  setRes(null);
                  toast(`Cut ${chosen.length} moment(s).`, 'info', { label: 'Undo', run: () => store.undo() });
                }}
              >
                Cut these
              </button>
              <button
                className="btn"
                disabled={chosen.length === 0}
                title="Put these moments in a new sequence; this edit stays as it is"
                onClick={() => {
                  const name = q.trim().slice(0, 40) || 'Found moments';
                  store.sequenceFromRanges(name, chosen.map((m) => ({ start: m.start, end: m.end })));
                  setRes(null);
                  toast(`New sequence “${name}” with ${chosen.length} moment(s).`, 'info', { label: 'Undo', run: () => store.undo() });
                }}
              >
                New sequence
              </button>
            </div>
          )}
        </>
      )}
      {!res && !error && (
        <p className="faint small">
          Searches the transcript of what is on the timeline. With Built-in commands this is a keyword search; with an AI provider it can match meaning (“the funniest moments”, “where we discuss money”).
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------- History

function History({ session }: { session: EditorSession }) {
  const { store } = session;
  const [name, setName] = useState('');
  const items = store.history.slice().reverse();
  return (
    <>
      <div className="row">
        <h3 className="grow">Edit history</h3>
        <button className="btn sm" disabled={!store.canUndo} onClick={() => store.undo()}>
          <Icon name="undo" size={13} /> Undo
        </button>
        <button className="btn sm" disabled={!store.canRedo} onClick={() => store.redo()}>
          <Icon name="redo" size={13} /> Redo
        </button>
      </div>
      {items.length === 0 ? (
        <p className="muted small">No edits yet in this session.</p>
      ) : (
        <div className="history">
          <ul>
            {items.map((h) => (
              <li key={h.id}>
                <span className={`badge ${h.source === 'ai' ? 'warn' : ''}`}>{h.source === 'ai' ? 'AI' : 'You'}</span>
                <span className="grow">
                  {h.label}
                  {h.notes.length > 0 && <div className="faint tiny">{h.notes.join(' · ')}</div>}
                </span>
                <span className="faint tiny mono">{new Date(h.at).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="divider" />
      <h3>Named versions</h3>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          store.saveVersion(name.trim() || `Version ${store.versions.length + 1}`);
          setName('');
        }}
      >
        <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Before the reel edit" aria-label="Version name" />
        <button className="btn" type="submit">
          Save version
        </button>
      </form>
      {store.versions.length === 0 && <p className="faint tiny">Versions are kept while the project is open.</p>}
      {store.versions
        .slice()
        .reverse()
        .map((v) => (
          <div className="row small" key={v.id}>
            <span className="grow">{v.name}</span>
            <span className="faint tiny mono">{new Date(v.at).toLocaleTimeString()}</span>
            <button className="btn sm" onClick={() => store.restoreVersion(v.id)}>
              Restore
            </button>
          </div>
        ))}
    </>
  );
}
