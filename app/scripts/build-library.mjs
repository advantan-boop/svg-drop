// Собирает готовую библиотеку для приложения из результатов extract.mjs:
// public/library/<size>/<id>-<variant>.svg + public/library/index.json
//
// node scripts/build-library.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const extractDir = path.resolve(root, '../extract');
const outDir = path.join(root, 'public/library');

// Порядок объектов в каждом исходнике (по сетке слева направо, сверху вниз).
// Секции: первые 10 — «Главные объекты», следующие 10 — «Фоновые объекты».
const ORDER = {
  L: ['book', 'phone', 'puzzle', 'coin', 'lamp', 'headphones', 'vase', 'wallet', 'folder', 'pen'],
  S: ['book', 'phone', 'puzzle', 'coin', 'headphones', 'lamp', 'vase', 'wallet', 'folder', 'pen'],
};

// Семантика объектов — по ней работает подбор по метафоре без AI
// и по ней же AI получает описание каталога.
const META = {
  book: { name: 'Книга', kind: 'surface', weight: 3, tags: ['книга', 'учёба', 'обучение', 'образование', 'знания', 'чтение', 'курс', 'урок', 'литература', 'история', 'библиотека', 'справочник', 'инструкция', 'гайд', 'школа', 'университет', 'book', 'study', 'learn', 'education', 'knowledge', 'read'] },
  phone: { name: 'Смартфон', kind: 'item', weight: 2, tags: ['телефон', 'смартфон', 'приложение', 'мобильный', 'связь', 'звонок', 'онлайн', 'цифровой', 'сервис', 'интернет', 'уведомление', 'мессенджер', 'игра', 'головоломка', 'phone', 'mobile', 'app', 'online', 'digital'] },
  puzzle: { name: 'Пазл', kind: 'item', weight: 1, tags: ['пазл', 'решение', 'задача', 'команда', 'совместимость', 'интеграция', 'партнёрство', 'сотрудничество', 'стратегия', 'соединение', 'головоломка', 'вместе', 'подбор', 'puzzle', 'solution', 'team', 'match', 'integration'] },
  coin: { name: 'Монета с замком', kind: 'item', weight: 1, tags: ['монета', 'деньги', 'безопасность', 'защита', 'финансы', 'сбережения', 'накопления', 'вклад', 'оплата', 'замок', 'приватность', 'надёжность', 'кэшбэк', 'бонус', 'coin', 'money', 'security', 'savings', 'lock', 'safe'] },
  lamp: { name: 'Настольная лампа', kind: 'tall', weight: 3, tags: ['лампа', 'идея', 'свет', 'вдохновение', 'творчество', 'рабочее место', 'кабинет', 'ночь', 'вечер', 'концентрация', 'озарение', 'работа', 'учёба', 'lamp', 'idea', 'light', 'inspiration', 'workspace'] },
  headphones: { name: 'Наушники', kind: 'item', weight: 2, tags: ['наушники', 'музыка', 'подкаст', 'звук', 'аудио', 'слушать', 'аудиокнига', 'отдых', 'фокус', 'поддержка', 'колл-центр', 'вебинар', 'лекция', 'headphones', 'music', 'audio', 'podcast', 'listen', 'support'] },
  vase: { name: 'Ваза с тюльпанами', kind: 'tall', weight: 2, tags: ['цветы', 'тюльпаны', 'ваза', 'букет', 'подарок', 'праздник', '8 марта', 'весна', 'забота', 'уют', 'дом', 'красота', 'благодарность', 'поздравление', 'flowers', 'gift', 'spring', 'holiday', 'care', 'home'] },
  wallet: { name: 'Кошелёк', kind: 'surface', weight: 2, tags: ['кошелёк', 'деньги', 'финансы', 'покупки', 'бюджет', 'расходы', 'оплата', 'кэшбэк', 'зарплата', 'карта', 'банк', 'шопинг', 'экономия', 'wallet', 'money', 'finance', 'budget', 'payment', 'bank'] },
  folder: { name: 'Папка с документами', kind: 'surface', weight: 3, tags: ['папка', 'документы', 'файлы', 'офис', 'работа', 'архив', 'бумаги', 'отчёт', 'проект', 'организация', 'договор', 'бизнес', 'бухгалтерия', 'налоги', 'folder', 'documents', 'files', 'office', 'work', 'report'] },
  pen: { name: 'Ручка', kind: 'item', weight: 1, tags: ['ручка', 'подпись', 'договор', 'письмо', 'заметки', 'писать', 'контракт', 'учёба', 'экзамен', 'творчество', 'план', 'список', 'pen', 'sign', 'write', 'contract', 'notes'] },
};

fs.rmSync(outDir, { recursive: true, force: true });
const index = { sizes: ['L', 'S'], palettes: [], backgrounds: [], objects: [] };
const objs = new Map(Object.keys(META).map((id) => [id, { id, ...META[id], variants: { main: {}, background: {} } }]));

for (const size of ['L', 'S']) {
  const m = JSON.parse(fs.readFileSync(path.join(extractDir, size, 'manifest.raw.json'), 'utf8'));
  fs.mkdirSync(path.join(outDir, size), { recursive: true });
  if (m.objects.length !== 20) throw new Error(`${size}: ожидалось 20 объектов, найдено ${m.objects.length}`);
  m.objects.forEach((o, k) => {
    const id = ORDER[size][k % 10];
    const variant = k < 10 ? 'main' : 'background';
    const file = `${size}/${id}-${variant}.svg`;
    fs.copyFileSync(path.join(extractDir, size, o.file), path.join(outDir, file));
    objs.get(id).variants[variant][size] = { file, width: o.width, height: o.height };
  });
  // фоны — по цвету заливки сопоставляем с палитрой
  m.backgrounds.forEach((b) => {
    const pal = m.palettes.findIndex((p) => p.background[0].toUpperCase() === b.fill.toUpperCase());
    const file = `${size}/background-${pal + 1}.svg`;
    fs.copyFileSync(path.join(extractDir, size, b.file), path.join(outDir, file));
    let bg = index.backgrounds.find((x) => x.palette === `palette-${pal + 1}`);
    if (!bg) index.backgrounds.push((bg = { id: `background-${pal + 1}`, palette: `palette-${pal + 1}`, files: {} }));
    bg.files[size] = { file, width: b.width, height: b.height };
  });
  if (size === 'L') index.palettes = m.palettes;
}

const NAMES = { 'palette-1': 'Лаванда', 'palette-2': 'Персик', 'palette-3': 'Мята' };
index.palettes = index.palettes.map((p) => ({ ...p, name: NAMES[p.id] }));
index.backgrounds.sort((a, b) => a.id.localeCompare(b.id));
index.objects = [...objs.values()];
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2));
console.log(`library: ${index.objects.length} objects × 2 variants × 2 sizes, ${index.backgrounds.length} backgrounds, ${index.palettes.length} palettes`);
