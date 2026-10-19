import { beforeEach, describe, expect, it } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';

const st = () => useV1.getState();
const wa = () => st().project.composition.workArea;
beforeEach(() => st().replaceProject(defaultProject()));

describe('MOTIONLAB V1 work area', () => {
  it('B / N set the edges; crossing edges push the other one; null clears', () => {
    st().setWorkArea({ start: 2 });
    expect(wa()).toEqual({ start: 2, end: 10 });
    st().setWorkArea({ end: 5 });
    expect(wa()).toEqual({ start: 2, end: 5 });
    st().setWorkArea({ start: 7 });                                     // past the end → end follows
    expect(wa()!.start).toBe(7);
    expect(wa()!.end).toBeGreaterThan(7);
    st().setWorkArea({ end: 1 });                                       // before the start → start follows
    expect(wa()!.end).toBe(1);
    expect(wa()!.start).toBeLessThan(1);
    st().setWorkArea(null);
    expect(wa()).toBeUndefined();
  });

  it('shortening the comp clips or drops the work area', () => {
    st().setWorkArea({ start: 2, end: 8 });
    st().setCompositionDuration(5);
    expect(wa()).toEqual({ start: 2, end: 5 });
    st().setCompositionDuration(1.5);
    expect(wa()).toBeUndefined();
  });
});
