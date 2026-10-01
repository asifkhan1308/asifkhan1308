import type { Template, ParameterConfig } from '../types';
const parameters: ParameterConfig[] = [
  { id: 'duration', label: 'Duration', type: 'slider', min: 1, max: 15, step: 0.1, default: 4, unit: 's' },
  { id: 'zoomAmount', label: 'Zoom Amount', type: 'slider', min: 0.1, max: 2, step: 0.1, default: 1.5 },
];
const animationFunction = (ctx: CanvasRenderingContext2D, media: any, params: any, progress: number) => {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  let scale = 1 + (params.zoomAmount - 1) * Math.sin(progress * Math.PI) ** 2;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(scale, scale);
  ctx.globalAlpha = 0.9;
  ctx.drawImage(media, -media.width / 2, -media.height / 2, media.width, media.height);
  ctx.restore();
};
const previewFunction = (canvas: HTMLCanvasElement, media: any, params: any, progress: number) => {
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  animationFunction(ctx, media, params, progress);
};
export const softZoom: Template = {
  id: 'soft-zoom', name: 'Soft Zoom', category: 'minimal', thumbnail: '', duration: 4,
  description: 'Smooth zoom in and out', supportedMediaTypes: ['image', 'video'],
  parameters, animationFunction, previewFunction,
};
