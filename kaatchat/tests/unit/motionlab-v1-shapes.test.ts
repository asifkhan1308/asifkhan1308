import { beforeEach, describe, expect, it } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';
import { shapePoints } from '../../src/features/motionlab-v1/engine/compose';
import { applyAIActions } from '../../src/features/motionlab-v1/engine/aiActions';
import { parseLocalCommand } from '../../src/features/motionlab-v1/engine/aiLocal';
import type { EllipseLayer } from '../../src/features/motionlab-v1/types';

const st = () => useV1.getState();
const shape = (id: string) => st().project.layers.find((l) => l.id === id) as EllipseLayer;
beforeEach(() => st().replaceProject(defaultProject()));

describe('MOTIONLAB V1 polygons and stars', () => {
  it('corner points: top first, inside the box; stars alternate inner points; plain ellipse → null', () => {
    expect(shapePoints({}, 100, 100)).toBeNull();
    const hex = shapePoints({ sides: 6 }, 200, 100)!;
    expect(hex).toHaveLength(6);
    expect(hex[0][0]).toBeCloseTo(100); expect(hex[0][1]).toBeCloseTo(0);
    for (const [x, y] of hex) { expect(x).toBeGreaterThanOrEqual(-1e-9); expect(x).toBeLessThanOrEqual(200 + 1e-9); expect(y).toBeLessThanOrEqual(100 + 1e-9); }
    const star = shapePoints({ sides: 5, starInner: 0.4 }, 100, 100)!;
    expect(star).toHaveLength(10);
    expect(Math.hypot(star[1][0] - 50, star[1][1] - 50)).toBeCloseTo(20);
    expect(shapePoints({ sides: 40 }, 10, 10)).toHaveLength(12);              // clamped
    expect(shapePoints({ sides: 2 }, 10, 10)).toBeNull();
  });

  it('store + ✦ Ask: add polygons and stars, named shapes, sides', () => {
    const p = st().addPolygon();
    expect(shape(p)).toMatchObject({ type: 'ellipse', name: 'Polygon', sides: 6 });
    expect(shape(p).starInner).toBeUndefined();
    const s = st().addPolygon(true);
    expect(shape(s)).toMatchObject({ name: 'Star', sides: 5, starInner: 0.5 });
    expect(parseLocalCommand('add a hexagon', 0)).toEqual([{ op: 'add_layer', type: 'polygon', sides: 6, name: 'Hexagon' }]);
    expect(parseLocalCommand('add a star', 0)).toEqual([{ op: 'add_layer', type: 'star' }]);
    expect(parseLocalCommand('add a 6-point star', 0)).toEqual([{ op: 'add_layer', type: 'star', sides: 6 }]);
    expect(parseLocalCommand('add an 8 sided polygon', 0)).toEqual([{ op: 'add_layer', type: 'polygon', sides: 8 }]);
    expect(parseLocalCommand('start at 2s', 0)[0]?.op).not.toBe('add_layer');
    const r = applyAIActions(parseLocalCommand('add a triangle and make it red and pop it in', 0));
    expect(r.skipped).toEqual([]);
    const tri = st().project.layers[st().project.layers.length - 1] as EllipseLayer;
    expect(tri).toMatchObject({ name: 'Triangle', sides: 3, fill: expect.stringMatching(/^#/) });
    applyAIActions([{ op: 'add_layer', type: 'star', sides: 99 }]);
    expect((st().project.layers[st().project.layers.length - 1] as EllipseLayer).sides).toBe(12);
  });
});
