// Brand Kit: one set of choices applied to an edit in one step.

import type { BrandKit, Clip, EditView, Overlay } from './types';
import { sequenceDuration } from './timeline';
import { imageOverlay, textOverlay } from './overlays';

export function defaultBrand(): BrandKit {
  return {
    name: 'My brand',
    logoAssetId: null,
    colors: { ink: '#111111', paper: '#FFFFFF', accent: '#FFFFFF' },
    font: 'Inter',
    captionStyle: 'bold',
    lowerThird: { enabled: false, name: '', title: '' },
    watermark: { enabled: false, position: 'br', opacity: 0.8 },
    introAssetId: null,
    outroAssetId: null,
  };
}

const CORNER: Record<BrandKit['watermark']['position'], { x: number; y: number }> = {
  tl: { x: 0.09, y: 0.13 },
  tr: { x: 0.91, y: 0.13 },
  bl: { x: 0.09, y: 0.87 },
  br: { x: 0.91, y: 0.87 },
};

/**
 * Apply a brand to an edit. Re-applying replaces what a previous apply
 * added (watermark, lower third, intro/outro) rather than stacking it.
 */
export function applyBrand(view: EditView, brand: BrandKit, newId: () => string): { view: EditView; notes: string[] } {
  const notes: string[] = [];
  // Intro / outro clips.
  let clips: Clip[] = view.clips.filter((c) => !c.brandRole);
  const clipFor = (assetId: string, role: 'intro' | 'outro'): Clip | null => {
    const a = view.assets[assetId];
    if (!a || a.kind === 'audio') return null;
    return { id: newId(), assetId, in: 0, out: a.duration, gainDb: 0, focusX: 0.5, focusY: 0.5, fit: 'fit', brandRole: role };
  };
  const intro = brand.introAssetId ? clipFor(brand.introAssetId, 'intro') : null;
  const outro = brand.outroAssetId ? clipFor(brand.outroAssetId, 'outro') : null;
  if (intro) {
    clips = [intro, ...clips];
    notes.push('Intro added');
  }
  if (outro) {
    clips = [...clips, outro];
    notes.push('Outro added');
  }
  const shift = intro ? intro.out - intro.in : 0;
  const prevIntro = view.clips.find((c) => c.brandRole === 'intro');
  const prevShift = prevIntro ? prevIntro.out - prevIntro.in : 0;
  const delta = shift - prevShift;
  const total = sequenceDuration(clips);

  // Keep user layers in step with the content if the intro changed length; restyle their font.
  let overlays: Overlay[] = view.overlays
    .filter((o) => o.role !== 'watermark' && o.role !== 'lower-third')
    .map((o) => ({ ...o, start: Math.max(0, o.start + delta), ...(o.kind === 'text' ? { font: brand.font } : {}) }));

  if (brand.watermark.enabled && brand.logoAssetId && view.assets[brand.logoAssetId]) {
    const p = CORNER[brand.watermark.position];
    overlays.push({
      ...imageOverlay(newId(), brand.logoAssetId, 'Watermark', 0, total),
      x: p.x,
      y: p.y,
      width: 0.08,
      opacity: brand.watermark.opacity,
      animIn: 'none',
      animOut: 'none',
      role: 'watermark',
    });
    notes.push('Watermark added');
  }
  if (brand.lowerThird.enabled && (brand.lowerThird.name || brand.lowerThird.title)) {
    const text = [brand.lowerThird.name, brand.lowerThird.title].filter(Boolean).join('\n');
    overlays.push(
      textOverlay(newId(), text, shift + 0.6, 4, {
        position: 'lower-third',
        anim: 'slide-left',
        font: brand.font,
        color: brand.colors.ink,
        background: brand.colors.paper,
        size: 0.04,
        weight: 700,
        role: 'lower-third',
      }),
    );
    notes.push('Lower third added');
  }
  overlays = overlays.sort((a, b) => a.start - b.start);

  const captions = { ...view.captions, style: brand.captionStyle, accent: brand.colors.accent };
  notes.push(`Captions: ${brand.captionStyle}`);
  return { view: { ...view, clips, overlays, captions, brand }, notes };
}
