import { useEffect, useRef, useState } from 'react';
import type { EditorSession } from '../app/session';
import { EXPORT_PRESETS, exportProject, projectExportSize, type ExportOptions, type ExportResult, type Quality } from '../engine/export';
import { sequenceDuration } from '../engine/timeline';
import { toView } from '../engine/project';
import type { EditView } from '../engine/types';
import { Dialog, Icon, Progress, fmtBytes, fmtTime } from './bits';
import { useJobs } from './Jobs';
import { t } from '../i18n';

type PresetId = 'project' | 'custom' | string;

export function ExportDialog({ session, onClose }: { session: EditorSession; onClose(): void }) {
  const { store } = session;
  const doc = store.doc;
  const proj = projectExportSize(doc);
  const [preset, setPreset] = useState<PresetId>('project');
  const [custom, setCustom] = useState(proj);
  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4');
  const [quality, setQuality] = useState<Quality>('high');
  const [fps, setFps] = useState<number>(doc.fps);
  const [framing, setFraming] = useState<ExportOptions['framing']>('project');
  const [captions, setCaptions] = useState(doc.captions.enabled);
  const [scope, setScope] = useState<'one' | 'all'>('one');
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [results, setResults] = useState<{ id: string; name: string; result: ExportResult; url: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const jobs = useJobs(session.jobs);
  const mine = jobs.filter((j) => jobIds.includes(j.id));
  const job = mine.find((j) => j.state === 'running') ?? mine[mine.length - 1];
  const seqCount = store.sequences.length;
  const hasTranscript = doc.clips.some((c) => store.index[c.assetId]?.transcript);

  const size = preset === 'project' ? proj : preset === 'custom' ? custom : EXPORT_PRESETS.find((p) => p.id === preset)!;
  const aspectMismatch = Math.abs(size.width / size.height - proj.width / proj.height) > 0.01;
  const urlsRef = useRef<string[]>([]);
  useEffect(() => {
    urlsRef.current = results.map((r) => r.url);
  }, [results]);
  // Revoke download links only when the dialog closes.
  useEffect(() => () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const start = () => {
    setError(null);
    setResults([]);
    const idx = store.index;
    const targets: EditView[] =
      scope === 'all' ? store.sequences.map((q) => toView({ ...store.project, activeSequenceId: q.id })) : [store.doc];
    const ids: string[] = [];
    for (const v of targets) {
      if (v.clips.length === 0) continue;
      // "Project" size follows each sequence's own shape.
      const sz = preset === 'project' ? projectExportSize(v) : size;
      const opts: ExportOptions = { width: sz.width, height: sz.height, fps, format, quality, framing, captions };
      const { id } = session.jobs.add(`Export “${v.name}” ${sz.width}×${sz.height} ${format.toUpperCase()}`, 'export', async (ctl) => {
        try {
          const r = await exportProject(v, idx, opts, ctl);
          setResults((prev) => [...prev, { id, name: v.name, result: r, url: URL.createObjectURL(r.blob) }]);
        } catch (e) {
          if (!(e instanceof DOMException && e.name === 'AbortError')) setError(`“${v.name}”: ${e instanceof Error ? e.message : String(e)}`);
          throw e;
        }
      });
      ids.push(id);
    }
    setJobIds(ids);
  };

  const running = mine.some((j) => j.state === 'running' || j.state === 'queued');
  const groups = ['Instagram', 'YouTube', 'TikTok'] as const;

  return (
    <Dialog
      title="Export"
      wide
      onClose={onClose}
      footer={
        running ? (
          <button className="btn" onClick={() => mine.forEach((j) => session.jobs.cancel(j.id))}>
            Cancel export
          </button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              Close
            </button>
            <button className="btn primary" onClick={start} disabled={doc.clips.length === 0}>
              <Icon name="download" /> {scope === 'all' ? `Export ${seqCount} sequences` : `Export ${fmtTime(sequenceDuration(doc.clips))}`}
            </button>
          </>
        )
      }
    >
      {seqCount > 1 && (
        <div className="suggest" role="radiogroup" aria-label="What to export">
          <button className="chip" aria-pressed={scope === 'one'} onClick={() => setScope('one')}>
            This sequence · {doc.name}
          </button>
          <button className="chip" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
            All sequences ({seqCount})
          </button>
        </div>
      )}
      <div className="col">
        <span className="muted small">{t('export.size')}</span>
        <div className="suggest">
          <button className="chip" aria-pressed={preset === 'project'} onClick={() => setPreset('project')}>
            Project · {proj.width}×{proj.height}
          </button>
          <button className="chip" aria-pressed={preset === 'custom'} onClick={() => setPreset('custom')}>
            {t('export.custom')}
          </button>
        </div>
        {groups.map((g) => (
          <div key={g} className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <span className="faint small" style={{ width: 70 }}>
              {g}
            </span>
            {EXPORT_PRESETS.filter((p) => p.group === g).map((p) => (
              <button key={p.id} className="chip" aria-pressed={preset === p.id} onClick={() => setPreset(p.id)} title={`${p.width}×${p.height}`}>
                {p.label}
              </button>
            ))}
          </div>
        ))}
        {preset === 'custom' && (
          <div className="row">
            <label className="field">
              {t('export.width')}
              <input className="input mono" type="number" min={16} max={7680} value={custom.width} onChange={(e) => setCustom({ ...custom, width: Math.max(16, Math.min(7680, +e.target.value || 16)) })} />
            </label>
            <label className="field">
              {t('export.height')}
              <input className="input mono" type="number" min={16} max={7680} value={custom.height} onChange={(e) => setCustom({ ...custom, height: Math.max(16, Math.min(7680, +e.target.value || 16)) })} />
            </label>
          </div>
        )}
        {aspectMismatch && framing === 'project' && (
          <p className="note warn">
            This size is a different shape from the project ({doc.aspect}). Each clip is cropped around its framing point; choose “Fit” to letterbox instead, or change the project aspect first to preview it.
          </p>
        )}
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <label className="field">
          {t('export.format')}
          <select className="select" value={format} onChange={(e) => setFormat(e.target.value as 'mp4' | 'webm')}>
            <option value="mp4">MP4 (H.264 / AAC where available)</option>
            <option value="webm">WebM (VP9 / Opus)</option>
          </select>
        </label>
        <label className="field">
          {t('export.quality')}
          <select className="select" value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
            <option value="standard">{t('export.q.standard')}</option>
            <option value="high">{t('export.q.high')}</option>
            <option value="max">{t('export.q.max')}</option>
          </select>
        </label>
        <label className="field">
          {t('export.fps')}
          <select className="select" value={fps} onChange={(e) => setFps(+e.target.value)}>
            {[24, 25, 30, 50, 60].map((f) => (
              <option key={f} value={f}>
                {f} fps{f === doc.fps ? ' (project)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t('export.framing')}
          <select className="select" value={framing} onChange={(e) => setFraming(e.target.value as ExportOptions['framing'])}>
            <option value="project">{t('export.fr.project')}</option>
            <option value="fill">{t('export.fr.fill')}</option>
            <option value="fit">{t('export.fr.fit')}</option>
          </select>
        </label>
      </div>
      <label className="row small">
        <input type="checkbox" className="check" checked={captions && doc.captions.enabled} disabled={!doc.captions.enabled || !hasTranscript} onChange={(e) => setCaptions(e.target.checked)} />
        Burn in captions {!doc.captions.enabled ? '(captions are off)' : !hasTranscript ? '(no transcript yet)' : `(${doc.captions.style})`}
      </label>

      <p className="faint small">{t('export.local')}</p>

      {mine.length > 1 && (
        <span className="small muted">
          {mine.filter((j) => j.state === 'done').length} of {mine.length} exported
        </span>
      )}
      {job && (
        <div className="col">
          <div className="row small">
            <span className="grow">{job.state === 'running' ? job.detail ?? 'Starting…' : job.state === 'queued' ? 'Waiting for other jobs to finish…' : job.state === 'cancelled' ? 'Export cancelled. Nothing was saved.' : ''}</span>
            {job.state === 'running' && job.progress !== null && <span className="mono">{Math.floor(job.progress * 100)}%</span>}
          </div>
          {running && <Progress value={job.state === 'running' ? job.progress : null} label="Export progress" />}
        </div>
      )}
      {error && <p className="note err">{t('export.failed')} {error}</p>}
      {results.map(({ id, name, result, url }) => (
        <div className="note" key={id}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Icon name="check" />
            <span className="grow">
              <b>{name}</b> · {result.fileName}
              <dl className="export-facts">
                <dt>{t('export.duration')}</dt>
                <dd data-fact="duration">{fmtDuration(result.durationSec)}</dd>
                <dt>{t('export.resolution')}</dt>
                <dd data-fact="resolution">
                  {result.width}×{result.height}
                </dd>
                <dt>{t('export.size')}</dt>
                <dd data-fact="size">{fmtBytes(result.blob.size)}</dd>
                <dt>{t('export.codecs')}</dt>
                <dd data-fact="codecs">
                  {codecName(result.videoCodec)}
                  {result.audioCodec ? ` + ${codecName(result.audioCodec)}` : ' (no audio)'}
                </dd>
                <dt>{t('export.encoded')}</dt>
                <dd data-fact="encoded">{(result.elapsedMs / 1000).toFixed(1)} s</dd>
              </dl>
            </span>
            <a className="btn primary" href={url} download={result.fileName}>
              <Icon name="download" /> {t('export.save')}
            </a>
          </div>
        </div>
      ))}
    </Dialog>
  );
}

const CODEC_NAMES: Record<string, string> = { avc: 'H.264', hevc: 'H.265', vp8: 'VP8', vp9: 'VP9', av1: 'AV1', aac: 'AAC', opus: 'Opus', vorbis: 'Vorbis' };
const codecName = (c: string) => CODEC_NAMES[c] ?? c.toUpperCase();
/** Media length as m:ss.s (e.g. 0:07.1). */
function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec < 10 ? '0' : ''}${sec.toFixed(1)}`;
}
