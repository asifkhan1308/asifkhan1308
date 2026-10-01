import type { Template, ParameterConfig } from '../types';

const parameters: ParameterConfig[] = [
  {
    id: 'duration',
    label: 'Duration',
    type: 'slider',
    min: 1,
    max: 15,
    step: 0.1,
    default: 5,
    unit: 's',
  },
  {
    id: 'scale',
    label: 'Scale',
    type: 'slider',
    min: 0.5,
    max: 2,
    step: 0.1,
    default: 1,
  },
  {
    id: 'rotation',
    label: 'Rotation',
    type: 'slider',
    min: -360,
    max: 360,
    step: 1,
    default: 0,
    unit: '°',
  },
  {
    id: 'floatDistance',
    label: 'Float Distance',
    type: 'slider',
    min: 10,
    max: 200,
    step: 10,
    default: 30,
    unit: 'px',
  },
];

const animationFunction = (ctx: CanvasRenderingContext2D, media: HTMLImageElement | HTMLVideoElement, params: Record<string, any>, progress: number, _aspect: any) => {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const centerX = w / 2;
  const centerY = h / 2;

  // Animation timeline
  let animProgress = progress % 1;

  // Floating motion
  const floatAmount = Math.sin(animProgress * Math.PI * 2) * params.floatDistance;

  // Scale animation
  const scaleStart = 0.8;
  const scalePeak = params.scale;
  let scale = scaleStart + (scalePeak - scaleStart) * Math.sin(animProgress * Math.PI);

  // Rotation
  const rotation = (params.rotation * Math.PI) / 180 + animProgress * Math.PI * 0.5;

  // Position
  const y = centerY + floatAmount - h * 0.15;
  const x = centerX;

  // Calculate media dimensions
  const mediaWidth = media.width || 400;
  const mediaHeight = media.height || 300;
  const aspectRatio = mediaWidth / mediaHeight;

  let displayWidth = h * 0.4 * aspectRatio;
  let displayHeight = h * 0.4;

  if (displayWidth > w * 0.6) {
    displayWidth = w * 0.6;
    displayHeight = displayWidth / aspectRatio;
  }

  displayWidth *= scale;
  displayHeight *= scale;

  // Draw
  ctx.save();
  ctx.globalAlpha = 0.8 + Math.cos(animProgress * Math.PI * 2) * 0.2;

  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.drawImage(media, -displayWidth / 2, -displayHeight / 2, displayWidth, displayHeight);

  ctx.restore();
};

const previewFunction = (canvas: HTMLCanvasElement, media: HTMLImageElement | HTMLVideoElement, params: Record<string, any>, progress: number) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  animationFunction(ctx, media, params, progress, { aspect: '16:9' });
};

export const floatingCard: Template = {
  id: 'floating-card',
  name: 'Floating Card',
  category: 'minimal',
  thumbnail: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDEwMCAxMDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHN0eWxlPi5kYXJreyBmaWxsOiAjMDAwOyB9IC5jYXJkeyBmaWxsOiAjMzMzOyB9PC9zdHlsZT48L2RlZnM+PHJlY3QgY2xhc3M9ImRhcmsiIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIi8+PHJlY3QgY2xhc3M9ImNhcmQiIHg9IjI1IiB5PSIzMCIgd2lkdGg9IjUwIiBoZWlnaHQ9IjQwIiByeD0iNCIvPjwvc3ZnPg==',
  duration: 5,
  description: 'Smooth floating card with subtle rotation and opacity pulse',
  supportedMediaTypes: ['image', 'video'],
  parameters,
  animationFunction,
  previewFunction,
};
