import { useEffect, useRef, useState } from 'react';
import { Brand, Icon, fmtTime, toast } from './bits';
import { t } from '../i18n';
import { deleteProject, listProjects, saveProject, type ProjectSummary } from '../engine/persist';
import { newProject } from '../engine/project';
import { ACCEPT } from '../engine/formats';
import { pendingImport } from './pending';
import { DownloadCard } from './Download';

export function Home() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [over, setOver] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () =>
    listProjects()
      .then(setProjects)
      .catch((e) => {
        setProjects([]);
        setStorageError(`Local storage is unavailable (${e instanceof Error ? e.message : e}). Projects cannot be saved in this window.`);
      });
  useEffect(() => {
    void refresh();
  }, []);

  const start = async (files?: File[]) => {
    const doc = newProject(files?.[0] ? files[0].name.replace(/\.[^.]+$/, '') : 'Untitled project');
    try {
      await saveProject(doc);
    } catch {
      toast('Could not save to local storage; this project will not be kept after closing.', 'err');
    }
    if (files?.length) pendingImport.set(doc.id, files);
    location.hash = `#/p/${doc.id}`;
  };

  const remove = async (p: ProjectSummary) => {
    if (!confirm(`Delete “${p.name}” and the copies of its media stored in this browser? Your original files are not affected.`)) return;
    await deleteProject(p.id);
    void refresh();
  };

  return (
    <div
      className="page"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...e.dataTransfer.files];
        if (files.length) void start(files);
      }}
    >
      <div className="page-inner">
        <nav className="page-top" aria-label="Main">
          <Brand />
          <span className="spacer" />
          <a className="btn ghost" href="#/motionlab-v1">
            <Icon name="spark" /> <span className="label">Studio</span>
          </a>
          <a className="btn ghost" href="#/motionlab">
            <Icon name="spark" /> <span className="label">Motion Design</span>
          </a>
          <a className="btn ghost" href="#/privacy">
            <Icon name="shield" /> <span className="label">{t('nav.privacy')}</span>
          </a>
          <a className="btn ghost" href="#/settings">
            <Icon name="settings" /> <span className="label">{t('nav.settings')}</span>
          </a>
        </nav>

        <header className="hero">
          <h1>{t('app.tagline')}</h1>
          <p className="lead">{t('app.sub')}</p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" /> Import videos
            </button>
            <button className="btn" onClick={() => void start()}>
              <Icon name="plus" /> {t('home.new')}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              if (files.length) void start(files);
            }}
          />
        </header>

        <div className={`dropzone${over ? ' over' : ''}`} aria-hidden="true">
          <Icon name="upload" size={22} />
          <span>{t('home.drop')}</span>
          <span className="faint small">Decoded and processed on this device. Nothing is uploaded.</span>
        </div>

        <DownloadCard />

        {storageError && <p className="note err" style={{ marginTop: 16 }}>{storageError}</p>}

        <section className="section" aria-labelledby="projects-h">
          <h2 id="projects-h">{t('home.projects')}</h2>
          {projects === null ? (
            <div className="spin" aria-label="Loading" />
          ) : projects.length === 0 ? (
            <p className="muted">{t('home.empty')}</p>
          ) : (
            <div className="projects">
              {projects.map((p) => (
                <div key={p.id} className="card project" role="link" tabIndex={0}
                  onClick={() => (location.hash = `#/p/${p.id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && (location.hash = `#/p/${p.id}`)}>
                  <div className="row">
                    <h3 className="grow ellipsis">{p.name}</h3>
                    <button className="btn ghost sm icon" aria-label={`Delete ${p.name}`} onClick={(e) => { e.stopPropagation(); void remove(p); }}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                  <span className="faint small mono">
                    {p.aspect} · {fmtTime(p.duration)} · {p.clips} clip{p.clips === 1 ? '' : 's'}
                  </span>
                  <span className="faint tiny">{new Date(p.savedAt).toLocaleString()}</span>
                  {p.hasNewerAutosave && <span className="badge warn">{t('home.recovered')}</span>}
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="section faint small">
          <p>
            Kaatchat is MPL-2.0 · Asif Khan · built on Mediabunny (MPL-2.0), with thanks to WolfCut. Inter and JetBrains Mono are
            SIL OFL 1.1.
          </p>
        </footer>
      </div>
    </div>
  );
}
