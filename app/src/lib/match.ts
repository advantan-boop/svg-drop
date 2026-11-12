import type { LibObject } from './types';

/**
 * Локальный подбор объектов (работает без AI):
 * токенизация → грубый стемминг русских слов → совпадение с тегами объектов.
 */
const STOP = new Set(['и', 'в', 'на', 'с', 'со', 'для', 'по', 'как', 'о', 'об', 'от', 'до', 'за', 'из', 'к', 'не', 'а', 'the', 'a', 'of', 'and', 'for', 'to', 'in']);

export function tokens(text: string) {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Отрезаем окончание: «книги», «книгой», «книжный» → «книг»/«книж» */
export function stem(t: string) {
  if (t.length <= 4) return t;
  return t.replace(/(ами|ями|ого|его|ому|ему|ыми|ими|ах|ях|ов|ев|ей|ой|ий|ый|ая|яя|ое|ее|ые|ие|ую|юю|ом|ем|ам|ям|ть|ешь|ет|ут|ют|ит|ат|ят|а|я|ы|и|е|у|ю|о|ь)$/, '');
}

function score(o: LibObject, qs: string[]) {
  const tagStems = [...o.tags, o.name].flatMap(tokens).map(stem);
  let s = 0;
  for (const q of qs) {
    let best = 0;
    for (const t of tagStems) {
      if (t === q) best = Math.max(best, 3);
      else if (q.length >= 4 && t.length >= 4 && (t.startsWith(q) || q.startsWith(t))) best = Math.max(best, 2);
      else if (q.length >= 5 && t.length >= 5 && t.slice(0, 5) === q.slice(0, 5)) best = Math.max(best, 1);
    }
    s += best;
  }
  return s;
}

/** Тематические группы — чтобы дополнить композицию уместными предметами */
const GROUPS: string[][] = [
  ['book', 'lamp', 'pen', 'folder', 'headphones'], // учёба / рабочее место
  ['coin', 'wallet', 'phone', 'folder', 'pen'], // финансы
  ['vase', 'book', 'headphones', 'lamp', 'phone'], // дом / отдых
  ['folder', 'pen', 'lamp', 'phone', 'puzzle'], // работа / офис
  ['phone', 'headphones', 'puzzle', 'coin', 'wallet'], // цифровые сервисы
];

export interface Pick { ids: string[]; matched: string[]; reason: string }

/** Сценарий 1: метафора или заголовок → набор объектов */
export function pickByMetaphor(text: string, objects: LibObject[], want = 4): Pick {
  const qs = tokens(text).map(stem);
  const ranked = objects
    .map((o) => ({ o, s: score(o, qs) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  const matched = ranked.map((x) => x.o.id);
  const ids = matched.slice(0, want);
  if (ids.length < 3) {
    // дополняем из самой близкой тематической группы
    const group =
      [...GROUPS].sort((a, b) => b.filter((x) => ids.includes(x)).length - a.filter((x) => ids.includes(x)).length)[0] ?? GROUPS[0];
    for (const id of group) if (ids.length < 3 && !ids.includes(id) && objects.some((o) => o.id === id)) ids.push(id);
  }
  const names = (list: string[]) => list.map((id) => objects.find((o) => o.id === id)?.name.toLowerCase()).join(', ');
  const reason = matched.length
    ? `По словам запроса подходят: ${names(matched.slice(0, want))}${ids.length > matched.length ? `; добавлено для баланса: ${names(ids.filter((i) => !matched.includes(i)))}` : ''}.`
    : `Прямых совпадений нет — собрана нейтральная сцена: ${names(ids)}.`;
  return { ids, matched, reason };
}

/** Сценарий 2: перечисление компонентов → объекты в указанном порядке */
export function pickByNames(text: string, objects: LibObject[]): Pick & { unknown: string[] } {
  const parts = text.split(/[,;\n+]|\sи\s/).map((p) => p.trim()).filter(Boolean);
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const part of parts) {
    const qs = tokens(part).map(stem);
    const best = objects.map((o) => ({ o, s: score(o, qs) + (o.id === part.toLowerCase() ? 5 : 0) })).sort((a, b) => b.s - a.s)[0];
    if (best && best.s >= 2) ids.push(best.o.id);
    else unknown.push(part);
  }
  return { ids, matched: ids, unknown, reason: unknown.length ? `Не нашёл в библиотеке: ${unknown.join(', ')}.` : '' };
}
