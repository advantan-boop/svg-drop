import { resolveAsset } from './library';
import type { Ctx } from './render';
import type { Format, Layer, Layout, Size } from './types';

/** Детерминированный ГСЧ: один seed — одна и та же композиция */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const uid = () => Math.random().toString(36).slice(2, 10);

interface Box { cx: number; cy: number; w: number; h: number }

/**
 * Изометрические предметы занимают ромб внутри своего прямоугольника,
 * поэтому для проверки пересечений используем «сжатый» прямоугольник —
 * так предметы могут касаться и чуть заходить друг на друга, как в примерах.
 */
const core = (b: Box, k = 0.72): Box => ({ ...b, w: b.w * k, h: b.h * k });

function overlap(a: Box, b: Box) {
  const x = Math.min(a.cx + a.w / 2, b.cx + b.w / 2) - Math.max(a.cx - a.w / 2, b.cx - b.w / 2);
  const y = Math.min(a.cy + a.h / 2, b.cy + b.h / 2) - Math.max(a.cy - a.h / 2, b.cy - b.h / 2);
  return x > 0 && y > 0 ? x * y : 0;
}

function bounds(bs: Box[]) {
  const x0 = Math.min(...bs.map((b) => b.cx - b.w / 2)), x1 = Math.max(...bs.map((b) => b.cx + b.w / 2));
  const y0 = Math.min(...bs.map((b) => b.cy - b.h / 2)), y1 = Math.max(...bs.map((b) => b.cy + b.h / 2));
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/** Область кадра, в которую вписывается кластер предметов */
export function regionFor(layout: Layout, f: Format) {
  const { w, h } = f;
  const tall = h > w * 1.1;
  switch (layout) {
    case 'offset':
      // кластер сдвинут к краю и чуть выходит за кадр — как «Со смещением» в Figma
      return tall
        ? { x: w * 0.12, y: h * 0.36, w: w * 1.0, h: h * 0.7 }
        : { x: w * 0.34, y: h * 0.06, w: w * 0.78, h: h * 0.98 };
    case 'headline':
      // свободное место под заголовок слева сверху
      return tall
        ? { x: w * 0.06, y: h * 0.42, w: w * 0.88, h: h * 0.52 }
        : { x: w * 0.44, y: h * 0.2, w: w * 0.52, h: h * 0.74 };
    default:
      return { x: w * 0.07, y: h * 0.08, w: w * 0.86, h: h * 0.84 };
  }
}

export interface ComposeInput {
  ctx: Ctx;
  objectIds: string[];
  size: Size;
  format: Format;
  layout: Layout;
  seed: number;
  /** добавить монохромные «фоновые объекты» вокруг кластера */
  decor: boolean;
}

export function compose({ ctx, objectIds, size, format, layout, seed, decor }: ComposeInput): Layer[] {
  const rand = rng(seed);
  const items = objectIds
    .map((id) => ctx.objects.get(id))
    .filter((o): o is NonNullable<typeof o> => !!o)
    .map((o) => {
      const a = resolveAsset(o, 'main', size)!;
      return { o, w: a.vb[2], h: a.vb[3] };
    })
    .filter((it) => it.w > 0);
  if (!items.length) return [];

  // Главный объект — самый «тяжёлый»; остальные — в порядке релевантности
  const heroIdx = items.reduce((best, it, i) => (it.o.weight > items[best].o.weight ? i : best), 0);
  const ordered = [items[heroIdx], ...items.filter((_, i) => i !== heroIdx)];

  const region = regionFor(layout, format);
  const targetAspect = region.w / region.h;

  type Placed = Box & { it: (typeof items)[number]; on?: number };
  const placed: Placed[] = [];
  const unit = Math.sqrt(ordered.reduce((s, it) => s + it.w * it.h, 0) / ordered.length);

  for (const it of ordered) {
    if (!placed.length) {
      placed.push({ cx: 0, cy: 0, w: it.w, h: it.h, it });
      continue;
    }
    // Небольшой предмет можно положить сверху на «поверхность» (телефон на книгу)
    const surfaceIdx = placed.findIndex(
      (p) => p.it.o.kind === 'surface' && p.on === undefined && !placed.some((q) => q.on === placed.indexOf(p)),
    );
    if (it.o.kind === 'item' && surfaceIdx >= 0) {
      const s = placed[surfaceIdx];
      if (it.w < s.w * 0.62 && it.h < s.h * 0.75 && rand() < 0.55) {
        placed.push({ cx: s.cx + (rand() - 0.5) * s.w * 0.2, cy: s.cy - s.h * 0.12, w: it.w, h: it.h, it, on: surfaceIdx });
        continue;
      }
    }
    // Иначе — ищем ближайшее свободное место вдоль изометрических направлений
    const angles = [30, 150, 210, 330, 90, 270, 0, 180].map((a) => ((a + (rand() - 0.5) * 24) * Math.PI) / 180);
    let best: { b: Box; score: number } | null = null;
    for (const ang of angles) {
      const c = bounds(placed);
      const ox = (c.x0 + c.x1) / 2, oy = (c.y0 + c.y1) / 2;
      for (let d = unit * 0.2; d < unit * 6; d += unit * 0.08) {
        const b: Box = { cx: ox + Math.cos(ang) * d, cy: oy + Math.sin(ang) * d, w: it.w, h: it.h };
        const free = placed.every((p) => overlap(core(b), core(p)) < Math.min(b.w * b.h, p.w * p.h) * 0.04);
        if (!free) continue;
        const nb = bounds([...placed, b]);
        const aspectPenalty = Math.abs(Math.log(nb.w / nb.h / targetAspect));
        const score = d / unit + aspectPenalty * 2.2 + rand() * 0.35;
        if (!best || score < best.score) best = { b, score };
        break;
      }
    }
    placed.push({ ...(best?.b ?? { cx: unit * placed.length, cy: 0, w: it.w, h: it.h }), it });
  }

  // Вписываем кластер в область макета единым масштабом — пропорции предметов сохраняются
  const bb = bounds(placed);
  const k = Math.min(region.w / bb.w, region.h / bb.h);
  const tx = region.x + region.w / 2 - ((bb.x0 + bb.x1) / 2) * k;
  const ty = region.y + region.h / 2 - ((bb.y0 + bb.y1) / 2) * k;

  // Порядок слоёв: что ниже на картинке — то ближе к зрителю; лежащее сверху — над опорой
  const depth = (p: Placed): number => (p.on !== undefined ? depth(placed[p.on]) + 0.001 : p.cy + p.h / 2);
  const layers: Layer[] = [...placed]
    .sort((a, b) => depth(a) - depth(b))
    .map((p) => ({
      uid: uid(),
      objectId: p.it.o.id,
      variant: 'main',
      x: p.cx * k + tx,
      y: p.cy * k + ty,
      width: p.w * k,
      rotation: 0,
      flip: false,
    }));

  if (decor) layers.unshift(...decorLayers(ctx, size, format, layers, k, rand, objectIds));
  return layers;
}

/** Монохромные фоновые объекты в свободных местах кадра — второй план */
function decorLayers(ctx: Ctx, size: Size, format: Format, main: Layer[], k: number, rand: () => number, used: string[]): Layer[] {
  const pool = [...ctx.objects.values()].filter((o) => !o.custom && o.variants.background[size]);
  const fresh = pool.filter((o) => !used.includes(o.id));
  const source = (fresh.length >= 2 ? fresh : pool).sort(() => rand() - 0.5);
  const boxes: Box[] = main.map((l) => {
    const o = ctx.objects.get(l.objectId)!;
    const a = resolveAsset(o, l.variant, size)!;
    return { cx: l.x, cy: l.y, w: l.width, h: (l.width * a.vb[3]) / a.vb[2] };
  });
  const out: Layer[] = [];
  const count = 2 + Math.floor(rand() * 2);
  for (const o of source) {
    if (out.length >= count) break;
    const a = resolveAsset(o, 'background', size)!;
    const s = k * (0.5 + rand() * 0.2);
    const w = a.vb[2] * s, h = a.vb[3] * s;
    for (let tries = 0; tries < 60; tries++) {
      const b: Box = { cx: w * 0.3 + rand() * (format.w - w * 0.6), cy: h * 0.3 + rand() * (format.h - h * 0.6), w, h };
      if (boxes.every((x) => overlap(b, x) === 0)) {
        boxes.push(b);
        out.push({ uid: uid(), objectId: o.id, variant: 'background', x: b.cx, y: b.cy, width: w, rotation: 0, flip: false });
        break;
      }
    }
  }
  return out.sort((a, b) => a.y - b.y);
}
