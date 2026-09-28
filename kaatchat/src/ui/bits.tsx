import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { t } from '../i18n';

/** The Kaatchat mark (monochrome, from the Main design canvas). Inverts in dark theme. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="15" style={{ fill: 'var(--accent)' }} />
      <path d="M20 11 L53 32 L20 29 Z" style={{ fill: 'var(--accent-ink)' }} transform="translate(-1.5,-1.5)" />
      <path d="M20 31.4 L53 32 L20 53 Z" style={{ fill: 'var(--accent-ink)' }} transform="translate(1.5,1.5)" opacity="0.92" />
    </svg>
  );
}

export function Brand() {
  return (
    <a className="brand" href="#/" aria-label="Kaatchat home">
      <Logo size={26} />
      <span className="label">Kaatchat</span>
    </a>
  );
}

const paths: Record<string, string> = {
  play: 'M7 5v14l11-7z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'm15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 15V3m0 0L7 8m5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  download: 'M12 3v12m0 0 5-5m-5 5-5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2-4.35-4.35',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  x: 'M18 6 6 18M6 6l12 12',
  left: 'm15 18-6-6 6-6',
  right: 'm9 18 6-6-6-6',
  menu: 'M3 6h18M3 12h18M3 18h18',
  panel: 'M3 4h18v16H3zM15 4v16',
  text: 'M4 7V4h16v3M9 20h6M12 4v16',
  wave: 'M2 12h2l2-6 3 12 3-9 2 6 2-3h6',
  check: 'M20 6 9 17l-5-5',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
  layers: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 16, label }: { name: IconName; size?: number; label?: string }) {
  const filled = name === 'play' || name === 'pause' || name === 'spark';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <path d={paths[name]} />
    </svg>
  );
}

/** Accessible modal: labelled, traps Tab, closes on Escape, restores focus. */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    const first = el.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    (first ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab') {
        const f = [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
          (x) => !x.hasAttribute('disabled'),
        );
        if (f.length === 0) return;
        const a = f[0];
        const z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dlg-title" ref={ref} tabIndex={-1}>
        <header>
          <h2 id="dlg-title" className="grow">
            {title}
          </h2>
          <button className="btn ghost icon" onClick={onClose} aria-label={t('common.close')} data-close>
            <Icon name="x" />
          </button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'err';
  action?: { label: string; run: () => void };
}
let toasts: Toast[] = [];
let tid = 0;
const tl = new Set<() => void>();
const temit = () => tl.forEach((f) => f());

export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action']) {
  const id = ++tid;
  toasts = [...toasts, { id, text, kind, action }].slice(-4);
  temit();
  setTimeout(() => dismissToast(id), kind === 'err' ? 9000 : 4500);
}
function dismissToast(id: number) {
  toasts = toasts.filter((x) => x.id !== id);
  temit();
}

export function Toasts() {
  const list = useSyncExternalStore(
    (f) => {
      tl.add(f);
      return () => tl.delete(f);
    },
    () => toasts,
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((x) => (
        <div key={x.id} className={`toast${x.kind === 'err' ? ' err' : ''}`}>
          {x.kind === 'err' && <Icon name="alert" />}
          <span className="grow">{x.text}</span>
          {x.action && (
            <button
              className="btn sm"
              onClick={() => {
                x.action!.run();
                dismissToast(x.id);
              }}
            >
              {x.action.label}
            </button>
          )}
          <button className="btn ghost sm icon" onClick={() => dismissToast(x.id)} aria-label="Dismiss">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function fmtTime(s: number, withFrames = false, fps = 30): string {
  if (!Number.isFinite(s)) s = 0;
  const neg = s < 0;
  s = Math.abs(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const f = Math.floor((s - Math.floor(s)) * fps);
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  const base = h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  return (neg ? '-' : '') + (withFrames ? `${base}:${String(f).padStart(2, '0')}` : base);
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function Progress({ value, label }: { value: number | null; label?: string }) {
  return (
    <div
      className={`progress${value === null ? ' indeterminate' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
    >
      <i style={{ width: `${(value ?? 0) * 100}%` }} />
    </div>
  );
}
