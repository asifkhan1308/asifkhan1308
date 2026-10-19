import { useEffect } from 'react';

/* Every shortcut and gesture in one place (press ? in the editor). Keep in
 * sync with the handlers in MotionLabV1.tsx, Timeline.tsx and CanvasHandles. */
const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
const GROUPS: Array<{ title: string; rows: Array<[string, string]> }> = [
  {
    title: 'Playback',
    rows: [
      ['Space', 'Play / pause'],
      ['Home / End', 'Jump to start / end'],
      ['← / →', 'Previous / next frame'],
      ['⇧ ← / ⇧ →', 'Back / forward 10 frames'],
      ['M', 'Add a marker at the playhead (double-click to rename)'],
      ['B / N', 'Work area start / end at the playhead (loops playback; export can use it)'],
    ],
  },
  {
    title: 'Layers',
    rows: [
      ['Shift / ' + mod + '-click', 'Add or remove from the selection'],
      [mod + ' A', 'Select all'],
      ['Esc', 'Clear the selection'],
      ['Delete', 'Delete selected'],
      [mod + ' D', 'Duplicate selected'],
      [mod + ' C / ' + mod + ' V', 'Copy / paste (keyframes at the playhead, else layers)'],
      ['K', 'Split the selected clip at the playhead'],
      ['Double-click name', 'Rename'],
      ['Drag name', 'Restack'],
    ],
  },
  {
    title: 'Canvas',
    rows: [
      ['Drag', 'Move (snaps to the frame and other layers)'],
      ['Alt + drag', 'Move without snapping'],
      ['Alt + arrows', 'Nudge the selection 1 px (add Shift for 10 px)'],
      ['Corner / edge handles', 'Scale · top knob rotates'],
    ],
  },
  {
    title: 'Timeline',
    rows: [
      [mod + ' + scroll', 'Zoom around the cursor'],
      ['Drag clip / edges', 'Move / trim (snaps; Alt to bypass)'],
      ['Drag a diamond', 'Move keyframes'],
    ],
  },
  {
    title: 'Project',
    rows: [
      [mod + ' Z / ' + mod + ' ⇧ Z', 'Undo / redo'],
      [mod + ' S', 'Save'],
      [mod + ' N', 'New project'],
      ['?', 'This sheet'],
    ],
  },
];

export default function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal v1-keys" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts">
        <div className="modal-header">
          <h2>Shortcuts & gestures</h2>
          <button className="btn-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-content v1-keys-grid">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <dl>
                {g.rows.map(([k, v]) => (
                  <div key={k} className="v1-keys-row"><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
