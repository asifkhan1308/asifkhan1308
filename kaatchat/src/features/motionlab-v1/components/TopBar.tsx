import { useV1 } from '../store';
import { Logo } from '../../../ui/bits';

interface Props {
  onExport: () => void;
}

export default function V1TopBar({ onExport }: Props) {
  const projectName = useV1((s) => s.project.name);
  const renameProject = useV1((s) => s.renameProject);
  const comp = useV1((s) => s.project.composition);
  const setSize = useV1((s) => s.setCompositionSize);
  const setFps = useV1((s) => s.setCompositionFps);
  const setDur = useV1((s) => s.setCompositionDuration);

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
      </div>

      <div className="v1-topbar-right">
        <button className="btn-export" onClick={onExport}>Export</button>
      </div>
    </div>
  );
}
