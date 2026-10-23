import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/* Tiny context-menu primitive.
 *
 * Usage: render <ContextMenu> conditionally with an anchor {x,y} in client
 * coords. It handles outside-click dismissal, Escape, and viewport-edge
 * flipping (nudges itself up/left if it would overflow). Items are a flat
 * list of { label, run, shortcut?, danger?, disabled?, divider? }.
 *
 * The caller owns open/close state so the trigger can be anywhere — a row
 * right-click, a canvas right-click, a long-press on touch, etc.
 */

export interface MenuItem {
  label: string;
  run?: () => void;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
}

interface Props {
  anchor: { x: number; y: number } | null;
  items: MenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ anchor, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  // After mount, measure and flip so the menu never overflows the viewport.
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = anchor.x + r.width > vw ? Math.max(4, anchor.x - r.width) : anchor.x;
    const y = anchor.y + r.height > vh ? Math.max(4, anchor.y - r.height) : anchor.y;
    setPos({ x, y });
  }, [anchor]);

  // Latest onClose without re-subscribing: callers often pass a new function
  // each render, and re-subscribing reopened the delayed window below.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  // Escape works from the moment the menu is on screen: a layout effect is
  // attached during the same commit that shows it (a passive effect can run
  // a task later, and a fast Escape slipped through to the editor).
  useLayoutEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anchor]);

  useEffect(() => {
    if (!anchor) return;
    const onDocDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeRef.current();
    };
    // Mouse dismissal waits a tick so the opening right-click's own events
    // don't close the menu.
    const id = setTimeout(() => {
      window.addEventListener('mousedown', onDocDown);
      window.addEventListener('contextmenu', onDocDown);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener('mousedown', onDocDown);
      window.removeEventListener('contextmenu', onDocDown);
    };
  }, [anchor]);

  if (!anchor) return null;

  return createPortal(
    <div
      ref={ref}
      className="v1-context-menu"
      style={{ left: pos?.x ?? anchor.x, top: pos?.y ?? anchor.y, visibility: pos ? 'visible' : 'hidden' }}
      role="menu"
    >
      {items.map((it, i) =>
        it.divider ? (
          <div key={`sep-${i}`} className="v1-ctx-sep" aria-hidden />
        ) : (
          <button
            key={`${it.label}-${i}`}
            type="button"
            className={`v1-ctx-item${it.danger ? ' danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              it.run?.();
              onClose();
            }}
            role="menuitem"
          >
            <span className="v1-ctx-label">{it.label}</span>
            {it.shortcut && <span className="v1-ctx-shortcut">{it.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
