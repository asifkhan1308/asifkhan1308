// Local AI: Ollama's API and the OpenAI-compatible API (LM Studio, llama.cpp,
// Jan, vLLM…), server detection, and reasoning-model output.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProvider, detectLocalServers, normalizeLocalUrl, stripThinking } from '../../src/ai/providers';
import type { ProviderSettings } from '../../src/ai/types';

type Call = { url: string; body: unknown };

/** A fake set of local servers: `routes` maps URL → JSON reply; anything else is refused. */
function fakeServers(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (!(url in routes)) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(routes[url]), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

const local = (s: Partial<ProviderSettings>) => createProvider('local', { enabled: true, model: 'm', ...s });
const req = { system: 'sys', user: 'hi', json: true };

describe('local AI', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('talks to OpenAI-compatible servers (LM Studio, llama.cpp, Jan, vLLM)', async () => {
    const calls = fakeServers({
      'http://localhost:1234/v1/chat/completions': { choices: [{ message: { content: '{"ok":true}' } }] },
    });
    const reply = await local({ baseUrl: 'http://localhost:1234', api: 'openai', model: 'qwen2.5-7b-instruct' }).generateText(req);
    expect(reply).toBe('{"ok":true}');
    expect(calls[0].body).toMatchObject({
      model: 'qwen2.5-7b-instruct',
      stream: false,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
    });
    // LM Studio rejects response_format json_object; Kaatchat validates JSON itself.
    expect(calls[0].body).not.toHaveProperty('response_format');
  });

  it('still speaks Ollama’s own API, with a context large enough for transcripts', async () => {
    const calls = fakeServers({ 'http://localhost:11434/api/chat': { message: { content: '{"a":1}' } } });
    expect(await local({ baseUrl: 'http://localhost:11434', model: 'llama3.1:8b' }).generateText(req)).toBe('{"a":1}');
    expect(calls[0].body).toMatchObject({ model: 'llama3.1:8b', format: 'json', options: { num_ctx: 16384 } });
  });

  it('drops the thinking of reasoning models (DeepSeek-R1, Qwen3) before the answer', async () => {
    fakeServers({ 'http://localhost:1234/v1/chat/completions': { choices: [{ message: { content: '<think>maybe {"x":0}…</think>\n{"x":1}' } }] } });
    expect(await local({ baseUrl: 'http://localhost:1234', api: 'openai' }).generateText(req)).toBe('{"x":1}');
    expect(stripThinking('<think>a</think> b <think>c</think> d')).toBe('b  d');
    // Some servers send the closing tag only (the opening one is in the template).
    expect(stripThinking('reasoning… </think>{"y":2}')).toBe('{"y":2}');
    expect(stripThinking('{"plain":true}')).toBe('{"plain":true}');
  });

  it('accepts the server address the way people type it', () => {
    expect(normalizeLocalUrl('localhost:1234', 'openai')).toBe('http://localhost:1234');
    expect(normalizeLocalUrl('http://127.0.0.1:1234/v1/', 'openai')).toBe('http://127.0.0.1:1234');
    expect(normalizeLocalUrl('http://localhost:11434/', 'ollama')).toBe('http://localhost:11434');
    expect(normalizeLocalUrl(undefined, 'ollama')).toBe('http://localhost:11434');
  });

  it('never leaves this computer', async () => {
    fakeServers({});
    await expect(local({ baseUrl: 'http://example.com:1234', api: 'openai' }).generateText(req)).rejects.toMatchObject({ kind: 'network', message: expect.stringMatching(/only talks to this computer/) });
    await expect(local({ baseUrl: 'not a url at all', api: 'openai' }).generateText(req)).rejects.toMatchObject({ kind: 'network' });
  });

  it('lists models and reports whether the chosen one is available', async () => {
    fakeServers({ 'http://localhost:1234/v1/models': { data: [{ id: 'qwen2.5-7b-instruct' }, { id: 'gemma-3-12b' }] } });
    expect(await local({ baseUrl: 'http://localhost:1234', api: 'openai', model: 'gemma-3-12b' }).testConnection()).toMatch(/“gemma-3-12b” is available/);
    expect(await local({ baseUrl: 'http://localhost:1234', api: 'openai', model: 'nope' }).testConnection()).toMatch(/not available\. Available: qwen2\.5-7b-instruct, gemma-3-12b/);
  });

  it('finds the servers that are running, with their models', async () => {
    fakeServers({
      'http://localhost:11434/api/tags': { models: [{ name: 'llama3.1:8b' }] },
      'http://localhost:1234/v1/models': { data: [{ id: 'qwen2.5-7b-instruct' }] },
    });
    const found = await detectLocalServers();
    expect(found).toEqual([
      { name: 'Ollama', baseUrl: 'http://localhost:11434', api: 'ollama', models: ['llama3.1:8b'] },
      { name: 'LM Studio', baseUrl: 'http://localhost:1234', api: 'openai', models: ['qwen2.5-7b-instruct'] },
    ]);
  });

  it('a server that accepts the connection but never answers does not stall detection', async () => {
    vi.stubGlobal('fetch', (_u: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    const t0 = Date.now();
    expect(await detectLocalServers(undefined, 50)).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
