// Preview noise reduction: the same processing the exporter uses, running in
// the audio thread. The page sends what the clip under the playhead wants;
// null switches it off (audio passes straight through).

import createRnnoise from '@jitsi/rnnoise-wasm/dist/rnnoise-sync.js';
import { Denoiser, type NoiseProfile } from './denoise';
import { VOICE_SAMPLE_RATE, VoiceDenoiser, type RnnoiseModule } from './voiceDenoise';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

export type DenoiseMessage = { mode: 'steady'; profile: NoiseProfile; strength: number } | { mode: 'voice'; strength: number } | null;

let rnnoise: RnnoiseModule | null = null;

class DenoiseProcessor extends AudioWorkletProcessor {
  private d: Denoiser | VoiceDenoiser | null = null;
  private key: NoiseProfile | 'voice' | null = null;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<DenoiseMessage>) => {
      const m = e.data;
      const key = !m ? null : m.mode === 'voice' ? 'voice' : m.profile;
      if (this.d && key === this.key && m) return this.d.setStrength(m.strength);
      if (this.d instanceof VoiceDenoiser) this.d.dispose();
      this.d = null;
      this.key = key;
      if (!m) return;
      if (m.mode === 'steady') this.d = new Denoiser(sampleRate, m.profile, m.strength, 2);
      // RNNoise runs at 48 kHz; the preview's audio context is opened at that rate.
      else if (sampleRate === VOICE_SAMPLE_RATE) {
        rnnoise ??= createRnnoise() as RnnoiseModule;
        this.d = new VoiceDenoiser(rnnoise, m.strength, 2);
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
