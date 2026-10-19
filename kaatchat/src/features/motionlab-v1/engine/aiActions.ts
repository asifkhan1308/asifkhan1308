import { useV1 } from '../store';
import { resolveAnimated } from './interp';
import type { AnimatedProperty, Layer, V2 } from '../types';

/* ──────────────────────────────────────────────────────────────────────────
 * ✦ Ask action engine. The model replies with { "actions": [...] }; this
 * file validates each action and applies it through the store, so a bad or
 * partial reply can never corrupt the project. The whole list is one undo
 * step. Kept free of React so it is unit-testable without a model.
 * ────────────────────────────────────────────────────────────────────────── */

export const PRESETS = ['fade_in', 'fade_out', 'slide_in_left', 'slide_in_right', 'slide_in_up', 'slide_in_down', 'pop', 'spin'] as const;
export type Preset = (typeof PRESETS)[number];
const LAYER_TYPES = ['text', 'rectangle', 'ellipse', 'null'] as const;

/** Prop paths the model may set / keyframe directly. */
export const AI_PATHS = [
  'position', 'scale', 'rotation', 'anchor', 'opacity', 'size', 'cornerRadius', 'fontSize',
  'brightness', 'contrast', 'saturation', 'blur', 'vignette', 'grain', 'tintAmount',
] as const;
const V2_PATHS = new Set(['position', 'scale', 'anchor', 'size']);

/** Every action may name a target with "layer" (id, name, or "new" = the
 *  last layer added by this command). Without it: the last added layer,
 *  else the selected one. */
export type AIAction = { op: string; layer?: string } & Record<string, unknown>;

export interface AIResult { applied: number; skipped: string[] }

export const AI_SYSTEM = `You edit a motion-design project in MOTIONLAB. You get the project (composition + layer list),
the selected layer in detail, the playhead time and the user's instruction. Reply ONLY with JSON:
{ "actions": [ ... ] }
Each action may include "layer": "<id or exact name>" or "new" (the layer added earlier in this reply).
Without "layer" it targets the layer added earlier in this reply, else the selected layer.
Actions:
  { "op": "add_layer", "type": "text"|"rectangle"|"ellipse"|"null", "text"?: string, "name"?: string }
  { "op": "set", "path": <prop>, "value": <number|[x,y]> }                 // base value
  { "op": "keyframe", "path": <prop>, "time": <sec>, "value": <number|[x,y]> }
  { "op": "preset", "name": ${PRESETS.map((p) => `"${p}"`).join('|')}, "duration"?: <sec>, "at"?: <sec> }
  { "op": "trim", "start"?: <sec>, "end"?: <sec>, "length"?: <sec> }       // clip in/out on the comp timeline
  { "op": "move", "start": <sec> }                                          // shift the clip in time
  { "op": "split", "time": <sec> }
  { "op": "delete" }
  { "op": "rename", "name": string }
  { "op": "set_text", "text": string }                                      // text layers
  { "op": "set_color", "color": "#rrggbb" }                                 // text / shape fill
  { "op": "comp", "duration": <sec> }
<prop> is one of: ${AI_PATHS.join(', ')}.
position / scale / anchor / size values are [x, y]; others are numbers. Opacity is 0..1, scale 1 = 100%.
Positions are in composition pixels (0,0 = top-left). Times are seconds on the composition timeline.
Prefer "preset" for common intros/outros (fade, slide, pop, spin). No prose, no comments in the JSON.`;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const v2 = (v: unknown): V2 | null =>
  Array.isArray(v) && v.length === 2 && num(v[0]) !== null && num(v[1]) !== null ? [num(v[0])!, num(v[1])!] : null;

