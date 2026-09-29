// Runs sandboxed. Exposes a narrow, typed bridge — no Node, no raw IPC.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const version = ipcRenderer.sendSync('kaatchat:version');

contextBridge.exposeInMainWorld('kaatchat', {
  desktop: true,
  version,
  platform: process.platform,
  openExternal: (url) => ipcRenderer.invoke('kaatchat:open-external', String(url)),
  keys: {
    secure: () => ipcRenderer.invoke('kaatchat:keys-secure'),
    has: (p) => ipcRenderer.invoke('kaatchat:keys-has', String(p)),
    set: (p, key) => ipcRenderer.invoke('kaatchat:keys-set', String(p), String(key)),
    clear: (p) => ipcRenderer.invoke('kaatchat:keys-clear', String(p)),
  },
  aiFetch: (id, provider, req) =>
    ipcRenderer.invoke('kaatchat:ai-fetch', String(id), String(provider), {
      url: String(req.url),
      method: req.method === 'POST' ? 'POST' : 'GET',
      headers: Object.fromEntries(Object.entries(req.headers || {}).map(([k, v]) => [String(k), String(v)])),
      body: req.body == null ? undefined : String(req.body),
    }),
  aiCancel: (id) => ipcRenderer.invoke('kaatchat:ai-cancel', String(id)),
});
