import type { Template } from '../types';

export const createTemplate = (
  id: string,
  name: string,
  category: any,
  duration: number,
  animationFn: (ctx: CanvasRenderingContext2D, media: any, _params: any, progress: number) => void,
): Template => ({
  id,
  name,
  category,
  thumbnail: '',
  duration,
  description: `${name} animation template`,
  supportedMediaTypes: ['image', 'video'],
  parameters: [{ id: 'duration', label: 'Duration', type: 'slider', min: 1, max: 15, step: 0.1, default: duration, unit: 's' }],
  animationFunction: animationFn,
  previewFunction: (canvas, media, _params, progress) => {
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    animationFn(ctx, media, _params, progress);
  },
});

// Template implementations
export const perspectiveSlide = createTemplate('perspective-slide', 'Perspective Slide', 'perspective', 5, (ctx, media, _params, progress) => {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.translate(w * (1 - progress), h / 2);
  ctx.rotate(progress * 0.3);
  ctx.drawImage(media, -media.width / 2, -media.height / 2, media.width, media.height);
  ctx.restore();
});

export const productTurn = createTemplate('product-turn', 'Product Turn', 'product', 5, (ctx, media, _params, progress) => {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(progress * Math.PI * 2);
  ctx.drawImage(media, -media.width / 2, -media.height / 2, media.width, media.height);
  ctx.restore();
});

export const cinemaricPush = createTemplate('cinematic-push', 'Cinematic Push', 'product', 5, (ctx, media, _params, progress) => {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.save();
  ctx.globalAlpha = progress;
  ctx.translate(w / 2, h / 2);
  const scale = 1 + progress * 0.3;
  ctx.scale(scale, scale);
  ctx.drawImage(media, -media.width / 2, -media.height / 2, media.width, media.height);
  ctx.restore();
});

export const depthZoom = createTemplate('depth-zoom', 'Depth Zoom', '3d', 5, (ctx, media, _params, progress) => {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  const zoom = 0.5 + progress * 1.5;
  ctx.scale(zoom, zoom);
  ctx.globalAlpha = 1 - progress * 0.2;
  ctx.drawImage(media, -media.width / 2, -media.height / 2, media.width, media.height);
  ctx.restore();
});

export const minimalFade = createTemplate('minimal-fade', 'Minimal Fade', 'minimal', 3, (ctx, media, _params, progress) => {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.globalAlpha = Math.sin(progress * Math.PI);
  ctx.drawImage(media, w / 2 - media.width / 2, h / 2 - media.height / 2, media.width, media.height);
});

export const splitScreen = createTemplate('split-screen', 'Split Screen', 'social', 5, (ctx, media, _params, progress) => {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w * progress, h);
  ctx.clip();
  ctx.drawImage(media, w / 2 - media.width / 2, h / 2 - media.height / 2, media.width, media.height);
  ctx.restore();
});

export const elasticEntrance = createTemplate('elastic-entrance', 'Elastic Entrance', 'experimental', 4, (ctx, media, _params, progress) => {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const elastic = Math.sin(progress * Math.PI * 3) * (1 - progress) * 0.1;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(progress + elastic, progress + elastic);
  ctx.drawImage(media, -media.width / 2, -media.height / 2, media.width, media.height);
  ctx.restore();
});

export const horizontalSweep = createTemplate('horizontal-sweep', 'Horizontal Sweep', 'editorial', 5, (ctx, media, _params, progress) => {
  const w = ctx.canvas.width;
  ctx.save();
  ctx.beginPath();
  ctx.rect(w * progress, 0, w, ctx.canvas.height);
  ctx.clip();
  ctx.drawImage(media, w / 2 - media.width / 2, ctx.canvas.height / 2 - media.height / 2, media.width, media.height);
  ctx.restore();
});

export const verticalReveal = createTemplate('vertical-reveal', 'Vertical Reveal', 'editorial', 4, (ctx, media, _params, progress) => {
  const h = ctx.canvas.height;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, h * (1 - progress), ctx.canvas.width, h * progress);
  ctx.clip();
  ctx.drawImage(media, ctx.canvas.width / 2 - media.width / 2, ctx.canvas.height / 2 - media.height / 2, media.width, media.height);
  ctx.restore();
});

export const parallaxDrift = createTemplate('parallax-drift', 'Parallax Drift', 'perspective', 6, (ctx, media, _params, progress) => {
  const w = ctx.canvas.width;
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.drawImage(media, (progress - 0.5) * w * 0.2, ctx.canvas.height / 2 - media.height / 2, media.width, media.height);
  ctx.restore();
});

