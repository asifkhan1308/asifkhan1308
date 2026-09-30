import { useEffect, useState } from 'react';
import { Brand, Icon, toast } from './bits';
import { useAISettings, setAISettings } from '../app/aiState';
import { PROVIDERS, createProvider, detectLocalServers, type FoundServer } from '../ai/providers';
import { keyStore } from '../ai/keys';
import type { LocalApi, ProviderId, ProviderSettings } from '../ai/types';
import { AIError } from '../ai/types';
import { usePrefs, setPrefs } from '../app/prefs';
import { WHISPER_MODELS } from '../engine/media';
import { setLang, useLang, type Lang } from '../i18n';
import { isDesktop } from '../platform/desktop';
import { storageEstimate } from '../engine/persist';
import { checkForUpdates, installUpdate, updatesSupported, useUpdates } from '../app/updates';
import { desktop } from '../platform/desktop';

const ORDER: ProviderId[] = ['builtin', 'local', 'gemini', 'openai', 'claude'];

export function Settings() {
  const ai = useAISettings();
  const prefs = usePrefs();
  const lang = useLang();
  const [secure, setSecure] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    void keyStore.secure().then(setSecure);
    void storageEstimate().then(setUsage);
  }, []);

  return (
    <div className="page">
      <div className="page-inner">
        <nav className="page-top" aria-label="Main">
          <Brand />
          <span className="spacer" />
          <button className="btn ghost" onClick={() => history.back()}>
            <Icon name="left" /> Back
          </button>
        </nav>
        <h1 style={{ fontSize: 32 }}>Settings</h1>

        <section className="section" aria-labelledby="ai-h">
          <h2 id="ai-h">AI providers</h2>
          <p className="muted small" style={{ maxWidth: 720 }}>
            AI in Kaatchat only proposes edits as structured commands; Kaatchat validates them and you decide whether to apply. Your video and audio files are never sent to any provider. Bring your own API key — consumer subscriptions (ChatGPT, Gemini, Claude.ai) do not include API access.
          </p>
          <p className={`note ${isDesktop ? '' : 'warn'}`}>
            {isDesktop
              ? secure
                ? 'Keys are encrypted with your operating system’s credential store and are never readable by the editor page.'
                : 'This system has no OS credential store available, so the desktop app will not save keys. Install a keyring (e.g. GNOME Keyring) to store keys.'
              : 'Web version: keys are stored in this browser for this site only. Anyone with access to this browser profile — or code running on this page — could read them. Use a key with a spending limit, or choose “this session only”.'}
          </p>
          <div className="grid2">
            {ORDER.map((id) => (
              <ProviderCard key={id} id={id} active={ai.active === id} />
            ))}
          </div>
        </section>

        <UpdatesSection />

        <section className="section" aria-labelledby="stt-h">
          <h2 id="stt-h">Transcription</h2>
          <p className="muted small">Speech-to-text runs locally with Whisper. The model is downloaded once from Hugging Face (needs internet the first time), cached by the browser, and then works offline. Audio never leaves this device.</p>
          <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
            <label className="field">
              Model
              <select className="select" value={prefs.whisperModel} onChange={(e) => setPrefs({ whisperModel: e.target.value })}>
                {WHISPER_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Spoken language
              <select className="select" value={prefs.speechLanguage} onChange={(e) => setPrefs({ speechLanguage: e.target.value })}>
                <option value="">Detect automatically</option>
                <option value="english">English</option>
                <option value="hindi">Hindi</option>
                <option value="urdu">Urdu</option>
                <option value="tamil">Tamil</option>
                <option value="telugu">Telugu</option>
                <option value="bengali">Bengali</option>
                <option value="marathi">Marathi</option>
              </select>
            </label>
          </div>
        </section>

        <section className="section" aria-labelledby="ui-h">
          <h2 id="ui-h">Interface</h2>
          <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
            <label className="field">
              Language
              <select className="select" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                <option value="en">English</option>
                <option value="hi">हिन्दी (Hindi)</option>
                <option value="hinglish">Hinglish</option>
              </select>
            </label>
            <label className="field">
              Appearance
              <select className="select" value={prefs.theme} onChange={(e) => setPrefs({ theme: e.target.value as 'system' | 'light' | 'dark' })}>
                <option value="system">Follow system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label className="field" style={{ minWidth: 200 }}>
              Interface size · {Math.round(prefs.uiScale * 100)}%
              <input className="range" type="range" min={0.9} max={1.3} step={0.05} value={prefs.uiScale} onChange={(e) => setPrefs({ uiScale: +e.target.value })} />
            </label>
            <label className="field">
              Motion
              <select className="select" value={prefs.reducedMotion} onChange={(e) => setPrefs({ reducedMotion: e.target.value as 'system' | 'on' | 'off' })}>
                <option value="system">Follow system</option>
                <option value="on">Reduce motion</option>
                <option value="off">Full motion</option>
              </select>
            </label>
            <label className="row small" style={{ alignSelf: 'flex-end', height: 32 }}>
              <input type="checkbox" className="check" checked={prefs.highContrast} onChange={(e) => setPrefs({ highContrast: e.target.checked })} />
              High contrast
            </label>
          </div>
          <p className="faint small">Hindi and Hinglish cover the main screens; untranslated text falls back to English.</p>
        </section>

        <section className="section" aria-labelledby="kb-h">
          <h2 id="kb-h">Keyboard</h2>
          <table className="table small">
            <tbody>
              {[
                ['Space', 'Play / pause'],
                ['S', 'Split at playhead'],
                ['Delete', 'Delete selected clip'],
                ['← / →', 'Step one frame (Shift: one second)'],
                ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
                ['Ctrl+K', 'Ask Kaatchat'],
                ['Ctrl+S', 'Save'],
                ['Ctrl+E', 'Export'],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td>
                    <span className="kbd">{k}</span>
                  </td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {usage && (
          <section className="section">
            <h2>Storage</h2>
            <p className="muted small">
              Projects and media copies use {(usage.usage / 1024 / 1024).toFixed(0)} MB of about {(usage.quota / 1024 / 1024 / 1024).toFixed(1)} GB available to Kaatchat in this browser.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

function ProviderCard({ id, active }: { id: ProviderId; active: boolean }) {
  const ai = useAISettings();
  const info = PROVIDERS[id];
  const s = ai.providers[id];
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [key, setKey] = useState('');
  const [remember, setRemember] = useState(true);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (info.needsKey) void keyStore.has(id).then(setHasKey);
  }, [id, info.needsKey]);

  const update = (patch: Partial<typeof s>) => setAISettings({ ...ai, providers: { ...ai.providers, [id]: { ...s, ...patch } } });
  const usable = s.enabled && (!info.needsKey || hasKey);

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const msg = await createProvider(id, s).testConnection(AbortSignal.timeout(20000));
      setTest({ ok: true, text: msg });
    } catch (e) {
      const text =
        e instanceof AIError ? e.message : e instanceof DOMException && e.name === 'TimeoutError' ? 'No answer within 20 seconds.' : e instanceof Error ? e.message : String(e);
      setTest({ ok: false, text });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className={`card provider${active ? ' active' : ''}`}>
      <div className="row">
        <h3 className="grow">{info.name}</h3>
        {info.network === 'internet' ? <span className="badge warn">Cloud</span> : <span className="badge ok">{info.network === 'none' ? 'On device' : 'This computer'}</span>}
      </div>
      <p className="muted small">{info.privacy}</p>
      {id !== 'builtin' && (
        <label className="row small">
          <input type="checkbox" className="check" checked={s.enabled} onChange={(e) => {
            const enabled = e.target.checked;
            setAISettings({ active: !enabled && active ? 'builtin' : ai.active, providers: { ...ai.providers, [id]: { ...s, enabled } } });
          }} />
          Enabled
        </label>
      )}
      {s.enabled && id !== 'builtin' && (
        <>
          {info.needsKey && (
            <div className="col" style={{ gap: 6 }}>
              <div className="row">
                <input
                  className="input grow mono"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={hasKey ? 'Key saved — enter a new one to replace' : 'Paste API key'}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  aria-label={`${info.name} API key`}
                />
                <button
                  className="btn"
                  disabled={!key.trim()}
                  onClick={async () => {
                    try {
                      await keyStore.set(id, key, remember);
                      setKey('');
                      setHasKey(true);
                      toast(`${info.name} key saved.`);
                    } catch (e) {
                      toast(e instanceof Error ? e.message : String(e), 'err');
                    }
                  }}
                >
                  Save key
                </button>
              </div>
              {!isDesktop && (
                <label className="row small muted">
                  <input type="checkbox" className="check" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  Remember on this browser (otherwise: this session only)
                </label>
              )}
              {hasKey && (
                <button className="btn ghost sm danger" style={{ alignSelf: 'flex-start' }} onClick={async () => { await keyStore.clear(id); setHasKey(false); setTest(null); }}>
                  Remove saved key
                </button>
              )}
              {info.keyHelp && <span className="faint tiny">{info.keyHelp}</span>}
            </div>
          )}
          {id === 'local' ? (
            <LocalSetup s={s} update={update} />
          ) : (
            <div className="row">
              <label className="field grow">
                Model
                <input className="input mono" value={s.model} onChange={(e) => update({ model: e.target.value.trim() })} spellCheck={false} />
              </label>
            </div>
          )}
          <div className="row">
            <button className="btn sm" onClick={runTest} disabled={testing || (info.needsKey && !hasKey)}>
              {testing ? <span className="spin" /> : null} Test connection
            </button>
            {test && <span className={`small ${test.ok ? '' : ''}`} style={{ color: test.ok ? 'var(--success)' : 'var(--danger)' }}>{test.text}</span>}
          </div>
        </>
      )}
      <div className="row">
        <span className="faint tiny grow">Can: {info.capabilities.join(', ').replace('edit-plan', 'plan edits').replace('footage-search', 'search footage')}</span>
        <button className="btn sm" aria-pressed={active} disabled={!usable || active} onClick={() => setAISettings({ ...ai, active: id })}>
          {active ? 'In use' : 'Use this'}
        </button>
      </div>
    </div>
  );
}

/** Local AI: find running servers, pick the API and a model the server actually has. */
function LocalSetup({ s, update }: { s: ProviderSettings; update: (patch: Partial<ProviderSettings>) => void }) {
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<FoundServer[] | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const api: LocalApi = s.api ?? 'ollama';

  const choose = (srv: FoundServer) => {
    const model = srv.models.includes(s.model) || srv.models.some((m) => m.startsWith(s.model + ':')) ? s.model : (srv.models[0] ?? '');
    update({ baseUrl: srv.baseUrl, api: srv.api, model });
    setModels(srv.models);
  };

  const scan = async () => {
    setScanning(true);
    setFound(null);
    try {
      const list = await detectLocalServers(AbortSignal.timeout(10_000));
      setFound(list);
      if (list.length === 1) choose(list[0]);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={scan} disabled={scanning}>
          {scanning ? <span className="spin" /> : <Icon name="search" size={13} />} Find local AI
        </button>
        <span className="faint tiny grow">Looks for Ollama, LM Studio, llama.cpp, Jan, vLLM and KoboldCpp on this computer.</span>
      </div>
      {found && found.length === 0 && (
        <p className="note warn small" role="status">
          No local AI server found. Start one (for example <b>Ollama</b>, or <b>LM Studio</b> → Developer → Start server) and try again
          {isDesktop ? '.' : ', and allow this page to reach it (see below).'}
        </p>
      )}
      {found && found.length > 0 && (
        <ul className="found-servers" aria-label="Local AI servers found">
          {found.map((srv) => (
            <li key={srv.baseUrl}>
              <button className={`btn sm${s.baseUrl === srv.baseUrl ? ' primary' : ''}`} onClick={() => choose(srv)} aria-pressed={s.baseUrl === srv.baseUrl}>
                {srv.name}
              </button>
              <span className="faint tiny mono">{srv.baseUrl}</span>
              <span className="faint tiny">
                {srv.models.length ? `${srv.models.length} model${srv.models.length === 1 ? '' : 's'}` : 'no models loaded yet'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <label className="field">
          Server type
          <select className="select" value={api} onChange={(e) => update({ api: e.target.value as LocalApi })}>
            <option value="ollama">Ollama</option>
            <option value="openai">OpenAI-compatible (LM Studio, llama.cpp, Jan, vLLM…)</option>
          </select>
        </label>
        <label className="field grow">
          Server
          <input className="input mono" value={s.baseUrl ?? ''} onChange={(e) => update({ baseUrl: e.target.value.trim() })} spellCheck={false} placeholder="http://localhost:11434" />
        </label>
      </div>
      <label className="field">
        Model
        <input className="input mono" list="local-models" value={s.model} onChange={(e) => update({ model: e.target.value.trim() })} spellCheck={false} placeholder="e.g. qwen2.5:7b" />
        <datalist id="local-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <span className="faint tiny">
        Good all-rounders for planning edits: Qwen 2.5 7B/14B, Llama 3.1 8B, Gemma 3 12B. Bigger models plan better; 7B+ with 8 GB of memory is a sensible minimum.
      </span>
      {!isDesktop && (
        <span className="faint tiny">
          In the browser, the server must allow this site: for Ollama set OLLAMA_ORIGINS to this page’s address; in LM Studio turn on “Enable CORS”. The desktop app needs neither.
        </span>
      )}
    </div>
  );
}

function UpdatesSection() {
  const prefs = usePrefs();
  const u = useUpdates();
  const busy = u.phase === 'checking' || u.phase === 'downloading' || u.phase === 'installing';
  return (
    <section className="section" aria-labelledby="upd-h">
      <h2 id="upd-h">Updates</h2>
      {!isDesktop ? (
        <p className="muted small">The web app updates itself: reload the page to get the newest version.</p>
      ) : !updatesSupported ? (
        <p className="muted small">This build cannot check for updates. Download the newest installer from the Kaatchat website.</p>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className="small grow">
              You have Kaatchat <b>{desktop?.version}</b>.
            </span>
            <button className="btn sm" onClick={() => void checkForUpdates()} disabled={busy}>
              {u.phase === 'checking' ? <span className="spin" /> : null} Check for updates
            </button>
          </div>
          <div role="status" aria-live="polite" className="small">
            {u.phase === 'result' && u.result.status === 'current' && <span>Kaatchat is up to date.</span>}
            {u.phase === 'result' && u.result.status === 'available' && (
              <div className="note">
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <span className="grow">
                    <b>Kaatchat {u.result.version}</b> is available{u.result.size ? ` (${(u.result.size / 1024 / 1024).toFixed(0)} MB)` : ''}.{' '}
                    {u.result.canInstall ? 'Kaatchat downloads it, checks it against its published checksum, then closes and installs it. Save your work first.' : ''}
                  </span>
                  <button className="btn sm primary" onClick={() => void installUpdate()}>
                    {u.result.canInstall ? 'Install update' : 'Open download page'}
                  </button>
                </div>
                <button className="btn ghost sm" style={{ paddingLeft: 0 }} onClick={() => void desktop?.openExternal(u.result.status === 'available' ? u.result.page : '')}>
                  Release notes
                </button>
              </div>
            )}
            {u.phase === 'downloading' && (
              <div className="col" style={{ gap: 4 }}>
                <span>
                  Downloading Kaatchat {u.version}… {Math.round(u.progress * 100)}%
                </span>
                <progress max={1} value={u.progress} aria-label="Update download" />
              </div>
            )}
            {u.phase === 'installing' && <span>Installing Kaatchat {u.version}. Kaatchat will close and reopen.</span>}
            {u.phase === 'error' && <span style={{ color: 'var(--danger)' }}>{u.message}</span>}
          </div>
          <label className="row small">
            <input type="checkbox" className="check" checked={prefs.checkUpdates} onChange={(e) => setPrefs({ checkUpdates: e.target.checked })} />
            Check for updates when Kaatchat starts (asks GitHub for the list of Kaatchat releases; nothing else is sent)
          </label>
        </div>
      )}
    </section>
  );
}
