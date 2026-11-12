import { buildColorMap, buildForeignColorMap, colorsIn, recolor } from './color';
import { getAsset, resolveAsset } from './library';
import type { Asset, Layer, LibObject, LibraryIndex, Palette, Scene } from './types';

export interface Ctx {
  index: LibraryIndex;
  objects: Map<string, LibObject>;
  palettes: Palette[];
}

export const sourcePalette = (ctx: Ctx) => ctx.index.palettes[0];
export const paletteOf = (ctx: Ctx, id: string) => ctx.palettes.find((p) => p.id === id) ?? ctx.index.palettes[0];

/** id внутри SVG (clipPath и т.п.) делаем уникальными для каждого экземпляра */
function scopeIds(markup: string, prefix: string) {
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  let out = markup;
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out
      .replace(new RegExp(`id="${esc}"`, 'g'), `id="${prefix}-${id}"`)
      .replace(new RegExp(`url\\(#${esc}\\)`, 'g'), `url(#${prefix}-${id})`)
      .replace(new RegExp(`href="#${esc}"`, 'g'), `href="#${prefix}-${id}"`);
  }
  return out;
}

const foreignCache = new Map<string, Map<string, string>>();
function foreignMap(ctx: Ctx, scene: Scene, id: string, a: Asset) {
  const pal = paletteOf(ctx, scene.paletteId);
  const key = `${id}|${pal.id}|${pal.background.join()}|${pal.objects.join()}`;
  let m = foreignCache.get(key);
  if (!m) foreignCache.set(key, (m = buildForeignColorMap(colorsIn(a.markup), sourcePalette(ctx), pal)));
  return m;
}

export function layerAsset(ctx: Ctx, scene: Scene, l: Layer): Asset | undefined {
  const o = ctx.objects.get(l.objectId);
  return o && resolveAsset(o, l.variant, scene.size);
}

export function layerHeight(a: Asset, l: Layer) {
  return (l.width * a.vb[3]) / a.vb[2];
}

/** transform, переводящий систему координат исходного SVG в позицию слоя */
export function layerTransform(a: Asset, l: Layer) {
  const s = l.width / a.vb[2];
  const cx = a.vb[0] + a.vb[2] / 2, cy = a.vb[1] + a.vb[3] / 2;
  const r = (n: number) => +n.toFixed(3);
  return `translate(${r(l.x)} ${r(l.y)}) rotate(${r(l.rotation)}) scale(${r(l.flip ? -s : s)} ${r(s)}) translate(${r(-cx)} ${r(-cy)})`;
}

export function layerMarkup(ctx: Ctx, scene: Scene, l: Layer, colorMap: Map<string, string>) {
  const a = layerAsset(ctx, scene, l);
  if (!a) return '';
  const o = ctx.objects.get(l.objectId)!;
  // свои SVG: цвета сопоставляются с ролями палитры по близости (если не выключено)
  const body = o.custom
    ? o.recolor === false ? a.markup : recolor(a.markup, foreignMap(ctx, scene, o.id, a))
    : recolor(a.markup, colorMap);
  return `<g data-object="${o.id}" data-variant="${l.variant}" transform="${layerTransform(a, l)}">${scopeIds(body, l.uid)}</g>`;
}

export function backdropMarkup(ctx: Ctx, scene: Scene) {
  const pal = paletteOf(ctx, scene.paletteId);
  const { w, h } = scene.format;
  let out = `<rect width="${w}" height="${h}" fill="${pal.background[0]}"/>`;
  if (scene.backdrop) {
    const bg = ctx.index.backgrounds.find((b) => b.id === scene.backdrop);
    const a = bg && getAsset(`${scene.size}/${bg.id}`);
    if (bg && a) {
      const own = ctx.index.palettes.find((p) => p.id === bg.palette)!;
      const map = buildColorMap(own, pal);
      // декоративный фон растягиваем «cover» по формату
      const s = Math.max(w / a.vb[2], h / a.vb[3]);
      const tx = (w - a.vb[2] * s) / 2 - a.vb[0] * s, ty = (h - a.vb[3] * s) / 2 - a.vb[1] * s;
      out += `<g data-backdrop="${bg.id}" transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(4)})">${scopeIds(recolor(a.markup, map), 'bd')}</g>`;
    }
  }
  return out;
}

/** Полная композиция как самостоятельный SVG-документ (для экспорта и превью) */
export function sceneToSvg(ctx: Ctx, scene: Scene, opts: { title?: string } = {}) {
  const map = buildColorMap(sourcePalette(ctx), paletteOf(ctx, scene.paletteId));
  const { w, h } = scene.format;
  const layers = scene.layers.filter((l) => !l.hidden).map((l) => layerMarkup(ctx, scene, l, map)).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">${opts.title ? `\n<title>${escapeXml(opts.title)}</title>` : ''}
<g id="background">${backdropMarkup(ctx, scene)}</g>
<g id="objects">
${layers}
</g>
</svg>
`;
}

const escapeXml = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

export function download(name: string, text: string, type = 'image/svg+xml') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
