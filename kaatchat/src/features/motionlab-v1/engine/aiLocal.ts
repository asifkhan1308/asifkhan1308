import type { AIAction, Preset } from './aiActions';
import { BLEND_MODES } from '../types';

const BLEND_NAMES = new Set<string>(BLEND_MODES);

/* ──────────────────────────────────────────────────────────────────────────
 * Offline ✦ Ask: a small phrase parser for the commands people type most.
 * Used when no language model is connected (the default "built-in"
 * provider), so the bar works for free, instantly and on-device. It emits
 * the same actions a model would, through the same validator.
 * Clauses are split on "and" / "then" / "," / ";".
 * ────────────────────────────────────────────────────────────────────────── */

const COLORS: Record<string, string> = {
  navy: '#0b1a33', cream: '#f5efe0', beige: '#e8dcc4',
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
  const clauses = masked.split(/\s*(?:,|;|\band then\b|\bthen\b|\band\b(?=\s+(?:add|fade|slide|pop|spin|make|color|colou?r|trim|move|start|split|delete|remove|rename|set|change|scale|rotate|opacity|duration|parent|attach|unparent|mask|matte|use|align|center|centre|typewriter|type|reveal|letter|word|gradient|drop|put|outline|stroke|reset|no|wiggle|shake|stop|slow|speed|freeze|unfreeze|blend)))\s*/i);

  for (const part of clauses) {
    const c = part.replace(/\uE000(\d+)\uE000/g, (_, i) => saved[Number(i)]).trim();
    const l = c.toLowerCase();
    if (!l) continue;
    let m: RegExpMatchArray | null;

    // markers: "add a marker (called Drop) (at 2s)"
    if ((m = c.match(/^(?:add|drop|put)\s+(?:a\s+)?marker\b(?:\s+(?:called|named|labelled|labeled)\s+(.+?))?(?:\s+at\s+(-?\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)?)?\s*$/i))) {
      out.push({ op: 'marker', ...(m[1] ? { label: quoted(m[1]) } : {}), ...(m[2] ? { time: Number(m[2]) } : {}) });
      continue;
    }
    // add text / shapes
    if ((m = c.match(/^(?:add|create|insert)\s+(?:a|an|the)?\s*(?:text|title|heading|caption|label)\b(?:\s+(?:saying|that says|which says|with|reading|:))?\s*(.*)$/i))) {
      const text = quoted(m[1].replace(/^(?:text\s+)/i, ''));
      out.push({ op: 'add_layer', type: 'text', ...(text ? { text } : {}) });
      continue;
    }
    // polygons and stars: "add a hexagon", "add a star", "add a 6-point star", "add an 8 sided polygon"
    if ((m = l.match(/^(?:add|create|insert)\s+(?:a|an)?\s*(?:(\d+)[\s-]*(?:point(?:ed)?|sided?)\s+)?(star|polygon|triangle|pentagon|hexagon|heptagon|octagon|diamond)\b/))) {
      const named: Record<string, number> = { triangle: 3, diamond: 4, pentagon: 5, hexagon: 6, heptagon: 7, octagon: 8 };
      const sides = m[1] ? Number(m[1]) : named[m[2]];
      out.push({ op: 'add_layer', type: m[2] === 'star' ? 'star' : 'polygon', ...(sides ? { sides } : {}), ...(m[2] !== 'star' && m[2] !== 'polygon' ? { name: m[2][0].toUpperCase() + m[2].slice(1) } : {}) });
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
    if (/\btype(?:writer|\s+(?:it\s+)?(?:on|in|out))\b|\btypewriter\b/.test(l)) { preset('typewriter'); continue; }
    if (/\b(?:letter\s+by\s+letter|per[-\s]letter|letters?\s+fade)\b/.test(l)) { preset('letters_in'); continue; }
    // blend: "blend multiply", "set the blend mode to screen", "screen blend", "normal blend"
    if (/\bblend(?:ing)?\b/.test(l)) {
      const words = l.replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter(Boolean);
      const i = words.findIndex((w) => /^blend(?:ing)?$/.test(w));
      const name = (j: number) => {
        const two = `${words[j] ?? ''}-${words[j + 1] ?? ''}`;
        return BLEND_NAMES.has(two) ? two : BLEND_NAMES.has(words[j] ?? '') ? words[j] : null;
      };
      let k = i + 1;
      while (words[k] && /^(?:mode|to|as|it|set|the)$/.test(words[k])) k++;
      const mode = name(k) ?? name(i - 2) ?? name(i - 1);
      if (mode) { out.push({ op: 'blend', mode }); continue; }
    }
    // time remap: "slow it down to half speed", "2x speed", "speed it up 4x", "freeze frame at 2s", "unfreeze"
    if (/^(?:unfreeze|(?:no|remove)\s+(?:the\s+)?freeze)\b/.test(l)) { out.push({ op: 'freeze', time: null }); continue; }
    if (/\bfreeze\b/.test(l)) {
      const at = l.match(/\bat\s+(\d+(?:\.\d+)?)\s*s/);
      out.push(at ? { op: 'freeze', time: Number(at[1]) } : { op: 'freeze' });
      continue;
    }
    if (/\b(?:slow[\s-]*mo(?:tion)?|slow\s+(?:it\s+)?down|speed\s+(?:it\s+)?up|(?:normal|half|double|quarter)\s+speed|\d+(?:\.\d+)?\s*[x×]\s*speed|speed\s+(?:to\s+)?\d)/.test(l)) {
      const n = l.match(/(\d+(?:\.\d+)?)\s*[x×%]?/);
      let v = /\bhalf\b/.test(l) ? 0.5 : /\bquarter\b/.test(l) ? 0.25 : /\bdouble\b/.test(l) ? 2 : /\bnormal\b/.test(l) ? 1 : n ? Number(n[1]) : /slow/.test(l) ? 0.5 : 2;
      if (n && /%/.test(n[0])) v = Number(n[1]) / 100;
      out.push({ op: 'speed', speed: v });
      continue;
    }
    // wiggle: "wiggle it", "shake it 40px", "wiggle the rotation 10 degrees 3 times a second", "stop wiggling"
    if (/^(?:stop\s+(?:the\s+)?(?:wiggl\w*|shak\w*)|(?:no|remove)\s+(?:the\s+)?wiggle)\b/.test(l)) {
      const p = l.match(/\b(rotation|scale|opacity|position)\b/)?.[1] ?? 'position';
      out.push({ op: 'wiggle', path: p, amount: 0 });
      continue;
    }
    if (/\b(?:wiggle|wiggly|shake|jitter)\b/.test(l)) {
      const p = l.match(/\b(rotat\w*|scale|size|opacity|position)\b/)?.[1];
      const path = !p ? 'position' : p.startsWith('rotat') ? 'rotation' : p === 'size' ? 'scale' : p;
      const amt = l.match(/(\d+(?:\.\d+)?)\s*(px|pixels?|°|deg\w*|%)/);
      const freq = l.match(/(\d+(?:\.\d+)?)\s*(?:times?\s*(?:a|per)\s*sec\w*|x\s*\/\s*s|\/s|hz)\b/);
      const a: AIAction = { op: 'wiggle', path };
      if (amt) a.amount = amt[2] === '%' ? Number(amt[1]) / 100 : Number(amt[1]);
      if (freq) a.freq = Number(freq[1]);
      out.push(a);
      continue;
    }
    if (/\b(?:word\s+by\s+word|per[-\s]word|words?\s+fade)\b/.test(l)) { preset('words_in'); continue; }
    if (/\b(?:pop|bounce)\b/.test(l)) { preset('pop'); continue; }
    if (/\bspin\b|\brotate\s+(?:it\s+)?(?:a\s+)?full\b|\b360\b/.test(l)) { preset('spin'); continue; }

    // background: "make the background navy" / "background white" / "bg #111"
    if ((m = l.match(/^(?:make\s+the\s+|set\s+the\s+|change\s+the\s+)?(?:background|bg)(?:\s+(?:colou?r))?\s+(?:to\s+)?(#[0-9a-f]{3,8}|[a-z]+)\s*$/))) {
      const col = m[1].startsWith('#') ? m[1] : COLORS[m[1]];
      if (col) { out.push({ op: 'comp', background: col }); continue; }
    }
    // looks: "make it cinematic", "vintage look", "black and white", "no look"
    if ((m = l.match(/\b(cinematic|vintage|retro|black\s*(?:and|&)\s*white|b\s*&\s*w|monochrome|greyscale|grayscale|dreamy|punchy|vivid|neon)\b/))) {
      const w = m[1].replace(/\s+/g, ' ');
      const name = /black|b\s*&|mono|grey|gray/.test(w) ? 'black-and-white' : w === 'retro' ? 'vintage' : w === 'vivid' ? 'punchy' : w;
      out.push({ op: 'look', name });
      continue;
    }
    if (/^(?:no|remove|reset)\s+(?:the\s+)?(?:look|effects|filter)\b/.test(l)) { out.push({ op: 'look', name: 'none' }); continue; }
    // outline: "outline it white 4px" / "stroke 6px black" / "no outline"
    if (/^(?:no|remove)\s+(?:the\s+)?(?:outline|stroke)\b/.test(l)) { out.push({ op: 'set_stroke', color: null }); continue; }
    if ((m = l.match(/^(?:outline|stroke)(?:\s+(?:it|this))?(?:\s+(?:in|with))?\s+(?:(#[0-9a-f]{3,8}|[a-z]+)\s*)?(?:(\d+(?:\.\d+)?)\s*px)?\s*(#[0-9a-f]{3,8}|[a-z]+)?\s*$/))) {
      const name = m[1] ?? m[3];
      const col = !name ? '#000000' : name.startsWith('#') ? name : COLORS[name];
      if (col) { out.push({ op: 'set_stroke', color: col, ...(m[2] ? { width: Number(m[2]) } : {}) }); continue; }
    }
    // gradient: "gradient from red to blue (at 45°)"
    if ((m = l.match(/\bgradient\s+(?:from\s+)?(#[0-9a-f]{3,8}|[a-z]+)\s+(?:to|into)\s+(#[0-9a-f]{3,8}|[a-z]+)(?:\s+(?:at\s+)?(-?\d+)\s*(?:°|deg|degrees)?)?/))) {
      const c1 = m[1].startsWith('#') ? m[1] : COLORS[m[1]];
      const c2 = m[2].startsWith('#') ? m[2] : COLORS[m[2]];
      if (c1 && c2) { out.push({ op: 'set_gradient', from: c1, to: c2, ...(m[3] ? { angle: Number(m[3]) } : {}) }); continue; }
    }
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
    if (/^(?:center|centre)\s+(?:it|this)?\s*$|^(?:center|centre)\s+(?:it\s+|this\s+)?(?:on|in)\s+(?:the\s+)?(?:frame|screen|canvas)/.test(l)) {
      out.push({ op: 'align', edge: 'hcenter' }, { op: 'align', edge: 'vcenter' });
      continue;
    }
    if ((m = l.match(/^align\s+(?:it\s+|this\s+)?(?:to\s+(?:the\s+)?)?(left|right|top|bottom|middle|center|centre)\b/))) {
      const e = m[1];
      out.push(e === 'center' || e === 'centre' ? { op: 'align', edge: 'hcenter' } : e === 'middle' ? { op: 'align', edge: 'vcenter' } : { op: 'align', edge: e });
      continue;
    }
    // Must run before the delete rule: "remove the matte" is not "delete the layer".
    if (/^(?:remove|clear|no)\s+(?:the\s+)?(?:track\s+)?(?:matte|mask)\b/.test(l)) { out.push({ op: 'matte', to: null }); continue; }
    if (/^(?:delete|remove)\b/.test(l)) { out.push({ op: 'delete' }); continue; }
    if (/^(?:unparent|detach)\b/.test(l)) { out.push({ op: 'parent', to: null }); continue; }
    if ((m = c.match(/^(?:mask|matte|clip)\s+(?:it\s+|this\s+)?(?:with|by|to|using)\s+(.+?)(\s+inverted)?$/i)) ||
        (m = c.match(/^use\s+(.+?)\s+as\s+(?:a\s+|the\s+)?(?:track\s+)?(?:matte|mask)(\s+inverted)?$/i))) {
      out.push({ op: 'matte', to: quoted(m[1]), ...(m[2] ? { inverted: true } : {}) });
      continue;
    }
    if ((m = c.match(/^(?:parent|attach|link)\s+(?:it\s+|this\s+)?(?:to|with)\s+(.+)$/i))) { out.push({ op: 'parent', to: quoted(m[1]) }); continue; }
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
  'parent it to Null 1',
  'typewriter over 2s',
];
