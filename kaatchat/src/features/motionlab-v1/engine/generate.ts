import { useV1 } from '../store';
import { createProvider, PROVIDERS } from '../../../ai/providers';
import { loadAISettings } from '../../../ai/settings';
import { AI_SYSTEM, aiContext, applyAIActions, extractJson, type AIAction, type AIResult } from './aiActions';

/* ──────────────────────────────────────────────────────────────────────────
 * Generate: describe a video, get an editable motion graphic on the timeline.
 *
 * Local engines (Ollama / LM Studio) and cloud engines are language models:
 * they design the piece — layers, text, colours, timing, animation — as
 * actions for the same validated engine ✦ Ask uses. Nothing is a black-box
 * render: every element lands as a normal layer you can edit, and the whole
 * generation is one undo step. With no model connected, an offline template
 * builds a clean animated title sequence from the prompt, for free.
 * ────────────────────────────────────────────────────────────────────────── */

export const GEN_SYSTEM = `${AI_SYSTEM}

You are now DESIGNING a complete short motion graphic from the user's description, not editing one.
Build it from scratch on the composition you are given:
- First set the composition duration with "comp" (default 6 s unless the user says otherwise).
- Start with a full-frame background rectangle (size = composition width/height, position = centre).
- Then add 2–6 layers: a headline text, optional supporting text, accent shapes.
- Give text real copy that fits the description. Use "set" fontSize (headline ~100–140, body ~40–60).
- Place layers with "set" position in composition pixels so nothing overlaps awkwardly.
- Animate with presets, staggering their "at" times (e.g. 0.2, 0.5, 0.9 s) and end with fade_out on the text.
- Use "set_color" with a coherent palette that matches the mood.
Every action that should affect a just-added layer must come right after its add_layer (or use "layer": "<name>").`;

const COLOR_WORDS: Record<string, string> = {
  red: '#ff3b30', orange: '#ff9500', yellow: '#ffcc00', green: '#34c759', blue: '#0a84ff',
  purple: '#af52de', pink: '#ff2d55', teal: '#30b0c7', gold: '#d4a017', white: '#ffffff',
};

/** Pull a headline (and optional subline) out of a free-text description. */
export function promptCopy(prompt: string): { title: string; sub: string | null } {
  const q = [...prompt.matchAll(/"([^"]+)"|“([^”]+)”/g)].map((m) => (m[1] ?? m[2]).trim()).filter(Boolean);
  if (q.length) return { title: q[0], sub: q[1] ?? null };
  const m = prompt.match(/\b(?:for|about|called|titled|named)\s+(.+?)(?:[.,;!]|\bwith\b|\bin\b|$)/i);
  const raw = (m?.[1] ?? prompt).replace(/\b(?:a|an|the)\s+(?:\d+\s*(?:s|sec|seconds?)\s+)?(?:intro|video|clip|title|promo)\b/gi, '').trim();
  const title = raw.replace(/\s+/g, ' ').slice(0, 42).replace(/^\w/, (c) => c.toUpperCase()) || 'Your Title';
  return { title, sub: null };
}

/* ───── Offline templates ─────
 * Picked from the prompt's words; the title card is the default. All are
 * built only from validated actions, so they're fully editable layers. */

export type TemplateKind = 'title' | 'lower-third' | 'quote' | 'countdown' | 'cta' | 'list' | 'stat' | 'sale';

export const TEMPLATES: Array<{ kind: TemplateKind; label: string; example: string }> = [
  { kind: 'title', label: 'Title card', example: 'a 6 second intro for "Asif\'s Bakery" with "Fresh every morning", gold accents' },
  { kind: 'lower-third', label: 'Lower third', example: 'lower third for "Sara Khan" "Head of Design"' },
  { kind: 'quote', label: 'Quote', example: 'quote "Make it simple, but significant." "Don Draper"' },
  { kind: 'countdown', label: 'Countdown', example: 'countdown from 3, blue' },
  { kind: 'cta', label: 'Call to action', example: 'subscribe button "Subscribe" "New videos every Friday", red' },
  { kind: 'list', label: 'List', example: 'list "3 reasons to switch" "Faster exports" "Free forever" "Works offline", green' },
  { kind: 'stat', label: 'Big number', example: 'stat "98%" "of customers come back", teal' },
  { kind: 'sale', label: 'Sale badge', example: 'sale "50% OFF" "This weekend only", pink' },
];

