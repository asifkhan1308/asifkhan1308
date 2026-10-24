import { useEffect, useRef, useState } from 'react';
import { useV1 } from '../store';
import { t as tr, useLang } from '../../../i18n';
import { importFile } from '../../../engine/media';
import type { Asset } from '../types';

export default function V1Toolbar() {
  useLang();
  const addText = useV1((s) => s.addTextLayer);
  const addRect = useV1((s) => s.addRectangle);
  const addEll = useV1((s) => s.addEllipse);
  const addPoly = useV1((s) => s.addPolygon);
  const addNull = useV1((s) => s.addNull);
  const addAsset = useV1((s) => s.addAsset);
  const addMediaLayer = useV1((s) => s.addMediaLayer);
  const addImageLayer = useV1((s) => s.addImageLayer);
  const activeTool = useV1((s) => s.activeTool);
  const setActiveTool = useV1((s) => s.setActiveTool);
  const fileRef = useRef<HTMLInputElement>(null);
  // Inline status instead of a blocking browser alert(): errors stay 6 s
  // (click to dismiss), "Importing…" shows while a large file is probed.
  const [notice, setNotice] = useState<{ text: string; err: boolean } | null>(null);
  useEffect(() => {
    if (!notice?.err) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const importMedia = async (file: File) => {
    setNotice({ text: `Importing ${file.name}…`, err: false });
    try {
      // Engine import: probes real duration/dimensions and persists the bytes
      // in the shared media store, so the clip survives reload (rehydrateMedia).
      const m = await importFile(file);
      const asset: Asset = {
        id: m.id,
        kind: m.kind === 'video' ? 'video' : m.kind === 'audio' ? 'audio' : 'image',
        name: m.name,
        mime: m.mime,
        width: m.width,
        height: m.height,
        duration: m.kind === 'video' || m.kind === 'audio' ? m.duration : 0,
        url: URL.createObjectURL(file),
      };
      addAsset(asset);
      // Audio files become media layers with sound and nothing to draw.
      if (asset.kind === 'video' || asset.kind === 'audio') addMediaLayer(asset);
      else addImageLayer(asset);
      setNotice(null);
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : 'Could not import this file.', err: true });
    }
  };

  const tools: Array<{ id: typeof activeTool; label: string; icon: string; action?: () => void }> = [
    { id: 'select', label: tr('studio.tool.select'), icon: '◇' },
    { id: 'text', label: tr('studio.tool.text'), icon: 'T', action: () => addText() },
    { id: 'rectangle', label: tr('studio.tool.rect'), icon: '▭', action: () => addRect() },
    { id: 'ellipse', label: tr('studio.tool.ellipse'), icon: '○', action: () => addEll() },
    { id: 'polygon', label: tr('studio.tool.polygon'), icon: '⬡', action: () => addPoly(false) },
    { id: 'star', label: tr('studio.tool.star'), icon: '☆', action: () => addPoly(true) },
    { id: 'media', label: tr('studio.tool.media'), icon: '▶', action: () => fileRef.current?.click() },
    { id: 'null', label: tr('studio.tool.null'), icon: '✦', action: () => addNull() },
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
        accept="image/*,video/*,audio/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importMedia(f);
          if (e.target) e.target.value = '';
        }}
      />
      {notice && (
        <div
          className={`v1-notice${notice.err ? ' err' : ''}`}
          role={notice.err ? 'alert' : 'status'}
          onClick={() => setNotice(null)}
          title="Click to dismiss"
        >
          {notice.text}
        </div>
      )}
    </div>
  );
}
