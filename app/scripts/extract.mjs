// Нарезка плоского SVG-экспорта из Figma на отдельные объекты.
// Фигуры (path/rect/line) копируются как есть: ни путь, ни цвет не меняются.
// Объект = связная группа фигур, чьи габариты пересекаются (с небольшим зазором).
//
// node scripts/extract.mjs "<src.svg>" <outDir> <prefix>
import fs from 'node:fs';
import path from 'node:path';
import { svgPathBbox } from 'svg-path-bbox';

const [, , src, outDir, prefix = 'L'] = process.argv;
const svg = fs.readFileSync(src, 'utf8');

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
};
const num = (v, d = 0) => (v == null ? d : parseFloat(v));

// Все рисуемые элементы по порядку (порядок = z-порядок, сохраняем его)
const defsStart = svg.indexOf('<defs>');
const body = defsStart > 0 ? svg.slice(0, defsStart) : svg;
const tags = [...body.matchAll(/<(path|rect|line)\b[^>]*\/>/g)].map((m, i) => ({ i, kind: m[1], tag: m[0] }));

function bbox(el) {
  const { kind, tag } = el;
  let tx = 0, ty = 0;
  const tr = attr(tag, 'transform');
  if (tr) {
    const m = tr.match(/translate\(([-\d.]+)[ ,]+([-\d.]+)\)/);
    if (m) { tx = +m[1]; ty = +m[2]; }
  }
  const sw = num(attr(tag, 'stroke-width'), attr(tag, 'stroke') ? 1 : 0) / 2;
  let b;
  if (kind === 'path') b = svgPathBbox(attr(tag, 'd'));
  else if (kind === 'rect') {
    const x = num(attr(tag, 'x')), y = num(attr(tag, 'y'));
    b = [x, y, x + num(attr(tag, 'width')), y + num(attr(tag, 'height'))];
  } else {
    const x1 = num(attr(tag, 'x1')), y1 = num(attr(tag, 'y1')), x2 = num(attr(tag, 'x2')), y2 = num(attr(tag, 'y2'));
    b = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  }
  return [b[0] + tx - sw, b[1] + ty - sw, b[2] + tx + sw, b[3] + ty + sw];
}
for (const el of tags) el.b = bbox(el);

// Пропускаем рамку фрейма (первые 2 фигуры на весь холст)
const W = num(attr(svg.match(/<svg[^>]*>/)[0], 'width'));
const items = tags.filter((e) => !(e.b[2] - e.b[0] > W * 0.9));

// --- Фоны: квадраты 1000×1000 (rect с translate) и всё внутри них
const bgRects = items.filter((e) => e.kind === 'rect' && attr(e.tag, 'transform') && e.b[2] - e.b[0] > 300 && Math.abs((e.b[2] - e.b[0]) - (e.b[3] - e.b[1])) < 5);
const inside = (b, r) => (b[0] + b[2]) / 2 > r[0] && (b[0] + b[2]) / 2 < r[2] && (b[1] + b[3]) / 2 > r[1] && (b[1] + b[3]) / 2 < r[3];
const used = new Set();
const backgrounds = bgRects.map((r, k) => {
  const els = items.filter((e) => inside(e.b, r.b));
  els.forEach((e) => used.add(e.i));
  return { id: `${prefix}-bg-${k + 1}`, rect: r.b, els };
});

// --- Палитры: прямоугольники-образцы 500×158
const swatches = items.filter((e) => e.kind === 'rect' && !attr(e.tag, 'transform') && Math.abs((e.b[2] - e.b[0]) / (e.b[3] - e.b[1]) - 3.16) < 0.1);
swatches.forEach((e) => used.add(e.i));

// --- Объекты: кластеризация по пересечению габаритов
const GAP = 3;
const rest = items.filter((e) => !used.has(e.i));
const parent = rest.map((_, k) => k);
const find = (k) => (parent[k] === k ? k : (parent[k] = find(parent[k])));
const hit = (a, b) => a[0] <= b[2] + GAP && b[0] <= a[2] + GAP && a[1] <= b[3] + GAP && b[1] <= a[3] + GAP;
for (let a = 0; a < rest.length; a++)
  for (let b = a + 1; b < rest.length; b++)
    if (hit(rest[a].b, rest[b].b)) parent[find(a)] = find(b);
const groups = new Map();
rest.forEach((e, k) => {
  const r = find(k);
  if (!groups.has(r)) groups.set(r, []);
  groups.get(r).push(e);
});

