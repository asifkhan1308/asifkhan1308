import { describe, expect, it } from 'vitest';
import { graphemes } from '../../src/features/motionlab-v1/engine/compose';

describe('text reveal splits by user-perceived characters', () => {
  it('keeps Devanagari vowel signs and viramas with their letters; never leaves a dangling mark', () => {
    const g = graphemes('नमस्ते');
    expect(g.join('')).toBe('नमस्ते');
    for (const piece of g) expect(piece).not.toMatch(/^\p{M}/u);       // no piece starts with a combining mark
    expect(g.length).toBeLessThan([...'नमस्ते'].length);                // fewer pieces than code points
  });
  it('English and emoji', () => {
    expect(graphemes('Hello')).toEqual(['H', 'e', 'l', 'l', 'o']);
    expect(graphemes('👍🏽 ok')).toEqual(['👍🏽', ' ', 'o', 'k']);
  });
});

import { withDevanagari } from '../../src/features/motionlab-v1/engine/compose';
describe('the bundled Devanagari font joins every font stack before the generic family', () => {
  it('inserts once, before sans-serif / serif / monospace; keeps Latin fonts first', () => {
    expect(withDevanagari('Inter, -apple-system, system-ui, sans-serif')).toBe('Inter, -apple-system, system-ui, "Kaatchat Devanagari", sans-serif');
    expect(withDevanagari('Georgia, "Times New Roman", serif')).toBe('Georgia, "Times New Roman", "Kaatchat Devanagari", serif');
    expect(withDevanagari('ui-monospace, Menlo, monospace')).toBe('ui-monospace, Menlo, "Kaatchat Devanagari", monospace');
    expect(withDevanagari('"My Font"')).toBe('"My Font", "Kaatchat Devanagari"');
    const once = withDevanagari('Inter, sans-serif');
    expect(withDevanagari(once)).toBe(once);
  });
});
