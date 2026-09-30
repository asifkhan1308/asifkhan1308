import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStoreVersion } from '../app/hooks';
import { EditorSession } from '../app/session';
import { loadProject, discardAutosave } from '../engine/persist';
import { Player } from '../engine/playback';
import { ACCEPT } from '../engine/formats';
import { ASPECT_IDS, ASPECTS, type AspectId } from '../engine/types';
import { sequenceDuration } from '../engine/timeline';
import { Brand, Dialog, Icon, dismissToast, fmtTime, toast } from './bits';
import { activeJobCount } from '../engine/jobs';
import { t } from '../i18n';
import { pendingImport } from './pending';
import { Timeline } from './Timeline';
import { MediaPanel } from './MediaPanel';
import { Studio, type StudioTab } from './Studio';
import { ExportDialog } from './ExportDialog';
import { JobsPanel, useJobs } from './Jobs';

type Loaded =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'recover'; saved: import('../engine/types').ProjectDoc | null; auto: import('../engine/types').ProjectDoc; autoAt: number }
  | { state: 'ready'; session: EditorSession };

export function Editor({ projectId }: { projectId: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let session: EditorSession | null = null;
    (async () => {
      try {
        const { saved, autosave } = await loadProject(projectId);
        if (cancelled) return;
        if (autosave && (!saved || autosave.savedAt > saved.savedAt)) {
          setLoaded({ state: 'recover', saved: saved?.doc ?? null, auto: autosave.doc, autoAt: autosave.savedAt });
          return;
        }
        if (!saved) {
          setLoaded({ state: 'error', message: 'This project does not exist in this browser.' });
          return;
        }
        session = await EditorSession.open(saved.doc);
        if (!cancelled) setLoaded({ state: 'ready', session });
      } catch (e) {
        if (!cancelled) setLoaded({ state: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
      session?.dispose();
    };
  }, [projectId]);

  if (loaded.state === 'loading')
    return (
      <div className="page" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="spin" aria-label="Opening project" />
      </div>
    );
  if (loaded.state === 'error')
    return (
      <div className="page">
        <div className="page-inner col">
          <Brand />
          <p className="note err">{loaded.message}</p>
          <a className="btn" href="#/">
            Back to projects
          </a>
        </div>
      </div>
    );
  if (loaded.state === 'recover')
    return (
      <Dialog
        title={t('recovery.title')}
        onClose={() => (location.hash = '#/')}
        footer={
          <>
            <button
              className="btn"
              onClick={async () => {
                await discardAutosave(projectId);
                if (!loaded.saved) {
                  location.hash = '#/';
                  return;
                }
                setLoaded({ state: 'ready', session: await EditorSession.open(loaded.saved) });
              }}
            >
              {t('recovery.discard')}
            </button>
            <button
              className="btn primary"
              onClick={async () => {
                const s = await EditorSession.open(loaded.auto);
                await s.save();
                setLoaded({ state: 'ready', session: s });
              }}
            >
              {t('recovery.restore')}
            </button>
          </>
        }
      >
        <p>
          {t('recovery.body')} <b>{relative(loaded.autoAt)}</b> ({new Date(loaded.autoAt).toLocaleString()}).
        </p>
        <p className="muted small">
          Restoring makes the recovered version your saved project. Discarding keeps the last saved version
          {loaded.saved ? '' : ' — this project was never saved, so discarding removes it'}.
        </p>
      </Dialog>
    );
  return <EditorView session={loaded.session} />;
}

function relative(at: number) {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 90) return 'a minute ago';
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}

function EditorView({ session }: { session: EditorSession }) {
  const { store } = session;
  useStoreVersion(session);
  const doc = store.doc;
  const index = store.index;
  const player = useMemo(() => new Player(store.doc, store.index), [store]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<StudioTab>('ask');
  const [ask, setAsk] = useState<{ text: string; n: number } | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showJobs, setShowJobs] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [over, setOver] = useState(false);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const fileRef = useRef<HTMLInputElement>(null);
  const cmdRef = useRef<HTMLInputElement>(null);
  const jobs = useJobs(session.jobs);
  const activeJobs = activeJobCount(jobs);

  const attachCanvas = useCallback((c: HTMLCanvasElement | null) => player.attach(c), [player]);
  useEffect(() => () => player.dispose(), [player]);
  useEffect(() => player.subscribe(() => {
    setTime(player.time);
    setPlaying(player.playing);
  }), [player]);
  useEffect(() => {
    player.update(doc, index);
  }, [player, doc, index]);
  useEffect(() => {
    if (selected && !doc.clips.some((c) => c.id === selected) && !doc.audio.some((a) => a.id === selected) && !doc.overlays.some((o) => o.id === selected)) setSelected(null);
  }, [doc, selected]);

  const importFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const { imported, errors, jobIds } = await session.importFiles(files);
      for (const e of errors) toast(e, 'err');
      if (!imported.length) return;
      const files_ = `${imported.length} file${imported.length === 1 ? '' : 's'}`;
      if (!jobIds.length) {
        toast(`Imported ${files_}.`);
        return;
      }
      // The message lives exactly as long as the measurements it describes.
      const pending = toast(`Imported ${files_}. Measuring on this device…`, 'info', undefined, { sticky: true });
      const settled = await session.jobs.whenSettled(jobIds);
      dismissToast(pending);
      const failed = settled.filter((j) => j.state === 'failed');
      for (const j of failed) toast(`${j.label} failed: ${j.error ?? 'unknown error'}`, 'err');
      if (!failed.length && settled.some((j) => j.state === 'done')) toast(`Measured ${files_}.`);
    },
    [session],
  );

  // Files dropped on the home screen.
  useEffect(() => {
    void importFiles(pendingImport.take(store.project.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(async () => {
    setSaving('saving');
    try {
      await session.save();
      setSaving('saved');
      setTimeout(() => setSaving('idle'), 1500);
    } catch (e) {
      setSaving('idle');
      toast(`Save failed: ${e instanceof Error ? e.message : e}. Your autosave is still kept.`, 'err');
    }
  }, [session]);

  // Save on leaving the editor.
  useEffect(() => {
    const onHide = () => {
      if (session.dirty) void session.save().catch(() => undefined);
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      onHide();
    };
  }, [session]);

  const runUndo = useCallback(() => {
    const label = store.undoLabel;
    store.undo();
    if (label) toast(`Undid: ${label}`);
  }, [store]);
  const runRedo = useCallback(() => {
    const label = store.redoLabel;
    store.redo();
    if (label) toast(`Redid: ${label}`);
  }, [store]);

  const split = useCallback(() => {
    store.run([{ type: 'split_clip', at: player.time }], 'Split');
  }, [store, player]);
  const del = useCallback(() => {
    if (!selected) return;
    if (store.doc.audio.some((a) => a.id === selected)) store.mutate('Remove music', (d) => ({ ...d, audio: d.audio.filter((a) => a.id !== selected) }));
    else if (store.doc.overlays.some((o) => o.id === selected)) store.mutate('Delete layer', (d) => ({ ...d, overlays: d.overlays.filter((o) => o.id !== selected) }));
    else store.run([{ type: 'delete_clip', clipId: selected }], 'Delete clip');
    setSelected(null);
  }, [store, selected]);

  // Keyboard shortcuts (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName) || tgt.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        cmdRef.current?.focus();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
        return;
      }
      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setShowExport(true);
        return;
      }
      if (typing || document.querySelector('.scrim')) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) runRedo();
        else runUndo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        runRedo();
      } else if (e.key === ' ') {
        e.preventDefault();
        player.toggle();
      } else if (e.key.toLowerCase() === 's' && !mod) {
        split();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected) {
          e.preventDefault();
          del();
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / doc.fps;
        player.seek(player.time + (e.key === 'ArrowLeft' ? -step : step));
      } else if (e.key === 'Home') player.seek(0);
      else if (e.key === 'End') player.seek(player.duration);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player, split, del, selected, save, runUndo, runRedo, doc.fps]);

  const duration = sequenceDuration(doc.clips);
  const hasTranscript = doc.clips.some((c) => index[c.assetId]?.transcript);

  const askKaatchat = (text: string) => {
    setTab('ask');
    setRightOpen(true);
    setAsk({ text, n: Date.now() });
  };

  return (
    <div
      className="editor"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setOver(false);
        void importFiles([...e.dataTransfer.files]);
      }}
    >
      <header className="topbar">
        <button className="btn ghost icon drawer-toggle left" aria-label="Media and transcript" onClick={() => setLeftOpen((v) => !v)}>
          <Icon name="menu" />
        </button>
        <Brand />
        <input
          className="name"
          aria-label="Project name"
          defaultValue={doc.projectName}
          key={doc.projectName}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== doc.projectName) store.run([{ type: 'rename_project', name: v.slice(0, 120) }], 'Rename');
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <button className="btn ghost icon" onClick={runUndo} disabled={!store.canUndo} aria-label={`${t('editor.undo')}${store.undoLabel ? `: ${store.undoLabel}` : ''}`} title={`${t('editor.undo')} (Ctrl+Z)`}>
          <Icon name="undo" />
        </button>
        <button className="btn ghost icon hide-sm" onClick={runRedo} disabled={!store.canRedo} aria-label={t('editor.redo')} title={`${t('editor.redo')} (Ctrl+Shift+Z)`}>
          <Icon name="redo" />
        </button>
        <form
          className="commandbar"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const v = cmdRef.current!.value.trim();
            if (!v) return;
            askKaatchat(v);
            cmdRef.current!.value = '';
          }}
        >
          <span className="spark">
            <Icon name="spark" size={15} />
          </span>
          <input ref={cmdRef} className="input" placeholder={`${t('ai.ask')}  (Ctrl+K)`} aria-label="Ask Kaatchat" />
        </form>
        {activeJobs ? (
          <button className="btn ghost" onClick={() => setShowJobs((v) => !v)} aria-expanded={showJobs} title={`${t('jobs.title')}: ${activeJobs}`}>
            <span className="spin" />
            <span className="label">
              {t('jobs.title')} · {activeJobs}
            </span>
          </button>
        ) : (
          <button className="btn ghost icon" onClick={() => setShowJobs((v) => !v)} aria-expanded={showJobs} aria-label={t('jobs.idle')} title={t('jobs.idle')}>
            <Icon name="layers" />
          </button>
        )}
        <button className="btn ghost icon hide-sm" onClick={save} aria-label={t('editor.save')} title={`${t('editor.save')} (Ctrl+S)`}>
          {saving === 'saved' ? <Icon name="check" /> : <Icon name="save" />}
        </button>
        <button className="btn ghost icon drawer-toggle right" aria-label={t('ai.studio')} onClick={() => setRightOpen((v) => !v)}>
          <Icon name="spark" />
        </button>
        <button className="btn primary" onClick={() => setShowExport(true)} disabled={doc.clips.length === 0}>
          <Icon name="download" /> <span className="label">{t('editor.export')}</span>
        </button>
      </header>

      <aside className={`panel left${leftOpen ? ' open' : ''}`} aria-label="Media and transcript">
        <MediaPanel session={session} time={time} onSeek={(s) => player.seek(s)} onImport={() => fileRef.current?.click()} />
      </aside>

      <main className="stage">
        <div className="viewer" style={over ? { outline: '2px dashed var(--accent)', outlineOffset: -8 } : undefined}>
          {doc.clips.length === 0 ? (
            <div className="empty-stage">
              <p>{t('editor.emptyTimeline')}</p>
              <button className="btn primary" onClick={() => fileRef.current?.click()}>
                <Icon name="upload" /> {t('editor.import')}
              </button>
            </div>
          ) : (
            <canvas ref={attachCanvas} aria-label="Preview" onClick={() => player.toggle()} />
          )}
        </div>
        <div className="transport">
          <button className="btn icon" onClick={() => player.toggle()} aria-label={playing ? 'Pause' : 'Play'} disabled={!doc.clips.length}>
            <Icon name={playing ? 'pause' : 'play'} />
          </button>
          <span className="timecode" aria-live="off">
            {fmtTime(time, true, doc.fps)} / {fmtTime(duration, true, doc.fps)}
          </span>
          <button className="btn sm" onClick={split} disabled={!doc.clips.length} title="Split at playhead (S)">
            <Icon name="scissors" size={14} /> <span className="label">Split</span>
          </button>
          <span className="spacer" />
          <label className="row small muted">
            <span className="label">Aspect</span>
            <select
              className="select"
              value={doc.aspect}
              onChange={(e) => store.run([{ type: 'set_aspect', aspect: e.target.value as AspectId }], `Aspect ${e.target.value}`)}
            >
              {ASPECT_IDS.map((a) => (
                <option key={a} value={a}>
                  {a} · {ASPECTS[a].name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn sm"
            aria-pressed={doc.captions.enabled}
            onClick={() => store.run([{ type: 'set_captions', enabled: !doc.captions.enabled }], doc.captions.enabled ? 'Captions off' : 'Captions on')}
            title={hasTranscript ? 'Show captions from the transcript' : 'Captions need a transcript (Media → Transcribe)'}
          >
            <Icon name="text" size={14} /> <span className="label">Captions</span>
          </button>
        </div>
      </main>

      <aside className={`panel right${rightOpen ? ' open' : ''}`} aria-label={t('ai.studio')}>
        <Studio
          session={session}
          tab={tab}
          setTab={setTab}
          ask={ask}
          time={time}
          selected={selected}
          onSeek={(s) => player.seek(s)}
          onPlay={() => player.play()}
        />
      </aside>

      <Timeline
        session={session}
        time={time}
        selected={selected}
        onSelect={(id) => {
          setSelected(id);
          if (id) setTab((cur) => (cur === 'ask' ? cur : 'clip'));
        }}
        onSeek={(s) => player.seek(s)}
        onSplit={split}
        onDelete={del}
      />

      {showJobs && <JobsPanel queue={session.jobs} onClose={() => setShowJobs(false)} />}
      {showExport && <ExportDialog session={session} onClose={() => setShowExport(false)} />}
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          void importFiles(files);
        }}
      />
    </div>
  );
}

