import type { Asset, FileRef, LibObject, LibraryIndex, Size, Variant } from './types';

const BASE = `${import.meta.env?.BASE_URL ?? "/"}library/`;
const cache = new Map<string, Asset>();

/**
 * Разбирает SVG в Asset: берём содержимое корневого <svg> без изменений
 * и его viewBox. Фигуры не трогаем — в композицию попадают те же path.
 */
export function parseSvg(text: string): Asset {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName !== 'svg' || doc.querySelector('parsererror')) throw new Error('Файл не похож на SVG');
  let vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some(isNaN)) {
    const w = parseFloat(svg.getAttribute('width') || '0');
    const h = parseFloat(svg.getAttribute('height') || '0');
    if (!w || !h) throw new Error('У SVG нет viewBox и размеров');
    vb = [0, 0, w, h];
  }
  return { markup: svg.innerHTML, vb: vb as Asset['vb'] };
}

export async function loadIndex(): Promise<LibraryIndex> {
  const r = await fetch(`${BASE}index.json`);
  return r.json();
}

export function assetKey(objectId: string, variant: Variant, size: Size) {
  return `${size}/${objectId}-${variant}`;
}

export function getAsset(key: string) {
  return cache.get(key);
}

export function putAsset(key: string, a: Asset) {
  cache.set(key, a);
}

async function loadFile(key: string, ref: FileRef) {
  if (cache.has(key)) return;
  const text = await (await fetch(BASE + ref.file)).text();
  cache.set(key, parseSvg(text));
}

/** Подгружает все варианты всех объектов и фоны (их немного — ~1.5 МБ) */
export async function preload(index: LibraryIndex) {
  const jobs: Promise<void>[] = [];
  for (const o of index.objects)
    for (const variant of ['main', 'background'] as Variant[])
      for (const size of index.sizes) {
        const ref = o.variants[variant][size];
        if (ref) jobs.push(loadFile(assetKey(o.id, variant, size), ref));
      }
  for (const b of index.backgrounds)
    for (const size of index.sizes) jobs.push(loadFile(`${size}/${b.id}`, b.files[size]));
  await Promise.all(jobs);
}

/**
 * Ищет ассет с фолбэком: если у объекта нет нужного размера/варианта
 * (например, пользовательский SVG есть только в одном виде) — берём то, что есть.
 */
export function resolveAsset(o: LibObject, variant: Variant, size: Size): Asset | undefined {
  const order: [Variant, Size][] = [
    [variant, size],
    [variant, size === 'L' ? 'S' : 'L'],
    ['main', size],
    ['main', size === 'L' ? 'S' : 'L'],
  ];
  for (const [v, s] of order) {
    const a = cache.get(assetKey(o.id, v, s));
    if (a) return a;
  }
  return undefined;
}

/** Пользовательский SVG → объект библиотеки (один и тот же файл для всех размеров) */
export function addCustomObject(name: string, text: string): LibObject {
  const asset = parseSvg(text);
  const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const ref = { file: '', width: asset.vb[2], height: asset.vb[3] };
  for (const s of ['L', 'S'] as Size[]) cache.set(assetKey(id, 'main', s), asset);
  const clean = name.replace(/\.svg$/i, '');
  return {
    id,
    name: clean,
    kind: 'item',
    weight: 2,
    tags: clean.toLowerCase().split(/[\s_\-.,]+/).filter(Boolean),
    variants: { main: { L: ref, S: ref }, background: {} },
    custom: true,
  };
}
