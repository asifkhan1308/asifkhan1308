// Preview transport. Plays the edit through one <video> element per media
// file and composes each frame onto a canvas with the same renderer the
// exporter uses. Clip gain is applied through Web Audio.

import type { AudioClip, EditView, ProjectIndex, MediaAsset } from './types';
import { ASPECTS } from './types';
import { locate, sequenceDuration, clipStarts, clipLength } from './timeline';
import { drawCaption, drawClipFrame, CAPTION_FONT } from './render';
import { drawOverlay, drawTransition, overlaysAt, transitionWindows } from './motion';
import { captionCues, cueAt, type CaptionCue } from './transcript';
import { fromDb } from './dsp';
import { duckDbAt, fadeGain, speechRanges } from './beats';
import { media } from './media';

interface Source {
  el: HTMLVideoElement | null;
  img: HTMLImageElement | null;
  gain: GainNode | null;
}

export class Player {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private doc: EditView;
  private cues: CaptionCue[] = [];
  private sources = new Map<string, Source>();
  private music = new Map<string, { el: HTMLAudioElement; gain: GainNode | null; url: string }>();
  private speech: { start: number; end: number }[] = [];
  private audio: AudioContext | null = null;
  private raf = 0;
  private lastWall = 0;
  private activeClipId: string | null = null;
  private _time = 0;
  private _playing = false;
  private listeners = new Set<() => void>();

  constructor(doc: EditView, index: ProjectIndex) {
    this.doc = doc;
    this.cues = captionCues(doc, index);
    this.speech = this.computeSpeech(index);
  }

  private computeSpeech(index: ProjectIndex) {
    return this.doc.audio.some((a) => a.duck) ? speechRanges(this.doc.clips, (id) => index[id]?.audio) : [];
  }

  get time() {
    return this._time;
  }
  get playing() {
    return this._playing;
  }
  get duration() {
    return sequenceDuration(this.doc.clips);
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit() {
    for (const l of this.listeners) l();
  }

  attach(canvas: HTMLCanvasElement | null) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext('2d') ?? null;
    this.resize();
    this.draw();
  }

