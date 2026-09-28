// Timeline audio mixer for export: main track + music track, with clip gain,
// fades, ducking under speech and track mute/solo. Streams each source
// once, in order, and produces sample-exact 48 kHz stereo.

import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';
import type { EditView, ProjectIndex } from './types';
import { clipLength, clipStarts } from './timeline';
import { mapChannels, planesOf, StreamResampler } from './audio';
import { duckDbAt, fadeGain, speechRanges } from './beats';
import { fromDb } from './dsp';
import { media } from './media';
import { throwIfAborted } from './jobs';

export const SAMPLE_RATE = 48000;

/** Streams one source range [srcIn, srcOut) as 48 kHz stereo, n samples at a time. */
class SourceReader {
  private queue: Float32Array[][] = [];
  private queued = 0;
  private it: AsyncGenerator<{ buffer: AudioBuffer; timestamp: number }> | null = null;
  private input: Input | null = null;
  private rs: StreamResampler | null = null;
  private sr = 48000;
  private cursor: number;
  private done = false;

  constructor(
    private blob: Blob,
    private srcIn: number,
    private srcOut: number,
  ) {
    this.cursor = srcIn;
  }

  private async open() {
    this.input = new Input({ source: new BlobSource(this.blob), formats: ALL_FORMATS });
    const track = await this.input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) {
      this.done = true;
      return;
    }
    this.sr = await track.getSampleRate();
    this.rs = new StreamResampler(this.sr, SAMPLE_RATE, 2);
    this.it = new AudioBufferSink(track).buffers(this.srcIn, this.srcOut) as AsyncGenerator<{ buffer: AudioBuffer; timestamp: number }>;
  }

  private push(planes: Float32Array[]) {
    if (planes[0].length === 0) return;
    this.queue.push(planes);
    this.queued += planes[0].length;
  }

  private async pull(): Promise<boolean> {
    if (this.done) return false;
    if (!this.input) await this.open();
    if (this.done || !this.it) return false;
    const r = await this.it.next();
    if (r.done) {
      this.done = true;
      return false;
    }
    const { buffer, timestamp } = r.value;
    let planes = mapChannels(planesOf(buffer), 2).map((p) => p.slice());
    let ts = timestamp;
    const skip = Math.round((this.cursor - ts) * this.sr);
    if (skip > 0) {
      if (skip >= planes[0].length) return true;
      planes = planes.map((p) => p.subarray(skip));
      ts = this.cursor;
    } else if (skip < -8) {
      this.push(this.rs!.push([new Float32Array(-skip), new Float32Array(-skip)]));
    }
    const endAt = Math.round((this.srcOut - ts) * this.sr);
    if (endAt <= 0) {
      this.done = true;
      return false;
    }
    if (endAt < planes[0].length) planes = planes.map((p) => p.subarray(0, endAt));
    this.push(this.rs!.push(planes));
    this.cursor = ts + planes[0].length / this.sr;
    return true;
  }

  /** Exactly `n` stereo samples; silence once the source is exhausted. */
  async read(n: number): Promise<Float32Array[]> {
    while (this.queued < n && (await this.pull()));
    const out = [new Float32Array(n), new Float32Array(n)];
    let o = 0;
    while (o < n && this.queue.length) {
      const head = this.queue[0];
      const take = Math.min(n - o, head[0].length);
      out[0].set(head[0].subarray(0, take), o);
      out[1].set(head[1].subarray(0, take), o);
      o += take;
      this.queued -= take;
      if (take === head[0].length) this.queue.shift();
      else this.queue[0] = head.map((p) => p.subarray(take));
    }
    return out;
  }

  dispose() {
    void this.it?.return?.(undefined);
    this.input?.dispose();
  }
}

interface Segment {
  start: number; // timeline seconds
  end: number;
  s0: number; // timeline samples
  s1: number;
  gainDb: number;
  fadeIn: number;
  fadeOut: number;
  duck: boolean;
  blob: Blob;
  srcIn: number;
  srcOut: number;
  reader: SourceReader | null;
  consumed: number; // samples read from reader
}

