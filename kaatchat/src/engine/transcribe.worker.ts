/// <reference lib="webworker" />
// Local speech-to-text with Whisper (transformers.js + ONNX Runtime Web).
// Runs off the main thread. Audio arrives as 16 kHz mono samples and never
// leaves the device; only the model files are downloaded, once, and cached
// by the browser.

import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

export type WorkerIn = { type: 'transcribe'; id: string; model: string; audio: Float32Array; language?: string };
export type WorkerOut =
  | { type: 'status'; id: string; phase: 'download' | 'transcribe'; progress: number | null; detail?: string }
  | { type: 'result'; id: string; chunks: { text: string; start: number; end: number }[]; language: string }
  | { type: 'error'; id: string; message: string };

env.allowLocalModels = false;
env.useBrowserCache = true;

let current: { model: string; pipe: Promise<AutomaticSpeechRecognitionPipeline> } | null = null;

const post = (m: WorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type !== 'transcribe') return;
  const { id } = msg;
  try {
    if (!current || current.model !== msg.model) {
      const files = new Map<string, { loaded: number; total: number }>();
      current = {
        model: msg.model,
        pipe: pipeline('automatic-speech-recognition', msg.model, {
          dtype: 'q8',
          device: 'wasm',
          progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
            if (p.status === 'progress' && p.file && p.total) {
              files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
              let l = 0;
              let t = 0;
              for (const f of files.values()) {
                l += f.loaded;
                t += f.total;
              }
              post({ type: 'status', id, phase: 'download', progress: t ? l / t : null, detail: `${(l / 1e6).toFixed(0)} / ${(t / 1e6).toFixed(0)} MB` });
            }
          },
        }) as Promise<AutomaticSpeechRecognitionPipeline>,
      };
    }
    const pipe = await current.pipe;
    post({ type: 'status', id, phase: 'transcribe', progress: null, detail: 'Transcribing on this device…' });
    const out = (await pipe(msg.audio, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      ...(msg.language ? { language: msg.language, task: 'transcribe' } : {}),
    })) as { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] };
    const chunks = (out.chunks ?? []).map((c) => ({
      text: c.text,
      start: c.timestamp[0],
      end: c.timestamp[1] ?? c.timestamp[0] + 0.3,
    }));
    post({ type: 'result', id, chunks, language: msg.language ?? 'auto' });
  } catch (err) {
    current = null;
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
};
