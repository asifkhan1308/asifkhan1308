'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveInsideRoot, checkProviderUrl, sanitizeHeaders } = require('../policy.cjs');

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