export class TimelineMixer {
  private segs: Segment[] = [];
  private speech: { start: number; end: number }[];
  private duckDb: number;
  rendered = 0; // samples produced so far

  constructor(view: EditView, index: ProjectIndex) {
    const mix = view.mix;
    const anySolo = mix.mainSolo || mix.musicSolo;
    const mainOn = !mix.mainMuted && (!anySolo || mix.mainSolo);
    const musicOn = !mix.musicMuted && (!anySolo || mix.musicSolo);
    const starts = clipStarts(view.clips);
    const toS = (t: number) => Math.round(t * SAMPLE_RATE);
    if (mainOn)
      view.clips.forEach((c, i) => {
        const a = view.assets[c.assetId];
        const blob = media.get(c.assetId);
        if (!a || !blob || a.kind !== 'video' || !a.hasAudio || c.muted) return;
        const start = starts[i];
        const end = start + clipLength(c);
        this.segs.push({ start, end, s0: toS(start), s1: toS(end), gainDb: c.gainDb, fadeIn: c.fadeIn ?? 0, fadeOut: c.fadeOut ?? 0, duck: false, blob, srcIn: c.in, srcOut: c.out, reader: null, consumed: 0 });
      });
    if (musicOn)
      for (const m of view.audio) {
        const blob = media.get(m.assetId);
        if (!blob) continue;
        const end = m.start + (m.out - m.in);
        this.segs.push({ start: m.start, end, s0: toS(m.start), s1: toS(end), gainDb: m.gainDb, fadeIn: m.fadeIn, fadeOut: m.fadeOut, duck: m.duck, blob, srcIn: m.in, srcOut: m.out, reader: null, consumed: 0 });
      }
    this.speech = view.audio.some((m) => m.duck) ? speechRanges(view.clips, (id) => index[id]?.audio) : [];
    this.duckDb = mix.duckDb;
  }

  get hasSources() {
    return this.segs.length > 0;
  }

  /** Mix timeline samples [from, to). */
  async render(from: number, to: number, signal: AbortSignal): Promise<Float32Array[]> {
    const n = to - from;
    const out = [new Float32Array(n), new Float32Array(n)];
    for (const seg of this.segs) {
      const a = Math.max(from, seg.s0);
      const b = Math.min(to, seg.s1);
      if (b <= a) {
        if (seg.reader && from >= seg.s1) {
          seg.reader.dispose();
          seg.reader = null;
        }
        continue;
      }
      throwIfAborted(signal);
      seg.reader ??= new SourceReader(seg.blob, seg.srcIn, seg.srcOut);
      const local = a - seg.s0;
      if (local > seg.consumed) {
        await seg.reader.read(local - seg.consumed);
        seg.consumed = local;
      }
      const planes = await seg.reader.read(b - a);
      seg.consumed += b - a;
      const base = fromDb(seg.gainDb);
      const len = seg.end - seg.start;
      // Gain changes are evaluated every 10 ms — smooth enough, and cheap.
      const block = 480;
      for (let k = 0; k < b - a; k += block) {
        const t = (a + k) / SAMPLE_RATE;
        let g = base * fadeGain(t - seg.start, len, seg.fadeIn, seg.fadeOut);
        if (seg.duck && this.speech.length) g *= fromDb(duckDbAt(t, this.speech, this.duckDb));
        const kEnd = Math.min(b - a, k + block);
        for (let ch = 0; ch < 2; ch++) {
          const src = planes[ch];
          const dst = out[ch];
          for (let j = k; j < kEnd; j++) dst[a - from + j] += src[j] * g;
        }
      }
    }
    // Soft limiter on the sum.
    for (const p of out)
      for (let i = 0; i < n; i++) {
        const v = p[i];
        const av = Math.abs(v);
        if (av > 0.9) p[i] = Math.sign(v) * (0.9 + 0.1 * Math.tanh((av - 0.9) / 0.1));
      }
    this.rendered = to;
    return out;
  }

  dispose() {
    for (const s of this.segs) s.reader?.dispose();
  }
}
