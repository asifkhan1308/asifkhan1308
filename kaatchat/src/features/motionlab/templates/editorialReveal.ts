import type { Template, ParameterConfig } from '../types';
const parameters: ParameterConfig[] = [
  { id: 'duration', label: 'Duration', type: 'slider', min: 2, max: 12, step: 0.1, default: 5, unit: 's' },
  { id: 'direction', label: 'Direction', type: 'select', default: 'left', options: [{ label: 'Left', value: 'left' }, { label: 'Right', value: 'right' }, { label: 'Top', value: 'top' }, { label: 'Bottom', value: 'bottom' }] },
];
const animationFunction = (ctx: CanvasRenderingContext2D, media: any, params: any, progress: number) => {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.save();
  ctx.globalAlpha = Math.sin(progress * Math.PI) ** 0.5;
  let clipX = 0, clipY = 0;
  if (params.direction === 'left') clipX = w * (1 - progress);
  else if (params.direction === 'right') clipX = w * progress;
  else if (params.direction === 'top') clipY = h * (1 - progress);
  else if (params.direction === 'bottom') clipY = h * progress;
  ctx.beginPath();
  ctx.rect(clipX, clipY, params.direction === 'left' || params.direction === 'right' ? w * progress : w, params.direction === 'top' || params.direction === 'bottom' ? h * progress : h);
  ctx.clip();
  ctx.translate(w / 2, h / 2);
  ctx.drawImage(media, -media.width / 2, -media.height / 2, media.width, media.height);
  ctx.restore();
};
const previewFunction = (canvas: HTMLCanvasElement, media: any, params: any, progress: number) => {
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  animationFunction(ctx, media, params, progress);
};
export const editorialReveal: Template = {
  id: 'editorial-reveal', name: 'Editorial Reveal', category: 'editorial', thumbnail: '', duration: 5,
  description: 'Directional reveal animation', supportedMediaTypes: ['image', 'video'],
  parameters, animationFunction, previewFunction,
};
