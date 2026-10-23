import { describe, expect, it } from 'vitest';
import { createHistory } from '../../src/features/motionlab-v1/engine/history';
import { defaultProject, newRectangleLayer, newTextLayer } from '../../src/features/motionlab-v1/engine/defaults';
import type { Layer, Project } from '../../src/features/motionlab-v1/types';

const withLayers = (p: Project, layers: Layer[]): Project => ({ ...p, layers });
const patch = (p: Project, id: string, change: Partial<Layer>): Project =>
  withLayers(p, p.layers.map((l) => (l.id === id ? ({ ...l, ...change } as Layer) : l)));

describe('MOTIONLAB V1 undo history', () => {
  it('keeps rapid but different edits as separate undo steps', () => {
    const p0 = defaultProject();
    const h = createHistory(p0);
    const a = newTextLayer(p0.composition);
    const b = newRectangleLayer(p0.composition);
    const p1 = withLayers(p0, [a]); h.push(p1);           // add
    const p2 = withLayers(p1, [a, b]); h.push(p2);        // add
    const p3 = patch(p2, a.id, { name: 'Hero' }); h.push(p3);  // rename a
    const p4 = patch(p3, b.id, { name: 'Box' }); h.push(p4);   // rename b
    expect(h.undo()).toBe(p3);
    expect(h.undo()).toBe(p2);
    expect(h.undo()).toBe(p1);
    expect(h.undo()).toBe(p0);
    expect(h.undo()).toBeNull();
  });

  it('merges a rapid run of edits to the same layer (slider drag) into one step', () => {
    const p0 = withLayers(defaultProject(), [newTextLayer(defaultProject().composition)]);
    const id = p0.layers[0].id;
    const h = createHistory(p0);
    let p = p0;
    for (let i = 1; i <= 20; i++) { p = patch(p, id, { name: `n${i}` }); h.push(p); }
    expect(h.undo()).toBe(p0);
    expect(h.canUndo()).toBe(false);
    expect(h.redo()).toBe(p);
  });

  it('rapid edits to different properties of one layer are separate steps; one property still merges', () => {
    const p0 = withLayers(defaultProject(), [newRectangleLayer(defaultProject().composition)]);
    const id = p0.layers[0].id;
    const h = createHistory(p0);
    const p1 = patch(p0, id, { fill: '#808080' } as Partial<Layer>);
    h.push(p1);
    const p2 = patch(p1, id, { blend: 'multiply' });
    h.push(p2);
    const p3 = patch(p2, id, { blend: 'screen' });
    h.push(p3);                                                  // same property again: merges
    expect(h.undo()).toBe(p1);                                   // blend undone, fill kept
    expect(h.undo()).toBe(p0);
  });
});
