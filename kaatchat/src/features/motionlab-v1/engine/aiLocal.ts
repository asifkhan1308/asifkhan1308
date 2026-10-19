import type { AIAction, Preset } from './aiActions';

/* ──────────────────────────────────────────────────────────────────────────
 * Offline ✦ Ask: a small phrase parser for the commands people type most.
 * Used when no language model is connected (the default "built-in"
 * provider), so the bar works for free, instantly and on-device. It emits
 * the same actions a model would, through the same validator.
 * Clauses are split on "and" / "then" / "," / ";".
 * ────────────────────────────────────────────────────────────────────────── */

const COLORS: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff3b30', orange: '#ff9500', yellow: '#ffcc00', green: '#34c759',
  blue: '#0a84ff', purple: '#af52de', pink: '#ff2d55', gray: '#8e8e93', grey: '#8e8e93', teal: '#30b0c7',
};
const N = String.raw`(-?\d+(?:\.\d+)?)`;
const SEC = String.raw`${N}\s*(ms|s|sec|secs|seconds?)?`;
const secs = (n: string, unit?: string) => (unit === 'ms' ? Number(n) / 1000 : Number(n));
const quoted = (s: string) => s.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();

/** Optional "over/for 1.5s" duration and "at 2s" start inside a clause. */
function timing(c: string): { duration?: number; at?: number } {
  const d = c.match(new RegExp(String.raw`\b(?:over|for|in)\s+${SEC}`));
  const a = c.match(new RegExp(String.raw`\bat\s+${SEC}`));
  return { ...(d ? { duration: secs(d[1], d[2]) } : {}), ...(a ? { at: secs(a[1], a[2]) } : {}) };
}

