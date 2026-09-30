// Provider adapters. Each one only turns (system, user) text into a reply;
// planning, validation and execution happen in Kaatchat, not here.

import Anthropic from '@anthropic-ai/sdk';
import { AIError, type AIProvider, type ChatRequest, type LocalApi, type ProviderId, type ProviderInfo, type ProviderSettings } from './types';
import { httpError, providerFetch } from './transport';
import { desktop } from '../platform/desktop';

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  builtin: {
    id: 'builtin',
    name: 'Built-in commands',
    network: 'none',
    needsKey: false,
    defaultModel: 'rules',
    capabilities: ['edit-plan', 'footage-search'],
    privacy:
      'No model. Understands common requests ("remove silence", "30 second reel", "make it vertical") with fixed rules and searches transcripts by keyword. Nothing leaves this device.',
  },
  local: {
    id: 'local',
    name: 'Local AI (Ollama, LM Studio, llama.cpp…)',
    network: 'localhost',
    needsKey: false,
    defaultModel: 'llama3.2',
    capabilities: ['text', 'edit-plan', 'footage-search', 'metadata'],
    privacy:
      'Uses a model running on this computer: Ollama, LM Studio, llama.cpp, Jan, vLLM or any OpenAI-compatible server. Transcript text and clip timings go only to that server; nothing goes to the internet, and no key or account is needed.',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    network: 'internet',
    needsKey: true,
    defaultModel: 'gpt-5-mini',
    capabilities: ['text', 'edit-plan', 'footage-search', 'metadata'],
    privacy:
      'Your request, clip timings, loudness readings and transcript text are sent to OpenAI. Video and audio files are never sent.',
    keyHelp: 'Create a key at platform.openai.com → API keys. A ChatGPT subscription does not include API access.',
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    network: 'internet',
    needsKey: true,
    defaultModel: 'gemini-2.5-flash',
    capabilities: ['text', 'edit-plan', 'footage-search', 'metadata'],
    privacy:
      'Your request, clip timings, loudness readings and transcript text are sent to Google. Video and audio files are never sent.',
    keyHelp: 'Create a key in Google AI Studio. A Gemini app subscription does not include API access.',
  },
  claude: {
    id: 'claude',
    name: 'Anthropic Claude',
    network: 'internet',
    needsKey: true,
    defaultModel: 'claude-opus-5',
    capabilities: ['text', 'edit-plan', 'footage-search', 'metadata'],
    privacy:
      'Your request, clip timings, loudness readings and transcript text are sent to Anthropic. Video and audio files are never sent.',
    keyHelp: 'Create a key in the Claude Console (platform.claude.com). A Claude.ai subscription does not include API access.',
  },
};

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

async function json<T>(res: Response, name: string): Promise<T> {
  if (!res.ok) throw await httpError(res, name);
  try {
    return (await res.json()) as T;
  } catch {
    throw new AIError(`${name} sent a reply that was not JSON.`, 'bad-output');
  }
}

class OpenAIProvider implements AIProvider {
  readonly info = PROVIDERS.openai;
  private f = providerFetch('openai');
  constructor(private s: ProviderSettings) {}

  async generateText(req: ChatRequest) {
    const res = await this.f('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: req.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.s.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        ...(req.json ? { response_format: { type: 'json_object' } } : {}),
        max_completion_tokens: req.maxTokens ?? 8000,
      }),
    });
    const j = await json<{ choices?: { message?: { content?: string; refusal?: string } }[] }>(res, 'OpenAI');
    const m = j.choices?.[0]?.message;
    if (m?.refusal) throw new AIError(`OpenAI declined: ${m.refusal}`, 'refused');
    if (!m?.content) throw new AIError('OpenAI returned an empty reply.', 'bad-output');
    return m.content;
  }

  async testConnection(signal?: AbortSignal) {
    const res = await this.f('https://api.openai.com/v1/models', { signal });
    const j = await json<{ data?: { id: string }[] }>(res, 'OpenAI');
    const ids = (j.data ?? []).map((m) => m.id);
    return ids.includes(this.s.model)
      ? `Connected. Model “${this.s.model}” is available.`
      : `Connected, but “${this.s.model}” is not in your model list (${ids.length} models found).`;
  }
}

class GeminiProvider implements AIProvider {
  readonly info = PROVIDERS.gemini;
  private f = providerFetch('gemini');
  constructor(private s: ProviderSettings) {}

