import { describe, expect, it } from 'vitest';
import { captionCues, cueAt, parseSubtitles, wordsToSegments } from '../../src/engine/transcript';
import { applyCommand } from '../../src/engine/commands/execute';
import { asset, clip, doc, seqId } from './helpers';

const SRT = `1
00:00:01,000 --> 00:00:03,000
Hello there friends.

2
00:00:04,500 --> 00:00:06,000
<i>Um</i> welcome back.
`;

const VTT = `WEBVTT

00:01.000 --> 00:02.000 align:start
First line

01:00:00.000 --> 01:00:01.500
Much later
`;

describe('subtitle import', () => {
  it('parses SRT with spread word timings', () => {
    const t = parseSubtitles(SRT);
    expect(t.segments).toHaveLength(2);
    expect(t.segments[1].text).toBe('Um welcome back.');
    const w = t.segments[0].words;
    expect(w[0].t0).toBe(1);
    expect(w[w.length - 1].t1).toBeCloseTo(3);
  });

  it('parses WebVTT including hours and cue settings', () => {
    const t = parseSubtitles(VTT);
    expect(t.segments.map((s) => s.t0)).toEqual([1, 3600]);
  });

  it('rejects files with no cues', () => {
    expect(() => parseSubtitles('just text')).toThrow(/No subtitle cues/);
  });
});

describe('segments and captions', () => {
  it('groups words into sentences', () => {
    const segs = wordsToSegments([
      { t0: 0, t1: 0.3, text: 'This' },
      { t0: 0.3, t1: 0.5, text: 'is' },
      { t0: 0.5, t1: 0.9, text: 'one.' },
      { t0: 3, t1: 3.4, text: 'Two' },
    ]);
    expect(segs.map((s) => s.text)).toEqual(['This is one.', 'Two']);
  });

  it('follows the edit: cutting a word removes its caption and shifts the rest', () => {
    const transcript = parseSubtitles(SRT);
    const d0 = { ...doc([clip('c', 'A', 0, 10)], [asset('A', 10)]), captions: { enabled: true, style: 'bold' as const, maxWords: 3 } };
    const index = { A: { transcript } };
    const before = captionCues(d0, index);
    expect(before.map((c) => c.words.map((w) => w.text).join(' '))).toEqual(['Hello there friends.', 'Um welcome back.']);
    const after = applyCommand(d0, { type: 'remove_fillers' }, { index, newId: seqId }).doc;
    const cues = captionCues(after, index);
    expect(cues[1].words.map((w) => w.text)).toEqual(['welcome', 'back.']);
    expect(cueAt(cues, 2)?.words[0].text).toBe('Hello');
    expect(cueAt(cues, 3.4)).toBeTruthy(); // held briefly after the last word
    expect(cueAt(cues, 3.9)).toBeNull(); // …but not across a long gap
    expect(cueAt(cues, 100)).toBeNull();
  });
});