export function parseLocalCommand(prompt: string, playhead: number): AIAction[] {
  const out: AIAction[] = [];
  // Keep quoted text intact while splitting into clauses: swap quotes for
  // placeholders, split, then restore.
  const saved: string[] = [];
  const masked = prompt.replace(/"[^"]*"|“[^”]*”/g, (q) => `\uE000${saved.push(q) - 1}\uE000`);
  const clauses = masked.split(/\s*(?:,|;|\band then\b|\bthen\b|\band\b(?=\s+(?:add|fade|slide|pop|spin|make|color|colou?r|trim|move|start|split|delete|remove|rename|set|change|scale|rotate|opacity|duration)))\s*/i);

  for (const part of clauses) {
    const c = part.replace(/\uE000(\d+)\uE000/g, (_, i) => saved[Number(i)]).trim();
    const l = c.toLowerCase();
    if (!l) continue;
    let m: RegExpMatchArray | null;

    // add text / shapes
    if ((m = c.match(/^(?:add|create|insert)\s+(?:a|an|the)?\s*(?:text|title|heading|caption|label)\b(?:\s+(?:saying|that says|which says|with|reading|:))?\s*(.*)$/i))) {
      const text = quoted(m[1].replace(/^(?:text\s+)/i, ''));
      out.push({ op: 'add_layer', type: 'text', ...(text ? { text } : {}) });
      continue;
    }
    if ((m = l.match(/^(?:add|create|insert)\s+(?:a|an)?\s*(rectangle|rect|box|square|ellipse|circle|dot|oval|null|anchor)\b/))) {
      const type = /ellipse|circle|dot|oval/.test(m[1]) ? 'ellipse' : /null|anchor/.test(m[1]) ? 'null' : 'rectangle';
      out.push({ op: 'add_layer', type });
      continue;
    }

    // presets
    const preset = (name: Preset) => out.push({ op: 'preset', name, ...timing(l) });
    if (/\bfade\s+(?:it\s+|this\s+)?in\b|\bfade-in\b/.test(l)) { preset('fade_in'); continue; }
    if (/\bfade\s+(?:it\s+|this\s+)?out\b|\bfade-out\b/.test(l)) { preset('fade_out'); continue; }
    if ((m = l.match(/\bslide\s+(?:it\s+)?in(?:\s+from)?(?:\s+the)?\s+(left|right|top|bottom|above|below)/))) {
      const dir = m[1];
      preset(dir === 'left' ? 'slide_in_left' : dir === 'right' ? 'slide_in_right' : dir === 'top' || dir === 'above' ? 'slide_in_down' : 'slide_in_up');
      continue;
    }
    if (/\b(?:pop|bounce)\b/.test(l)) { preset('pop'); continue; }
    if (/\bspin\b|\brotate\s+(?:it\s+)?(?:a\s+)?full\b|\b360\b/.test(l)) { preset('spin'); continue; }

    // colour
    if ((m = l.match(/\b(?:make\s+(?:it|this)|colou?r(?:\s+it)?|fill)\s+(?:to\s+)?(#[0-9a-f]{3,8}|[a-z]+)\b/))) {
      const col = m[1].startsWith('#') ? m[1] : COLORS[m[1]];
      if (col) { out.push({ op: 'set_color', color: col }); continue; }
    }

    // timeline
    if ((m = l.match(new RegExp(String.raw`^trim\s+(?:it\s+|this\s+)?(?:to|down to)\s+${SEC}`)))) {
      out.push({ op: 'trim', length: secs(m[1], m[2]) });
      continue;
    }
    if ((m = l.match(new RegExp(String.raw`^(?:end|cut|stop)\s+(?:it\s+)?at\s+${SEC}`)))) {
      out.push({ op: 'trim', end: secs(m[1], m[2]) });
      continue;
    }
    if ((m = l.match(new RegExp(String.raw`^(?:move\s+(?:it\s+)?to|start\s+(?:it\s+)?at|starts?\s+at)\s+${SEC}`)))) {
      out.push({ op: 'move', start: secs(m[1], m[2]) });
      continue;
    }
    if (/^split\b/.test(l)) {
      m = l.match(new RegExp(String.raw`at\s+${SEC}`));
      out.push({ op: 'split', time: m ? secs(m[1], m[2]) : playhead });
      continue;
    }
    if (/^(?:delete|remove)\b/.test(l)) { out.push({ op: 'delete' }); continue; }
    if ((m = c.match(/^rename\s+(?:it\s+|this\s+)?(?:to\s+)?(.+)$/i))) { out.push({ op: 'rename', name: quoted(m[1]) }); continue; }
    if ((m = c.match(/^(?:(?:change|set)\s+(?:the\s+)?text\s+to|say|make it say)\s+(.+)$/i))) { out.push({ op: 'set_text', text: quoted(m[1]) }); continue; }
    if ((m = l.match(new RegExp(String.raw`(?:duration|(?:video|comp|composition)(?:\s+length)?)\s+(?:to\s+)?${SEC}|make\s+(?:the\s+)?(?:video|comp|composition)\s+${SEC}`)))) {
      out.push({ op: 'comp', duration: m[1] ? secs(m[1], m[2]) : secs(m[3], m[4]) });
      continue;
    }

    // properties (base values)
    if ((m = l.match(new RegExp(String.raw`\bopacity\s+(?:to\s+)?${N}\s*(%)?`)))) {
      const v = Number(m[1]);
      out.push({ op: 'set', path: 'opacity', value: m[2] || v > 1 ? v / 100 : v });
      continue;
    }
    if ((m = l.match(new RegExp(String.raw`\bscale\s+(?:it\s+)?(?:to\s+|by\s+)?${N}\s*(%|x)?`)))) {
      const v = Number(m[1]);
      const k = m[2] === '%' || (!m[2] && v > 10) ? v / 100 : v;
      out.push({ op: 'set', path: 'scale', value: [k, k] });
      continue;
    }
    if ((m = l.match(new RegExp(String.raw`\brotate\s+(?:it\s+)?(?:to\s+|by\s+)?${N}`)))) {
      out.push({ op: 'set', path: 'rotation', value: Number(m[1]) });
      continue;
    }
  }
  return out;
}

/** Example phrases the offline parser understands (shown as a hint). */
export const LOCAL_EXAMPLES = [
  'add a title "Hello" and pop it in',
  'fade in over 1s',
  'slide in from the left',
  'make it red',
  'trim to 3s',
  'start at 2s',
  'rename to Logo',
];