  async generateText(req: ChatRequest) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.s.model)}:generateContent`;
    const res = await this.f(url, {
      method: 'POST',
      signal: req.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.user }] }],
        generationConfig: { maxOutputTokens: req.maxTokens ?? 8000, ...(req.json ? { responseMimeType: 'application/json' } : {}) },
      }),
    });
    const j = await json<{
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
    }>(res, 'Gemini');
    if (j.promptFeedback?.blockReason) throw new AIError(`Gemini blocked the request (${j.promptFeedback.blockReason}).`, 'refused');
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text) throw new AIError(`Gemini returned an empty reply (${j.candidates?.[0]?.finishReason ?? 'no reason given'}).`, 'bad-output');
    return text;
  }

  async testConnection(signal?: AbortSignal) {
    const res = await this.f('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { signal });
    const j = await json<{ models?: { name: string }[] }>(res, 'Gemini');
    const ids = (j.models ?? []).map((m) => m.name.replace(/^models\//, ''));
    return ids.includes(this.s.model)
      ? `Connected. Model “${this.s.model}” is available.`
      : `Connected, but “${this.s.model}” was not listed (${ids.length} models found).`;
  }
}

class ClaudeProvider implements AIProvider {
  readonly info = PROVIDERS.claude;
  private client: Anthropic;
  constructor(private s: ProviderSettings) {
    // The real key is added by providerFetch (page) or the main process
    // (desktop); the SDK only ever holds a placeholder.
    this.client = new Anthropic({
      apiKey: 'added-by-kaatchat',
      dangerouslyAllowBrowser: true,
      fetch: providerFetch('claude'),
      maxRetries: 1,
    });
  }

  async generateText(req: ChatRequest) {
    const supportsFallbacks = /^claude-(opus-5$|fable-5-1$)/.test(this.s.model);
    try {
      const msg = await this.client.beta.messages.create(
        {
          model: this.s.model,
          max_tokens: req.maxTokens ?? 16000,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
          output_config: { effort: 'medium' },
          ...(supportsFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
        } as Anthropic.Beta.MessageCreateParamsNonStreaming,
        { signal: req.signal },
      );
      if (msg.stop_reason === 'refusal') throw new AIError('Claude declined this request.', 'refused');
      const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      if (!text) throw new AIError('Claude returned an empty reply.', 'bad-output');
      return text;
    } catch (e) {
      throw this.mapError(e);
    }
  }

  async testConnection(signal?: AbortSignal) {
    try {
      const m = await this.client.models.retrieve(this.s.model, {}, { signal });
      return `Connected. Model “${m.display_name ?? m.id}” is available.`;
    } catch (e) {
      throw this.mapError(e);
    }
  }

  private mapError(e: unknown): unknown {
    if (e instanceof AIError || isAbort(e)) return e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
      return new AIError('Anthropic rejected the API key.', 'auth');
    if (e instanceof Anthropic.RateLimitError) return new AIError('Anthropic is rate-limiting requests. Try again shortly.', 'rate-limit');
    if (e instanceof Anthropic.NotFoundError) return new AIError(`Anthropic: model “${this.s.model}” not found.`, 'server');
    if (e instanceof Anthropic.APIUserAbortError) return new DOMException('Aborted', 'AbortError');
    // Our transport's own errors (timeout, offline, no key) arrive wrapped by the SDK.
    if (e instanceof Anthropic.APIConnectionError && e.cause instanceof AIError) return e.cause;
    if (e instanceof Anthropic.APIConnectionError) return new AIError('Could not reach Anthropic. Check your connection.', 'network');
    if (e instanceof Anthropic.APIError) return new AIError(`Anthropic returned ${e.status}: ${e.message}`.slice(0, 280), 'server');
    return e;
  }
}

/** Local servers Kaatchat looks for, by their usual default ports. */
export const LOCAL_SERVERS: { name: string; baseUrl: string; api: LocalApi }[] = [
  { name: 'Ollama', baseUrl: 'http://localhost:11434', api: 'ollama' },
  { name: 'LM Studio', baseUrl: 'http://localhost:1234', api: 'openai' },
  { name: 'llama.cpp / LocalAI', baseUrl: 'http://localhost:8080', api: 'openai' },
  { name: 'Jan', baseUrl: 'http://localhost:1337', api: 'openai' },
  { name: 'vLLM', baseUrl: 'http://localhost:8000', api: 'openai' },
  { name: 'KoboldCpp', baseUrl: 'http://localhost:5001', api: 'openai' },
];

export interface FoundServer {
  name: string;
  baseUrl: string;
  api: LocalApi;
  models: string[];
}

/** Reasoning models (DeepSeek-R1, Qwen3, …) think out loud first; only the answer matters here. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
}

/** Accepts "localhost:1234", "http://localhost:1234/v1/" and the like. */
export function normalizeLocalUrl(raw: string | undefined, api: LocalApi): string {
  let b = (raw || 'http://localhost:11434').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(b)) b = `http://${b}`;
  if (api === 'openai') b = b.replace(/\/v1$/i, '');
  return b;
}