export function templateKindOf(prompt: string): TemplateKind {
  const p = prompt.toLowerCase();
  if (/\blower[-\s]?third|\bname\s*(?:tag|plate)|\bchyron\b/.test(p)) return 'lower-third';
  if (/\bquote\b|\bquotation\b/.test(p)) return 'quote';
  if (/\bcount\s*down\b|\b3[\s,.]+2[\s,.]+1\b/.test(p)) return 'countdown';
  if (/\bsale\b|\bdiscount\b|\d+\s*%\s*off\b|\bdeal\b|\boffer\b/.test(p)) return 'sale';
  if (/\bstats?\b|\bstatistic|\bbig number\b|\bkpi\b|\bmetric\b/.test(p)) return 'stat';
  if (/\blist\b|\btips\b|\bsteps\b|\breasons\b|\btop\s+\d+\b|\bbullets?\b/.test(p)) return 'list';
  if (/\bsubscribe\b|\bfollow\b|\bsign\s*up\b|\bcall to action\b|\bcta\b|\bbuy now\b|\bshop now\b/.test(p)) return 'cta';
  return 'title';
}

const accentOf = (prompt: string, fallback: string) =>
  Object.entries(COLOR_WORDS).find(([w]) => new RegExp(`\\b${w}\\b`, 'i').test(prompt))?.[1] ?? fallback;

/** Offline template chosen from the prompt (title card by default). */
export function templateActions(prompt: string, comp: { width: number; height: number }): AIAction[] {
  switch (templateKindOf(prompt)) {
    case 'lower-third': return lowerThird(prompt, comp);
    case 'quote': return quoteCard(prompt, comp);
    case 'countdown': return countdown(prompt, comp);
    case 'cta': return callToAction(prompt, comp);
    case 'list': return listCard(prompt, comp);
    case 'stat': return statCard(prompt, comp);
    case 'sale': return saleBadge(prompt, comp);
    default: return titleCard(prompt, comp);
  }
}

function lowerThird(prompt: string, comp: { width: number; height: number }): AIAction[] {
  const W = comp.width, H = comp.height, s = Math.min(W, H) / 1080;
  const { title, sub } = promptCopy(prompt);
  const accent = accentOf(prompt, '#ffffff');
  const x = Math.round(W * 0.08), y = Math.round(H * 0.8);
  return [
    { op: 'comp', duration: 5 },
    { op: 'add_layer', type: 'rectangle', name: 'Panel' },
    { op: 'set', path: 'size', value: [Math.round(620 * s), Math.round(130 * s)] },
    { op: 'set', path: 'position', value: [x + Math.round(310 * s), y] },
    { op: 'set', path: 'cornerRadius', value: Math.round(10 * s) },
    { op: 'set_color', color: '#111113' },
    { op: 'preset', name: 'slide_in_left', at: 0.2, duration: 0.6 },
    { op: 'preset', name: 'fade_out', duration: 0.5 },
    { op: 'add_layer', type: 'rectangle', name: 'Accent' },
    { op: 'set', path: 'size', value: [Math.round(8 * s), Math.round(130 * s)] },
    { op: 'set', path: 'position', value: [x + Math.round(4 * s), y] },
    { op: 'set_color', color: accent },
    { op: 'preset', name: 'fade_in', at: 0.5, duration: 0.3 },
    { op: 'preset', name: 'fade_out', duration: 0.5 },
    { op: 'add_layer', type: 'text', name: 'Name', text: title },
    { op: 'text_align', align: 'left' },
    { op: 'set', path: 'fontSize', value: Math.round(48 * s) },
    { op: 'set', path: 'position', value: [x + Math.round(36 * s), y - Math.round(4 * s)] },
    { op: 'set_color', color: '#ffffff' },
    { op: 'preset', name: 'typewriter', at: 0.6, duration: 0.6 },
    { op: 'preset', name: 'fade_out', duration: 0.5 },
    ...(sub ? [
      { op: 'add_layer', type: 'text', name: 'Role', text: sub },
      { op: 'text_align', align: 'left' },
      { op: 'set', path: 'fontSize', value: Math.round(28 * s) },
      { op: 'set', path: 'position', value: [x + Math.round(36 * s), y + Math.round(38 * s)] },
      { op: 'set_color', color: '#a1a1a6' },
      { op: 'preset', name: 'fade_in', at: 1.0, duration: 0.5 },
      { op: 'preset', name: 'fade_out', duration: 0.5 },
    ] as AIAction[] : []),
  ];
}