export const perspective3DTilt = createTemplate('perspective-3d-tilt', '3D Tilt', '3d', 5, (ctx, media, _params, progress) => {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(progress * Math.PI * 2 * 0.3);
  const s = 1 - progress * 0.1;
  ctx.scale(s, s);
  ctx.drawImage(media, -media.width / 2, -media.height / 2, media.width, media.height);
  ctx.restore();
});

export const imageStack = createTemplate('image-stack', 'Image Stack', 'portfolio', 5, (ctx, media, _params, progress) => {
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.globalAlpha = (1 - progress) * (1 - i * 0.3);
    ctx.translate(i * 10, i * 10);
    ctx.drawImage(media, ctx.canvas.width / 2 - media.width / 2, ctx.canvas.height / 2 - media.height / 2, media.width, media.height);
    ctx.restore();
  }
});

export const magazineFlip = createTemplate('magazine-flip', 'Magazine Flip', 'editorial', 5, (ctx, media, _params, progress) => {
  const w = ctx.canvas.width;
  ctx.save();
  ctx.beginPath();
  ctx.rect(w * progress * 0.5, 0, w * 0.5, ctx.canvas.height);
  ctx.clip();
  ctx.transform(1, progress * 0.2, 0, 1, 0, 0);
  ctx.drawImage(media, w / 2 - media.width / 2, ctx.canvas.height / 2 - media.height / 2, media.width, media.height);
  ctx.restore();
});

export const windowReveal = createTemplate('window-reveal', 'Window Reveal', 'experimental', 4, (ctx, media, _params, progress) => {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const size = Math.min(w, h) * progress;
  ctx.save();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(media, w / 2 - media.width / 2, h / 2 - media.height / 2, media.width, media.height);
  ctx.restore();
});

export const glasPanel = createTemplate('glass-panel', 'Glass Panel', 'minimal', 5, (ctx, media, _params, progress) => {
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.globalAlpha = progress * 0.8 + 0.2;
  ctx.drawImage(media, ctx.canvas.width / 2 - media.width / 2, ctx.canvas.height / 2 - media.height / 2, media.width, media.height);
  ctx.restore();
});

export const cardCarousel = createTemplate('card-carousel', 'Card Carousel', 'social', 6, (ctx, media, _params, progress) => {
  ctx.save();
  ctx.translate(progress * ctx.canvas.width * 0.5, 0);
  ctx.drawImage(media, ctx.canvas.width / 2 - media.width / 2, ctx.canvas.height / 2 - media.height / 2, media.width, media.height);
  ctx.restore();
});

export const dynamicCrop = createTemplate('dynamic-crop', 'Dynamic Crop', 'experimental', 4, (ctx, media, _params, progress) => {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const crop = progress * 50;
  ctx.save();
  ctx.beginPath();
  ctx.rect(crop, crop, w - crop * 2, h - crop * 2);
  ctx.clip();
  ctx.drawImage(media, w / 2 - media.width / 2, h / 2 - media.height / 2, media.width, media.height);
  ctx.restore();
});

export const infinitePerspectiveLoop = createTemplate('infinite-perspective-loop', 'Infinite Perspective Loop', 'experimental', 8, (ctx, media, _params, progress) => {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  const cycle = progress % 1;
  const scale = 0.7 + Math.sin(cycle * Math.PI * 2) * 0.2;
  ctx.scale(scale, scale);
  ctx.rotate(cycle * Math.PI * 2 * 0.5);
  ctx.drawImage(media, -media.width / 2, -media.height / 2, media.width, media.height);
  ctx.restore();
});

export const deviceShowcase = createTemplate('device-showcase', 'Device Showcase', 'device', 6, (ctx, media, _params, progress) => {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 2;
  ctx.roundRect(w * 0.2, h * 0.1, w * 0.6, h * 0.8, 20);
  ctx.stroke();
  ctx.translate(progress * 100, 0);
  ctx.drawImage(media, w * 0.25, h * 0.15, w * 0.5, h * 0.7);
  ctx.restore();
});

export const cameraOrbit = createTemplate('camera-orbit', 'Camera Orbit', '3d', 7, (ctx, media, _params, progress) => {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const angle = progress * Math.PI * 2;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(angle);
  ctx.translate(200, 0);
  ctx.drawImage(media, -media.width / 2, -media.height / 2, media.width, media.height);
  ctx.restore();
});

export const rotationReveal = createTemplate('rotation-reveal', 'Rotation Reveal', 'experimental', 5, (ctx, media, _params, progress) => {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(progress * Math.PI * 2);
  ctx.globalAlpha = Math.sin(progress * Math.PI);
  ctx.drawImage(media, -media.width / 2, -media.height / 2, media.width, media.height);
  ctx.restore();
});
