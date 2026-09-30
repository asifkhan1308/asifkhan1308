'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveInsideRoot, checkProviderUrl, sanitizeHeaders, compareVersions, pickUpdate, isAllowedDownload, sumFor, parseTag } = require('../policy.cjs');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-'));
const root = path.join(base, 'dist');
fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
fs.writeFileSync(path.join(root, 'index.html'), 'i');
fs.writeFileSync(path.join(root, 'assets', 'a.js'), 'a');
fs.mkdirSync(path.join(base, 'dist-secret'));
fs.writeFileSync(path.join(base, 'dist-secret', 'keys.json'), 's');
fs.writeFileSync(path.join(base, 'provider-keys.json'), 's');
const index = path.join(root, 'index.html');

test('serves files inside dist', () => {
  assert.equal(resolveInsideRoot(root, '/assets/a.js'), path.join(root, 'assets', 'a.js'));
  assert.equal(resolveInsideRoot(root, '/'), index);
});

test('blocks traversal, including the v0.1 sibling-prefix bypass', () => {
  for (const p of ['/../provider-keys.json', '/%2e%2e/provider-keys.json', '/../dist-secret/keys.json', '/assets/../../dist-secret/keys.json', '/%00', '/%E0%A4%A']) {
    assert.equal(resolveInsideRoot(root, p), index, p);
  }
});

test('provider requests only go to that provider', () => {
  assert.equal(checkProviderUrl('openai', 'https://api.openai.com/v1/models').hostname, 'api.openai.com');
  assert.throws(() => checkProviderUrl('openai', 'https://api.anthropic.com/v1/messages'));
  assert.throws(() => checkProviderUrl('openai', 'http://api.openai.com/v1/models'));
  assert.throws(() => checkProviderUrl('claude', 'https://api.anthropic.com.evil.com/v1'));
  assert.throws(() => checkProviderUrl('claude', 'https://user:pw@api.anthropic.com/v1'));
  assert.throws(() => checkProviderUrl('shell', 'https://example.com'));
  assert.equal(checkProviderUrl('local', 'http://localhost:11434/api/tags').port, '11434');
  assert.equal(checkProviderUrl('local', 'http://[::1]:11434/api/tags').hostname, '[::1]');
  assert.throws(() => checkProviderUrl('local', 'http://192.168.1.5:11434/api/tags'));
});

test('the page cannot set credentials or inject headers', () => {
  assert.deepEqual(sanitizeHeaders({ Authorization: 'Bearer x', 'X-Api-Key': 'k', 'content-type': 'application/json', bad: 'a\r\nb' }), {
    'content-type': 'application/json',
  });
});

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

const DL = 'https://github.com/asifkhan1308/asifkhan1308/releases/download';
const release = (v, extra = {}) => ({
  tag_name: `kaatchat-v${v}`,
  draft: false,
  prerelease: v.includes('-'),
  html_url: `https://github.com/asifkhan1308/asifkhan1308/releases/tag/kaatchat-v${v}`,
  body: `Kaatchat ${v}`,
  assets: [
    { name: `Kaatchat-Setup-${v}.exe`, size: 116260603, browser_download_url: `${DL}/kaatchat-v${v}/Kaatchat-Setup-${v}.exe` },
    { name: 'SHA256SUMS.txt', size: 100, browser_download_url: `${DL}/kaatchat-v${v}/SHA256SUMS.txt` },
  ],
  ...extra,
});

test('versions sort by semantic-version rules', () => {
  const order = ['1.9.9', '2.0.0-alpha.1', '2.0.0-alpha.2', '2.0.0-alpha.10', '2.0.0-beta', '2.0.0-rc.1', '2.0.0', '2.0.1', '2.1.0', '10.0.0'];
  for (let i = 0; i < order.length - 1; i++) {
    assert.ok(compareVersions(order[i], order[i + 1]) < 0, `${order[i]} < ${order[i + 1]}`);
    assert.ok(compareVersions(order[i + 1], order[i]) > 0, `${order[i + 1]} > ${order[i]}`);
  }
  assert.equal(compareVersions('2.0.0-alpha.2', '2.0.0-alpha.2'), 0);
  assert.equal(parseTag('v2.0.0'), null);
  assert.equal(parseTag('kaatchat-v2.0'), null);
  assert.equal(parseTag('something-else'), null);
});

test('update: picks the newest newer release that has an installer and checksums', () => {
  const list = [release('2.0.0-alpha.1'), release('2.0.0-alpha.3'), release('2.0.0-alpha.2'), { tag_name: 'profile-v9', assets: [] }];
  const u = pickUpdate(list, '2.0.0-alpha.2');
  assert.equal(u.version, '2.0.0-alpha.3');
  assert.equal(u.installer.name, 'Kaatchat-Setup-2.0.0-alpha.3.exe');
  assert.match(u.sumsUrl, /kaatchat-v2\.0\.0-alpha\.3\/SHA256SUMS\.txt$/);
  assert.equal(pickUpdate(list, '2.0.0-alpha.3'), null, 'already newest');
  assert.equal(pickUpdate([], '2.0.0'), null);
  assert.equal(pickUpdate('not a list', '2.0.0'), null);
});

