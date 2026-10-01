import type { Template, ParameterConfig } from '../types';
const parameters: ParameterConfig[] = [
  { id: 'duration', label: 'Duration', type: 'slider', min: 2, max: 20, step: 0.1, default: 6, unit: 's' },
  { id: 'amplitude', label: 'Amplitude', type: 'slider', min: 5, max: 100, step: 5, default: 30, unit: 'px' },
];
const animationFunction = (ctx: CanvasRenderingContext2D, media: any, params: any, progress: number) => {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const floatY = Math.sin(progress * Math.PI * 2) * params.amplitude;
  const floatX = Math.cos(progress * Math.PI) * params.amplitude * 0.5;
  ctx.save();
  ctx.globalAlpha = 0.85 + Math.cos(progress * Math.PI * 2) * 0.15;
  ctx.translate(w / 2 + floatX, h / 2 + floatY);
  ctx.drawImage(media, -media.width / 2, -media.height / 2, media.width, media.height);
  ctx.restore();
};
const previewFunction = (canvas: HTMLCanvasElement, media: any, params: any, progress: number) => {
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  animationFunction(ctx, media, params, progress);
};
export const infiniteFloat: Template = {
  id: 'infinite-float', name: 'Infinite Float', category: 'experimental', thumbnail: '', duration: 6,
  description: 'Continuous floating motion', supportedMediaTypes: ['image', 'video'],
  parameters, animationFunction, previewFunction,
};