  /** Preview resolution: the project shape, capped for smooth playback. */
  resize() {
    if (!this.canvas) return;
    const a = ASPECTS[this.doc.aspect];
    const scale = Math.min(1, 960 / Math.max(a.width, a.height));
    const w = Math.round(a.width * scale);
    const h = Math.round(a.height * scale);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  update(doc: EditView, index: ProjectIndex) {
    const aspectChanged = doc.aspect !== this.doc.aspect;
    this.doc = doc;
    this.cues = captionCues(doc, index);
    this.speech = this.computeSpeech(index);
    for (const [id, m] of this.music)
      if (!doc.audio.some((a) => a.id === id)) {
        m.el.pause();
        this.music.delete(id);
      }
    if (aspectChanged) {
      this.resize();
      this.snaps.clear();
    }
    this.prefetchTransitionFrames();
    const d = this.duration;
    if (this._time > d) this._time = d;
    this.activeClipId = null;
    if (this._playing) this.syncActive(true);
    else this.seek(this._time);
  }

  private source(asset: MediaAsset): Source {
    let s = this.sources.get(asset.id);
    const url = media.url(asset.id);
    if (s && url && (s.el?.src === url || s.img?.src === url)) return s;
    if (s) this.disposeSource(s);
    s = { el: null, img: null, gain: null };
    if (url) {
      if (asset.kind === 'image') {
        s.img = new Image();
        s.img.src = url;
        s.img.onload = () => this.draw();
      } else {
        const el = document.createElement('video');
        el.src = url;
        el.preload = 'auto';
        el.playsInline = true;
        el.crossOrigin = 'anonymous';
        el.addEventListener('seeked', () => {
          if (!this._playing) this.draw();
        });
        el.addEventListener('loadeddata', () => this.draw());
        s.el = el;
        if (this.audio) this.connect(s);
      }
    }
    this.sources.set(asset.id, s);
    return s;
  }

  private connect(s: Source) {
    if (!s.el || s.gain || !this.audio) return;
    const node = this.audio.createMediaElementSource(s.el);
    s.gain = this.audio.createGain();
    node.connect(s.gain).connect(this.audio.destination);
  }

  private disposeSource(s: Source) {
    if (s.el) {
      s.el.pause();
      s.el.removeAttribute('src');
      s.el.load();
    }
  }

  play() {
    if (this.doc.clips.length === 0) return;
    if (this._time >= this.duration - 0.02) this._time = 0;
    if (!this.audio) {
      try {
        this.audio = new AudioContext();
        for (const s of this.sources.values()) this.connect(s);
        for (const m of this.music.values()) this.connectMusic(m);
      } catch {
        this.audio = null; // Preview still plays, without per-clip gain.
      }
    }
    void this.audio?.resume();
    this._playing = true;
    this.lastWall = performance.now();
    this.activeClipId = null;
    this.syncActive(true);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
    this.emit();
  }

  pause() {
    this._playing = false;
    cancelAnimationFrame(this.raf);
    for (const s of this.sources.values()) s.el?.pause();
    for (const m of this.music.values()) m.el.pause();
    this.emit();
    this.draw();
  }

  toggle() {
    if (this._playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    this._time = Math.max(0, Math.min(t, this.duration));
    const hit = locate(this.doc.clips, this._time);
    if (hit) {
      const asset = this.doc.assets[hit.clip.assetId];
      const s = asset && this.source(asset);
      if (s?.el) {
        if (this._playing) {
          this.activeClipId = null;
          this.syncActive(true);
        } else if (Math.abs(s.el.currentTime - hit.sourceTime) > 0.001) s.el.currentTime = hit.sourceTime;
      }
    }
    this.draw();
    this.emit();
  }

  /** Make sure the element for the clip under the playhead is playing from the right place. */
  private syncActive(force: boolean) {
    const hit = locate(this.doc.clips, this._time);
    if (!hit) return;
    const asset = this.doc.assets[hit.clip.assetId];
    if (!asset) return;
    const s = this.source(asset);
    if (this.activeClipId !== hit.clip.id || force) {
      for (const [id, o] of this.sources) if (id !== asset.id) o.el?.pause();
      if (s.el) {
        s.el.currentTime = hit.sourceTime;
        if (s.gain) s.gain.gain.value = fromDb(hit.clip.gainDb);
        else s.el.volume = Math.min(1, fromDb(hit.clip.gainDb));
        void s.el.play().catch(() => undefined);
      }
      this.activeClipId = hit.clip.id;
    }
  }

  private audible(track: 'main' | 'music') {
    const m = this.doc.mix;
    const anySolo = m.mainSolo || m.musicSolo;
    return track === 'main' ? !m.mainMuted && (!anySolo || m.mainSolo) : !m.musicMuted && (!anySolo || m.musicSolo);
  }

  private connectMusic(m: { el: HTMLAudioElement; gain: GainNode | null }) {
    if (m.gain || !this.audio) return;
    const node = this.audio.createMediaElementSource(m.el);
    m.gain = this.audio.createGain();
    node.connect(m.gain).connect(this.audio.destination);
  }

  private musicEl(a: AudioClip) {
    const url = media.url(a.assetId);
    if (!url) return null;
    let m = this.music.get(a.id);
    if (m && m.url === url) return m;
    const el = document.createElement('audio');
    el.src = url;
    el.preload = 'auto';
    m = { el, gain: null, url };
    this.music.set(a.id, m);
    this.connectMusic(m);
    return m;
  }

  /** Clip gain, fades, ducking and mute/solo — applied every frame while playing. */
  private applyMix() {
    const t = this._time;
    const hit = locate(this.doc.clips, t);
    if (hit) {
      const asset = this.doc.assets[hit.clip.assetId];
      const s = asset ? this.sources.get(asset.id) : undefined;
      if (s?.el) {
        const c = hit.clip;
        const g = this.audible('main') && !c.muted ? fromDb(c.gainDb) * fadeGain(hit.offset, clipLength(c), c.fadeIn ?? 0, c.fadeOut ?? 0) : 0;
        if (s.gain) s.gain.gain.value = g;
        else s.el.volume = Math.min(1, g);
      }
    }
    for (const a of this.doc.audio) {
      const m = this.musicEl(a);
      if (!m) continue;
      const len = a.out - a.in;
      const active = this._playing && t >= a.start && t < a.start + len;
      if (!active) {
        if (!m.el.paused) m.el.pause();
        continue;
      }
      const want = a.in + (t - a.start);
      if (Math.abs(m.el.currentTime - want) > 0.2) m.el.currentTime = want;
      if (m.el.paused) void m.el.play().catch(() => undefined);
      let g = this.audible('music') ? fromDb(a.gainDb) * fadeGain(t - a.start, len, a.fadeIn, a.fadeOut) : 0;
      if (a.duck && this.speech.length) g *= fromDb(duckDbAt(t, this.speech, this.doc.mix.duckDb));
      if (m.gain) m.gain.gain.value = g;
      else m.el.volume = Math.min(1, g);
    }
  }

  private tick = () => {
    if (!this._playing) return;
    const now = performance.now();
    const wallDt = (now - this.lastWall) / 1000;
    this.lastWall = now;
    const hit = locate(this.doc.clips, this._time);
    if (!hit) return this.pause();
    const starts = clipStarts(this.doc.clips);
    const clipStart = starts[hit.index];
    const clipEnd = clipStart + clipLength(hit.clip);
    const asset = this.doc.assets[hit.clip.assetId];
    const s = asset ? this.source(asset) : null;
    if (s?.el && !s.el.paused && s.el.readyState >= 2 && this.activeClipId === hit.clip.id) {
      this._time = clipStart + (s.el.currentTime - hit.clip.in);
    } else {
      this._time += wallDt; // images, or media still buffering
    }
    if (this._time >= clipEnd - 0.01) {
      if (hit.index >= this.doc.clips.length - 1) {
        this._time = this.duration;
        this.draw();
        return this.pause();
      }
      this._time = clipEnd;
      this.syncActive(true);
    } else if (this.activeClipId !== hit.clip.id) this.syncActive(false);
    this.applyMix();
    this.draw();
    this.emit();
    this.raf = requestAnimationFrame(this.tick);
  };

  /** Composed frames of clips we have shown, for held-frame transitions in preview. */
  private snaps = new Map<string, OffscreenCanvas>();
  private images = new Map<string, HTMLImageElement>();
  private scratch: [OffscreenCanvas, OffscreenCanvas] | null = null;

  private overlayImage(assetId: string): HTMLImageElement | undefined {
    let img = this.images.get(assetId);
    const url = media.url(assetId);
    if (!url) return undefined;
    if (!img || img.src !== url) {
      img = new Image();
      img.src = url;
      img.onload = () => this.draw();
      this.images.set(assetId, img);
    }
    return img.complete && img.naturalWidth ? img : undefined;
  }

  /** Draw one clip into `ctx`, live if it is the element's current clip, else from its snapshot. */
  private drawClip(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, index: number, W: number, H: number, live: boolean) {
    const clip = this.doc.clips[index];
    const asset = this.doc.assets[clip.assetId];
    const s = asset ? this.source(asset) : null;
    const snap = this.snaps.get(clip.id);
    if (live && s?.el && s.el.readyState >= 2) drawClipFrame(ctx, s.el, s.el.videoWidth, s.el.videoHeight, clip, W, H);
    else if (s?.img && s.img.complete && s.img.naturalWidth) drawClipFrame(ctx, s.img, s.img.naturalWidth, s.img.naturalHeight, clip, W, H);
    else if (snap) ctx.drawImage(snap, 0, 0, W, H);
    else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      return false;
    }
    return true;
  }

  private snapshot(clipId: string, from: CanvasImageSource, W: number, H: number) {
    let c = this.snaps.get(clipId);
    if (!c || c.width !== W || c.height !== H) {
      c = new OffscreenCanvas(W, H);
      this.snaps.set(clipId, c);
    }
    c.getContext('2d')!.drawImage(from, 0, 0, W, H);
  }

  draw() {
    const ctx = this.ctx;
    const c = this.canvas;
    if (!ctx || !c) return;
    const W = c.width;
    const H = c.height;
    const t = this._time;
    const hit = locate(this.doc.clips, t);
    if (!hit) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      return;
    }
    const starts = clipStarts(this.doc.clips);
    const w = transitionWindows(this.doc.clips, starts).find((x) => t >= x.start && t < x.end);
    if (w) {
      if (!this.scratch || this.scratch[0].width !== W || this.scratch[0].height !== H) this.scratch = [new OffscreenCanvas(W, H), new OffscreenCanvas(W, H)];
      const [a, b] = this.scratch;
      const before = t < w.boundary;
      this.drawClip(a.getContext('2d')!, w.fromIndex, W, H, before);
      this.drawClip(b.getContext('2d')!, w.fromIndex + 1, W, H, !before);
      if (before) this.snapshot(this.doc.clips[w.fromIndex].id, a, W, H);
      else this.snapshot(this.doc.clips[w.fromIndex + 1].id, b, W, H);
      drawTransition(ctx, w.kind, a, b, (t - w.start) / (w.end - w.start), W, H);
    } else {
      const ok = this.drawClip(ctx, hit.index, W, H, true);
      if (ok) this.snapshot(hit.clip.id, c, W, H);
      const asset = this.doc.assets[hit.clip.assetId];
      if (!ok && asset && !media.get(asset.id)) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = `500 ${Math.round(H * 0.035)}px ${CAPTION_FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(`Relink “${asset.name}” to preview`, W / 2, H / 2);
        ctx.textAlign = 'start';
      }
    }
    for (const o of overlaysAt(this.doc.overlays, t)) drawOverlay(ctx, o, t - o.start, W, H, o.assetId ? this.overlayImage(o.assetId) : undefined);
    if (this.doc.captions.enabled) drawCaption(ctx, cueAt(this.cues, t), t, this.doc.captions.style, W, H, CAPTION_FONT, this.doc.captions.accent);
  }

  /** Warm the first frame of the clip after each transition so the blend has something to show. */
  prefetchTransitionFrames() {
    const starts = clipStarts(this.doc.clips);
    for (const w of transitionWindows(this.doc.clips, starts)) {
      const next = this.doc.clips[w.fromIndex + 1];
      if (this.snaps.has(next.id)) continue;
      const asset = this.doc.assets[next.assetId];
      const url = asset && media.url(asset.id);
      if (!url || asset.kind !== 'video') continue;
      const el = document.createElement('video');
      el.muted = true;
      el.preload = 'auto';
      el.src = url;
      el.addEventListener(
        'loadeddata',
        () => {
          el.currentTime = next.in;
        },
        { once: true },
      );
      el.addEventListener(
        'seeked',
        () => {
          const W = this.canvas?.width ?? 960;
          const H = this.canvas?.height ?? 540;
          const off = new OffscreenCanvas(W, H);
          drawClipFrame(off.getContext('2d')!, el, el.videoWidth, el.videoHeight, next, W, H);
          this.snaps.set(next.id, off);
          el.removeAttribute('src');
          el.load();
        },
        { once: true },
      );
    }
  }

  dispose() {
    this.pause();
    for (const m of this.music.values()) {
      m.el.removeAttribute('src');
      m.el.load();
    }
    this.music.clear();
    for (const s of this.sources.values()) this.disposeSource(s);
    this.sources.clear();
    void this.audio?.close();
  }
}