// Слишком крупный кластер = два соседних предмета, чьи габариты задели друг друга
// (например, плечо лампы и тень книги). Делим его по горизонтальной «полосе» —
// строке сетки — в которой лежит центр каждой фигуры.
// Пересобираем крупный кластер со всё более строгим порогом пересечения,
// пока он не распадётся на предметы разумного размера.
function recluster(els, gap) {
  const par = els.map((_, k) => k);
  const f = (k) => (par[k] === k ? k : (par[k] = f(par[k])));
  const h = (a, b) => a[0] <= b[2] + gap && b[0] <= a[2] + gap && a[1] <= b[3] + gap && b[1] <= a[3] + gap;
  for (let a = 0; a < els.length; a++) for (let b = a + 1; b < els.length; b++) if (h(els[a].b, els[b].b)) par[f(a)] = f(b);
  const m = new Map();
  els.forEach((e, k) => { const r = f(k); if (!m.has(r)) m.set(r, []); m.get(r).push(e); });
  return [...m.values()];
}
function splitByRows(els) {
  for (let gap = -5; gap >= -200; gap -= 5) {
    const parts = recluster(els, gap).filter((p) => p.length > 0);
    const big = parts.filter((p) => p.length >= 3);
    if (big.length >= 2) {
      // мелочь из распада возвращаем к ближайшему крупному
      const small = parts.filter((p) => p.length < 3).flat();
      for (const e of small) {
        const c = [(e.b[0] + e.b[2]) / 2, (e.b[1] + e.b[3]) / 2];
        let best = big[0], d = Infinity;
        for (const p of big) { const u = union(p); const dd = Math.max(u[0] - c[0], 0, c[0] - u[2]) + Math.max(u[1] - c[1], 0, c[1] - u[3]); if (dd < d) { d = dd; best = p; } }
        best.push(e);
      }
      return big;
    }
  }
  return [els];
}
for (const [key, els] of [...groups]) {
  const u = union(els);
  if (u[2] - u[0] > W * 0.35) {
    groups.delete(key);
    splitByRows(els).forEach((part, n) => groups.set(`${key}-${n}`, part));
  }
}
// крошечные осколки (точки-блики) приклеиваем к ближайшему объекту
for (const [key, els] of [...groups]) {
  const u = union(els);
  if ((u[2] - u[0]) * (u[3] - u[1]) > 400) continue;
  let near = null, dist = Infinity;
  for (const [k2, e2] of groups) {
    if (k2 === key) continue;
    const v = union(e2);
    const dx = Math.max(v[0] - u[2], 0, u[0] - v[2]), dy = Math.max(v[1] - u[3], 0, u[1] - v[3]);
    if (dx + dy < dist) { dist = dx + dy; near = k2; }
  }
  if (near != null && dist < 80) { groups.get(near).push(...els); groups.delete(key); }
}

function union(els) { return els.reduce((u, e) => [Math.min(u[0], e.b[0]), Math.min(u[1], e.b[1]), Math.max(u[2], e.b[2]), Math.max(u[3], e.b[3])], [Infinity, Infinity, -Infinity, -Infinity]); }
const _unused = (els) => els.reduce((u, e) => [Math.min(u[0], e.b[0]), Math.min(u[1], e.b[1]), Math.max(u[2], e.b[2]), Math.max(u[3], e.b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
// Объекты — в порядке чтения: по строкам, затем слева направо
let objects = [...groups.values()].map((els) => ({ els: els.sort((a, b) => a.i - b.i), b: union(els) }));
objects = objects.filter((o) => !(o.els.length === 1 && o.b[3] - o.b[1] < 100 && (o.b[2] - o.b[0]) / (o.b[3] - o.b[1]) > 4));
objects.sort((p, q) => (Math.abs(p.b[1] - q.b[1]) < 150 ? p.b[0] - q.b[0] : p.b[1] - q.b[1]));

fs.mkdirSync(outDir, { recursive: true });
const PAD = 2;
function write(id, els, b, extraDefs = '') {
  const x = Math.floor(b[0] - PAD), y = Math.floor(b[1] - PAD);
  const w = Math.ceil(b[2] + PAD) - x, h = Math.ceil(b[3] + PAD) - y;
  const out = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" fill="none">\n${extraDefs}${els.map((e) => e.tag).join('\n')}\n</svg>\n`;
  fs.writeFileSync(path.join(outDir, `${id}.svg`), out);
  return { id, file: `${id}.svg`, width: w, height: h, origin: [x, y], paths: els.length };
}

const manifest = { source: path.basename(src), backgrounds: [], objects: [], palettes: [] };
for (const bg of backgrounds) {
  // фон обрезается по своему квадрату (как в исходнике)
  const [x0, y0, x1, y1] = bg.rect;
  const clipId = `${bg.id}-clip`;
  const els = bg.els;
  const x = Math.round(x0), y = Math.round(y0), w = Math.round(x1 - x0), h = Math.round(y1 - y0);
  const out = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" fill="none">\n<defs><clipPath id="${clipId}"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}"/></clipPath></defs>\n<g clip-path="url(#${clipId})">\n${els.map((e) => e.tag).join('\n')}\n</g>\n</svg>\n`;
  fs.writeFileSync(path.join(outDir, `${bg.id}.svg`), out);
  manifest.backgrounds.push({ id: bg.id, file: `${bg.id}.svg`, width: w, height: h, paths: els.length, fill: attr(els[0].tag, 'fill') });
  void x; void y;
}

// палитры: колонки по 2 (фон | объекты), 4 строки
const cols = new Map();
for (const s of swatches) {
  const key = Math.round(s.b[0] / 20);
  if (!cols.has(key)) cols.set(key, []);
  cols.get(key).push(s);
}
const colList = [...cols.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.sort((a, b) => a.b[1] - b.b[1]).map((s) => attr(s.tag, 'fill').toUpperCase().replace('WHITE', '#FFFFFF')));
for (let k = 0; k + 1 < colList.length; k += 2) {
  manifest.palettes.push({ id: `palette-${k / 2 + 1}`, background: colList[k], objects: colList[k + 1] });
}

objects.forEach((o, k) => manifest.objects.push({ ...write(`${prefix}-obj-${String(k + 1).padStart(2, '0')}`, o.els, o.b), bbox: o.b.map((v) => Math.round(v)) }));
fs.writeFileSync(path.join(outDir, `manifest.raw.json`), JSON.stringify(manifest, null, 2));
console.log(`backgrounds ${manifest.backgrounds.length}, palettes ${manifest.palettes.length}, objects ${manifest.objects.length}`);
