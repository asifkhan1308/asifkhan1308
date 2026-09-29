// One fetch function per provider. It adds the person's key at the last
// possible moment — in the page for the web build, or in the Electron main
// process for the desktop build (where the page never sees the key).

import { desktop } from '../platform/desktop';
import { uid } from '../engine/id';
import { keyStore } from './keys';
import { AIError, type ProviderId } from './types';

/** How each provider expects its key. Mirrored in desktop/main.cjs. */
export const AUTH: Record<ProviderId, { header: string; prefix: string } | null> = {
  builtin: null,
  local: null,
  openai: { header: 'authorization', prefix: 'Bearer ' },
  gemini: { header: 'x-goog-api-key', prefix: '' },
  claude: { header: 'x-api-key', prefix: '' },
};

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function headersToObject(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(h).forEach((v, k) => (out[k] = v));
  return out;
}

export function providerFetch(provider: ProviderId): FetchLike {
  return async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = headersToObject(init.headers);
    const auth = AUTH[provider];

    if (typeof navigator !== 'undefined' && navigator.onLine === false && provider !== 'local')
      throw new AIError('You are offline. This provider needs an internet connection.', 'offline');

    if (desktop) {
      const id = uid();
      const onAbort = () => void desktop!.aiCancel(id);
      init.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const body = typeof init.body === 'string' ? init.body : init.body == null ? undefined : String(init.body);
        const r = await desktop.aiFetch(id, provider, {
          url,
          method: (init.method as 'GET' | 'POST') ?? 'GET',
          headers,
          body,
        });
        if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        return new Response(r.body, { status: r.status, statusText: r.statusText, headers: r.headers });
      } finally {
        init.signal?.removeEventListener('abort', onAbort);
      }
    }

    if (auth) {
      const key = keyStore.webKey(provider);
      if (!key) throw new AIError('No API key is set for this provider. Add one in Settings → AI providers.', 'no-key');
      headers[auth.header] = auth.prefix + key;
    }
    try {
      return await fetch(url, { ...init, headers });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new AIError(
        provider === 'local'
          ? 'Could not reach the local model server. Is it running, and does it allow this origin?'
          : 'Could not reach the provider. Check your connection.',
        'network',
      );
    }
  };
}

/** Turn an HTTP failure into something a person can act on. */
export async function httpError(res: Response, providerName: string): Promise<AIError> {
  let detail = '';
  try {
    const j = (await res.json()) as { error?: { message?: string } | string; message?: string };
    detail = typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message ?? '');
  } catch {
    /* body was not JSON */
  }
  detail = detail.slice(0, 240);
  if (res.status === 401 || res.status === 403)
    return new AIError(`${providerName} rejected the API key${detail ? `: ${detail}` : '.'}`, 'auth');
  if (res.status === 429) return new AIError(`${providerName} is rate-limiting requests. Try again shortly.`, 'rate-limit');
  if (res.status === 404) return new AIError(`${providerName}: model or endpoint not found${detail ? ` — ${detail}` : ''}.`, 'server');
  return new AIError(`${providerName} returned ${res.status}${detail ? `: ${detail}` : ''}`, 'server');
}
