import { useRef } from 'react';
import type { EditorSession } from '../app/session';
import { applyBrand, defaultBrand } from '../engine/brand';
import { fromView, toView } from '../engine/project';
import { putFont, registerFont } from '../engine/persist';
import { OVERLAY_FONTS } from '../engine/motion';
import { CAPTION_STYLES } from '../engine/render';
import type { BrandKit, CaptionStyleId, ProjectDoc } from '../engine/types';
import { uid } from '../engine/id';
import { Icon, toast } from './bits';

const DEFAULT_KEY = 'kaatchat.brand.default';

/** Brand Kit: set once, apply to any edit. */
export function BrandPanel({ session }: { session: EditorSession }) {
  const { store } = session;
  const brand = store.project.brand ?? defaultBrand();
  const assets = Object.values(store.project.assets);
  const images = assets.filter((a) => a.kind === 'image');
  const clips = assets.filter((a) => a.kind === 'video' || a.kind === 'image');
  const logoRef = useRef<HTMLInputElement>(null);
  const fontRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<BrandKit>, label = 'Edit brand') => store.mutateProject(label, (p) => ({ ...p, brand: { ...brand, ...patch } }));
  const fonts = [...Object.keys(OVERLAY_FONTS), ...(Object.keys(OVERLAY_FONTS).includes(brand.font) ? [] : [brand.font])];

  const applyTo = (all: boolean) => {
    let notes: string[] = [];
    store.mutateProject(
      all ? 'Apply brand to all sequences' : 'Apply brand',
      (p) => {
        const withBrand: ProjectDoc = { ...p, brand };
        if (!all) {
          const r = applyBrand(toView(withBrand), brand, uid);
          notes = r.notes;
          return fromView(withBrand, r.view);
        }
        let cur = withBrand;
        for (const s of withBrand.sequences) {
          const q = { ...cur, activeSequenceId: s.id };
          const r = applyBrand(toView(q), brand, uid);
          notes = r.notes;
          cur = { ...fromView(q, r.view), activeSequenceId: p.activeSequenceId };
        }
        return cur;
      },
      'you',
    );
    toast(`${all ? `All ${store.sequences.length} sequences` : 'This sequence'}: ${notes.join(' · ')}`, 'info', { label: 'Undo', run: () => store.undo() });
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      <p className="muted small">Set your look once. “Apply” (or asking “use my brand”) puts it on the edit; applying again replaces what it added.</p>

      <label className="field">
        Logo
        <div className="row">
          <select className="select grow" value={brand.logoAssetId ?? ''} onChange={(e) => set({ logoAssetId: e.target.value || null }, 'Brand logo')}>
            <option value="">None</option>
            {images.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button className="btn sm" onClick={() => logoRef.current?.click()}>
            <Icon name="upload" size={13} /> Import
          </button>
        </div>
      </label>
      <input
        ref={logoRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          const r = await session.importFiles([f], false);
          r.errors.forEach((m) => toast(m, 'err'));
          if (r.imported[0]) set({ logoAssetId: r.imported[0].id }, 'Brand logo');
        }}
      />

      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        {(['ink', 'paper', 'accent'] as const).map((k) => (
          <label key={k} className="row small">
            <input type="color" value={brand.colors[k]} onChange={(e) => set({ colors: { ...brand.colors, [k]: e.target.value } }, 'Brand colours')} aria-label={`Brand ${k} colour`} />
            {k === 'ink' ? 'Text' : k === 'paper' ? 'Panel' : 'Highlight'}
          </label>
        ))}
      </div>

      <label className="field">
        Font
        <div className="row">
          <select className="select grow" value={brand.font} onChange={(e) => set({ font: e.target.value }, 'Brand font')}>
            {fonts.map((f) => (
              <option key={f} value={f}>
                {f === 'system-serif' ? 'Serif' : f === 'system-sans' ? 'System' : f}
              </option>
            ))}
          </select>
          <button className="btn sm" onClick={() => fontRef.current?.click()} title="Upload a .ttf, .otf, .woff or .woff2 you are licensed to use">
            <Icon name="upload" size={13} /> Upload
          </button>
        </div>
      </label>
      <input
        ref={fontRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2,font/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          const family = f.name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 40) || 'Brand font';
          try {
            await registerFont(family, f);
            await putFont(family, f);
            set({ font: family }, 'Brand font');
            toast(`Font “${family}” is ready. It is stored on this device only.`);
          } catch {
            toast(`“${f.name}” could not be loaded as a font.`, 'err');
          }
        }}
      />

      <label className="field">
        Caption style
        <select className="select" value={brand.captionStyle} onChange={(e) => set({ captionStyle: e.target.value as CaptionStyleId }, 'Brand captions')}>
          {Object.entries(CAPTION_STYLES).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </label>

      <div className="divider" />
      <label className="row small">
        <input type="checkbox" className="check" checked={brand.lowerThird.enabled} onChange={(e) => set({ lowerThird: { ...brand.lowerThird, enabled: e.target.checked } }, 'Lower third')} />
        Lower third
      </label>
      {brand.lowerThird.enabled && (
        <div className="row">
          <input className="input grow" placeholder="Name" defaultValue={brand.lowerThird.name} onBlur={(e) => set({ lowerThird: { ...brand.lowerThird, name: e.target.value } }, 'Lower third')} aria-label="Lower third name" />
          <input className="input grow" placeholder="Title" defaultValue={brand.lowerThird.title} onBlur={(e) => set({ lowerThird: { ...brand.lowerThird, title: e.target.value } }, 'Lower third')} aria-label="Lower third title" />
        </div>
      )}
      <label className="row small">
        <input
          type="checkbox"
          className="check"
          checked={brand.watermark.enabled}
          disabled={!brand.logoAssetId}
          onChange={(e) => set({ watermark: { ...brand.watermark, enabled: e.target.checked } }, 'Watermark')}
        />
        Logo watermark {brand.logoAssetId ? '' : '(choose a logo first)'}
      </label>
      {brand.watermark.enabled && (
        <div className="row">
          <select className="select" value={brand.watermark.position} onChange={(e) => set({ watermark: { ...brand.watermark, position: e.target.value as BrandKit['watermark']['position'] } }, 'Watermark')} aria-label="Watermark corner">
            <option value="tl">Top left</option>
            <option value="tr">Top right</option>
            <option value="bl">Bottom left</option>
            <option value="br">Bottom right</option>
          </select>
          <input
            className="range grow"
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            defaultValue={brand.watermark.opacity}
            onPointerUp={(e) => set({ watermark: { ...brand.watermark, opacity: +(e.target as HTMLInputElement).value } }, 'Watermark')}
            aria-label="Watermark opacity"
          />
        </div>
      )}
      <div className="row">
        <label className="field grow">
          Intro
          <select className="select" value={brand.introAssetId ?? ''} onChange={(e) => set({ introAssetId: e.target.value || null }, 'Brand intro')}>
            <option value="">None</option>
            {clips.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          Outro
          <select className="select" value={brand.outroAssetId ?? ''} onChange={(e) => set({ outroAssetId: e.target.value || null }, 'Brand outro')}>
            <option value="">None</option>
            {clips.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn primary" disabled={store.doc.clips.length === 0} onClick={() => applyTo(false)}>
          Apply brand
        </button>
        {store.sequences.length > 1 && (
          <button className="btn" onClick={() => applyTo(true)}>
            Apply to all {store.sequences.length} sequences
          </button>
        )}
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button
          className="btn sm ghost"
          onClick={() => {
            const { logoAssetId: _l, introAssetId: _i, outroAssetId: _o, ...portable } = brand;
            void _l;
            void _i;
            void _o;
            try {
              localStorage.setItem(DEFAULT_KEY, JSON.stringify(portable));
              toast('Saved as your default brand on this device (logo, intro and outro are per project).');
            } catch {
              toast('Could not save — browser storage is blocked.', 'err');
            }
          }}
        >
          Save as my default
        </button>
        <button
          className="btn sm ghost"
          onClick={() => {
            try {
              const d = JSON.parse(localStorage.getItem(DEFAULT_KEY) ?? 'null');
              if (!d) return toast('No default brand saved yet.', 'err');
              set({ ...defaultBrand(), ...d, logoAssetId: brand.logoAssetId, introAssetId: brand.introAssetId, outroAssetId: brand.outroAssetId }, 'Load default brand');
            } catch {
              toast('Could not read the default brand.', 'err');
            }
          }}
        >
          Load my default
        </button>
      </div>
    </div>
  );
}
