import { useEffect, useState } from 'react';
import { loadAISettings, saveAISettings } from '../../../ai/settings';
import { detectLocalServers, PROVIDERS, type FoundServer } from '../../../ai/providers';
import type { ProviderId } from '../../../ai/types';
import { generateFromPrompt, TEMPLATES } from '../engine/generate';

/* Generate modal.
 * "Describe your video" → an editable motion graphic on the timeline, built
 * by the engine picked below (see engine/generate.ts). Local uses the user's
 * own RAM via Ollama / LM Studio / llama.cpp; cloud uses whichever provider's
 * key the user configured; with neither, an offline template runs for free.
 * Language models design the layers/animation; they don't render pixels. */

interface Row {
  id: ProviderId | 'local-detected';
  title: string;
  sub: string;
  detail?: string;
  ready: boolean;
  providerId: ProviderId;
  baseUrl?: string;
}

export default function GenerateModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState(loadAISettings());
  const [detected, setDetected] = useState<FoundServer[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [genErr, setGenErr] = useState('');
  const engineName = settings.active === 'builtin' ? 'Offline template (free, no AI)' : PROVIDERS[settings.active].name;
  const generate = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setGenErr('');
    try {
      await generateFromPrompt(prompt.trim());
      onClose();
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const rescan = async () => {
    setScanning(true);
    try {
      const r = await detectLocalServers();
      setDetected(r);
    } catch {
      setDetected([]);
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    void rescan();
  }, []);

  const rows: Row[] = [];
  // Built-in = the offline mode (templates + phrase parser); always available.
  rows.push({
    id: 'builtin',
    title: 'Built-in · Offline',
    sub: 'Free, on this device, no AI model: templates and common commands.',
    ready: true,
    providerId: 'builtin',
  });
  // Local servers — user's own RAM, offline.
  if (detected && detected.length > 0) {
    for (const d of detected) {
      rows.push({
        id: 'local-detected',
        title: `Local · ${d.name}`,
        sub: `${d.baseUrl} · ${d.models.length} model${d.models.length === 1 ? '' : 's'} loaded`,
        detail: d.models.slice(0, 3).join(', ') + (d.models.length > 3 ? '…' : ''),
        ready: true,
        providerId: 'local',
        baseUrl: d.baseUrl,
      });
    }
  } else {
    rows.push({
      id: 'local',
      title: 'Local · Ollama / LM Studio',
      sub: scanning
        ? 'Scanning localhost…'
        : 'No local server detected. Install Ollama or LM Studio, start it, then click Re-scan.',
      ready: false,
      providerId: 'local',
    });
  }
  for (const pid of ['openai', 'gemini', 'claude'] as ProviderId[]) {
    const info = PROVIDERS[pid];
    const cfg = settings.providers[pid];
    const hasKey = !!cfg.enabled;
    rows.push({
      id: pid,
      title: `Cloud · ${info.name}`,
      sub: hasKey
        ? `${info.defaultModel} · using your API key`
        : `Add an API key in Settings → AI providers to use ${info.name}.`,
      ready: hasKey,
      providerId: pid,
    });
  }

  const pick = (r: Row) => {
    if (!r.ready) return;
    const next = { ...settings, active: r.providerId };
    if (r.baseUrl) {
      next.providers = {
        ...next.providers,
        local: { ...next.providers.local, enabled: true, baseUrl: r.baseUrl },
      };
    }
    setSettings(next);
    saveAISettings(next);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Generate a video</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-content">
          <div className="v1-gen-prompt">
            <textarea
              className="v1-gen-input"
              placeholder={'Describe your video — e.g. a 6 second intro for "Asif\'s Bakery" with "Fresh every morning", gold accents'}
              value={prompt}
              rows={3}
              autoFocus
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void generate(); }}
            />
            <div className="v1-gen-chips" role="group" aria-label="Start from a template">
              {TEMPLATES.map((t) => (
                <button key={t.kind} type="button" className="v1-gen-chip" onClick={() => setPrompt(t.example)} title={t.example}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="v1-gen-actions">
              <span className="v1-gen-engine">Engine: {engineName}</span>
              <button className="btn-primary v1-gen-go" onClick={() => void generate()} disabled={busy || !prompt.trim()}>
                {busy ? 'Generating…' : 'Generate'}
              </button>
            </div>
            {genErr && <div className="v1-gen-err" role="alert">{genErr}</div>}
            <p className="v1-gen-note">
              Builds editable layers, text and animation on your timeline (one ⌘Z undoes it). Local and cloud engines
              design it with AI; language models don't render video pixels.
            </p>
          </div>
          <div className="v1-gen-rows">
            {rows.map((r, i) => (
              <button
                key={`${r.id}-${i}`}
                type="button"
                className={`v1-gen-row${settings.active === r.providerId ? ' active' : ''}`}
                onClick={() => pick(r)}
                disabled={!r.ready}
              >
                <span aria-hidden>{settings.active === r.providerId ? '●' : '○'}</span>
                <span className="meta">
                  <span className="title">{r.title}</span>
                  <span className="sub">{r.sub}</span>
                  {r.detail && <span className="sub">{r.detail}</span>}
                </span>
                <span className={`badge ${r.ready ? 'ready' : 'setup'}`}>
                  {r.ready ? 'Ready' : 'Setup'}
                </span>
              </button>
            ))}
          </div>
          <p style={{ fontSize: 11, color: 'var(--v1-text-3)', margin: 0 }}>
            Pick the engine: local runs on your own RAM (Ollama / LM Studio), cloud uses your key,
            and the offline template needs neither.
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={() => void rescan()} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Re-scan local'}
          </button>
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
