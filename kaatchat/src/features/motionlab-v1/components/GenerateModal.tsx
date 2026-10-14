import { useEffect, useState } from 'react';
import { loadAISettings, saveAISettings } from '../../../ai/settings';
import { detectLocalServers, PROVIDERS, type FoundServer } from '../../../ai/providers';
import type { ProviderId } from '../../../ai/types';

/* Generate modal — Stage-1 scaffolding.
 * Picks the backend the user wants for AI generation (local vs cloud) and
 * routes through Kaatchat's existing provider abstraction. Local uses the
 * user's own RAM via Ollama / LM Studio / llama.cpp. Cloud uses whichever
 * provider's key the user has configured in Settings.
 *
 * Actual clip-generation plumbing (text-to-video, text-to-image) lands in
 * a later stage — this slice ships the picker + status surface so Studio
 * users can see what their options are and switch active provider without
 * leaving the editor. */

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
  // The built-in Anthropic path is always available via Kaatchat's bundled
  // auth — show it as "Ready" so new users have a working default.
  rows.push({
    id: 'builtin',
    title: 'Built-in · Claude',
    sub: "Fastest to try. Routed through Kaatchat's bundled AI. No key required.",
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
          <h2>Generate — pick the engine</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-content">
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
            Stage 1 wires the engine picker. Clip generation (text-to-image,
            text-to-video) is wired to the chosen engine in the next slice —
            local engines run on your own RAM, cloud engines through your key.
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
