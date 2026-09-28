import { useSyncExternalStore } from 'react';
import type { JobQueue, Job } from '../engine/jobs';
import { Icon, Progress } from './bits';
import { t } from '../i18n';

export function useJobs(q: JobQueue): Job[] {
  return useSyncExternalStore(q.subscribe, q.getSnapshot);
}

const stateLabel: Record<Job['state'], string> = {
  queued: 'Waiting',
  running: '',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function JobsPanel({ queue, onClose }: { queue: JobQueue; onClose: () => void }) {
  const jobs = useJobs(queue);
  return (
    <section className="card jobs" aria-label={t('jobs.title')}>
      <div className="row">
        <h3 className="grow">{t('jobs.title')}</h3>
        {jobs.some((j) => j.state !== 'running' && j.state !== 'queued') && (
          <button className="btn ghost sm" onClick={() => queue.clearFinished()}>
            Clear finished
          </button>
        )}
        <button className="btn ghost sm icon" onClick={onClose} aria-label={t('common.close')}>
          <Icon name="x" size={14} />
        </button>
      </div>
      {jobs.length === 0 && <p className="muted small">{t('jobs.none')}</p>}
      {jobs
        .slice()
        .reverse()
        .map((j) => (
          <div className="job" key={j.id}>
            <div className="row small">
              <span className="grow ellipsis">{j.label}</span>
              {j.state === 'running' && j.progress !== null && <span className="mono faint">{Math.floor(j.progress * 100)}%</span>}
              {stateLabel[j.state] && (
                <span className={`badge ${j.state === 'done' ? 'ok' : j.state === 'failed' ? 'err' : ''}`}>{stateLabel[j.state]}</span>
              )}
              {(j.state === 'running' || j.state === 'queued') && (
                <button className="btn ghost sm" onClick={() => queue.cancel(j.id)}>
                  Cancel
                </button>
              )}
            </div>
            {j.state === 'running' && <Progress value={j.progress} label={j.label} />}
            {j.detail && j.state === 'running' && <span className="faint tiny">{j.detail}</span>}
            {j.error && <span className="tiny" style={{ color: 'var(--danger)' }}>{j.error}</span>}
          </div>
        ))}
    </section>
  );
}
