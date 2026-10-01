import { useEditorStore } from '../store/editorStore';

interface TopBarProps {
  onExport: () => void;
}

export default function TopBar({ onExport }: TopBarProps) {
  const currentProject = useEditorStore((s) => s.currentProject);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying);
  const setAspectRatio = useEditorStore((s) => s.setAspectRatio);

  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="logo">MOTIONLAB</div>
        <div className="project-name">{currentProject?.name || 'Untitled'}</div>
      </div>
      <div className="topbar-center">
        <button onClick={undo} className="btn-icon" title="Undo (Ctrl+Z)">↶</button>
        <button onClick={redo} className="btn-icon" title="Redo (Ctrl+Shift+Z)">↷</button>
        <button onClick={() => setIsPlaying(!isPlaying)} className="btn-play" title="Play/Pause">
          {isPlaying ? '⏸' : '▶'}
        </button>
      </div>
      <div className="topbar-right">
        <select
          className="select-small"
          value={currentProject?.aspectRatio || '16:9'}
          onChange={(e) => setAspectRatio(e.target.value as any)}
        >
          <option value="16:9">16:9</option>
          <option value="4:3">4:3</option>
          <option value="1:1">1:1</option>
          <option value="9:16">9:16</option>
          <option value="4:5">4:5</option>
          <option value="3:4">3:4</option>
        </select>
        <button className="btn-export" onClick={onExport}>Export</button>
      </div>
    </div>
  );
}
