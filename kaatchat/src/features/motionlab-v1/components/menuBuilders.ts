import { useV1 } from '../store';
import { anim } from '../engine/interp';
import type { MenuItem } from './ContextMenu';
import type { Layer } from '../types';

/* Centralised menu builders so every surface (timeline row, canvas,
 * clip, future layers-panel) offers the same actions in the same order
 * — only the parts the context can't do are hidden. */

export function layerMenu(layerId: string, extra?: { onRename?: () => void }): MenuItem[] {
  const s = useV1.getState();
  const duplicate = s.duplicate;
  const removeLayer = s.removeLayer;
  const splitLayerAt = s.splitLayerAt;
  const patchLayer = s.patchLayer;
  const reorderLayer = s.reorderLayer;
  const setVisible = s.setVisible;
  const setLocked = s.setLocked;
  const layer = s.project.layers.find((l) => l.id === layerId);
  if (!layer) return [];
  const idx = s.project.layers.findIndex((l) => l.id === layerId);
  const last = s.project.layers.length - 1;

  const resetTransform = () => {
    const comp = s.project.composition;
    const base = {
      position: anim<[number, number]>([comp.width / 2, comp.height / 2]),
      scale: anim<[number, number]>([1, 1]),
      rotation: anim<number>(0),
      anchor: anim<[number, number]>([0, 0]),
      opacity: anim<number>(1),
    };
    patchLayer(layer.id, { transform: base } as Partial<Layer>);
  };

  return [
    ...(extra?.onRename ? [{ label: 'Rename…', run: extra.onRename }] : []),
    { label: 'Duplicate', shortcut: '⌘D', run: () => duplicate(layer.id) },
    { label: 'Split at playhead', shortcut: 'K', run: () => splitLayerAt(layer.id, s.currentTime) },
    { divider: true, label: '' },
    { label: 'Copy keyframes at playhead', shortcut: '⌘C', run: () => s.copyKeyframesAt(layer.id, s.currentTime) },
    {
      label: 'Paste keyframes at playhead',
      shortcut: '⌘V',
      disabled: !s.hasKeyframeClipboard(),
      run: () => s.pasteKeyframesAt(layer.id, s.currentTime),
    },
    { divider: true, label: '' },
    { label: layer.visible ? 'Hide' : 'Show', run: () => setVisible(layer.id, !layer.visible) },
    ...(layer.type === 'media'
      ? [{ label: layer.muted ? 'Unmute audio' : 'Mute audio', run: () => patchLayer(layer.id, { muted: !layer.muted } as Partial<Layer>) }]
      : []),
    { label: layer.locked ? 'Unlock' : 'Lock', run: () => setLocked(layer.id, !layer.locked) },
    { divider: true, label: '' },
    {
      label: 'Bring to front',
      disabled: idx === last,
      run: () => reorderLayer(layer.id, last),
    },
    {
      label: 'Send to back',
      disabled: idx === 0,
      run: () => reorderLayer(layer.id, 0),
    },
    { divider: true, label: '' },
    { label: 'Reset transform', run: resetTransform },
    { divider: true, label: '' },
    { label: 'Delete', shortcut: '⌫', danger: true, run: () => removeLayer(layer.id) },
  ];
}

/* Menu for a right-click on empty canvas / timeline background — add
 * a layer, paste (future). For V1 we show the add-layer options so
 * users have a right-click path to the toolbar. */
export function addLayerMenu(): MenuItem[] {
  const s = useV1.getState();
  return [
    { label: 'Add text layer', run: () => s.addTextLayer() },
    { label: 'Add rectangle', run: () => s.addRectangle() },
    { label: 'Add ellipse', run: () => s.addEllipse() },
    { label: 'Add null (anchor)', run: () => s.addNull() },
  ];
}

/* Clip-specific extras (shown IN ADDITION to layerMenu when a clip is
 * right-clicked on the timeline track). "Trim to playhead" is a very
 * common NLE operation — chop the part before or after the current
 * time off the clip, leaving the other side intact. */
export function clipExtras(layerId: string): MenuItem[] {
  const s = useV1.getState();
  const layer = s.project.layers.find((l) => l.id === layerId);
  if (!layer) return [];
  const t = s.currentTime;
  const inside = t > layer.startTime && t < layer.startTime + layer.duration;
  if (!inside) return [];
  return [
    { label: 'Trim start to playhead', run: () => s.trimLayerIn(layerId, t) },
    { label: 'Trim end to playhead', run: () => s.trimLayerOut(layerId, t) },
    { divider: true, label: '' },
  ];
}
