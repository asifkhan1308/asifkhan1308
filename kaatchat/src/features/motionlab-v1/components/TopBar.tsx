import { useV1 } from '../store';
import { t, useLang } from '../../../i18n';
import { useShallow } from 'zustand/react/shallow';
import { useCloud } from '../cloud/useCloud';
import { Logo } from '../../../ui/bits';
import ProjectMenu from './ProjectMenu';

interface Props {
  onExport: () => void;
  onShare?: () => void;
  onCloud?: () => void;
  onKeys?: () => void;
}

export default function V1TopBar({ onExport, onShare, onKeys, onCloud }: Props) {
  useLang();
  const cloudLinked = useCloud((s) => !!s.link && !!s.user);
  const others = useCloud(useShallow((s) => s.others));
  const projectName = useV1((s) => s.project.name);
  const renameProject = useV1((s) => s.renameProject);
  const comp = useV1((s) => s.project.composition);
  const setSize = useV1((s) => s.setCompositionSize);
  const setFps = useV1((s) => s.setCompositionFps);
  const setDur = useV1((s) => s.setCompositionDuration);
  const undo = useV1((s) => s.undo);
  const redo = useV1((s) => s.redo);
  const canUndo = useV1((s) => s.canUndo());
  const canRedo = useV1((s) => s.canRedo());

  const PRESETS: Array<{ label: string; w: number; h: number }> = [
    { label: 'HD 1920×1080', w: 1920, h: 1080 },
    { label: 'Vertical 1080×1920', w: 1080, h: 1920 },
    { label: 'Square 1080×1080', w: 1080, h: 1080 },
    { label: '4K 3840×2160', w: 3840, h: 2160 },
  ];

  return (
    <div className="v1-topbar">
      <div className="v1-topbar-left">
        <a className="brand-link" href="#/" aria-label="Kaatchat home">
          <Logo size={22} />
          <span className="brand-name">Kaatchat</span>
        </a>
        <span className="brand-sep" aria-hidden>/</span>
        <div className="logo">MOTIONLAB</div>
        <input
          className="project-name-input"
          value={projectName}
          onChange={(e) => renameProject(e.target.value)}
          spellCheck={false}
        />
        <ProjectMenu />
      </div>

      <div className="v1-topbar-center">
        <select
          className="select-small"
          value={`${comp.width}×${comp.height}`}
          onChange={(e) => {
            const p = PRESETS.find((x) => `${x.w}×${x.h}` === e.target.value);
            if (p) setSize(p.w, p.h);
          }}
        >
          {PRESETS.map((p) => (
            <option key={p.label} value={`${p.w}×${p.h}`}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          className="select-small"
          value={comp.fps}
          onChange={(e) => setFps(Number(e.target.value) as 24 | 25 | 30 | 60)}
        >
          <option value={24}>24 fps</option>
          <option value={25}>25 fps</option>
          <option value={30}>30 fps</option>
          <option value={60}>60 fps</option>
        </select>
        <label className="duration-field">
          <span>Duration</span>
          <input
            type="number"
            min={1}
            max={600}
            step={1}
            value={comp.duration}
            onChange={(e) => setDur(Math.max(1, Number(e.target.value) || 1))}
          />
          <span>s</span>
        </label>
        <label className="v1-bg-field" title="Background colour">
          <span>BG</span>
          <input
            type="color"
            aria-label="Background colour"
            value={/^#[0-9a-f]{6}$/i.test(comp.background) ? comp.background : '#000000'}
            onChange={(e) => useV1.getState().setBackground(e.target.value)}
          />
        </label>
        {/* Motion blur: export always; canvas shows it on paused frames. */}
        <button
          type="button"
          className={`v1-mb-btn${comp.motionBlur?.enabled ? ' on' : ''}`}
          aria-pressed={!!comp.motionBlur?.enabled}
          title="Motion blur — averages sub-frames across the shutter (shown when paused and in exports)"
          onClick={() => useV1.getState().setMotionBlur({ enabled: !comp.motionBlur?.enabled })}
        >
          Motion blur
        </button>
        {comp.motionBlur?.enabled && (
          <select
            className="v1-mb-shutter"
            aria-label="Shutter angle"
            value={Math.round((comp.motionBlur.shutter ?? 0.5) * 360)}
            onChange={(e) => useV1.getState().setMotionBlur({ enabled: true, shutter: Number(e.target.value) / 360 })}
          >
            {[90, 180, 270, 360].map((a) => <option key={a} value={a}>{a}°</option>)}
          </select>
        )}
      </div>

      <div className="v1-topbar-right">
        <button
          className="btn-icon"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (⌘Z)"
          aria-label="Undo"
        >↶</button>
        <button
          className="btn-icon"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (⌘⇧Z)"
          aria-label="Redo"
        >↷</button>
        {onKeys && <button className="btn-icon v1-keys-btn" onClick={onKeys} title="Shortcuts & gestures (?)" aria-label="Shortcuts and gestures">?</button>}
        {others.length > 0 && (
          <span className="v1-presence" title={`Also here: ${others.join(', ')}`} aria-label={`Also editing: ${others.join(', ')}`}>
            {others.slice(0, 3).map((e) => <span key={e} className="v1-presence-dot">{e[0].toUpperCase()}</span>)}
            <span className="v1-presence-text">{others.length === 1 ? `${others[0].split('@')[0]} is here` : `${others.length} others here`}</span>
          </span>
        )}
        {onCloud && (
          <button className={`btn-cloud${cloudLinked ? ' on' : ''}`} onClick={onCloud} title={cloudLinked ? 'In the cloud — sharing, saves' : 'Cloud: sign in, save, work together'}>
            {t('studio.cloud')}{cloudLinked ? ' ●' : ''}
          </button>
        )}
        {onShare && <button className="btn-share" onClick={onShare} title="Share a review link">{t('studio.share')}</button>}
        <button className="btn-export" onClick={onExport}>{t('studio.export')}</button>
      </div>
    </div>
  );
}
