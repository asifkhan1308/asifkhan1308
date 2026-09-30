declare module '@jitsi/rnnoise-wasm/dist/rnnoise-sync.js' {
  /** Emscripten factory; the WebAssembly is embedded and compiled synchronously. */
  const create: () => unknown;
  export default create;
}
