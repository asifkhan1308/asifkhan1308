import { useState } from 'react';
import type { EditorSession } from '../app/session';
import { useStoreVersion } from '../app/hooks';
import { newSequence } from '../engine/project';
import { sequenceDuration } from '../engine/timeline';
import { Icon, fmtTime, toast } from './bits';

/** One tab per sequence (edit). A project can hold many — e.g. one per Reel. */
export function SequenceTabs({ session }: { session: EditorSession }) {
  useStoreVersion(session);
  const { store } = session;
  const seqs = store.sequences;
  const activeId = store.project.activeSequenceId;
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="seqbar" role="tablist" aria-label="Sequences">
      {seqs.map((s) => (
        <div key={s.id} className="seqtab" aria-selected={s.id === activeId} role="tab">
          {editing === s.id ? (
            <input
              className="input"
              autoFocus
              defaultValue={s.name}
              aria-label="Sequence name"
              onBlur={(e) => {
                store.renameSequence(s.id, e.target.value);
                setEditing(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditing(null);
              }}
            />
          ) : (
            <button
              className="seqname"
              onClick={() => store.setActiveSequence(s.id)}
              onDoubleClick={() => setEditing(s.id)}
              title="Double-click to rename"
            >
              <span className="ellipsis">{s.name}</span>
              <span className="mono faint tiny">
                {s.aspect} · {fmtTime(sequenceDuration(s.clips))}
              </span>
            </button>
          )}
          {s.id === activeId && seqs.length > 1 && (
            <button
              className="btn ghost sm icon"
              aria-label={`Delete sequence ${s.name}`}
              onClick={() => {
                if (!confirm(`Delete the sequence “${s.name}”? You can undo this.`)) return;
                try {
                  store.deleteSequence(s.id);
                } catch (e) {
                  toast(e instanceof Error ? e.message : String(e), 'err');
                }
              }}
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      ))}
      <button
        className="btn ghost sm"
        title="New empty sequence"
        onClick={() => store.createSequence(newSequence(`Sequence ${seqs.length + 1}`, store.doc.aspect))}
      >
        <Icon name="plus" size={13} /> <span className="label">New</span>
      </button>
      <button className="btn ghost sm" title="Duplicate this sequence" onClick={() => store.duplicateSequence()}>
        <Icon name="layers" size={13} /> <span className="label">Duplicate</span>
      </button>
    </div>
  );
}
