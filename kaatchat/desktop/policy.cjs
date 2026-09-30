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

// ---------------------------------------------------------------------------
// Updates: only Kaatchat's own releases in its own repository, verified by SHA-256.
// ---------------------------------------------------------------------------

const UPDATE_REPO = 'asifkhan1308/asifkhan1308';
const RELEASES_API = `https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=30`;
/**
 * The release manifest the website's Download button uses, read from the main
 * branch. raw.githubusercontent.com has no per-IP API limit, so this is the
 * primary source; the releases API is the fallback.
 */
const RELEASE_MANIFEST = `https://raw.githubusercontent.com/${UPDATE_REPO}/main/kaatchat/site/release.json`;
const TAG_RE = /^kaatchat-v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** "kaatchat-v2.0.0-alpha.2" → { version: "2.0.0-alpha.2", … }; anything else → null. */
function parseTag(tag) {
  const m = TAG_RE.exec(String(tag));
  if (!m) return null;
  return { version: String(tag).slice('kaatchat-v'.length), core: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.') : [] };
}

function parseVersion(v) {
  return parseTag(`kaatchat-v${v}`);
}

/** Semantic-version order: negative if a < b. A prerelease sorts before its release. */
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`Not a version: ${!x ? a : b}`);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre.length || !y.pre.length) return (y.pre.length ? 1 : 0) - (x.pre.length ? 1 : 0);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && +p !== +q) return +p - +q;
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/**
 * The newest release newer than `current` from a GitHub releases list, or null.
 * People on a prerelease also get prereleases; people on a stable release only
 * stable ones. A release counts only if it carries its installer and checksums.
 */
function pickUpdate(releases, current) {
  const wantPre = parseVersion(current)?.pre.length > 0;
  let best = null;
  for (const r of Array.isArray(releases) ? releases : []) {
    if (!r || r.draft) continue;
    const t = parseTag(r.tag_name);
    if (!t || (t.pre.length && !wantPre)) continue;
    const assets = Array.isArray(r.assets) ? r.assets : [];
    const exe = assets.find((a) => a && a.name === `Kaatchat-Setup-${t.version}.exe`);
    const sums = assets.find((a) => a && a.name === 'SHA256SUMS.txt');
    if (!exe || !sums || !isAllowedDownload(exe.browser_download_url) || !isAllowedDownload(sums.browser_download_url)) continue;
    if (compareVersions(t.version, current) <= 0) continue;
    if (best && compareVersions(t.version, best.version) <= 0) continue;
    best = {
      version: t.version,
      page: typeof r.html_url === 'string' ? r.html_url : `https://github.com/${UPDATE_REPO}/releases`,
      notes: typeof r.body === 'string' ? r.body.slice(0, 2000) : '',
      prerelease: !!r.prerelease,
      installer: { name: exe.name, url: exe.browser_download_url, size: typeof exe.size === 'number' ? exe.size : null },
      sumsUrl: sums.browser_download_url,
    };
  }
  return best;
}

/** The same update shape as pickUpdate, from the website's release.json, or null. */
function updateFromManifest(m, current) {
  if (!m || typeof m !== 'object') return null;
  const t = parseTag(`kaatchat-v${m.version}`);
  if (!t || !isAllowedDownload(m.windowsUrl) || !/^[0-9a-f]{64}$/i.test(String(m.sha256))) return null;
  if (!String(m.windowsUrl).endsWith(`/kaatchat-v${t.version}/Kaatchat-Setup-${t.version}.exe`)) return null;
  const wantPre = parseVersion(current)?.pre.length > 0;
  if ((t.pre.length && !wantPre) || compareVersions(t.version, current) <= 0) return null;
  return {
    version: t.version,
    page: `https://github.com/${UPDATE_REPO}/releases/tag/kaatchat-v${t.version}`,
    notes: typeof m.notes === 'string' ? m.notes.slice(0, 2000) : '',
    prerelease: t.pre.length > 0,
    installer: { name: `Kaatchat-Setup-${t.version}.exe`, url: m.windowsUrl, size: typeof m.size === 'number' ? m.size : null },
    sha256: String(m.sha256).toLowerCase(),
  };
}

/** Only files from this repository's releases, over HTTPS. */
function isAllowedDownload(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return false;
  }
  return u.protocol === 'https:' && u.hostname === 'github.com' && u.pathname.startsWith(`/${UPDATE_REPO}/releases/download/kaatchat-v`) && !u.username && !u.password;
}

/** The SHA-256 listed for `fileName` in a SHA256SUMS.txt, lower-case, or null. */
function sumFor(text, fileName) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m && m[2] === fileName) return m[1].toLowerCase();
  }
  return null;
}

module.exports = {
  resolveInsideRoot,
  PROVIDERS,
  isProvider,
  checkProviderUrl,
  sanitizeHeaders,
  RELEASES_API,
  RELEASE_MANIFEST,
  updateFromManifest,
  parseTag,
  compareVersions,
  pickUpdate,
  isAllowedDownload,
  sumFor,
};
