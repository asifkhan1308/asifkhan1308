import { useEffect, useMemo, useState } from 'react';
import type { EditorSession } from '../app/session';
import { EXPORT_PRESETS, exportProject, projectExportSize, type ExportOptions, type ExportResult, type Quality } from '../engine/export';
import { sequenceDuration } from '../engine/timeline';
import { Dialog, Icon, Progress, fmtBytes, fmtTime } from './bits';
import { useJobs } from './Jobs';

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
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const jobs = useJobs(session.jobs);
  const job = jobs.find((j) => j.id === jobId);
  const hasTranscript = doc.clips.some((c) => store.index[c.assetId]?.transcript);

  const size = preset === 'project' ? proj : preset === 'custom' ? custom : EXPORT_PRESETS.find((p) => p.id === preset)!;
  const aspectMismatch = Math.abs(size.width / size.height - proj.width / proj.height) > 0.01;
  const url = useMemo(() => (result ? URL.createObjectURL(result.blob) : null), [result]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const start = () => {
    setError(null);
    setResult(null);
    const opts: ExportOptions = { width: size.width, height: size.height, fps, format, quality, framing, captions };
    const snapshot = store.doc;
    const idx = store.index;
    const { id } = session.jobs.add(`Export ${size.width}×${size.height} ${format.toUpperCase()}`, 'export', async (ctl) => {
      try {
        const r = await exportProject(snapshot, idx, opts, ctl);
        setResult(r);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e));
        throw e;
      }
    });
    setJobId(id);
  };

  const running = job && (job.state === 'running' || job.state === 'queued');
  const groups = ['Instagram', 'YouTube', 'TikTok'] as const;

  return (
    <Dialog
      title="Export"
      wide
      onClose={onClose}
      footer={
        running ? (
          <button className="btn" onClick={() => session.jobs.cancel(job!.id)}>
            Cancel export
          </button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              Close
            </button>
            <button className="btn primary" onClick={start} disabled={doc.clips.length === 0}>
              <Icon name="download" /> Export {fmtTime(sequenceDuration(doc.clips))}
            </button>
          </>
        )
      }
    >
      <div className="col">
        <span className="muted small">Size</span>
        <div className="suggest">
          <button className="chip" aria-pressed={preset === 'project'} onClick={() => setPreset('project')}>
            Project · {proj.width}×{proj.height}
          </button>
          <button className="chip" aria-pressed={preset === 'custom'} onClick={() => setPreset('custom')}>
            Custom
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
              Width
              <input className="input mono" type="number" min={16} max={7680} value={custom.width} onChange={(e) => setCustom({ ...custom, width: Math.max(16, Math.min(7680, +e.target.value || 16)) })} />
            </label>
            <label className="field">
              Height
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
          Format
          <select className="select" value={format} onChange={(e) => setFormat(e.target.value as 'mp4' | 'webm')}>
            <option value="mp4">MP4 (H.264 / AAC where available)</option>
            <option value="webm">WebM (VP9 / Opus)</option>
          </select>
        </label>
        <label className="field">
          Quality
          <select className="select" value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
            <option value="standard">Standard</option>
            <option value="high">High</option>
            <option value="max">Maximum</option>
          </select>
        </label>
        <label className="field">
          Frame rate
          <select className="select" value={fps} onChange={(e) => setFps(+e.target.value)}>
            {[24, 25, 30, 50, 60].map((f) => (
              <option key={f} value={f}>
                {f} fps{f === doc.fps ? ' (project)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Framing
          <select className="select" value={framing} onChange={(e) => setFraming(e.target.value as ExportOptions['framing'])}>
            <option value="project">Project (per clip)</option>
            <option value="fill">Fill (crop)</option>
            <option value="fit">Fit (letterbox)</option>
          </select>
        </label>
      </div>
      <label className="row small">
        <input type="checkbox" className="check" checked={captions && doc.captions.enabled} disabled={!doc.captions.enabled || !hasTranscript} onChange={(e) => setCaptions(e.target.checked)} />
        Burn in captions {!doc.captions.enabled ? '(captions are off)' : !hasTranscript ? '(no transcript yet)' : `(${doc.captions.style})`}
      </label>

      <p className="faint small">Encoded on this device with WebCodecs. Nothing is uploaded.</p>

      {job && (
        <div className="col">
          <div className="row small">
            <span className="grow">{job.state === 'running' ? job.detail ?? 'Starting…' : job.state === 'queued' ? 'Waiting for other jobs to finish…' : job.state === 'cancelled' ? 'Export cancelled. Nothing was saved.' : ''}</span>
            {job.state === 'running' && job.progress !== null && <span className="mono">{Math.floor(job.progress * 100)}%</span>}
          </div>
          {running && <Progress value={job.state === 'running' ? job.progress : null} label="Export progress" />}
        </div>
      )}
      {error && <p className="note err">Export failed: {error}</p>}
      {result && url && (
        <div className="note">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Icon name="check" />
            <span className="grow">
              {result.fileName} · {fmtBytes(result.blob.size)} · {result.videoCodec.toUpperCase()}
              {result.audioCodec ? ` + ${result.audioCodec.toUpperCase()}` : ''} · encoded in {(result.elapsedMs / 1000).toFixed(1)}s
            </span>
            <a className="btn primary" href={url} download={result.fileName}>
              <Icon name="download" /> Save file
            </a>
          </div>
        </div>
      )}
    </Dialog>
  );
}
