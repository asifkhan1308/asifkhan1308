import { useState } from 'react';
import { useV1 } from '../store';
import { createProvider } from '../../../ai/providers';
import { loadAISettings } from '../../../ai/settings';
import type { Layer } from '../types';

/* ──────────────────────────────────────────────────────────────────────────
 * AI command bar: "✦ Ask MOTIONLAB…"
 * Sends a small JSON contract to whichever provider the user has active
 * (built-in Claude, local Ollama/LM Studio, OpenAI, Gemini). Returns a tiny
 * action list that we apply to the project — never prose-only.
 *
 * This is the Stage-1 wiring: it understands two kinds of actions today,
 * both scoped to the selected layer:
 *   { "op": "set", "path": "<prop>", "value": <number|number[]> }
 *   { "op": "keyframe", "path": "<prop>", "time": <seconds>, "value": <...> }
 * We ship it with the plumbing so future actions (add layer, trim clip,
 * generate clip) slot in by extending this file, not the plumbing.
 * ────────────────────────────────────────────────────────────────────────── */

type Action =
  | { op: 'set'; path: string; value: number | [number, number] }
  | { op: 'keyframe'; path: string; time: number; value: number | [number, number] };

const SYSTEM = `You edit a motion-design project. You are given the currently selected
layer as JSON and the user's instruction. Respond with a JSON object:
{ "actions": [ { "op": "set" | "keyframe", "path": "<prop>", ("time": <sec>)?, "value": <number|[x,y]> } ] }
Where "path" is one of:
  position, scale, rotation, anchor, opacity,
  size, cornerRadius, fontSize,
  brightness, contrast, saturation, blur, vignette, grain, tintAmount
Rules:
- "value" for position / scale / anchor / size is a two-number array [x, y].
- "value" for everything else is a single number.
- For "set", apply at the layer's base value.
- For "keyframe", include "time" in seconds within the composition duration.
- Do not add anything other than valid JSON. No prose.
- Prefer "keyframe" when the user asks for an animation.`;

interface Props {
  onOpenGenerate: () => void;
}

export default function AIBar({ onOpenGenerate }: Props) {
  const project = useV1((s) => s.project);
  const selectedId = useV1((s) => s.selectedLayerId);
  const setPropertyBase = useV1((s) => s.setPropertyBase);
  const addKeyframeAt = useV1((s) => s.toggleKeyframe);

  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<string>('');
  const [err, setErr] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const selected = project.layers.find((l) => l.id === selectedId);

  const applyActions = (list: Action[]) => {
    if (!selected) return;
    let applied = 0;
    for (const a of list) {
      const path = a.path as Parameters<typeof setPropertyBase>[1];
      if (a.op === 'set') {
        setPropertyBase(selected.id, path, a.value as unknown as number);
        applied++;
      } else if (a.op === 'keyframe') {
        // Minimal: set the base to the requested value at the kf time, then
        // toggle a keyframe there. Full-fidelity jump happens next session.
        setPropertyBase(selected.id, path, a.value as unknown as number);
        useV1.getState().setCurrentTime(a.time);
        addKeyframeAt(selected.id, path);
        applied++;
      }
    }
    setStatus(`Applied ${applied} action${applied === 1 ? '' : 's'}.`);
  };

  const run = async () => {
    if (!prompt.trim()) return;
    setErr('');
    setStatus('Thinking…');
    setBusy(true);
    try {
      const settings = loadAISettings();
      const provider = createProvider(settings.active, settings.providers[settings.active]);
      const layerSummary = selected ? summariseLayer(selected) : null;
      const userMsg = selected
        ? `Selected layer:\n${JSON.stringify(layerSummary)}\n\nComposition duration: ${project.composition.duration}s.\n\nInstruction: ${prompt}`
        : `No layer selected. Composition duration: ${project.composition.duration}s.\nInstruction: ${prompt}`;
      const text = await provider.generateText({
        system: SYSTEM,
        user: userMsg,
        json: true,
      });
      // The model may wrap the JSON in markdown fences; strip them.
      const json = extractJson(text);
      const parsed = JSON.parse(json) as { actions?: Action[] };
      if (!parsed.actions?.length) {
        setStatus('No actions returned.');
      } else if (!selected) {
        setErr('Pick a layer first — this build applies actions to the selected layer.');
      } else {
        applyActions(parsed.actions);
      }
      setPrompt('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="v1-ai-bar">
      <span className="v1-ai-prefix" aria-hidden>✦</span>
      <input
        className="v1-ai-input"
        placeholder={selected ? `Ask MOTIONLAB to edit "${selected.name}" — e.g. “fade in over 1s” or “scale 1.2 at 2s”` : 'Select a layer, then ask MOTIONLAB…'}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void run(); }}
      />
      <button className="v1-ai-run" onClick={() => void run()} disabled={busy || !prompt.trim()}>
        {busy ? '…' : 'Ask'}
      </button>
      <button className="v1-ai-generate" onClick={onOpenGenerate}>Generate ▸</button>
      <span className={`v1-ai-status${err ? ' err' : ''}`}>{err || status}</span>
    </div>
  );
}

function summariseLayer(l: Layer) {
  const base: Record<string, unknown> = {
    id: l.id,
    name: l.name,
    type: l.type,
    startTime: l.startTime,
    duration: l.duration,
    transform: {
      position: l.transform.position.default,
      scale: l.transform.scale.default,
      rotation: l.transform.rotation.default,
      anchor: l.transform.anchor.default,
      opacity: l.transform.opacity.default,
    },
  };
  if (l.type === 'rectangle' || l.type === 'ellipse') base.size = l.size.default;
  if (l.type === 'rectangle') base.cornerRadius = l.cornerRadius.default;
  if (l.type === 'text') {
    base.text = l.text;
    base.fontSize = l.fontSize.default;
  }
  return base;
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  // Fenced block? Grab what's inside.
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  // Already JSON?
  if (trimmed.startsWith('{')) return trimmed;
  // Otherwise find the first { … matching }.
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  throw new Error('AI reply did not contain JSON.');
}