function quoteCard(prompt: string, comp: { width: number; height: number }): AIAction[] {
  const W = comp.width, H = comp.height, s = Math.min(W, H) / 1080;
  const { title, sub } = promptCopy(prompt);
  const text = title.startsWith('“') || title.startsWith('"') ? title : `“${title}”`;
  return [
    { op: 'comp', duration: 6 },
    { op: 'add_layer', type: 'rectangle', name: 'Background' },
    { op: 'set', path: 'size', value: [W, H] },
    { op: 'set', path: 'position', value: [W / 2, H / 2] },
    { op: 'set', path: 'cornerRadius', value: 0 },
    { op: 'set_gradient', from: '#1c1c1e', to: '#000000', angle: 90 },
    { op: 'add_layer', type: 'text', name: 'Quote', text },
    { op: 'set', path: 'fontSize', value: Math.round((text.length > 40 ? 64 : 84) * s) },
    { op: 'set', path: 'position', value: [W / 2, Math.round(H / 2 - 10 * s)] },
    { op: 'set_color', color: '#ffffff' },
    { op: 'preset', name: 'words_in', at: 0.3, duration: 1.6 },
    { op: 'preset', name: 'fade_out', duration: 0.6 },
    ...(sub ? [
      { op: 'add_layer', type: 'text', name: 'Author', text: `— ${sub}` },
      { op: 'set', path: 'fontSize', value: Math.round(36 * s) },
      { op: 'set', path: 'position', value: [W / 2, Math.round(H / 2 + 110 * s)] },
      { op: 'set_color', color: accentOf(prompt, '#a1a1a6') },
      { op: 'preset', name: 'fade_in', at: 2.1, duration: 0.6 },
      { op: 'preset', name: 'fade_out', duration: 0.6 },
    ] as AIAction[] : []),
  ];
}