class LocalProvider implements AIProvider {
  readonly info = PROVIDERS.local;
  private f: ReturnType<typeof providerFetch>;
  constructor(
    private s: ProviderSettings,
    timeoutMs?: number,
  ) {
    this.f = providerFetch('local', timeoutMs);
  }

  private get api(): LocalApi {
    return this.s.api ?? 'ollama';
  }

  private base() {
    const b = normalizeLocalUrl(this.s.baseUrl, this.api);
    let u: URL;
    try {
      u = new URL(b);
    } catch {
      throw new AIError(`“${this.s.baseUrl}” is not a valid server address.`, 'network');
    }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
      throw new AIError('The local provider only talks to this computer (localhost).', 'network');
    // Browsers' Content-Security-Policy cannot allow IPv6 literals, so the web app would be
    // blocked silently. The desktop app sends requests from its main process, where [::1] works.
    if (u.hostname === '[::1]' && !desktop)
      throw new AIError('In the browser, use http://localhost or http://127.0.0.1 for the local server ([::1] is blocked by the page’s security policy).', 'network');
    return b;
  }

  async generateText(req: ChatRequest) {
    const messages = [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ];
    let content: string | undefined;
    if (this.api === 'openai') {
      const res = await this.f(`${this.base()}/v1/chat/completions`, {
        method: 'POST',
        signal: req.signal,
        headers: { 'content-type': 'application/json' },
        // No response_format: servers disagree on it (LM Studio rejects json_object);
        // Kaatchat extracts and validates the JSON itself.
        body: JSON.stringify({ model: this.s.model, stream: false, temperature: 0.2, ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}), messages }),
      });
      const j = await json<{ choices?: { message?: { content?: string } }[] }>(res, 'Local model');
      content = j.choices?.[0]?.message?.content;
    } else {
      const res = await this.f(`${this.base()}/api/chat`, {
        method: 'POST',
        signal: req.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.s.model,
          stream: false,
          ...(req.json ? { format: 'json' } : {}),
          // Ollama's default context is small and silently cuts long transcripts.
          options: { temperature: 0.2, num_ctx: 16384 },
          messages,
        }),
      });
      const j = await json<{ message?: { content?: string } }>(res, 'Local model');
      content = j.message?.content;
    }
    const text = stripThinking(content ?? '');
    if (!text) throw new AIError('The local model returned an empty reply.', 'bad-output');
    return text;
  }

  /** Models the server has available. */
  async listModels(signal?: AbortSignal): Promise<string[]> {
    if (this.api === 'openai') {
      const res = await this.f(`${this.base()}/v1/models`, { signal });
      const j = await json<{ data?: { id: string }[] }>(res, 'Local model');
      return (j.data ?? []).map((m) => m.id).filter(Boolean);
    }
    const res = await this.f(`${this.base()}/api/tags`, { signal });
    const j = await json<{ models?: { name: string }[] }>(res, 'Local model');
    return (j.models ?? []).map((m) => m.name).filter(Boolean);
  }

  async testConnection(signal?: AbortSignal) {
    const names = await this.listModels(signal);
    if (!this.s.model) return `Connected. Choose a model: ${names.join(', ') || 'none installed yet'}.`;
    const has = names.some((n) => n === this.s.model || n.startsWith(this.s.model + ':'));
    return has
      ? `Connected. “${this.s.model}” is available.`
      : `Connected, but “${this.s.model}” is not available. Available: ${names.join(', ') || 'none'}.`;
  }
}

/**
 * Looks for model servers on this computer's usual ports, in parallel. Each
 * probe is a single short request to that server's model list; servers that
 * are not running (or, in a browser, do not allow this page) are skipped.
 */
export async function detectLocalServers(signal?: AbortSignal, probeMs = 2500): Promise<FoundServer[]> {
  const found = await Promise.all(
    LOCAL_SERVERS.map(async (srv) => {
      try {
        const models = await new LocalProvider({ enabled: true, model: '', baseUrl: srv.baseUrl, api: srv.api }, probeMs).listModels(signal);
        return { ...srv, models };
      } catch {
        return null;
      }
    }),
  );
  return found.filter((x): x is FoundServer => x !== null);
}

class BuiltinProvider implements AIProvider {
  readonly info = PROVIDERS.builtin;
  async generateText(): Promise<string> {
    throw new AIError('The built-in commands are rules, not a language model.', 'bad-output');
  }
  async testConnection() {
    return 'Always available. Runs entirely on this device.';
  }
}

export function createProvider(id: ProviderId, s: ProviderSettings): AIProvider {
  switch (id) {
    case 'openai':
      return new OpenAIProvider(s);
    case 'gemini':
      return new GeminiProvider(s);
    case 'claude':
      return new ClaudeProvider(s);
    case 'local':
      return new LocalProvider(s);
    case 'builtin':
      return new BuiltinProvider();
  }
}
