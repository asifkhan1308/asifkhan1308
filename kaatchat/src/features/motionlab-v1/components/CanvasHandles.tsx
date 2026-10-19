import { useCallback, useRef, useState } from 'react';
import { selectionOf, useV1 } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { pickLayerAt, worldCorners, type WorldBox } from '../engine/bbox';
import { aabb, guideTargets, snapMove } from '../engine/guides';
import { ancestors } from '../engine/matrix';
import { isLayerActive } from '../engine/compose';
import ContextMenu from './ContextMenu';
import { addLayerMenu, layerMenu } from './menuBuilders';
import type { V2 } from '../types';

/* SVG overlay drawn on top of the composition canvas. Renders the selection
 * bounding box and all drag handles for the selected layer, and does the
 * hit-testing + mouse math itself — the compose canvas never has to care
 * about input.
 *
 * The overlay sits in a viewBox that matches the composition pixel space, so
 * coordinates we compute via worldCorners drop straight in. Mouse events
 * are converted to composition pixels via the <svg> element's getScreenCTM
 * so drag math works at any CSS zoom level.
 *
 * Handles:
 *   • body         — pointerdown anywhere inside the bbox moves position
 *   • 4 corners    — proportional scale around the opposite corner
 *   • 4 edges      — uniform scale on one axis
 *   • top circle   — rotate around the layer centre
 */

type HandleKind = 'body' | 'rot' | 'tl' | 'tr' | 'br' | 'bl' | 't' | 'r' | 'b' | 'l';

const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const mag = (v: V2) => Math.hypot(v[0], v[1]);