function countdown(prompt: string, comp: { width: number; height: number }): AIAction[] {
  const W = comp.width, H = comp.height, s = Math.min(W, H) / 1080;
  const from = Math.max(1, Math.min(10, Number(prompt.match(/\bfrom\s+(\d+)/i)?.[1] ?? 3)));
  const accent = accentOf(prompt, '#ffffff');
  const out: AIAction[] = [
    { op: 'comp', duration: from + 1 },
    { op: 'add_layer', type: 'ellipse', name: 'Ring' },
    { op: 'set', path: 'size', value: [Math.round(420 * s), Math.round(420 * s)] },
    { op: 'set', path: 'position', value: [W / 2, H / 2] },
    { op: 'set_color', color: '#0b0b0c' },
    { op: 'set_stroke', color: accent, width: Math.max(2, Math.round(10 * s)) },
  ];
  for (let i = 0; i < from; i++) {
    const n = from - i;
    out.push(
      { op: 'add_layer', type: 'text', name: `Count ${n}`, text: String(n) },
      { op: 'set', path: 'fontSize', value: Math.round(220 * s) },
      { op: 'set', path: 'position', value: [W / 2, Math.round(H / 2 + 78 * s)] },
      { op: 'set_color', color: '#ffffff' },
      { op: 'move', start: i },
      { op: 'trim', start: i, end: i + 1 },
      { op: 'preset', name: 'pop', at: i, duration: 0.35 },
      { op: 'preset', name: 'fade_out', duration: 0.2 },
    );
  }
  const { title } = promptCopy(prompt.replace(/countdown|from\s+\d+/gi, ''));
  out.push(
    { op: 'add_layer', type: 'text', name: 'Go', text: /["“]/.test(prompt) ? title : 'GO!' },
    { op: 'set', path: 'fontSize', value: Math.round(180 * s) },
    { op: 'set', path: 'position', value: [W / 2, Math.round(H / 2 + 64 * s)] },
    { op: 'set_color', color: accent },
    { op: 'move', start: from },
    { op: 'trim', start: from, end: from + 1 },
    { op: 'preset', name: 'pop', at: from, duration: 0.4 },
  );
  return out;
}

function callToAction(prompt: string, comp: { width: number; height: number }): AIAction[] {
  const W = comp.width, H = comp.height, s = Math.min(W, H) / 1080;
  const q = [...prompt.matchAll(/"([^"]+)"|“([^”]+)”/g)].map((m) => (m[1] ?? m[2]).trim()).filter(Boolean);
  const label = q[0] ?? (/\bfollow\b/i.test(prompt) ? 'Follow' : /\bsign\s*up\b/i.test(prompt) ? 'Sign up' : 'Subscribe');
  const accent = accentOf(prompt, '#ff3b30');
  return [
    { op: 'comp', duration: 4 },
    { op: 'add_layer', type: 'rectangle', name: 'Button' },
    { op: 'set', path: 'size', value: [Math.round((140 + label.length * 30) * s), Math.round(120 * s)] },
    { op: 'set', path: 'position', value: [W / 2, H / 2] },
    { op: 'set', path: 'cornerRadius', value: Math.round(60 * s) },
    { op: 'set_color', color: accent },
    { op: 'preset', name: 'pop', at: 0.2, duration: 0.6 },
    { op: 'preset', name: 'fade_out', duration: 0.4 },
    { op: 'add_layer', type: 'text', name: 'Label', text: label },
    { op: 'set', path: 'fontSize', value: Math.round(56 * s) },
    { op: 'set', path: 'position', value: [W / 2, Math.round(H / 2 + 20 * s)] },
    { op: 'set_color', color: '#ffffff' },
    { op: 'preset', name: 'pop', at: 0.35, duration: 0.6 },
    { op: 'preset', name: 'fade_out', duration: 0.4 },
    ...(q[1] ? [
      { op: 'add_layer', type: 'text', name: 'Note', text: q[1] },
      { op: 'set', path: 'fontSize', value: Math.round(34 * s) },
      { op: 'set', path: 'position', value: [W / 2, Math.round(H / 2 + 130 * s)] },
      { op: 'set_color', color: '#d1d1d6' },
      { op: 'preset', name: 'fade_in', at: 0.9, duration: 0.5 },
      { op: 'preset', name: 'fade_out', duration: 0.4 },
    ] as AIAction[] : []),
  ];
}

const quoted = (prompt: string) => [...prompt.matchAll(/"([^"]+)"|“([^”]+)”/g)].map((m) => (m[1] ?? m[2]).trim()).filter(Boolean);
const bg = (W: number, H: number, from: string, to: string): AIAction[] => [
  { op: 'add_layer', type: 'rectangle', name: 'Background' },
  { op: 'set', path: 'size', value: [W, H] },
  { op: 'set', path: 'position', value: [W / 2, H / 2] },
  { op: 'set', path: 'cornerRadius', value: 0 },
  { op: 'set_gradient', from, to, angle: 90 },
];

/** List: a heading, then up to 5 items sliding in one after another. */
function listCard(prompt: string, comp: { width: number; height: number }): AIAction[] {
  const W = comp.width, H = comp.height, s = Math.min(W, H) / 1080;
  const q = quoted(prompt);
  // "list: a, b, c" works too when nothing is quoted.
  const items = q.length > 1 ? q.slice(1) : (prompt.split(':')[1] ?? '').split(/,|\band\b/).map((x) => x.trim()).filter(Boolean);
  const list = (items.length ? items : ['First point', 'Second point', 'Third point']).slice(0, 5);
  const heading = q[0] ?? (q.length === 0 && prompt.includes(':') ? prompt.split(':')[0].replace(/\blist\b/i, '').trim() : '') ?? '';
  const accent = accentOf(prompt, '#ffffff');
  const step = 0.45, first = 0.7, gap = Math.round(96 * s);
  const top = Math.round(H / 2 - ((list.length - 1) * gap) / 2 + 50 * s);
  const x = Math.round(W / 2 - 360 * s);
  const out: AIAction[] = [
    { op: 'comp', duration: Math.max(4, first + list.length * step + 2.5) },
    ...bg(W, H, '#151517', '#000000'),
    { op: 'add_layer', type: 'text', name: 'Heading', text: heading || 'Here’s how' },
    { op: 'set', path: 'fontSize', value: Math.round(72 * s) },
    { op: 'set', path: 'position', value: [W / 2, top - Math.round(130 * s)] },
    { op: 'set_color', color: '#ffffff' },
    { op: 'preset', name: 'slide_in_down', at: 0.1, duration: 0.5 },
    { op: 'preset', name: 'fade_out', duration: 0.5 },
  ];
  list.forEach((item, i) => out.push(
    { op: 'add_layer', type: 'ellipse', name: `Dot ${i + 1}` },
    { op: 'set', path: 'size', value: [Math.round(22 * s), Math.round(22 * s)] },
    { op: 'set', path: 'position', value: [x, top + i * gap - Math.round(16 * s)] },
    { op: 'set_color', color: accent },
    { op: 'preset', name: 'pop', at: first + i * step, duration: 0.35 },
    { op: 'preset', name: 'fade_out', duration: 0.5 },
    { op: 'add_layer', type: 'text', name: `Item ${i + 1}`, text: item },
    { op: 'text_align', align: 'left' },
    { op: 'set', path: 'fontSize', value: Math.round(50 * s) },
    { op: 'set', path: 'position', value: [x + Math.round(44 * s), top + i * gap] },
    { op: 'set_color', color: '#e5e5ea' },
    { op: 'preset', name: 'slide_in_right', at: first + i * step, duration: 0.5 },
    { op: 'preset', name: 'fade_out', duration: 0.5 },
  ));
  return out;
}

/** Big number: a huge figure that pops in, with a label under it. */
function statCard(prompt: string, comp: { width: number; height: number }): AIAction[] {
  const W = comp.width, H = comp.height, s = Math.min(W, H) / 1080;
  const q = quoted(prompt);
  const figure = q.find((x) => /\d/.test(x)) ?? prompt.match(/\d[\d,.]*\s*[%kKmM+x×]?/)?.[0]?.trim() ?? '100%';
  const label = q.find((x) => x !== figure) ?? '';
  const accent = accentOf(prompt, '#ffffff');
  return [
    { op: 'comp', duration: 5 },
    ...bg(W, H, '#0b0b0c', '#000000'),
    { op: 'add_layer', type: 'text', name: 'Figure', text: figure },
    { op: 'set', path: 'fontSize', value: Math.round(260 * s) },
    { op: 'set', path: 'position', value: [W / 2, Math.round(H / 2 + 40 * s)] },
    { op: 'set_color', color: accent },
    { op: 'preset', name: 'pop', at: 0.2, duration: 0.7 },
    { op: 'preset', name: 'fade_out', duration: 0.5 },
    { op: 'add_layer', type: 'rectangle', name: 'Rule' },
    { op: 'set', path: 'size', value: [Math.round(180 * s), Math.max(3, Math.round(6 * s))] },
    { op: 'set', path: 'position', value: [W / 2, Math.round(H / 2 + 110 * s)] },
    { op: 'set_color', color: '#ffffff' },
    { op: 'preset', name: 'slide_in_left', at: 0.8, duration: 0.5 },
    { op: 'preset', name: 'fade_out', duration: 0.5 },
    ...(label ? [
      { op: 'add_layer', type: 'text', name: 'Label', text: label },
      { op: 'set', path: 'fontSize', value: Math.round(48 * s) },
      { op: 'set', path: 'position', value: [W / 2, Math.round(H / 2 + 200 * s)] },
      { op: 'set_color', color: '#d1d1d6' },
      { op: 'preset', name: 'fade_in', at: 1.1, duration: 0.6 },
      { op: 'preset', name: 'fade_out', duration: 0.5 },
    ] as AIAction[] : []),
  ];
}

/** Sale badge: a spinning star with the offer, and a line under it. */
function saleBadge(prompt: string, comp: { width: number; height: number }): AIAction[] {
  const W = comp.width, H = comp.height, s = Math.min(W, H) / 1080;
  const q = quoted(prompt);
  const offer = q[0] ?? prompt.match(/\d+\s*%\s*off/i)?.[0]?.toUpperCase() ?? 'SALE';
  const accent = accentOf(prompt, '#ff2d55');
  const size = Math.round(520 * s);
  return [
    { op: 'comp', duration: 5 },
    ...bg(W, H, '#111113', '#000000'),
    { op: 'add_layer', type: 'star', name: 'Badge', sides: 12 },
    { op: 'set', path: 'size', value: [size, size] },
    { op: 'set', path: 'position', value: [W / 2, Math.round(H / 2 - 40 * s)] },
    { op: 'set_color', color: accent },
    { op: 'preset', name: 'spin', at: 0.1, duration: 0.8 },
    { op: 'preset', name: 'fade_out', duration: 0.5 },
    { op: 'add_layer', type: 'text', name: 'Offer', text: offer },
    { op: 'set', path: 'fontSize', value: Math.round((offer.length > 8 ? 70 : 96) * s) },
    { op: 'set', path: 'position', value: [W / 2, Math.round(H / 2 - 4 * s)] },
    { op: 'set_color', color: '#ffffff' },
    { op: 'preset', name: 'pop', at: 0.7, duration: 0.5 },
    { op: 'preset', name: 'fade_out', duration: 0.5 },
    ...(q[1] ? [
      { op: 'add_layer', type: 'text', name: 'Details', text: q[1] },
      { op: 'set', path: 'fontSize', value: Math.round(44 * s) },
      { op: 'set', path: 'position', value: [W / 2, Math.round(H / 2 + 300 * s)] },
      { op: 'set_color', color: '#ffffff' },
      { op: 'preset', name: 'slide_in_up', at: 1.1, duration: 0.5 },
      { op: 'preset', name: 'fade_out', duration: 0.5 },
    ] as AIAction[] : []),
  ];
}

/** Title card: background, accent bar, title (pop) and optional subtitle. */
function titleCard(prompt: string, comp: { width: number; height: number }): AIAction[] {
  const W = comp.width, H = comp.height, cx = W / 2, cy = H / 2;
  const d = prompt.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?)\b/i);
  const duration = Math.max(2, Math.min(60, d ? Number(d[1]) : 6));
  const accent = Object.entries(COLOR_WORDS).find(([w]) => new RegExp(`\\b${w}\\b`, 'i').test(prompt))?.[1] ?? '#ffffff';
  const { title, sub } = promptCopy(prompt);
  const s = Math.min(W, H) / 1080; // scale type & shapes for vertical / square / 4K comps
  const out: AIAction[] = [
    { op: 'comp', duration },
    { op: 'add_layer', type: 'rectangle', name: 'Background' },
    { op: 'set', path: 'size', value: [W, H] },
    { op: 'set', path: 'position', value: [cx, cy] },
    { op: 'set', path: 'cornerRadius', value: 0 },
    { op: 'set_color', color: '#0b0b0c' },
    { op: 'add_layer', type: 'rectangle', name: 'Accent' },
    { op: 'set', path: 'size', value: [Math.round(260 * s), Math.max(4, Math.round(8 * s))] },
    { op: 'set', path: 'position', value: [cx, Math.round(cy + 95 * s)] },
    { op: 'set_color', color: accent },
    { op: 'preset', name: 'slide_in_left', at: 0.5, duration: 0.6 },
    { op: 'preset', name: 'fade_out', duration: 0.5 },
    { op: 'add_layer', type: 'text', name: 'Title', text: title },
    { op: 'set', path: 'fontSize', value: Math.round((title.length > 22 ? 96 : 128) * s) },
    { op: 'set', path: 'position', value: [cx, Math.round(cy - 10 * s)] },
    { op: 'set_color', color: '#ffffff' },
    { op: 'preset', name: 'pop', at: 0.2, duration: 0.7 },
    { op: 'preset', name: 'fade_out', duration: 0.5 },
  ];
  if (sub) {
    out.push(
      { op: 'add_layer', type: 'text', name: 'Subtitle', text: sub },
      { op: 'set', path: 'fontSize', value: Math.round(46 * s) },
      { op: 'set', path: 'position', value: [cx, Math.round(cy + 170 * s)] },
      { op: 'set_color', color: '#d1d1d6' },
      { op: 'preset', name: 'fade_in', at: 0.9, duration: 0.6 },
      { op: 'preset', name: 'fade_out', duration: 0.5 },
    );
  }
  return out;
}

export interface GenerateOutcome { engine: string; result: AIResult }

/** Generate with the active engine (model → designed piece; none → template). */
export async function generateFromPrompt(prompt: string, signal?: AbortSignal): Promise<GenerateOutcome> {
  const settings = loadAISettings();
  const comp = useV1.getState().project.composition;
  if (settings.active === 'builtin') {
    return { engine: 'Offline template', result: applyAIActions(templateActions(prompt, comp)) };
  }
  const provider = createProvider(settings.active, settings.providers[settings.active]);
  const text = await provider.generateText({
    system: GEN_SYSTEM,
    user: `Project:\n${aiContext()}\n\nDesign this video: ${prompt}`,
    json: true,
    signal,
  });
  const parsed = JSON.parse(extractJson(text)) as { actions?: unknown };
  const result = applyAIActions(parsed.actions);
  if (!result.applied) throw new Error(`The model's design couldn't be applied${result.skipped.length ? `: ${result.skipped.slice(0, 3).join('; ')}` : '.'}`);
  return { engine: PROVIDERS[settings.active].name, result };
}
