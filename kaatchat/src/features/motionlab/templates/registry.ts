import type { Template } from '../types';
import * as templates from './';

export const templateRegistry: Template[] = [
  templates.floatingCard,
  templates.perspectiveSlide,
  templates.softZoom,
  templates.infiniteFloat,
  templates.editorialReveal,
  templates.productTurn,
  templates.cinemaricPush,
  templates.depthZoom,
  templates.minimalFade,
  templates.splitScreen,
  templates.elasticEntrance,
  templates.horizontalSweep,
  templates.verticalReveal,
  templates.parallaxDrift,
  templates.perspective3DTilt,
  templates.imageStack,
  templates.magazineFlip,
  templates.windowReveal,
  templates.glasPanel,
  templates.cardCarousel,
  templates.dynamicCrop,
  templates.infinitePerspectiveLoop,
  templates.deviceShowcase,
  templates.cameraOrbit,
  templates.rotationReveal,
];

export const getTemplateById = (id: string): Template | undefined => {
  return templateRegistry.find((t) => t.id === id);
};

export const getTemplatesByCategory = (category: string): Template[] => {
  return templateRegistry.filter((t) => t.category === category);
};

export const categories = [
  { value: 'all', label: 'All' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'device', label: 'Device' },
  { value: 'perspective', label: 'Perspective' },
  { value: 'editorial', label: 'Editorial' },
  { value: 'product', label: 'Product' },
  { value: '3d', label: '3D' },
  { value: 'social', label: 'Social' },
  { value: 'portfolio', label: 'Portfolio' },
  { value: 'experimental', label: 'Experimental' },
];