export function applyAIActions(actions: unknown): AIResult {
  const res: AIResult = { applied: 0, skipped: [] };
  if (!Array.isArray(actions)) { res.skipped.push('reply had no action list'); return res; }
  const st = useV1.getState();
  let lastAdded: string | null = null;

  const target = (a: AIAction): Layer | null => {
    const layers = useV1.getState().project.layers;
    const ref = typeof a.layer === 'string' ? a.layer.trim() : '';
    if (ref && ref !== 'new') {
      return layers.find((l) => l.id === ref) ?? layers.find((l) => l.name.toLowerCase() === ref.toLowerCase()) ?? null;
    }
    const id = lastAdded ?? useV1.getState().selectedLayerId;
    return layers.find((l) => l.id === id) ?? null;
  };

  st.batch(() => {
    for (const raw of actions as AIAction[]) {
      if (!raw || typeof raw !== 'object') { res.skipped.push('?: not an action object'); continue; }
      const op = String(raw.op ?? '');
      const s = useV1.getState();
      const comp = s.project.composition;
      const clampT = (t: number) => Math.max(0, Math.min(comp.duration, t));
      const skip = (why: string) => res.skipped.push(`${op || '?'}: ${why}`);

      if (op === 'add_layer') {
        const type = String(raw.type ?? '');
        if (!(LAYER_TYPES as readonly string[]).includes(type)) { skip(`unknown layer type "${type}"`); continue; }
        const id =
          type === 'text' ? s.addTextLayer() : type === 'rectangle' ? s.addRectangle() : type === 'ellipse' ? s.addEllipse() : s.addNull();
        if (type === 'text' && typeof raw.text === 'string' && raw.text.trim()) s.patchLayer(id, { text: raw.text } as Partial<Layer>);
        if (typeof raw.name === 'string' && raw.name.trim()) s.renameLayer(id, raw.name.trim());
        lastAdded = id;
        s.selectLayer(id);
        res.applied++;
        continue;
      }
      if (op === 'comp') {
        const d = num(raw.duration);
        if (d === null || d <= 0 || d > 3600) { skip('duration must be 0–3600 s'); continue; }
        s.setCompositionDuration(d);
        res.applied++;
        continue;
      }

      const layer = target(raw);
      if (!layer) { skip(raw.layer ? `no layer "${String(raw.layer)}"` : 'no layer selected'); continue; }
      const end = layer.startTime + layer.duration;

      switch (op) {
        case 'set':
        case 'keyframe': {
          const path = String(raw.path ?? '');
          if (!(AI_PATHS as readonly string[]).includes(path)) { skip(`unknown property "${path}"`); break; }
          const value = V2_PATHS.has(path) ? v2(raw.value) : num(raw.value);
          if (value === null) { skip(`bad value for ${path}`); break; }
          if (op === 'set') {
            s.setPropertyBase(layer.id, path as Parameters<typeof s.setPropertyBase>[1], value);
            res.applied++;
          } else {
            const t = num(raw.time);
            if (t === null) { skip('keyframe needs a time'); break; }
            if (s.setKeyframeAt(layer.id, path, clampT(t), value)) res.applied++;
            else skip(`${layer.type} layers have no ${path}`);
          }
          break;
        }
        case 'preset': {
          const name = String(raw.name ?? '') as Preset;
          if (!PRESETS.includes(name)) { skip(`unknown preset "${name}"`); break; }
          const d = Math.max(0.05, Math.min(layer.duration, num(raw.duration) ?? 0.6));
          applyPreset(layer, name, d, num(raw.at), comp.width, comp.height, end, clampT);
          res.applied++;
          break;
        }
        case 'trim': {
          const a = num(raw.start), len = num(raw.length);
          const b = num(raw.end) ?? (len !== null && len > 0 ? (a ?? layer.startTime) + len : null);
          if (a === null && b === null) { skip('trim needs start, end or length'); break; }
          if (a !== null) s.trimLayerIn(layer.id, clampT(a));
          if (b !== null) s.trimLayerOut(layer.id, clampT(b));
          res.applied++;
          break;
        }
        case 'move': {
          const a = num(raw.start);
          if (a === null) { skip('move needs start'); break; }
          s.moveLayerInTime(layer.id, a);
          res.applied++;
          break;
        }
        case 'split': {
          const t = num(raw.time);
          if (t === null || t <= layer.startTime || t >= end) { skip('split time must be inside the clip'); break; }
          s.splitLayerAt(layer.id, t);
          res.applied++;
          break;
        }
        case 'delete':
          s.removeLayer(layer.id);
          if (lastAdded === layer.id) lastAdded = null;
          res.applied++;
          break;
        case 'rename':
          if (typeof raw.name !== 'string' || !raw.name.trim()) { skip('rename needs a name'); break; }
          s.renameLayer(layer.id, raw.name.trim());
          res.applied++;
          break;
        case 'set_text':
          if (layer.type !== 'text') { skip('not a text layer'); break; }
          if (typeof raw.text !== 'string') { skip('set_text needs text'); break; }
          s.patchLayer(layer.id, { text: raw.text } as Partial<Layer>);
          res.applied++;
          break;
        case 'set_color': {
          const c = typeof raw.color === 'string' ? raw.color.trim() : '';
          if (!/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) { skip('color must be #rrggbb'); break; }
          if (layer.type !== 'text' && layer.type !== 'rectangle' && layer.type !== 'ellipse') { skip(`${layer.type} layers have no fill`); break; }
          s.patchLayer(layer.id, { fill: c } as Partial<Layer>);
          res.applied++;
          break;
        }
        default:
          skip('unknown action');
      }
    }
  }, 'Ask');
  return res;
}

