// Saved preferences: an earlier Whisper choice moves to its exact-word-timing twin.
import { describe, expect, it } from 'vitest';
import { loadPrefs } from '../../src/app/prefs';
import { WHISPER_MODELS } from '../../src/engine/whisperModels';

describe('preferences', () => {
  it('defaults to a model with exact word timings', () => {
    const p = loadPrefs(null);
    expect(WHISPER_MODELS.find((m) => m.id === p.whisperModel)?.wordTimings).toBe(true);
  });

  it('moves the earlier Base and Tiny choices to their timed versions, keeps others', () => {
    expect(loadPrefs(JSON.stringify({ whisperModel: 'onnx-community/whisper-base' })).whisperModel).toBe('onnx-community/whisper-base_timestamped');
    expect(loadPrefs(JSON.stringify({ whisperModel: 'onnx-community/whisper-tiny', theme: 'dark' }))).toMatchObject({ whisperModel: 'onnx-community/whisper-tiny_timestamped', theme: 'dark' });
    expect(loadPrefs(JSON.stringify({ whisperModel: 'onnx-community/whisper-base.en' })).whisperModel).toBe('onnx-community/whisper-base.en');
  });

  it('every offered model is in the list once, and saved choices always resolve to one', () => {
    expect(new Set(WHISPER_MODELS.map((m) => m.id)).size).toBe(WHISPER_MODELS.length);
    for (const old of ['onnx-community/whisper-base', 'onnx-community/whisper-tiny'])
      expect(WHISPER_MODELS.some((m) => m.id === loadPrefs(JSON.stringify({ whisperModel: old })).whisperModel)).toBe(true);
  });

  it('survives a corrupt store', () => {
    expect(loadPrefs('{not json').whisperModel).toBe('onnx-community/whisper-base_timestamped');
  });
});
