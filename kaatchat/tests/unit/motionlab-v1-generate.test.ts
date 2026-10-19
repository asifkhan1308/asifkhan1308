import { beforeEach, describe, expect, it } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';
import { applyAIActions } from '../../src/features/motionlab-v1/engine/aiActions';
import { promptCopy, templateActions } from '../../src/features/motionlab-v1/engine/generate';

const st = () => useV1.getState();
beforeEach(() => st().replaceProject(defaultProject()));

describe('MOTIONLAB V1 Generate (offline template)', () => {
  it('takes the headline from quotes, or from the description', () => {
    expect(promptCopy('a 6 second intro for "Asif\'s Bakery" with "Fresh every morning"')).toEqual({ title: "Asif's Bakery", sub: 'Fresh every morning' });
    expect(promptCopy('an intro for Northwind Coffee, warm and calm')).toEqual({ title: 'Northwind Coffee', sub: null });
    expect(promptCopy('Summer sale').title).toBe('Summer sale');
  });

  it('builds a valid, fully applied title sequence — one undo removes it', () => {
    const actions = templateActions('8 second promo for "Launch Day" "Join us live", blue accents', st().project.composition);
    const r = applyAIActions(actions);
    expect(r.skipped).toEqual([]);
    expect(r.applied).toBe(actions.length);
    const p = st().project;
    expect(p.composition.duration).toBe(8);
    expect(p.layers.map((l) => l.name)).toEqual(['Background', 'Accent', 'Title', 'Subtitle']);
    const title = p.layers.find((l) => l.name === 'Title')!;
    expect(title.type === 'text' && title.text).toBe('Launch Day');
    const accent = p.layers.find((l) => l.name === 'Accent')!;
    expect(accent.type === 'rectangle' && accent.fill).toBe('#0a84ff');
    const bg = p.layers.find((l) => l.name === 'Background')!;
    expect(bg.type === 'rectangle' && bg.size.default).toEqual([1920, 1080]);
    // Resized shapes stay centred on their position (anchor follows the size).
    expect(bg.transform.anchor.default).toEqual([960, 540]);
    expect(accent.transform.anchor.default).toEqual([130, 4]);
    // Title pops in and fades out at the end.
    expect(title.transform.scale.keyframes?.length).toBe(3);
    expect(title.transform.opacity.keyframes?.at(-1)).toMatchObject({ time: 8, value: 0 });

    st().undo();
    expect(st().project.layers).toHaveLength(0);
  });

  it('fits vertical compositions', () => {
    st().setCompositionSize(1080, 1920);
    applyAIActions(templateActions('"Hi"', st().project.composition));
    const bg = st().project.layers[0];
    expect(bg.type === 'rectangle' && bg.size.default).toEqual([1080, 1920]);
    expect(st().project.layers[2].transform.position.default[0]).toBe(540);
  });
});

import { TEMPLATES, templateKindOf } from '../../src/features/motionlab-v1/engine/generate';

describe('MOTIONLAB V1 Generate — more offline templates', () => {
  it('picks the template from the words', () => {
    expect(templateKindOf('lower third for "Sara"')).toBe('lower-third');
    expect(templateKindOf('a quote card')).toBe('quote');
    expect(templateKindOf('3, 2, 1 go')).toBe('countdown');
    expect(templateKindOf('subscribe button')).toBe('cta');
    expect(templateKindOf('intro for my bakery')).toBe('title');
  });

  it('every template example builds cleanly (nothing skipped)', () => {
    for (const t of TEMPLATES) {
      st().replaceProject(defaultProject());
      const r = applyAIActions(templateActions(t.example, st().project.composition));
      expect({ kind: t.kind, skipped: r.skipped }).toEqual({ kind: t.kind, skipped: [] });
      expect(st().project.layers.length).toBeGreaterThan(1);
    }
  });

  it('countdown shows each number in its own second, then GO', () => {
    applyAIActions(templateActions('countdown from 3', st().project.composition));
    const p = st().project;
    expect(p.composition.duration).toBe(4);
    const span = (name: string) => { const l = p.layers.find((x) => x.name === name)!; return [l.startTime, +(l.startTime + l.duration).toFixed(3)]; };
    expect(span('Count 3')).toEqual([0, 1]);
    expect(span('Count 2')).toEqual([1, 2]);
    expect(span('Count 1')).toEqual([2, 3]);
    expect(span('Go')).toEqual([3, 4]);
  });

  it('lower third uses the quoted name and role; quote uses words-in', () => {
    applyAIActions(templateActions('lower third for "Sara Khan" "Head of Design"', st().project.composition));
    const names = st().project.layers.map((l) => l.name);
    expect(names).toEqual(['Panel', 'Accent', 'Name', 'Role']);
    st().replaceProject(defaultProject());
    applyAIActions(templateActions('quote "Less, but better." "Dieter Rams"', st().project.composition));
    const q = st().project.layers.find((l) => l.name === 'Quote')!;
    expect(q.type === 'text' && [q.text, q.revealMode]).toEqual(['“Less, but better.”', 'words']);
  });
});
