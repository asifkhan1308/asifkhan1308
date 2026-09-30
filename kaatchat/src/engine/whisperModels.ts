// Speech models offered in Settings (no dependencies: tests read this list too).

/**
 * The "_timestamped" exports include the cross-attention outputs Whisper needs to
 * time each word, so word cuts land exactly. The others give sentence timings,
 * spread over the words by length.
 */
export const WHISPER_MODELS = [
  { id: 'onnx-community/whisper-base_timestamped', label: 'Whisper Base (multilingual, ~80 MB, exact word timings)', multilingual: true, wordTimings: true },
  { id: 'onnx-community/whisper-tiny_timestamped', label: 'Whisper Tiny (multilingual, ~40 MB, faster, less accurate, exact word timings)', multilingual: true, wordTimings: true },
  { id: 'onnx-community/whisper-small_timestamped', label: 'Whisper Small (multilingual, ~250 MB, most accurate, exact word timings)', multilingual: true, wordTimings: true },
  { id: 'onnx-community/whisper-base.en', label: 'Whisper Base English (~80 MB, estimated word timings)', multilingual: false, wordTimings: false },
] as const;
