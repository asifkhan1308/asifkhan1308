import { useMemo, useRef, useState } from 'react';
import type { EditorSession } from '../app/session';
import { useStoreVersion } from '../app/hooks';
import { useJobs } from './Jobs';
import type { MediaAsset, Transcript } from '../engine/types';
import { sourceToTimeline, locate } from '../engine/timeline';
import { WHISPER_MODELS } from '../engine/media';
import { usePrefs } from '../app/prefs';
import { Icon, fmtBytes, fmtTime, toast } from './bits';
import { t } from '../i18n';
import { uid } from '../engine/id';

export function MediaPanel({ session, time, onSeek, onImport }: { session: EditorSession; time: number; onSeek(t: number): void; onImport(): void }) {
  const [tab, setTab] = useState<'media' | 'transcript'>('media');
  return (
    <>
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === 'media'} onClick={() => setTab('media')}>
          {t('editor.media')}
        </button>
        <button className="tab" role="tab" aria-selected={tab === 'transcript'} onClick={() => setTab('transcript')}>
          {t('editor.transcript')}
        </button>
      </div>
      <div className="panel-body" role="tabpanel">
        {tab === 'media' ? <MediaBin session={session} onImport={onImport} /> : <TranscriptView session={session} time={time} onSeek={onSeek} />}
      </div>
    </>
  );
}

function MediaBin({ session, onImport }: { session: EditorSession; onImport(): void }) {
  useStoreVersion(session);
  const jobs = useJobs(session.jobs);
  const prefs = usePrefs();
  const { store } = session;
  const assets = Object.values(store.doc.assets).sort((a, b) => a.addedAt - b.addedAt);
  const relinkRef = useRef<HTMLInputElement>(null);
  const subsRef = useRef<HTMLInputElement>(null);
  const target = useRef<MediaAsset | null>(null);
  const model = WHISPER_MODELS.find((m) => m.id === prefs.whisperModel) ?? WHISPER_MODELS[0];

  return (
    <>
      <button className="btn primary" onClick={onImport}>
        <Icon name="upload" /> {t('editor.import')}
      </button>
      {assets.length === 0 && <p className="muted small">Videos and images you import appear here. They are read from your disk, never uploaded.</p>}
      {assets.map((a) => {
        const idx = store.index[a.id] ?? {};
        const running = jobs.filter((j) => j.group === `asset:${a.id}` && (j.state === 'running' || j.state === 'queued'));
        const transcribing = running.some((j) => j.label.startsWith('Transcribe'));
        return (
          <div className="asset" key={a.id}>
            {a.kind === 'audio' ? (
              <div className="thumb audio" aria-hidden="true">
                ♪
              </div>
            ) : (
              <div className="thumb" style={idx.thumbs?.[0] ? { backgroundImage: `url(${idx.thumbs[0].url})` } : undefined} />
            )}
            <div className="meta">
              <span className="ellipsis" title={a.name}>
                {a.name}
              </span>
              <span className="faint tiny mono">
                {a.kind === 'image' ? 'image' : fmtTime(a.duration)}
                {a.kind === 'audio' ? ' · audio' : ` · ${a.width}×${a.height}`} · {fmtBytes(a.size)}
              </span>
              <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                {a.storage === 'missing' && <span className="badge err">Needs relink</span>}
                {a.storage === 'session' && <span className="badge warn" title="Too large to copy into browser storage">This session only</span>}
                {running.length > 0 && <span className="badge"><span className="spin" style={{ width: 10, height: 10 }} /> {running.length} job{running.length > 1 ? 's' : ''}</span>}
                {idx.audio && <span className="badge ok" title={`Level ${idx.audio.levelDb.toFixed(1)} dBFS`}>Loudness</span>}
                {idx.framing && <span className="badge ok">Framing</span>}
                {idx.transcript && <span className="badge ok" title={idx.transcript.model}>Transcript</span>}
                {idx.beats && <span className="badge ok" title={`Beat confidence ${Math.round(idx.beats.confidence * 100)}%`}>{Math.round(idx.beats.bpm)} bpm</span>}
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {a.storage === 'missing' ? (
                  <button className="btn sm" onClick={() => { target.current = a; relinkRef.current?.click(); }}>
                    <Icon name="link" size={13} /> Relink
                  </button>
                ) : (
                  <button
                    className="btn sm"
                    title="Add another copy of this clip to the end of the timeline"
                    onClick={() =>
                      store.mutate(`Add ${a.name}`, (d) =>
                        a.kind === 'audio'
                          ? { ...d, audio: [...d.audio, { id: uid(), assetId: a.id, start: 0, in: 0, out: a.duration, gainDb: -6, fadeIn: 0.5, fadeOut: 1, duck: true }] }
                          : { ...d, clips: [...d.clips, { id: uid(), assetId: a.id, in: 0, out: a.duration, gainDb: 0, focusX: 0.5, focusY: 0.5, fit: 'fill' }] },
                      )
                    }
                  >
                    <Icon name="plus" size={13} /> Add
                  </button>
                )}
                {a.kind === 'video' && a.hasAudio && a.storage !== 'missing' && (
                  <button
                    className="btn sm"
                    disabled={transcribing}
                    title={`Local ${model.label}. Downloaded once from Hugging Face (${t('common.requiresInternet').toLowerCase()} the first time), then cached. Audio never leaves this device.`}
                    onClick={() => session.transcribe(a)}
                  >
                    <Icon name="text" size={13} /> {idx.transcript ? 'Re-transcribe' : 'Transcribe'}
                  </button>
                )}
                {a.kind === 'video' && (
                  <button className="btn sm ghost" title="Use an existing .srt or .vtt file as the transcript" onClick={() => { target.current = a; subsRef.current?.click(); }}>
                    .srt / .vtt
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
      <input
        ref={relinkRef}
        type="file"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f || !target.current) return;
          try {
            await session.relink(target.current, f);
            toast(`Relinked “${f.name}”.`);
          } catch (err) {
            toast(err instanceof Error ? err.message : String(err), 'err');
          }
        }}
      />
      <input
        ref={subsRef}
        type="file"
        accept=".srt,.vtt,text/vtt"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f || !target.current) return;
          try {
            const n = await session.importSubtitles(target.current, f);
            toast(`Imported ${n} subtitle cues as the transcript (word timing is approximate).`);
          } catch (err) {
            toast(err instanceof Error ? err.message : String(err), 'err');
          }
        }}
      />
    </>
  );
}

