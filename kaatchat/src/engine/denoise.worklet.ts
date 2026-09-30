// Preview noise reduction: the same Denoiser the exporter uses, running in the
// audio thread. The page sends { profile, strength } for the clip under the
// playhead; null switches it off (audio passes straight through).

import { Denoiser, type NoiseProfile } from './denoise';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

export type DenoiseMessage = { profile: NoiseProfile; strength: number } | null;

class DenoiseProcessor extends AudioWorkletProcessor {
  private d: Denoiser | null = null;
  private profile: NoiseProfile | null = null;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<DenoiseMessage>) => {
      const m = e.data;
      if (!m) {
        this.d = null;
        this.profile = null;
      } else if (this.d && this.profile === m.profile) this.d.setStrength(m.strength);
      else {
        this.profile = m.profile;
        this.d = new Denoiser(sampleRate, m.profile, m.strength, 2);
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) {
      for (const ch of output) ch.fill(0);
      return true;
    }
    if (!this.d) {
      for (let c = 0; c < output.length; c++) output[c].set(input[Math.min(c, input.length - 1)]);
      return true;
    }
    const y = this.d.process([input[0], input[1] ?? input[0]]);
    for (let c = 0; c < output.length; c++) output[c].set(y[Math.min(c, 1)]);
    return true;
  }
}

registerProcessor('kaatchat-denoise', DenoiseProcessor);
