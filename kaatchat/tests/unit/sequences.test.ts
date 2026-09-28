import { describe, expect, it } from 'vitest';
import { EditorStore } from '../../src/engine/store';
import { reviveProject, toView } from '../../src/engine/project';
import { sequenceDuration } from '../../src/engine/timeline';
import { asset, clip, doc, projectOf } from './helpers';

const A = asset('A', 20);
const base = doc([clip('c1', 'A', 0, 20)], [A]);

describe('project migration', () => {
  it('turns a v2 project into one sequence', () => {
    const p = reviveProject({
      version: 2,
      id: 'p1',
      name: 'Old',
      createdAt: 1,
      updatedAt: 2,
      aspect: '9:16',
      fps: 25,
      assets: { A },
      clips: [clip('c1', 'A', 0, 5)],
      captions: { enabled: true, style: 'podcast', maxWords: 3 },
    });
    expect(p.version).toBe(3);
    expect(p.sequences).toHaveLength(1);
    const v = toView(p);
    expect(v).toMatchObject({ aspect: '9:16', fps: 25, projectName: 'Old', captions: { enabled: true, style: 'podcast' } });
    expect(v.audio).toEqual([]);
    expect(v.overlays).toEqual([]);
  });

  it('rejects damaged files', () => {
    expect(() => reviveProject({ version: 3, id: 'x', assets: {}, sequences: [] })).toThrow();
    expect(() => reviveProject({ version: 3, id: 'x', assets: {}, sequences: [{ id: 's' }] })).toThrow(/damaged/);
  });
});

describe('sequences', () => {
  it('cuts a new sequence from ranges; one undo removes it', () => {
    const s = new EditorStore(projectOf(base));
    const first = s.project.activeSequenceId;
    s.sequenceFromRanges('Clip 1', [{ start: 2, end: 6 }]);
    expect(s.sequences).toHaveLength(2);
    expect(s.project.activeSequenceId).not.toBe(first);
    expect(sequenceDuration(s.doc.clips)).toBeCloseTo(4);
    expect(s.doc.sourceSequenceId).toBe(first);
    s.undo();
    expect(s.sequences).toHaveLength(1);
    expect(s.project.activeSequenceId).toBe(first);
  });

  it('switching sequences is not an undo step, and edits stay in their sequence', () => {
    const s = new EditorStore(projectOf(base));
    const first = s.project.activeSequenceId;
    s.sequenceFromRanges('Short', [{ start: 0, end: 3 }]);
    s.run([{ type: 'set_aspect', aspect: '9:16' }], 'Vertical');
    const before = s.history.length;
    s.setActiveSequence(first);
    expect(s.history.length).toBe(before);
    expect(s.doc.aspect).toBe('16:9');
    expect(s.sequences.find((q) => q.name === 'Short')!.aspect).toBe('9:16');
  });

  it('duplicates with fresh clip ids and refuses to delete the last sequence', () => {
    const s = new EditorStore(projectOf(base));
    s.duplicateSequence();
    expect(s.sequences).toHaveLength(2);
    expect(s.sequences[1].clips[0].id).not.toBe(s.sequences[0].clips[0].id);
    s.deleteSequence(s.sequences[1].id);
    expect(() => s.deleteSequence(s.sequences[0].id)).toThrow(/at least one/);
  });

  it('renames the project through the command system', () => {
    const s = new EditorStore(projectOf(base));
    s.run([{ type: 'rename_project', name: 'New name' }], 'Rename');
    expect(s.project.name).toBe('New name');
    expect(s.doc.projectName).toBe('New name');
  });
});