function TranscriptView({ session, time, onSeek }: { session: EditorSession; time: number; onSeek(t: number): void }) {
  useStoreVersion(session);
  const { store } = session;
  const doc = store.doc;
  const [sel, setSel] = useState<{ assetId: string; a: [number, number]; b: [number, number] } | null>(null);

  const withTranscripts = useMemo(() => {
    const seen = new Set<string>();
    const out: { asset: MediaAsset; tr: Transcript }[] = [];
    for (const c of doc.clips) {
      const tr = store.index[c.assetId]?.transcript;
      if (tr && !seen.has(c.assetId)) {
        seen.add(c.assetId);
        out.push({ asset: doc.assets[c.assetId], tr });
      }
    }
    return out;
  }, [doc, store.index]);

  const here = locate(doc.clips, time);

  if (withTranscripts.length === 0)
    return (
      <div className="col">
        <p className="muted">No transcript yet.</p>
        <p className="faint small">
          Use <b>Transcribe</b> in the Media tab (local Whisper, runs on this device) or load an existing .srt/.vtt file. Then delete words here to cut the video.
        </p>
      </div>
    );

  const inSel = (assetId: string, si: number, wi: number) => {
    if (!sel || sel.assetId !== assetId) return false;
    const k = si * 1e5 + wi;
    const a = sel.a[0] * 1e5 + sel.a[1];
    const b = sel.b[0] * 1e5 + sel.b[1];
    return k >= Math.min(a, b) && k <= Math.max(a, b);
  };

  const cutSelection = () => {
    if (!sel) return;
    const item = withTranscripts.find((x) => x.asset.id === sel.assetId);
    if (!item) return;
    const ranges: { start: number; end: number }[] = [];
    item.tr.segments.forEach((s, si) => s.words.forEach((w, wi) => inSel(sel.assetId, si, wi) && ranges.push({ start: w.t0, end: w.t1 })));
    if (!ranges.length) return;
    try {
      store.run([{ type: 'remove_words', assetId: sel.assetId, ranges }], `Cut ${ranges.length} word${ranges.length > 1 ? 's' : ''}`);
      setSel(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err');
    }
  };

  return (
    <div className="col">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn sm" disabled={!sel} onClick={cutSelection} title="Remove the selected words from the video">
          <Icon name="scissors" size={13} /> Cut selection
        </button>
        <button
          className="btn sm"
          onClick={() => {
            try {
              const notes = store.run([{ type: 'remove_fillers' }], 'Remove fillers');
              toast(notes.join(' · '));
            } catch (e) {
              toast(e instanceof Error ? e.message : String(e), 'err');
            }
          }}
        >
          Remove um/uh
        </button>
      </div>
      <p className="faint tiny">Click a word to jump; shift-click to select a range. Struck-through words are already cut.</p>
      {withTranscripts.map(({ asset, tr }) => (
        <div key={asset.id} className="transcript">
          {withTranscripts.length > 1 && <h3 style={{ marginBottom: 6 }}>{asset.name}</h3>}
          {tr.segments.map((s, si) => (
            <p className="seg" key={si}>
              <span className="ts">{fmtTime(s.t0)}</span>
              {s.words.map((w, wi) => {
                const hits = sourceToTimeline(doc.clips, asset.id, (w.t0 + w.t1) / 2);
                const cut = hits.length === 0;
                const now = !!here && here.clip.assetId === asset.id && here.sourceTime >= w.t0 && here.sourceTime < w.t1;
                return (
                  <span
                    key={wi}
                    className={`w${cut ? ' cut' : ''}${inSel(asset.id, si, wi) ? ' sel' : ''}${now ? ' now' : ''}`}
                    onClick={(e) => {
                      if (e.shiftKey && sel && sel.assetId === asset.id) setSel({ ...sel, b: [si, wi] });
                      else {
                        setSel({ assetId: asset.id, a: [si, wi], b: [si, wi] });
                        if (!cut) onSeek(hits[0]);
                      }
                    }}
                  >
                    {w.text}{' '}
                  </span>
                );
              })}
            </p>
          ))}
          <p className="faint tiny">{tr.model}</p>
        </div>
      ))}
    </div>
  );
}
