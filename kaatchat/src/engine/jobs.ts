// Global processing queue. Progress is only ever what the job measured
// (e.g. seconds decoded / total seconds); jobs that cannot measure progress
// report `null` and the UI shows an indeterminate state instead of a number.

import { uid } from './id';

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  label: string;
  group: string;
  state: JobState;
  progress: number | null;
  detail?: string;
  error?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface JobControl {
  signal: AbortSignal;
  progress(p: number | null, detail?: string): void;
}

type Runner = (ctl: JobControl) => Promise<void>;

interface Entry {
  job: Job;
  run: Runner;
  ac: AbortController;
  done: Promise<void>;
  resolve: () => void;
}

export class JobQueue {
  private entries: Entry[] = [];
  private running = 0;
  private listeners = new Set<() => void>();
  private snapshot: Job[] = [];

  constructor(private concurrency = 1) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snapshot;

  private emit() {
    this.snapshot = this.entries.map((e) => ({ ...e.job }));
    for (const l of this.listeners) l();
  }

  add(label: string, group: string, run: Runner): { id: string; done: Promise<void> } {
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const entry: Entry = { job: { id: uid(), label, group, state: 'queued', progress: null }, run, ac: new AbortController(), done, resolve };
    this.entries.push(entry);
    this.emit();
    this.pump();
    return { id: entry.job.id, done };
  }

  cancel(id: string) {
    const e = this.entries.find((x) => x.job.id === id);
    if (!e) return;
    if (e.job.state === 'queued') {
      e.job.state = 'cancelled';
      e.job.endedAt = Date.now();
      e.resolve();
      this.emit();
    } else if (e.job.state === 'running') e.ac.abort();
  }

  /**
   * Resolves once every listed job has finished, failed or been cancelled,
   * with their final states. Unknown ids count as settled.
   */
  async whenSettled(ids: string[]): Promise<Job[]> {
    const entries = ids.map((id) => this.entries.find((e) => e.job.id === id)).filter((e): e is Entry => !!e);
    await Promise.all(entries.map((e) => e.done));
    return entries.map((e) => ({ ...e.job }));
  }

  cancelGroup(group: string) {
    for (const e of this.entries) if (e.job.group === group) this.cancel(e.job.id);
  }

  clearFinished() {
    this.entries = this.entries.filter((e) => e.job.state === 'queued' || e.job.state === 'running');
    this.emit();
  }

  private pump() {
    while (this.running < this.concurrency) {
      const next = this.entries.find((e) => e.job.state === 'queued');
      if (!next) return;
      this.start(next);
    }
  }

  private async start(e: Entry) {
    this.running++;
    e.job.state = 'running';
    e.job.startedAt = Date.now();
    this.emit();
    let last = 0;
    try {
      await e.run({
        signal: e.ac.signal,
        progress: (p, detail) => {
          e.job.progress = p === null ? null : Math.max(0, Math.min(1, p));
          if (detail !== undefined) e.job.detail = detail;
          const now = performance.now();
          if (now - last > 100 || p === 1) {
            last = now;
            this.emit();
          }
        },
      });
      e.job.state = e.ac.signal.aborted ? 'cancelled' : 'done';
    } catch (err) {
      if (e.ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) e.job.state = 'cancelled';
      else {
        e.job.state = 'failed';
        e.job.error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      e.job.endedAt = Date.now();
      this.running--;
      e.resolve();
      this.emit();
      this.pump();
    }
  }
}

/** Jobs that are waiting or running — the only ones the UI calls "processing". */
export function activeJobCount(jobs: readonly Job[]): number {
  return jobs.filter((j) => j.state === 'running' || j.state === 'queued').length;
}

export function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
}
