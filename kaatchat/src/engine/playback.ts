// Preview transport. Plays the edit through one <video> element per media
// file and composes each frame onto a canvas with the same renderer the
// exporter uses. Clip gain is applied through Web Audio.

import type { ProjectDoc, ProjectIndex, MediaAsset } from './types';
import { ASPECTS } from './types';
import { locate, sequenceDuration, clipStarts, clipLength } from './timeline';
import { drawCaption, drawClipFrame, CAPTION_FONT } from './render';
import { captionCues, cueAt, type CaptionCue } from './transcript';
import { fromDb } from './dsp';
import { media } from './media';

interface Source {
  el: HTMLVideoElement | null;
  img: HTMLImageElement | null;
  gain: GainNode | null;
}

export class Player {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private doc: ProjectDoc;
  private cues: CaptionCue[] = [];
  private sources = new Map<string, Source>();
  private audio: AudioContext | null = null;
  private raf = 0;
  private lastWall = 0;
  private activeClipId: string | null = null;
  private _time = 0;
  private _playing = false;
  private listeners = new Set<() => void>();

  constructor(doc: ProjectDoc, index: ProjectIndex) {
    this.doc = doc;
    this.cues = captionCues(doc, index);
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

  update(doc: ProjectDoc, index: ProjectIndex) {
    const aspectChanged = doc.aspect !== this.doc.aspect;
    this.doc = doc;
    this.cues = captionCues(doc, index);
    if (aspectChanged) this.resize();
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
    this.draw();
    this.emit();
    this.raf = requestAnimationFrame(this.tick);
  };

  draw() {
    const ctx = this.ctx;
    const c = this.canvas;
    if (!ctx || !c) return;
    const hit = locate(this.doc.clips, this._time);
    if (!hit) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, c.width, c.height);
      return;
    }
    const asset = this.doc.assets[hit.clip.assetId];
    const s = asset ? this.source(asset) : null;
    if (s?.el && s.el.readyState >= 2) drawClipFrame(ctx, s.el, s.el.videoWidth, s.el.videoHeight, hit.clip, c.width, c.height);
    else if (s?.img && s.img.complete && s.img.naturalWidth) drawClipFrame(ctx, s.img, s.img.naturalWidth, s.img.naturalHeight, hit.clip, c.width, c.height);
    else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, c.width, c.height);
      if (asset && !media.get(asset.id)) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = `500 ${Math.round(c.height * 0.035)}px ${CAPTION_FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(`Relink “${asset.name}” to preview`, c.width / 2, c.height / 2);
        ctx.textAlign = 'start';
      }
    }
    if (this.doc.captions.enabled) drawCaption(ctx, cueAt(this.cues, this._time), this._time, this.doc.captions.style, c.width, c.height, CAPTION_FONT);
  }

  dispose() {
    this.pause();
    for (const s of this.sources.values()) this.disposeSource(s);
    this.sources.clear();
    void this.audio?.close();
  }
}
