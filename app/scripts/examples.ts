// Генерирует примеры композиций тем же кодом, что и приложение.
// npx tsx scripts/examples.ts
import fs from 'node:fs';
import path from 'node:path';

// Минимальный DOMParser для Node: библиотеке нужен только корневой <svg>
class MiniParser {
  parseFromString(text: string) {
    const open = text.match(/<svg\b[^>]*>/)!;
    const inner = text.slice(open.index! + open[0].length, text.lastIndexOf('</svg>'));
    const attr = (n: string) => open[0].match(new RegExp(`\\s${n}="([^"]*)"`))?.[1] ?? null;
    return { documentElement: { nodeName: 'svg', getAttribute: attr, innerHTML: inner }, querySelector: () => null };
  }
}
(globalThis as Record<string, unknown>).DOMParser = MiniParser;

const root = path.resolve(import.meta.dirname, '..');
const lib = path.join(root, 'public/library');
(globalThis as Record<string, unknown>).fetch = async (url: string) => {
  const file = path.join(lib, url.replace(/^.*library\//, ''));
  const text = fs.readFileSync(file, 'utf8');
  return { text: async () => text, json: async () => JSON.parse(text) };
};

const { loadIndex, preload } = await import('../src/lib/library');
const { compose } = await import('../src/lib/compose');
const { pickByMetaphor } = await import('../src/lib/match');
const { sceneToSvg } = await import('../src/lib/render');
const { FORMATS } = await import('../src/lib/types');

const index = await loadIndex();
await preload(index);
const ctx = { index, objects: new Map(index.objects.map((o) => [o.id, o])), palettes: index.palettes };

const examples = [
  { title: 'Как накопить на мечту', palette: 'palette-2', layout: 'assembled', format: 'og', seed: 7 },
  { title: 'Учёба по вечерам', palette: 'palette-1', layout: 'offset', format: 'og', seed: 3 },
  { title: 'Подарок к 8 марта', palette: 'palette-3', layout: 'headline', format: 'square', seed: 11 },
] as const;

const out = path.resolve(root, '../examples');
fs.mkdirSync(out, { recursive: true });
for (const [i, ex] of examples.entries()) {
  const pick = pickByMetaphor(ex.title, index.objects);
  const format = FORMATS.find((f) => f.id === ex.format)!;
  const scene = {
    format, size: 'L' as const, paletteId: ex.palette, backdrop: null,
    layers: compose({ ctx, objectIds: pick.ids, size: 'L', format, layout: ex.layout, seed: ex.seed, decor: true }),
  };
  const file = path.join(out, `${i + 1}-${ex.layout}-${format.w}x${format.h}.svg`);
  fs.writeFileSync(file, sceneToSvg(ctx, scene, { title: ex.title }));
  console.log(`${path.basename(file)}: «${ex.title}» → ${pick.ids.join(', ')}`);
}
