import { useState } from 'react';
import { useV1 } from '../store';
import { t, useLang } from '../../../i18n';
import { createProvider } from '../../../ai/providers';
import { loadAISettings } from '../../../ai/settings';
import { AI_SYSTEM, aiContext, applyAIActions, extractJson } from '../engine/aiActions';
import { LOCAL_EXAMPLES, parseLocalCommand } from '../engine/aiLocal';

/* ──────────────────────────────────────────────────────────────────────────
 * AI command bar: "✦ Ask MOTIONLAB…"
 * Sends a small JSON contract to whichever provider the user has active
 * (built-in Claude, local Ollama/LM Studio, OpenAI, Gemini). Returns a tiny
 * action list that we apply to the project — never prose-only.
 *
 * The action vocabulary, validation and presets live in engine/aiActions.ts
 * (add / trim / move / split / delete / rename layers, set & keyframe props,
 * text, colour, comp duration, preset animations). One command = one undo.
 * ────────────────────────────────────────────────────────────────────────── */

interface Props {
  onOpenGenerate: () => void;
}

export default function AIBar({ onOpenGenerate }: Props) {
  useLang();
  const project = useV1((s) => s.project);
  const selectedId = useV1((s) => s.selectedLayerId);

  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<string>('');
  const [err, setErr] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const selected = project.layers.find((l) => l.id === selectedId);

  const run = async () => {
    if (!prompt.trim()) return;
    setErr('');
    setStatus('Thinking…');
    setBusy(true);
    try {
      const settings = loadAISettings();
      let actions: unknown;
      if (settings.active === 'builtin') {
        // No model connected: understand common phrases offline, for free.
        actions = parseLocalCommand(prompt, useV1.getState().currentTime);
        if (!(actions as unknown[]).length) {
          throw new Error(`Offline mode didn't catch that. Try “${LOCAL_EXAMPLES[0]}” or “${LOCAL_EXAMPLES[2]}” — or connect Claude or a local model in AI settings for free-form requests.`);
        }
      } else {
        const provider = createProvider(settings.active, settings.providers[settings.active]);
        const text = await provider.generateText({
          system: AI_SYSTEM,
          user: `Project:\n${aiContext()}\n\nInstruction: ${prompt}`,
          json: true,
        });
        actions = (JSON.parse(extractJson(text)) as { actions?: unknown }).actions;
      }
      const r = applyAIActions(actions);
      if (!r.applied && !r.skipped.length) setStatus('No actions returned.');
      else {
        // Partial success still says why something was skipped (first reason).
        setStatus(`Applied ${r.applied} action${r.applied === 1 ? '' : 's'}${r.skipped.length ? ` · skipped ${r.skipped.length} (${r.skipped[0]})` : ''} — ⌘Z undoes it all.`);
        if (r.skipped.length) setErr(r.applied ? '' : `Couldn't apply: ${r.skipped.join('; ')}`);
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
        placeholder={selected ? `Ask MOTIONLAB — e.g. “fade "${selected.name}" in”, “trim it to 3s”, “make it red”` : t('studio.ai.placeholder')}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void run(); }}
      />
      <button className="v1-ai-run" onClick={() => void run()} disabled={busy || !prompt.trim()}>
        {busy ? '…' : 'Ask'}
      </button>
      <button className="v1-ai-generate" onClick={onOpenGenerate}>{t('studio.generate')}</button>
      <span className={`v1-ai-status${err ? ' err' : ''}`}>{err || status}</span>
    </div>
  );
}