/* Presets are deterministic keyframe recipes, so "fade it in" always gives
 * the same clean result instead of whatever numbers a model invents. Intros
 * start at the clip's start (or `at`), outros end at the clip's end. */
function applyPreset(
  layer: Layer, name: Preset, d: number, at: number | null, w: number, h: number, end: number,
  clampT: (t: number) => number,
) {
  const s = useV1.getState();
  const intro = name !== 'fade_out';
  const t0 = clampT(at ?? (intro ? layer.startTime : end - d));
  const t1 = clampT(t0 + d);
  const tr = layer.transform;
  const at0 = <T,>(p: AnimatedProperty<T>) => resolveAnimated(p, intro ? t1 : t0);
  const key = (path: string, t: number, v: unknown) => s.setKeyframeAt(layer.id, path, t, v);

  switch (name) {
    case 'fade_in': { const o = at0(tr.opacity) || 1; key('opacity', t0, 0); key('opacity', t1, o); break; }
    case 'fade_out': { const o = at0(tr.opacity); key('opacity', t0, o); key('opacity', t1, 0); break; }
    case 'slide_in_left':
    case 'slide_in_right':
    case 'slide_in_up':
    case 'slide_in_down': {
      const [x, y] = at0(tr.position);
      const dx = name === 'slide_in_left' ? -w * 0.3 : name === 'slide_in_right' ? w * 0.3 : 0;
      const dy = name === 'slide_in_up' ? h * 0.3 : name === 'slide_in_down' ? -h * 0.3 : 0;
      key('position', t0, [x + dx, y + dy]);
      key('position', t1, [x, y]);
      const o = at0(tr.opacity) || 1;
      key('opacity', t0, 0);
      key('opacity', t1, o);
      break;
    }
    case 'pop': {
      const [sx, sy] = at0(tr.scale);
      key('scale', t0, [0, 0]);
      key('scale', clampT(t0 + d * 0.7), [sx * 1.1, sy * 1.1]);
      key('scale', t1, [sx, sy]);
      break;
    }
    case 'spin': {
      const r = at0(tr.rotation);
      key('rotation', t0, r - 360);
      key('rotation', t1, r);
      break;
    }
  }
}

/** Compact project context for the model (no keyframe dumps). */
export function aiContext(): string {
  const s = useV1.getState();
  const p = s.project;
  const sel = p.layers.find((l) => l.id === s.selectedLayerId);
  const brief = (l: Layer) => ({ id: l.id, name: l.name, type: l.type, start: +l.startTime.toFixed(2), end: +(l.startTime + l.duration).toFixed(2) });
  const detail = sel && {
    ...brief(sel),
    position: sel.transform.position.default,
    scale: sel.transform.scale.default,
    rotation: sel.transform.rotation.default,
    opacity: sel.transform.opacity.default,
    ...(sel.type === 'text' ? { text: sel.text, fontSize: sel.fontSize.default, fill: sel.fill } : {}),
    ...(sel.type === 'rectangle' || sel.type === 'ellipse' ? { size: sel.size.default, fill: sel.fill } : {}),
  };
  return JSON.stringify({
    composition: { width: p.composition.width, height: p.composition.height, fps: p.composition.fps, duration: p.composition.duration },
    playhead: +s.currentTime.toFixed(2),
    layers: p.layers.map(brief),
    selected: detail ?? null,
  });
}

/** Pull the JSON object out of a reply that may be fenced or chatty. */
export function extractJson(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  if (trimmed.startsWith('{')) return trimmed;
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  throw new Error('AI reply did not contain JSON.');
}
