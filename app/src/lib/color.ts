import type { Palette } from './types';

/**
 * Перекраска по ролям. Все объекты библиотеки нарисованы в палитре-источнике
 * (первая палитра из Figma). Каждому её цвету соответствует роль
 * (фон-светлый, фон-средний, фон-тёмный, акцент 1..3), и при смене палитры
 * цвет заменяется на цвет той же роли. Так работает и Figma-плагин из ТЗ.
 * Геометрия не меняется — меняются только значения fill/stroke.
 */
export function buildColorMap(from: Palette, to: Palette): Map<string, string> {
  const map = new Map<string, string>();
  const put = (a: string, b: string) => {
    const k = norm(a);
    if (k && !map.has(k)) map.set(k, b.toUpperCase());
  };
  // роли 0..2: фоновые оттенки и акценты; 3-я позиция (контур/белый) — общая
  from.background.forEach((c, i) => to.background[i] && put(c, to.background[i]));
  from.objects.forEach((c, i) => to.objects[i] && put(c, to.objects[i]));
  // тождественные пары не нужны
  for (const [k, v] of [...map]) if (k === v) map.delete(k);
  return map;
}

export function norm(c: string): string {
  const s = c.trim().toUpperCase();
  if (s === 'WHITE') return '#FFFFFF';
  if (s === 'BLACK') return '#000000';
  if (/^#[0-9A-F]{3}$/.test(s)) return '#' + [...s.slice(1)].map((x) => x + x).join('');
  return /^#[0-9A-F]{6}$/.test(s) ? s : '';
}

const ATTR_RE = /\b(fill|stroke|stop-color)="([^"]+)"/g;

export function recolor(markup: string, map: Map<string, string>): string {
  if (!map.size) return markup;
  return markup.replace(ATTR_RE, (m, attr, val) => {
    const to = map.get(norm(val));
    return to ? `${attr}="${to}"` : m;
  });
}

/** Палитра из списка HEX-кодов (вставка текстом / .txt / .json) */
export function parsePalette(text: string, name = 'Своя палитра'): Palette | null {
  let colors: string[] = [];
  try {
    const j = JSON.parse(text);
    if (j && Array.isArray(j.background) && Array.isArray(j.objects)) {
      return {
        id: `custom-${Date.now().toString(36)}`,
        name: j.name || name,
        background: fill4(j.background.map(norm).filter(Boolean), '#181817'),
        objects: fill4(j.objects.map(norm).filter(Boolean), '#FFFFFF'),
        custom: true,
      };
    }
    if (Array.isArray(j)) colors = j.map(String);
  } catch {
    colors = text.match(/#?[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || [];
  }
  colors = colors.map((c) => norm(c.startsWith('#') ? c : '#' + c)).filter(Boolean);
  if (colors.length < 2) return null;
  // Нет явных ролей: сортируем по светлоте. Три самых светлых — фон
  // (от светлого к тёмному), остальные — акценты объектов.
  const byLight = [...new Set(colors)].sort((a, b) => lightness(b) - lightness(a));
  const bg = byLight.length >= 6 ? [byLight[0], byLight[2], byLight[4]] : byLight.slice(0, 3);
  const rest = byLight.filter((c) => !bg.includes(c));
  return {
    id: `custom-${Date.now().toString(36)}`,
    name,
    background: fill4(bg, '#181817'),
    objects: fill4(rest.length ? rest : bg, '#FFFFFF'),
    custom: true,
  };
}

function fill4(arr: string[], last: string) {
  const out = arr.slice(0, 3);
  while (out.length < 3) out.push(out[out.length - 1] || last);
  out.push(last);
  return out;
}

export function lightness(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
