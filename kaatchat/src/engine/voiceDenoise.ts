// Voice isolation with RNNoise (Xiph's recurrent neural network noise
// suppressor, compiled to WebAssembly). Unlike the spectral Denoiser it needs
// no noise profile and handles noise that changes: traffic, keyboards, crowd
// murmur, wind, music in the background.
//
// RNNoise works on 480-sample frames of 48 kHz audio in 16-bit range. It is
// streaming and pure, so the preview (an AudioWorklet) and export (the mixer)
// run the same code. Output is delayed by a fixed number of samples; the dry
// signal is delayed to match, so partial strengths blend without comb effects.

export const VOICE_SAMPLE_RATE = 48000;
const FRAME = 480;
/** RNNoise's own delay (measured: 960 samples at 48 kHz). */
const RNNOISE_DELAY = 960;

/** The parts of the Emscripten module this uses. */
export interface RnnoiseModule {
  HEAPF32: Float32Array;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  _rnnoise_create(model: number): number;
  _rnnoise_destroy(state: number): void;
  _rnnoise_process_frame(state: number, out: number, input: number): number;
}

/** Wet/dry mix for a strength 0 … 1: the network's output is already strong, so the curve favours it. */
export const voiceMix = (strength: number) => Math.min(1, Math.max(0, strength)) ** 0.5;

export class VoiceDenoiser {
  /** Fixed delay, in samples, between input and output. */
  static readonly latency = FRAME + RNNOISE_DELAY;
  readonly latency = VoiceDenoiser.latency;
  private states: number[];
  private buf: number;
  private fill = 0;
  private inBuf: Float32Array[];
  private dry: Float32Array[];
  private dryAt = 0;
  private out: Float32Array[][];
  private wet: number;

  constructor(
    private m: RnnoiseModule,
    strength: number,
    private channels = 2,
  ) {
    this.wet = voiceMix(strength);
    this.states = Array.from({ length: channels }, () => m._rnnoise_create(0));
    this.buf = m._malloc(FRAME * 4);
    this.inBuf = Array.from({ length: channels }, () => new Float32Array(FRAME));
    // The dry path is delayed by RNNoise's own delay, a ring of that length.
    this.dry = Array.from({ length: channels }, () => new Float32Array(RNNOISE_DELAY));
    // One frame of silence up front: output never runs dry, whatever the input chunk sizes.
    this.out = Array.from({ length: channels }, () => [new Float32Array(FRAME)]);
  }

  setStrength(strength: number) {
    this.wet = voiceMix(strength);
  }

  process(planes: Float32Array[]): Float32Array[] {
    const n = planes[0].length;
    let i = 0;
    while (i < n) {
      const take = Math.min(FRAME - this.fill, n - i);
      for (let ch = 0; ch < this.channels; ch++) this.inBuf[ch].set((planes[ch] ?? planes[0]).subarray(i, i + take), this.fill);
      this.fill += take;
      i += take;
      if (this.fill === FRAME) {
        this.frame();
        this.fill = 0;
      }
    }
    return this.take(n);
  }

  private frame() {
    const heap = this.m.HEAPF32;
    const at = this.buf >> 2;
    const wet = this.wet;
    for (let ch = 0; ch < this.channels; ch++) {
      const x = this.inBuf[ch];
      for (let k = 0; k < FRAME; k++) heap[at + k] = x[k] * 32768;
      this.m._rnnoise_process_frame(this.states[ch], this.buf, this.buf);
      // _process_frame may grow memory; re-read the heap view.
      const h = this.m.HEAPF32;
      const ring = this.dry[ch];
      const o = new Float32Array(FRAME);
      for (let k = 0; k < FRAME; k++) {
        const r = (this.dryAt + k) % RNNOISE_DELAY;
        const d = ring[r];
        ring[r] = x[k];
        o[k] = wet * (h[at + k] / 32768) + (1 - wet) * d;
      }
      this.out[ch].push(o);
    }
    this.dryAt = (this.dryAt + FRAME) % RNNOISE_DELAY;
  }

  private take(n: number): Float32Array[] {
    return this.out.map((q) => {
      const o = new Float32Array(n);
      let at = 0;
      while (at < n && q.length) {
        const head = q[0];
        const k = Math.min(n - at, head.length);
        o.set(head.subarray(0, k), at);
        at += k;
        if (k === head.length) q.shift();
        else q[0] = head.subarray(k);
      }
      return o;
    });
  }

  dispose() {
    for (const s of this.states) this.m._rnnoise_destroy(s);
    this.states = [];
    this.m._free(this.buf);
  }
}

let loading: Promise<RnnoiseModule> | null = null;
/** Loads the WebAssembly module once (about 2 MB; bundled, nothing is downloaded from elsewhere). */
export function loadRnnoise(): Promise<RnnoiseModule> {
  loading ??= import('@jitsi/rnnoise-wasm/dist/rnnoise-sync.js').then(async ({ default: create }) => {
    const m = create() as RnnoiseModule & { ready?: Promise<unknown> };
    await m.ready;
    return m;
  });
  return loading;
}
