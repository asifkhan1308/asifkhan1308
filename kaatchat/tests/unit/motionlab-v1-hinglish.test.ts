import { beforeEach, describe, expect, it } from 'vitest';
import { useV1 } from '../../src/features/motionlab-v1/store';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';
import { applyAIActions } from '../../src/features/motionlab-v1/engine/aiActions';
import { parseLocalCommand } from '../../src/features/motionlab-v1/engine/aiLocal';
import { hinglishToEnglish } from '../../src/features/motionlab-v1/engine/aiHinglish';

const st = () => useV1.getState();
beforeEach(() => st().replaceProject(defaultProject()));
const same = (a: string, b: string) => {
  const want = parseLocalCommand(b, 0);
  expect(want.length, b).toBeGreaterThan(0);                                // the English reference really parses
  expect(parseLocalCommand(a, 0), a).toEqual(want);
};

describe('MOTIONLAB ✦ Ask in Hinglish and Hindi (offline)', () => {
  it('maps common Hinglish phrasings to the English commands', () => {
    same('isko laal karo', 'make it red');
    same('rang neela karo', 'make it blue');
    same('background kaala karo', 'background black');
    same('hatao', 'delete it');
    same('“Sale” title jodo', 'add a title “Sale”');
    same('ek tara jodo', 'add a star');
    same('gola daalo', 'add a circle');
    same('fade in karo', 'fade in');
    same('isko beech mein rakho', 'center it');
    same('ghumao', 'spin it');
    same('isko hilao', 'wiggle it');
    same('dheema karo', 'slow motion');
    same('3 second ka karo', 'trim to 3s');
  });

  it('understands Devanagari and chains clauses with aur / phir', () => {
    same('इसे लाल करो', 'make it red');
    same('तारा जोड़ो और इसे बीच में रखो', 'add a star, center it');
    same('add a hexagon aur isko hara karo phir ghumao', 'add a hexagon, make it green, spin it');
  });

  it('leaves English and quoted text alone', () => {
    expect(hinglishToEnglish('make it red, fade in')).toBe('make it red, fade in');
    const p = parseLocalCommand('"laal karo" title jodo', 0);
    expect(p).toEqual(parseLocalCommand('add a title "laal karo"', 0));       // the quote is the copy, not a command
  });

  it('applies end to end with nothing skipped', () => {
    const r = applyAIActions(parseLocalCommand('ek tara jodo aur isko gulabi karo phir hilao', 0));
    expect(r.skipped).toEqual([]);
    const star = st().project.layers[0];
    expect(star.type === 'ellipse' && [star.sides, star.fill]).toEqual([5, '#ff2d55']);
    expect(star.transform.position.wiggle).toBeDefined();
  });
});

describe('the ✦ Ask placeholder examples work as written', () => {
  it('Hindi and Hinglish examples apply cleanly', () => {
    for (const ex of ['"नमस्ते" टाइटल जोड़ो और इसे बीच में रखो', '"Hello" title jodo aur pop karo']) {
      st().replaceProject(defaultProject());
      const acts = parseLocalCommand(ex, 0);
      expect(acts.length, ex).toBeGreaterThanOrEqual(2);
      expect(applyAIActions(acts).skipped, ex).toEqual([]);
      const title = st().project.layers[0];
      expect(title.type === 'text' && title.text).toMatch(/नमस्ते|Hello/);
    }
  });
});
