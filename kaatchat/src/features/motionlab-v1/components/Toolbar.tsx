import { useRef } from 'react';
import { useV1 } from '../store';
import { importFileToMotion } from '../../motionlab/engine/bridge';
import type { Asset } from '../types';

export default function V1Toolbar() {
  const addText = useV1((s) => s.addTextLayer);
  const addRect = useV1((s) => s.addRectangle);
  const addEll = useV1((s) => s.addEllipse);
  const addNull = useV1((s) => s.addNull);
  const addAsset = useV1((s) => s.addAsset);
  const addMediaLayer = useV1((s) => s.addMediaLayer);
  const addImageLayer = useV1((s) => s.addImageLayer);
  const activeTool = useV1((s) => s.activeTool);
  const setActiveTool = useV1((s) => s.setActiveTool);
  const fileRef = useRef<HTMLInputElement>(null);

  const importMedia = async (file: File) => {
    try {
      const m = await importFileToMotion(file);
      const asset: Asset = {
        id: m.id,
        kind: m.type === 'video' ? 'video' : 'image',
        name: m.name,
        mime: m.data?.type ?? 'application/octet-stream',
        width: m.width,
        height: m.height,
        duration: 5,
        url: m.url,
      };
      addAsset(asset);
      if (asset.kind === 'video') addMediaLayer(asset);
      else addImageLayer(asset);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not import this file.');
    }
  };

  const tools: Array<{ id: typeof activeTool; label: string; icon: string; action?: () => void }> = [
    { id: 'select', label: 'Select', icon: '◇' },
    { id: 'text', label: 'Text', icon: 'T', action: () => addText() },
    { id: 'rectangle', label: 'Rect', icon: '▭', action: () => addRect() },
    { id: 'ellipse', label: 'Ellipse', icon: '○', action: () => addEll() },
    { id: 'media', label: 'Media', icon: '▶', action: () => fileRef.current?.click() },
    { id: 'null', label: 'Null', icon: '✦', action: () => addNull() },
  ];

  return (
    <div className="v1-toolbar">
      {tools.map((t) => (
        <button
          key={t.id}
          className={`v1-tool${activeTool === t.id ? ' active' : ''}`}
          title={t.label}
          onClick={() => {
            setActiveTool(t.id);
            t.action?.();
          }}
        >
          <span className="v1-tool-icon">{t.icon}</span>
          <span className="v1-tool-label">{t.label}</span>
        </button>
      ))}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importMedia(f);
          if (e.target) e.target.value = '';
        }}
      />
    </div>
  );
}