test('update: stable users are not offered prereleases; prerelease users get stable too', () => {
  const list = [release('2.1.0-beta.1'), release('2.0.1')];
  assert.equal(pickUpdate(list, '2.0.0').version, '2.0.1');
  assert.equal(pickUpdate(list, '2.0.0-alpha.2').version, '2.1.0-beta.1');
  assert.equal(pickUpdate([release('2.0.0')], '2.0.0-alpha.2').version, '2.0.0');
});

test('update: drafts, missing assets and foreign download hosts are ignored', () => {
  assert.equal(pickUpdate([release('3.0.0', { draft: true })], '2.0.0'), null);
  const noSums = release('3.0.0');
  noSums.assets = noSums.assets.filter((a) => a.name !== 'SHA256SUMS.txt');
  assert.equal(pickUpdate([noSums], '2.0.0'), null);
  const evil = release('3.0.0');
  evil.assets[0].browser_download_url = 'https://evil.example.com/Kaatchat-Setup-3.0.0.exe';
  assert.equal(pickUpdate([evil], '2.0.0'), null);
});

test('update: only this repository’s release files may be downloaded', () => {
  assert.ok(isAllowedDownload(`${DL}/kaatchat-v2.0.0/Kaatchat-Setup-2.0.0.exe`));
  for (const bad of [
    'http://github.com/asifkhan1308/asifkhan1308/releases/download/kaatchat-v2.0.0/x.exe',
    'https://github.com/someone/else/releases/download/kaatchat-v2.0.0/x.exe',
    'https://github.com.evil.com/asifkhan1308/asifkhan1308/releases/download/kaatchat-v2.0.0/x.exe',
    'https://user:pw@github.com/asifkhan1308/asifkhan1308/releases/download/kaatchat-v2.0.0/x.exe',
    'https://github.com/asifkhan1308/asifkhan1308/releases/download/other-v1/x.exe',
    'not a url',
  ])
    assert.equal(isAllowedDownload(bad), false, bad);
});

test('update: reads the checksum from SHA256SUMS.txt as the release workflow writes it', () => {
  // Byte-for-byte shape of the published file: Windows line endings, lower-case hex.
  const text = '09190191efd1ad5c4e865fb98b713feb05e56f4cf490be6bb142e9c6b9f2afa0  Kaatchat-Setup-2.0.0-alpha.2.exe\r\n';
  assert.equal(sumFor(text, 'Kaatchat-Setup-2.0.0-alpha.2.exe'), '09190191efd1ad5c4e865fb98b713feb05e56f4cf490be6bb142e9c6b9f2afa0');
  assert.equal(sumFor(text.toUpperCase().replace('KAATCHAT-SETUP-2.0.0-ALPHA.2.EXE', 'Kaatchat-Setup-2.0.0-alpha.2.exe'), 'Kaatchat-Setup-2.0.0-alpha.2.exe'), '09190191efd1ad5c4e865fb98b713feb05e56f4cf490be6bb142e9c6b9f2afa0');
  assert.equal(sumFor(text, 'Kaatchat-Setup-9.9.9.exe'), null);
  assert.equal(sumFor('garbage', 'x'), null);
});

test('update: the website release manifest is the primary source', () => {
  const { updateFromManifest } = require('../policy.cjs');
  const m = {
    version: '2.0.0-alpha.2',
    windowsUrl: `${DL}/kaatchat-v2.0.0-alpha.2/Kaatchat-Setup-2.0.0-alpha.2.exe`,
    sha256: '09190191EFD1AD5C4E865FB98B713FEB05E56F4CF490BE6BB142E9C6B9F2AFA0',
    size: 116260603,
  };
  const u = updateFromManifest(m, '2.0.0-alpha.1');
  assert.equal(u.version, '2.0.0-alpha.2');
  assert.equal(u.sha256, '09190191efd1ad5c4e865fb98b713feb05e56f4cf490be6bb142e9c6b9f2afa0');
  assert.equal(u.page, 'https://github.com/asifkhan1308/asifkhan1308/releases/tag/kaatchat-v2.0.0-alpha.2');
  assert.equal(updateFromManifest(m, '2.0.0-alpha.2'), null, 'same version');
  assert.equal(updateFromManifest(m, '2.0.0'), null, 'stable users skip prereleases');
  assert.equal(updateFromManifest({ ...m, sha256: 'nope' }, '2.0.0-alpha.1'), null);
  assert.equal(updateFromManifest({ ...m, windowsUrl: 'https://evil.example.com/x.exe' }, '2.0.0-alpha.1'), null);
  // A URL for a different version than the manifest claims is refused.
  assert.equal(updateFromManifest({ ...m, version: '2.0.0-alpha.9' }, '2.0.0-alpha.1'), null);
  assert.equal(updateFromManifest({ version: '2.0.0', windowsUrl: null, sha256: null }, '1.0.0'), null, 'unreleased manifest');
  assert.equal(updateFromManifest(null, '1.0.0'), null);
});