export default function V1CanvasHandles() {
  const project = useV1((s) => s.project);
  const time = useV1((s) => s.currentTime);
  const selectedId = useV1((s) => s.selectedLayerId);
  const selection = useV1(useShallow((s) => selectionOf(s)));
  const setPropertyBase = useV1((s) => s.setPropertyBase);
  const patchLayer = useV1((s) => s.patchLayer);
  const svgRef = useRef<SVGSVGElement>(null);

  const layer = project.layers.find((l) => l.id === selectedId);
  const comp = project.composition;
  const box = layer ? worldCorners(layer, time, project.assets, project.layers) : null;
  // Null layers never render; the editor shows them as dashed squares (like
  // After Effects) so they can be found, picked and dragged.
  const nullMarks = project.layers
    .filter((l) => l.type === 'null' && isLayerActive(l, time))
    .map((l) => ({ id: l.id, b: worldCorners(l, time, project.assets, project.layers) }))
    .filter((x): x is { id: string; b: NonNullable<typeof box> } => !!x.b)
    .map(({ id, b }) => {
      const [a, c, d, e] = b.corners;
      return (
        <g key={id} className="v1-null-mark" aria-hidden>
          <polygon points={`${a.join(',')} ${c.join(',')} ${d.join(',')} ${e.join(',')}`} />
          <line x1={a[0]} y1={a[1]} x2={d[0]} y2={d[1]} />
          <line x1={c[0]} y1={c[1]} x2={e[0]} y2={e[1]} />
        </g>
      );
    });
  const selectLayer = useV1((s) => s.selectLayer);
  const [menu, setMenu] = useState<{ x: number; y: number; layerId: string | null } | null>(null);

  /* Smart guides: snap a dragged layer's box to the frame and other layers.
   * 6 screen px whatever the zoom; Alt drags freely. Children of the dragged
   * layer move with it, so they are not targets. */
  const [guides, setGuides] = useState<{ gx: number | null; gy: number | null } | null>(null);
  const makeSnapper = (moving: string | string[], start: WorldBox | V2[]) => {
    const st = useV1.getState();
    const t = st.currentTime;
    const ids = Array.isArray(moving) ? moving : [moving];
    const others = st.project.layers
      .filter((l) => !ids.includes(l.id) && l.type !== 'null' && isLayerActive(l, t))
      .filter((l) => !ancestors(l, st.project.layers).some((a) => ids.includes(a.id)))
      .map((l) => worldCorners(l, t, st.project.assets, st.project.layers))
      .filter((b): b is WorldBox => !!b)
      .map((b) => aabb(b.corners));
    const targets = guideTargets(st.project.composition, others);
    const box = aabb(Array.isArray(start) ? start : start.corners);
    const thr = 6 / (svgRef.current?.getScreenCTM()?.a || 1);
    return (d: V2, free: boolean): V2 => {
      if (free) { setGuides(null); return d; }
      const r = snapMove(box, d, targets, thr);
      setGuides(r.gx === null && r.gy === null ? null : { gx: r.gx, gy: r.gy });
      return r.d;
    };
  };

  const onContext = (ev: React.MouseEvent) => {
    ev.preventDefault();
    const p = toComp(ev as unknown as React.PointerEvent);
    const hit = pickLayerAt(project, time, p);
    if (hit) selectLayer(hit);
    setMenu({ x: ev.clientX, y: ev.clientY, layerId: hit });
  };

  /** Convert a pointer event to composition pixels, so dragging keeps feel at
   *  any CSS zoom. */
  const toComp = useCallback((e: PointerEvent | React.PointerEvent): V2 => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return [0, 0];
    const inv = ctm.inverse();
    const p = pt.matrixTransform(inv);
    return [p.x, p.y];
  }, []);

  const dragBodyOf = (layerId: string, ev: React.PointerEvent) => {
    // Shared body-drag used by (a) dragging the selection outline, (b) a
    // click-to-select-then-drag initiated by the picker. Pulls the needed
    // state from the store rather than closure so it works on the layer we
    // JUST selected, not the one that was selected when the closure ran.
    const state = useV1.getState();
    // Multi-select: dragging any selected layer moves the whole selection.
    // A layer whose ancestor is also selected moves with that ancestor only.
    const sel = selectionOf(state);
    const group = sel.length > 1 && sel.includes(layerId) ? sel : [layerId];
    const movers = group
      .map((id) => state.project.layers.find((x) => x.id === id))
      .filter((l): l is NonNullable<typeof l> => !!l && !l.locked)
      .filter((l) => !ancestors(l, state.project.layers).some((a) => group.includes(a.id)))
      .map((l) => ({ l, b: worldCorners(l, state.currentTime, state.project.assets, state.project.layers) }))
      .filter((m): m is { l: typeof m.l; b: WorldBox } => !!m.b)
      .map((m) => ({ id: m.l.id, b: m.b, startPos: [...m.b.position] as V2 }));
    if (!movers.length) return;
    (ev.target as Element).setPointerCapture(ev.pointerId);
    const start = toComp(ev);
    const snap = makeSnapper(group, movers.flatMap((m) => m.b.corners));
    const onMove = (me: PointerEvent) => {
      const cur = toComp(me);
      // Snap in world space, then convert to each layer's parent space so
      // parented layers track the pointer. One history step per tick.
      const dw = snap([cur[0] - start[0], cur[1] - start[1]], me.altKey);
      const apply = () => movers.forEach((m) => {
        const d = m.b.toParent(dw);
        state.setPropertyBase<V2>(m.id, 'position', [m.startPos[0] + d[0], m.startPos[1] + d[1]]);
      });
      if (movers.length > 1) state.batch(apply, 'Move'); else apply();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setGuides(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onBackdropDown = (ev: React.PointerEvent) => {
    const p = toComp(ev);
    const hit = pickLayerAt(project, time, p);
    if (ev.shiftKey || ev.metaKey || ev.ctrlKey) {
      // Shift / ⌘-click adds or removes a layer from the selection.
      if (hit) useV1.getState().toggleSelect(hit);
      return;
    }
    if (hit) {
      // Clicking a layer that's already part of a multi-selection keeps the
      // selection so the whole group can be dragged.
      if (!selectionOf(useV1.getState()).includes(hit)) selectLayer(hit);
      // One-gesture click-and-drag like Figma / After Effects.
      dragBodyOf(hit, ev);
    } else {
      selectLayer(null);
    }
  };

  const beginDrag = (kind: HandleKind) => (ev: React.PointerEvent) => {
    if (!layer || !box || layer.locked) return;
    ev.stopPropagation();
    ev.preventDefault();
    if (kind === 'body') {
      // Body drags share the (multi-select aware) path above.
      if (ev.shiftKey || ev.metaKey || ev.ctrlKey) { useV1.getState().toggleSelect(layer.id); return; }
      dragBodyOf(layer.id, ev);
      return;
    }
    (ev.target as Element).setPointerCapture(ev.pointerId);

    const start = toComp(ev);
    const startScale: V2 = [...box.scale];
    const startSizeW: V2 =
      (layer.type === 'rectangle' || layer.type === 'ellipse') ? [...box.local] : [0, 0];
    const startRot = box.rotation;
    const center: V2 = [...box.center];
    // The pivot for scale handles is the opposite corner / edge. In world
    // space, computed once at drag start so the layer scales toward the user,
    // not toward a moving target.
    let pivot: V2 | null = null;
    const [tl, tr, br, bl] = box.corners;
    switch (kind) {
      case 'br': pivot = tl; break;
      case 'tl': pivot = br; break;
      case 'tr': pivot = bl; break;
      case 'bl': pivot = tr; break;
      case 't': pivot = [(bl[0] + br[0]) / 2, (bl[1] + br[1]) / 2]; break;
      case 'b': pivot = [(tl[0] + tr[0]) / 2, (tl[1] + tr[1]) / 2]; break;
      case 'l': pivot = [(tr[0] + br[0]) / 2, (tr[1] + br[1]) / 2]; break;
      case 'r': pivot = [(tl[0] + bl[0]) / 2, (tl[1] + bl[1]) / 2]; break;
    }

    const onMove = (me: PointerEvent) => {
      const cur = toComp(me);

      if (kind === 'rot') {
        const a0 = Math.atan2(start[1] - center[1], start[0] - center[0]);
        const a1 = Math.atan2(cur[1] - center[1], cur[0] - center[0]);
        const delta = ((a1 - a0) * 180) / Math.PI;
        const next = startRot + delta;
        setPropertyBase<number>(layer.id, 'rotation', Math.round(next * 10) / 10);
      } else if (pivot) {
        // Scale is the ratio of (current→pivot) / (start→pivot).
        const d0 = mag(sub(start, pivot));
        const d1 = mag(sub(cur, pivot));
        if (d0 < 0.001) return;
        const ratio = d1 / d0;
        // Shape layers scale their size prop so the bounding box tracks the
        // actual geometry (no cumulative scale distortion). Media / text /
        // image layers scale via transform.scale.
        if ((layer.type === 'rectangle' || layer.type === 'ellipse') &&
            (kind === 'tl' || kind === 'tr' || kind === 'br' || kind === 'bl')) {
          const w = Math.max(1, startSizeW[0] * ratio);
          const h = Math.max(1, startSizeW[1] * ratio);
          setPropertyBase<V2>(layer.id, 'size', [w, h]);
        } else {
          const uni = kind === 't' || kind === 'b' || kind === 'l' || kind === 'r' ? ratio : ratio;
          const sx = kind === 't' || kind === 'b' ? startScale[0] : startScale[0] * uni;
          const sy = kind === 'l' || kind === 'r' ? startScale[1] : startScale[1] * uni;
          setPropertyBase<V2>(layer.id, 'scale', [sx, sy]);
        }
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setGuides(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    void patchLayer;
  };

  if (!layer || !box || layer.locked) {
    // Still render the picker so clicks on the canvas can pick a layer even
    // when nothing is selected (or a locked / null layer is selected).
    return (
      <>
        <svg
          ref={svgRef}
          className="v1-canvas-handles"
          viewBox={`0 0 ${comp.width} ${comp.height}`}
          preserveAspectRatio="none"
          onContextMenu={onContext}
        >
          <rect
            x={0}
            y={0}
            width={comp.width}
            height={comp.height}
            className="v1-sel-picker"
            onPointerDown={onBackdropDown}
          />
          {nullMarks}
          {guides?.gx != null && <line className="v1-guide" x1={guides.gx} y1={0} x2={guides.gx} y2={comp.height} />}
          {guides?.gy != null && <line className="v1-guide" x1={0} y1={guides.gy} x2={comp.width} y2={guides.gy} />}
        </svg>
        <ContextMenu
          anchor={menu ? { x: menu.x, y: menu.y } : null}
          onClose={() => setMenu(null)}
          items={menu ? (menu.layerId ? layerMenu(menu.layerId) : addLayerMenu()) : []}
        />
      </>
    );
  }

  const [tl, tr, br, bl] = box.corners;
  const edgeMid = (a: V2, b: V2): V2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const tM = edgeMid(tl, tr);
  const rM = edgeMid(tr, br);
  const bM = edgeMid(br, bl);
  const lM = edgeMid(bl, tl);
  const rotPivot: V2 = [tM[0] - (box.center[0] - tM[0]) * 0.12, tM[1] - (box.center[1] - tM[1]) * 0.12];

  const hs = Math.max(8, Math.min(comp.width, comp.height) * 0.012);

  return (
    <>
    <svg
      ref={svgRef}
      className="v1-canvas-handles"
      viewBox={`0 0 ${comp.width} ${comp.height}`}
      preserveAspectRatio="none"
      onContextMenu={onContext}
    >
      {/* Backdrop: picks a different layer or deselects on click outside the
          selected layer's body / handles. Placed FIRST so SVG hit-testing
          falls through to it only when nothing on top caught the click. */}
      <rect
        x={0}
        y={0}
        width={comp.width}
        height={comp.height}
        className="v1-sel-picker"
        onPointerDown={onBackdropDown}
      />
      {nullMarks}
      {guides?.gx != null && <line className="v1-guide" x1={guides.gx} y1={0} x2={guides.gx} y2={comp.height} />}
      {guides?.gy != null && <line className="v1-guide" x1={0} y1={guides.gy} x2={comp.width} y2={guides.gy} />}
      {/* Other selected layers: outline + drag area (moves the whole group). */}
      {selection.filter((id) => id !== layer.id).map((id) => {
        const l2 = project.layers.find((x) => x.id === id);
        const b2 = l2 && worldCorners(l2, time, project.assets, project.layers);
        if (!b2) return null;
        const pts = b2.corners.map((c) => c.join(',')).join(' ');
        return (
          <g key={id}>
            <polygon className="v1-sel-outline secondary" points={pts} />
            <polygon className="v1-sel-body" points={pts} onPointerDown={(e) => {
              e.stopPropagation();
              if (e.shiftKey || e.metaKey || e.ctrlKey) { useV1.getState().toggleSelect(id); return; }
              dragBodyOf(id, e);
            }} />
          </g>
        );
      })}
      {/* Selection outline */}
      <polygon
        className="v1-sel-outline"
        points={`${tl.join(',')} ${tr.join(',')} ${br.join(',')} ${bl.join(',')}`}
      />
      {/* Hit area to drag the layer by its body (filled transparent) */}
      <polygon
        className="v1-sel-body"
        points={`${tl.join(',')} ${tr.join(',')} ${br.join(',')} ${bl.join(',')}`}
        onPointerDown={beginDrag('body')}
      />
      {/* Rotation stem */}
      <line
        x1={tM[0]} y1={tM[1]}
        x2={rotPivot[0]} y2={rotPivot[1]}
        className="v1-sel-rot-line"
      />
      {/* Edge handles */}
      {([
        ['t', tM], ['r', rM], ['b', bM], ['l', lM],
      ] as Array<[HandleKind, V2]>).map(([k, p]) => (
        <rect
          key={k}
          x={p[0] - hs / 2}
          y={p[1] - hs / 2}
          width={hs}
          height={hs}
          className="v1-sel-handle v1-sel-edge"
          onPointerDown={beginDrag(k)}
        />
      ))}
      {/* Corner handles */}
      {([
        ['tl', tl], ['tr', tr], ['br', br], ['bl', bl],
      ] as Array<[HandleKind, V2]>).map(([k, p]) => (
        <rect
          key={k}
          x={p[0] - hs / 2}
          y={p[1] - hs / 2}
          width={hs}
          height={hs}
          className="v1-sel-handle v1-sel-corner"
          onPointerDown={beginDrag(k)}
        />
      ))}
      {/* Rotation handle */}
      <circle
        cx={rotPivot[0]}
        cy={rotPivot[1]}
        r={hs * 0.7}
        className="v1-sel-handle v1-sel-rot"
        onPointerDown={beginDrag('rot')}
      />
    </svg>
    <ContextMenu
      anchor={menu ? { x: menu.x, y: menu.y } : null}
      onClose={() => setMenu(null)}
      items={menu ? (menu.layerId ? layerMenu(menu.layerId) : addLayerMenu()) : []}
    />
    </>
  );
}

