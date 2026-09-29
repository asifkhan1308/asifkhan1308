// Pure security policy for the desktop main process — unit-tested without Electron.
'use strict';

const path = require('node:path');
const fs = require('node:fs');

/** Map a kaatchat:// path to a file inside `root`; anything else falls back to index.html. */
function resolveInsideRoot(root, urlPath) {
  const index = path.join(root, 'index.html');
  let decoded;
  try {
    decoded = decodeURIComponent(String(urlPath).split('?')[0].split('#')[0]);
  } catch {
    return index;
  }
  if (decoded.includes('\0')) return index;
  const clean = decoded === '/' || decoded === '' ? '/index.html' : decoded;
  const target = path.normalize(path.join(root, clean));
  // v0.1 used startsWith(root) without a separator, which let "dist-other/…" through.
  if (!target.startsWith(root + path.sep)) return index;
  try {
    if (!fs.statSync(target).isFile()) return index;
  } catch {
    return index;
  }
  return target;
}

const PROVIDERS = {
  openai: { hosts: ['api.openai.com'], header: 'authorization', prefix: 'Bearer ', needsKey: true },
  gemini: { hosts: ['generativelanguage.googleapis.com'], header: 'x-goog-api-key', prefix: '', needsKey: true },
  claude: { hosts: ['api.anthropic.com'], header: 'x-api-key', prefix: '', needsKey: true },
  local: { hosts: ['localhost', '127.0.0.1', '[::1]'], header: null, prefix: '', needsKey: false, allowHttp: true },
};

const AUTH_HEADERS = ['authorization', 'x-api-key', 'x-goog-api-key', 'cookie', 'proxy-authorization'];

const isProvider = (p) => typeof p === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, p);

/** Returns the parsed URL if `provider` may be sent to it, otherwise throws. */
function checkProviderUrl(provider, raw) {
  if (!isProvider(provider)) throw new Error('Unknown provider.');
  const spec = PROVIDERS[provider];
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new Error('Bad URL.');
  }
  const okProto = url.protocol === 'https:' || (spec.allowHttp === true && url.protocol === 'http:');
  const host = url.hostname === '::1' ? '[::1]' : url.hostname;
  if (!okProto || !spec.hosts.includes(host) || url.username || url.password)
    throw new Error(`Kaatchat only sends ${provider} requests to ${spec.hosts.join(', ')}.`);
  return url;
}

/** Drop any credentials the page tried to set; only the main process adds keys. */
function sanitizeHeaders(input) {
  const out = {};
  for (const [k, v] of Object.entries(input || {})) {
    const lk = String(k).toLowerCase();
    if (!AUTH_HEADERS.includes(lk) && typeof v === 'string' && !/[\r\n]/.test(v)) out[lk] = v;
  }
  return out;
}

module.exports = { resolveInsideRoot, PROVIDERS, isProvider, checkProviderUrl, sanitizeHeaders };
