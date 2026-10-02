export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5' | '21:9';

export type ParameterValue = number | string | boolean;

export interface MediaAsset {
  id: string;
  type: 'image' | 'video';
  name: string;
  data?: Blob;
  url: string;
  width: number;
  height: number;
}

export interface BackgroundSettings {
  type: 'solid' | 'gradient' | 'image';
  color?: string;
  gradient?: { from: string; to: string; angle: number };
  imageUrl?: string;
  opacity: number;
}

export interface AnimationState {
  duration: number;
  delay: number;
  speed: number;
  loop: boolean;
}

export interface TransformState {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  perspective: number;
}

export interface ParameterConfig {
  id: string;
  label: string;
  type: 'slider' | 'color' | 'select' | 'toggle';
  min?: number;
  max?: number;
  step?: number;
  default: ParameterValue;
  unit?: string;
  options?: Array<{ label: string; value: ParameterValue }>;
}

export type MediaLike = any;

export type AnimationFunction = (
  ctx: CanvasRenderingContext2D,
  media: MediaLike,
  params: Record<string, any>,
  progress: number,
  extras?: any,
) => void;

export type PreviewFunction = (
  canvas: HTMLCanvasElement,
  media: MediaLike,
  params: Record<string, any>,
  progress: number,
) => void;

export interface Template {
  id: string;
  name: string;
  category: string;
  description?: string;
  thumbnail?: string;
  duration: number;
  supportedMediaTypes?: Array<'image' | 'video'>;
  parameters: ParameterConfig[];
  animationFunction: AnimationFunction;
  previewFunction?: PreviewFunction;
}

export type TextAnimation = 'none' | 'fade-in' | 'slide-up' | 'typewriter';

export interface TextLayer {
  id: string;
  text: string;
  /** Normalised 0..1 in canvas space. Center-anchored. */
  x: number;
  y: number;
  /** Font size as a fraction of canvas height (0.05 = 5% of H). */
  size: number;
  color: string;
  fontFamily: string;
  fontWeight: 400 | 500 | 600 | 700 | 800;
  align: 'left' | 'center' | 'right';
  /** Visible window in seconds, within the project's animation.duration. */
  start: number;
  end: number;
  animation: TextAnimation;
}

export interface Project {
  id: string;
  name: string;
  templateId: string;
  aspectRatio: AspectRatio;
  parameters: Record<string, ParameterValue>;
  background: BackgroundSettings;
  animation: AnimationState;
  transform: TransformState;
  textLayers: TextLayer[];
  createdAt: number;
  updatedAt: number;
}

export interface HistoryEntry {
  action: string;
  projectState: Project;
  timestamp: number;
}

export interface ExportSettings {
  format: 'mp4' | 'webm';
  resolution: '720p' | '1080p' | '2k' | '4k' | '8k';
  frameRate: 24 | 30 | 60;
  quality: 'low' | 'medium' | 'high' | 'ultra';
}
