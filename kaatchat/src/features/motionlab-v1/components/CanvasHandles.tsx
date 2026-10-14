import { useCallback, useRef } from 'react';
import { useV1 } from '../store';
import { pickLayerAt, worldCorners } from '../engine/bbox';
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
  const setPropertyBase = useV1((s) => s.setPropertyBase);
  const patchLayer = useV1((s) => s.patchLayer);
  const svgRef = useRef<SVGSVGElement>(null);

  const layer = project.layers.find((l) => l.id === selectedId);
  const comp = project.composition;
  const box = layer ? worldCorners(layer, time, project.assets) : null;
  const selectLayer = useV1((s) => s.selectLayer);

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
    const l = state.project.layers.find((x) => x.id === layerId);
    if (!l || l.locked || l.type === 'null') return;
    const b = worldCorners(l, state.currentTime, state.project.assets);
    if (!b) return;
    (ev.target as Element).setPointerCapture(ev.pointerId);
    const start = toComp(ev);
    const startPos: V2 = [...b.position];
    const onMove = (me: PointerEvent) => {
      const cur = toComp(me);
      state.setPropertyBase<V2>(l.id, 'position', [
        startPos[0] + (cur[0] - start[0]),
        startPos[1] + (cur[1] - start[1]),
      ]);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onBackdropDown = (ev: React.PointerEvent) => {
    const p = toComp(ev);
    const hit = pickLayerAt(project, time, p);
    if (hit) {
      selectLayer(hit);
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
    (ev.target as Element).setPointerCapture(ev.pointerId);

    const start = toComp(ev);
    const startPos: V2 = [...box.position];
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
      const dx = cur[0] - start[0];
      const dy = cur[1] - start[1];

      if (kind === 'body') {
        setPropertyBase<V2>(layer.id, 'position', [startPos[0] + dx, startPos[1] + dy]);
      } else if (kind === 'rot') {
        const a0 = Math.atan2(start[1] - center[1], start[0] - center[0]);
        const a1 = Math.atan2(cur[1] - center[1], cur[0] - center[0]);
        let delta = ((a1 - a0) * 180) / Math.PI;
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
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    void patchLayer;
  };

  if (!layer || !box || layer.locked || layer.type === 'null') {
    // Still render the picker so clicks on the canvas can pick a layer even
    // when nothing is selected (or a locked / null layer is selected).
    return (
      <svg
        ref={svgRef}
        className="v1-canvas-handles"
        viewBox={`0 0 ${comp.width} ${comp.height}`}
        preserveAspectRatio="none"
      >
        <rect
          x={0}
          y={0}
          width={comp.width}
          height={comp.height}
          className="v1-sel-picker"
          onPointerDown={onBackdropDown}
        />
      </svg>
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
    <svg
      ref={svgRef}
      className="v1-canvas-handles"
      viewBox={`0 0 ${comp.width} ${comp.height}`}
      preserveAspectRatio="none"
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
  );
}

