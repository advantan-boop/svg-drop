import { useMemo, useRef } from 'react';
import { buildColorMap } from '../lib/color';
import { backdropMarkup, layerAsset, layerHeight, layerMarkup, layerTransform, paletteOf, sourcePalette, type Ctx } from '../lib/render';
import type { Layer, Scene } from '../lib/types';

interface Props {
  ctx: Ctx;
  scene: Scene;
  selected: string | null;
  onSelect: (uid: string | null) => void;
  onChange: (layers: Layer[], commit: boolean) => void;
  onDropObject: (objectId: string, variant: Layer['variant'], x: number, y: number) => void;
}

type Drag =
  | { mode: 'move'; uid: string; dx: number; dy: number }
  | { mode: 'scale'; uid: string; cx: number; cy: number; d0: number; w0: number }
  | { mode: 'rotate'; uid: string; cx: number; cy: number; a0: number; r0: number };

export function Canvas({ ctx, scene, selected, onSelect, onChange, onDropObject }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const moved = useRef(false);
  const { w, h } = scene.format;

  const map = useMemo(() => buildColorMap(sourcePalette(ctx), paletteOf(ctx, scene.paletteId)), [ctx, scene.paletteId]);
  const backdrop = useMemo(() => backdropMarkup(ctx, scene), [ctx, scene.paletteId, scene.backdrop, scene.format, scene.size]); // eslint-disable-line react-hooks/exhaustive-deps

  const pt = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!;
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const m = svg.getScreenCTM();
    return m ? p.matrixTransform(m.inverse()) : p;
  };

  const update = (uid: string, patch: Partial<Layer>, commit: boolean) =>
    onChange(scene.layers.map((l) => (l.uid === uid ? { ...l, ...patch } : l)), commit);

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    moved.current = true;
    const p = pt(e);
    if (d.mode === 'move') update(d.uid, { x: p.x - d.dx, y: p.y - d.dy }, false);
    else if (d.mode === 'scale') {
      const dist = Math.hypot(p.x - d.cx, p.y - d.cy);
      update(d.uid, { width: Math.max(12, (d.w0 * dist) / d.d0) }, false);
    } else {
      const a = (Math.atan2(p.y - d.cy, p.x - d.cx) * 180) / Math.PI;
      let r = d.r0 + a - d.a0;
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      update(d.uid, { rotation: ((r % 360) + 540) % 360 - 180 }, false);
    }
  };

  const endDrag = () => {
    if (drag.current && moved.current) onChange(scene.layers, true);
    drag.current = null;
    moved.current = false;
  };

  const startMove = (e: React.PointerEvent, l: Layer) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    onSelect(l.uid);
    const p = pt(e);
    drag.current = { mode: 'move', uid: l.uid, dx: p.x - l.x, dy: p.y - l.y };
  };

  // невидимая зона клика по габаритам: у изометрических предметов много «дыр»
  const hitRect = (l: Layer) => {
    const a = layerAsset(ctx, scene, l);
    if (!a) return null;
    return <rect x={a.vb[0]} y={a.vb[1]} width={a.vb[2]} height={a.vb[3]} fill="transparent" transform={layerTransform(a, l)} />;
  };

  const sel = scene.layers.find((l) => l.uid === selected && !l.hidden);
  const selAsset = sel && layerAsset(ctx, scene, sel);
  const handle = Math.max(w, h) / 90;

  return (
    <svg
      ref={svgRef}
      className="canvas"
      viewBox={`0 0 ${w} ${h}`}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onPointerDown={() => onSelect(null)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const data = e.dataTransfer.getData('application/x-svgdrop');
        if (!data) return;
        const { id, variant } = JSON.parse(data);
        const p = pt(e);
        onDropObject(id, variant, p.x, p.y);
      }}
    >
      <defs>
        <clipPath id="frame">
          <rect width={w} height={h} />
        </clipPath>
      </defs>
      <g clipPath="url(#frame)">
        <g dangerouslySetInnerHTML={{ __html: backdrop }} />
        {scene.layers.map((l) =>
          l.hidden ? null : (
            <LayerView key={l.uid} html={layerMarkup(ctx, scene, l, map)} hit={hitRect(l)} onPointerDown={(e) => startMove(e, l)} />
          ),
        )}
      </g>
      {sel && selAsset && (
        <g transform={`translate(${sel.x} ${sel.y}) rotate(${sel.rotation})`} className="selection">
          <rect
            x={-sel.width / 2}
            y={-layerHeight(selAsset, sel) / 2}
            width={sel.width}
            height={layerHeight(selAsset, sel)}
            vectorEffect="non-scaling-stroke"
          />
          <line x1={0} y1={-layerHeight(selAsset, sel) / 2} x2={0} y2={-layerHeight(selAsset, sel) / 2 - handle * 3} vectorEffect="non-scaling-stroke" />
          <circle
            className="handle rotate"
            cx={0}
            cy={-layerHeight(selAsset, sel) / 2 - handle * 3}
            r={handle * 0.9}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
              const p = pt(e);
              drag.current = { mode: 'rotate', uid: sel.uid, cx: sel.x, cy: sel.y, a0: (Math.atan2(p.y - sel.y, p.x - sel.x) * 180) / Math.PI, r0: sel.rotation };
            }}
          />
          {[
            [1, 1],
            [-1, 1],
            [1, -1],
            [-1, -1],
          ].map(([sx, sy]) => (
            <rect
              key={`${sx}${sy}`}
              className="handle scale"
              x={(sx * sel.width) / 2 - handle / 2}
              y={(sy * layerHeight(selAsset, sel)) / 2 - handle / 2}
              width={handle}
              height={handle}
              onPointerDown={(e) => {
                e.stopPropagation();
                (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                const p = pt(e);
                drag.current = { mode: 'scale', uid: sel.uid, cx: sel.x, cy: sel.y, d0: Math.max(1, Math.hypot(p.x - sel.x, p.y - sel.y)), w0: sel.width };
              }}
            />
          ))}
        </g>
      )}
    </svg>
  );
}

function LayerView({ html, hit, onPointerDown }: { html: string; hit: React.ReactNode; onPointerDown: (e: React.PointerEvent) => void }) {
  // layerMarkup возвращает <g transform>…</g>; вставляем его как есть
  return (
    <g className="layer" onPointerDown={onPointerDown}>
      {hit}
      <g dangerouslySetInnerHTML={{ __html: html }} />
    </g>
  );
}
