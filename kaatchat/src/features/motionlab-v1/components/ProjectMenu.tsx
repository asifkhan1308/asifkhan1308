import { useEffect, useRef, useState } from 'react';
import { useV1 } from '../store';
import {
  deleteProject,
  downloadProject,
  importProjectFromText,
  listProjects,
  type ProjectSummary,
} from '../engine/persist';

/* Dropdown next to the Kaatchat brand: New · Open · Save · Save As · Download
 * .kaatchat · Import .kaatchat · Recent projects list. */
export default function ProjectMenu() {
  const project = useV1((s) => s.project);
  const newProject = useV1((s) => s.newProject);
  const saveToStorage = useV1((s) => s.saveToStorage);
  const loadFromStorage = useV1((s) => s.loadFromStorage);
  const replaceProject = useV1((s) => s.replaceProject);
  const savedAt = useV1((s) => s.savedAt);
  const isDirty = useV1((s) => s.isDirty);

  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<ProjectSummary[]>([]);
  const [err, setErr] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const panelRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const onDoc = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [open]);

  const refresh = async () => {
    try {
      setRecent(await listProjects());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const save = async () => {
    try {
      await saveToStorage();
      setStatus('Saved');
      setTimeout(() => setStatus(''), 1500);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const open_ = async (id: string) => {
    try {
      await loadFromStorage(id);
      setOpen(false);
      setStatus('Opened');
      setTimeout(() => setStatus(''), 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this project? This cannot be undone.')) return;
    try {
      await deleteProject(id);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const importFile = async (f: File) => {
    try {
      const text = await f.text();
      const parsed = importProjectFromText(text);
      replaceProject(parsed);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const savedBadge =
    status || (isDirty ? 'Unsaved' : savedAt ? `Saved ${timeAgo(savedAt)}` : 'Not saved');

  return (
    <div className="v1-project-menu" ref={panelRef}>
      <button className="v1-menu-trigger" onClick={() => setOpen(!open)} title="Project menu">
        File ▾
      </button>
      <span className="v1-save-badge" title={savedAt ? new Date(savedAt).toLocaleString() : 'Not saved'}>
        {savedBadge}
      </span>
      {open && (
        <div className="v1-menu-panel">
          <button className="v1-menu-item" onClick={() => { newProject(); setOpen(false); }}>
            <span>New project</span>
            <span className="kbd">⌘N</span>
          </button>
          <button className="v1-menu-item" onClick={() => void save()}>
            <span>Save</span>
            <span className="kbd">⌘S</span>
          </button>
          <button className="v1-menu-item" onClick={() => { downloadProject(project); }}>
            <span>Download .kaatchat</span>
          </button>
          <button className="v1-menu-item" onClick={() => fileRef.current?.click()}>
            <span>Import .kaatchat…</span>
          </button>
          <div className="v1-menu-sep" />
          <div className="v1-menu-head">Recent</div>
          {recent.length === 0 ? (
            <div className="v1-menu-empty">No saved projects yet.</div>
          ) : (
            <div className="v1-menu-list">
              {recent.slice(0, 8).map((r) => (
                <div key={r.id} className={`v1-menu-recent${r.id === project.id ? ' current' : ''}`}>
                  <button className="v1-menu-recent-main" onClick={() => void open_(r.id)}>
                    <span className="v1-menu-recent-name">
                      {r.name} {r.hasNewerAutosave && <em title="Newer autosave available">●</em>}
                    </span>
                    <span className="v1-menu-recent-meta">
                      {r.width}×{r.height} · {r.layerCount} layer{r.layerCount === 1 ? '' : 's'} · {timeAgo(r.savedAt)}
                    </span>
                  </button>
                  <button className="v1-menu-recent-del" onClick={() => void remove(r.id)} title="Delete">×</button>
                </div>
              ))}
            </div>
          )}
          {err && <div className="v1-menu-err">{err}</div>}
          <input
            ref={fileRef}
            type="file"
            accept=".kaatchat,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              if (e.target) e.target.value = '';
            }}
          />
        </div>
      )}
    </div>
  );
}

function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
