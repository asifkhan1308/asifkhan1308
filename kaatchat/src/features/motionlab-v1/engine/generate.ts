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

/** Offline template: an animated title card built only from validated actions. */
export function templateActions(prompt: string, comp: { width: number; height: number }): AIAction[] {
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
