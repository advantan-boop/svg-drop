import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from './components/Canvas';
import { parsePalette } from './lib/color';
import { compose, uid } from './lib/compose';
import { addCustomObject, assetKey, getAsset, loadIndex, preload, resolveAsset } from './lib/library';
import { pickByMetaphor, pickByNames } from './lib/match';
import { download, paletteOf, sceneToSvg, type Ctx } from './lib/render';
import { FORMATS, LAYOUTS, type Layer, type Layout, type LibObject, type LibraryIndex, type Palette, type Scene, type Size, type Variant } from './lib/types';
import { useHistory } from './lib/useHistory';

const LS_KEY = 'svgdrop.v1';
const store = {
  get<T>(k: string): T | null {
    try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
  },
  set(k: string, v: unknown) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ }
  },
};

interface Variation { seed: number; layout: Layout; scene: Scene }
type Mode = 'metaphor' | 'names';

const EMPTY: Scene = { format: FORMATS[0], size: 'L', paletteId: 'palette-2', backdrop: null, layers: [] };

export default function App() {
  const [index, setIndex] = useState<LibraryIndex | null>(null);
  const [customObjects, setCustomObjects] = useState<LibObject[]>([]);
  const [customPalettes, setCustomPalettes] = useState<Palette[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const idx = await loadIndex();
        await preload(idx);
        // восстанавливаем загруженные пользователем SVG и палитры
        const saved = store.get<{ name: string; svg: string }[]>(`${LS_KEY}.objects`) ?? [];
        const restored: LibObject[] = [];
        for (const s of saved) try { restored.push(Object.assign(addCustomObject(s.name, s.svg), { svgText: s.svg })); } catch { /* битый файл */ }
        setCustomObjects(restored);
        setCustomPalettes(store.get<Palette[]>(`${LS_KEY}.palettes`) ?? []);
        setIndex(idx);
      } catch (e) {
        setError(`Не удалось загрузить библиотеку: ${e instanceof Error ? e.message : e}`);
      }
    })();
  }, []);

  if (error) return <div className="loading">{error}</div>;
  if (!index) return <div className="loading">Загружаю библиотеку…</div>;
  return (
    <Editor
      index={index}
      customObjects={customObjects}
      setCustomObjects={setCustomObjects}
      customPalettes={customPalettes}
      setCustomPalettes={setCustomPalettes}
    />
  );
}

function Editor(props: {
  index: LibraryIndex;
  customObjects: LibObject[];
  setCustomObjects: React.Dispatch<React.SetStateAction<LibObject[]>>;
  customPalettes: Palette[];
  setCustomPalettes: React.Dispatch<React.SetStateAction<Palette[]>>;
}) {
  const { index, customObjects, setCustomObjects, customPalettes, setCustomPalettes } = props;
  const ctx: Ctx = useMemo(() => {
    const all = [...index.objects, ...customObjects];
    return { index, objects: new Map(all.map((o) => [o.id, o])), palettes: [...index.palettes, ...customPalettes] };
  }, [index, customObjects, customPalettes]);

  const { state: scene, set: setScene, undo, redo } = useHistory<Scene>(store.get<Scene>(`${LS_KEY}.scene`) ?? EMPTY);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('metaphor');
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState<Layout>('assembled');
  const [decor, setDecor] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [variations, setVariations] = useState<Variation[]>([]);
  const [ai, setAi] = useState<{ ai: boolean; model?: string; reason?: string }>({ ai: false });
  const [libTab, setLibTab] = useState<Variant>('main');
  const [libSearch, setLibSearch] = useState('');
  const [paletteText, setPaletteText] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => { store.set(`${LS_KEY}.scene`, scene); }, [scene]);
  useEffect(() => { fetch('/api/status').then((r) => r.json()).then(setAi).catch(() => setAi({ ai: false, reason: 'сервер без API' })); }, []);
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2200); };

  const objects = [...ctx.objects.values()];
  const sel = scene.layers.find((l) => l.uid === selected) ?? null;
  const palette = paletteOf(ctx, scene.paletteId);

  const setLayers = useCallback((layers: Layer[], commit = true) => setScene((s) => ({ ...s, layers }), commit), [setScene]);
  const patchLayer = (uidv: string, patch: Partial<Layer>, commit = true) =>
    setLayers(scene.layers.map((l) => (l.uid === uidv ? { ...l, ...patch } : l)), commit);

  // ---------- Генерация ----------
  const buildVariations = (ids: string[], base: Partial<Scene> = {}, preferLayout?: Layout) => {
    const next: Scene = { ...scene, ...base };
    const layouts: Layout[] = preferLayout ? [preferLayout, preferLayout, ...LAYOUTS.map((l) => l.id).filter((l) => l !== preferLayout)] : [layout, layout, ...LAYOUTS.map((l) => l.id).filter((l) => l !== layout)];
    const vars = layouts.slice(0, 4).map((lay, i) => {
      const seed = Math.floor(Math.random() * 1e9) + i;
      return { seed, layout: lay, scene: { ...next, layers: compose({ ctx, objectIds: ids, size: next.size, format: next.format, layout: lay, seed, decor }) } };
    });
    setVariations(vars);
    setScene(vars[0].scene);
    setLayout(vars[0].layout);
    setSelected(null);
  };

  const generate = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setNote('');
    try {
      if (mode === 'names') {
        const r = pickByNames(query, objects);
        if (!r.ids.length) { setNote(`Не нашёл таких компонентов. Есть: ${objects.map((o) => o.name.toLowerCase()).join(', ')}.`); return; }
        setPicked(r.ids);
        setNote(r.reason || `Компоненты: ${r.ids.map((id) => ctx.objects.get(id)!.name).join(', ')}.`);
        buildVariations(r.ids);
        return;
      }
      if (ai.ai) {
        const res = await fetch('/api/pick', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: query, extra: customObjects.map((o) => ({ id: o.id, name: o.name, tags: o.tags })) }),
        });
        if (res.ok) {
          const r = await res.json();
          if (r.objects?.length) {
            setPicked(r.objects);
            setNote(`AI (${r.model}): ${r.reason}`);
            buildVariations(r.objects, { paletteId: r.palette ?? scene.paletteId }, r.layout);
            return;
          }
        }
      }
      const r = pickByMetaphor(query, objects);
      setPicked(r.ids);
      setNote(`${ai.ai ? 'AI недоступен, подбор по тегам. ' : ''}${r.reason}`);
      buildVariations(r.ids);
    } finally {
      setBusy(false);
    }
  };

  const reshuffle = () => {
    const ids = picked.length ? picked : [...new Set(scene.layers.filter((l) => l.variant === 'main').map((l) => l.objectId))];
    if (ids.length) buildVariations(ids);
  };

  // ---------- Редактирование ----------
  const addObject = (id: string, variant: Variant, x?: number, y?: number) => {
    const o = ctx.objects.get(id)!;
    const a = resolveAsset(o, variant, scene.size);
    if (!a) return;
    const { w, h } = scene.format;
    // масштаб — как у уже стоящих объектов, чтобы пропорции между предметами сохранялись
    const ref = scene.layers.find((l) => l.variant === 'main');
    const refAsset = ref && resolveAsset(ctx.objects.get(ref.objectId)!, ref.variant, scene.size);
    const k = ref && refAsset ? ref.width / refAsset.vb[2] : Math.min((w * 0.35) / a.vb[2], (h * 0.5) / a.vb[3]);
    const layer: Layer = { uid: uid(), objectId: id, variant, x: x ?? w / 2, y: y ?? h / 2, width: a.vb[2] * k, rotation: 0, flip: false };
    setLayers([...scene.layers, layer]);
    setSelected(layer.uid);
  };

  const duplicate = (l: Layer) => {
    const copy = { ...l, uid: uid(), x: l.x + 30, y: l.y + 30 };
    const i = scene.layers.indexOf(l);
    setLayers([...scene.layers.slice(0, i + 1), copy, ...scene.layers.slice(i + 1)]);
    setSelected(copy.uid);
  };
  const remove = (l: Layer) => { setLayers(scene.layers.filter((x) => x.uid !== l.uid)); setSelected(null); };
  const move = (l: Layer, dir: 'up' | 'down' | 'top' | 'bottom') => {
    const arr = scene.layers.filter((x) => x.uid !== l.uid);
    const i = scene.layers.indexOf(l);
    const at = dir === 'top' ? arr.length : dir === 'bottom' ? 0 : Math.max(0, Math.min(arr.length, i + (dir === 'up' ? 1 : -1)));
    arr.splice(at, 0, l);
    setLayers(arr);
  };

  // горячие клавиши
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (!sel) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(sel); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(sel); }
    else if (e.key === ']') move(sel, 'up');
    else if (e.key === '[') move(sel, 'down');
    else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[e.key]!;
      patchLayer(sel.uid, { x: sel.x + d[0], y: sel.y + d[1] });
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ---------- Загрузки ----------
  const uploadSvgs = async (files: FileList | null) => {
    if (!files) return;
    const added: LibObject[] = [];
    const saved = store.get<{ name: string; svg: string }[]>(`${LS_KEY}.objects`) ?? [];
    for (const f of [...files]) {
      try {
        const text = await f.text();
        added.push(addCustomObject(f.name, text));
        saved.push({ name: f.name, svg: text });
      } catch (e) {
        flash(`${f.name}: ${e instanceof Error ? e.message : 'ошибка'}`);
      }
    }
    store.set(`${LS_KEY}.objects`, saved);
    setCustomObjects((c) => [...c, ...added]);
    if (added.length) flash(`Добавлено в библиотеку: ${added.length}`);
  };

  const addPalette = (text: string, name?: string) => {
    const p = parsePalette(text, name);
    if (!p) { flash('Не нашёл цветов: нужны HEX-коды или JSON {background, objects}'); return; }
    const next = [...customPalettes, p];
    setCustomPalettes(next);
    store.set(`${LS_KEY}.palettes`, next);
    setScene((s) => ({ ...s, paletteId: p.id }));
    setPaletteText('');
    flash(`Палитра «${p.name}» применена`);
  };

  const editPaletteColor = (role: 'background' | 'objects', i: number, color: string, commit: boolean) => {
    let p = palette;
    if (!p.custom) {
      // заводская палитра не меняется — создаём редактируемую копию
      p = { ...p, id: `custom-${Date.now().toString(36)}`, name: `${p.name} (изм.)`, custom: true, background: [...p.background], objects: [...p.objects] };
      setScene((s) => ({ ...s, paletteId: p.id }));
    }
    const np = { ...p, [role]: p[role].map((c, j) => (j === i ? color.toUpperCase() : c)) };
    const next = [...customPalettes.filter((x) => x.id !== np.id), np];
    setCustomPalettes(next);
    if (commit) store.set(`${LS_KEY}.palettes`, next);
  };

  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__svgdrop = () => sceneToSvg(ctx, scene);

  const exportSvg = () => {
    const name = (query.trim() || 'composition').slice(0, 40).replace(/[^\p{L}\p{N}]+/gu, '-');
    download(`${name}-${scene.format.w}x${scene.format.h}.svg`, sceneToSvg(ctx, scene, { title: query || undefined }));
  };
  const copySvg = async () => {
    try {
      await navigator.clipboard.writeText(sceneToSvg(ctx, scene));
      flash('SVG скопирован — вставьте в Figma (⌘V), слои останутся векторными');
    } catch {
      flash('Буфер обмена недоступен — используйте «Скачать SVG»');
    }
  };

  const libItems = objects.filter((o) => {
    if (libTab === 'background' && !o.variants.background[scene.size] && !o.custom) return false;
    if (libTab === 'background' && o.custom) return false;
    const q = libSearch.trim().toLowerCase();
    return !q || o.name.toLowerCase().includes(q) || o.tags.some((t) => t.includes(q));
  });

  const thumb = (o: LibObject, v: Variant) => {
    const a = getAsset(assetKey(o.id, v, 'S')) ?? resolveAsset(o, v, 'S');
    if (!a) return null;
    return <svg viewBox={a.vb.join(' ')} dangerouslySetInnerHTML={{ __html: a.markup }} />;
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo">◆</span> SVG-drop
          <span className={`badge ${ai.ai ? 'on' : ''}`} title={ai.reason || ai.model}>{ai.ai ? `AI: ${ai.model}` : 'подбор по тегам'}</span>
        </div>
        <form className="prompt" onSubmit={(e) => { e.preventDefault(); generate(); }}>
          <div className="seg">
            <button type="button" className={mode === 'metaphor' ? 'on' : ''} onClick={() => setMode('metaphor')}>Метафора</button>
            <button type="button" className={mode === 'names' ? 'on' : ''} onClick={() => setMode('names')}>Компоненты</button>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === 'metaphor' ? 'Заголовок или метафора: «Как накопить на мечту», «Учёба по вечерам»…' : 'Через запятую: книга, лампа, ручка'}
          />
          <button className="primary" disabled={busy || !query.trim()}>{busy ? 'Собираю…' : 'Собрать'}</button>
        </form>
        <div className="actions">
          <button onClick={undo} title="Отменить (⌘Z)">↶</button>
          <button onClick={redo} title="Повторить (⇧⌘Z)">↷</button>
          <button onClick={copySvg} title="Скопировать SVG для вставки в Figma">Копировать</button>
          <button className="primary" onClick={exportSvg} disabled={!scene.layers.length}>Скачать SVG</button>
        </div>
      </header>

      {(note || variations.length > 0) && (
        <div className="variants">
          {note && <p className="note">{note}</p>}
          <div className="strip">
            {variations.map((v, i) => (
              <button
                key={v.seed}
                className="variant"
                onClick={() => { setScene(v.scene); setLayout(v.layout); setSelected(null); }}
                title={LAYOUTS.find((l) => l.id === v.layout)!.name}
              >
                <span dangerouslySetInnerHTML={{ __html: sceneToSvg(ctx, v.scene) }} />
                <small>{i + 1}. {LAYOUTS.find((l) => l.id === v.layout)!.name}</small>
              </button>
            ))}
            {variations.length > 0 && <button className="variant more" onClick={reshuffle}>↻<small>Ещё варианты</small></button>}
          </div>
        </div>
      )}

      <main className="work">
        <aside className="panel lib">
          <div className="panel-head">
            <h2>Библиотека</h2>
            <label className="upload">
              + SVG
              <input type="file" accept=".svg,image/svg+xml" multiple onChange={(e) => { uploadSvgs(e.target.files); e.target.value = ''; }} />
            </label>
          </div>
          <div className="seg small">
            <button className={libTab === 'main' ? 'on' : ''} onClick={() => setLibTab('main')}>Главные</button>
            <button className={libTab === 'background' ? 'on' : ''} onClick={() => setLibTab('background')}>Фоновые</button>
          </div>
          <input className="search" placeholder="Поиск по названию и тегам" value={libSearch} onChange={(e) => setLibSearch(e.target.value)} />
          <div className="grid">
            {libItems.map((o) => (
              <button
                key={o.id}
                className="tile"
                draggable
                onDragStart={(e) => e.dataTransfer.setData('application/x-svgdrop', JSON.stringify({ id: o.id, variant: libTab }))}
                onClick={() => addObject(o.id, libTab)}
                title={`${o.name} — нажмите или перетащите на холст`}
              >
                {thumb(o, libTab)}
                <span>{o.name}{o.custom ? ' ·моё' : ''}</span>
              </button>
            ))}
          </div>
          <p className="hint">Объекты вставляются без изменений: те же векторные пути, меняется только расположение и цвет по палитре.</p>
        </aside>

        <section className="stage">
          <div className="stage-inner">
          <div className="frame" style={{ '--ratio': scene.format.w / scene.format.h } as React.CSSProperties}>
            <Canvas
              ctx={ctx}
              scene={scene}
              selected={selected}
              onSelect={setSelected}
              onChange={(layers, commit) => setLayers(layers, commit)}
              onDropObject={(id, v, x, y) => addObject(id, v, x, y)}
            />
            {!scene.layers.length && (
              <div className="empty">
                <b>Опишите идею сверху</b> — сервис подберёт предметы и соберёт композицию.<br />
                Или перетащите объекты из библиотеки.
                <div className="examples">
                  {['Финансовая грамотность', 'Учёба по вечерам', 'Подарок к 8 марта', 'Безопасные платежи'].map((t) => (
                    <button key={t} onClick={() => { setMode('metaphor'); setQuery(t); }}>{t}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          </div>
          <p className="kbd">Перетаскивание — двигать · уголки — масштаб · кружок — поворот (⇧ шаг 15°) · ⌫ удалить · ⌘D дублировать · [ ] порядок</p>
        </section>

        <aside className="panel props">
          <h2>Композиция</h2>
          <label>Формат
            <select value={scene.format.id} onChange={(e) => {
              const f = FORMATS.find((x) => x.id === e.target.value)!;
              const ids = [...new Set(scene.layers.filter((l) => l.variant === 'main').map((l) => l.objectId))];
              const next = { ...scene, format: f };
              setScene(ids.length ? { ...next, layers: compose({ ctx, objectIds: ids, size: scene.size, format: f, layout, seed: Date.now(), decor }) } : next);
              setVariations([]);
            }}>
              {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          <div className="row">
            <span>Детализация</span>
            <div className="seg small">
              {(['L', 'S'] as Size[]).map((s) => (
                <button key={s} className={scene.size === s ? 'on' : ''} title={s === 'L' ? 'Подробные объекты — для больших форматов' : 'Упрощённые объекты — для мелких размеров'} onClick={() => setScene({ ...scene, size: s })}>{s}</button>
              ))}
            </div>
          </div>
          <div className="row">
            <span>Раскладка</span>
            <select value={layout} onChange={(e) => {
              const lay = e.target.value as Layout;
              setLayout(lay);
              const ids = [...new Set(scene.layers.filter((l) => l.variant === 'main').map((l) => l.objectId))];
              if (ids.length) setScene({ ...scene, layers: compose({ ctx, objectIds: ids, size: scene.size, format: scene.format, layout: lay, seed: Date.now(), decor }) });
            }}>
              {LAYOUTS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <label className="check"><input type="checkbox" checked={decor} onChange={(e) => setDecor(e.target.checked)} /> Фоновые объекты при сборке</label>
          <div className="row">
            <span>Фон</span>
            <select value={scene.backdrop ?? ''} onChange={(e) => setScene({ ...scene, backdrop: e.target.value || null })}>
              <option value="">Однотонный</option>
              {index.backgrounds.map((b, i) => <option key={b.id} value={b.id}>Декор {i + 1}</option>)}
            </select>
          </div>

          <h3>Палитра</h3>
          <div className="palettes">
            {ctx.palettes.map((p) => (
              <button key={p.id} className={`pal ${p.id === scene.paletteId ? 'on' : ''}`} onClick={() => setScene({ ...scene, paletteId: p.id })} title={p.name}>
                {[...p.background.slice(0, 3), ...p.objects.slice(0, 3)].map((c, i) => <i key={i} style={{ background: c }} />)}
                <small>{p.name}</small>
              </button>
            ))}
          </div>
          <div className="roles">
            {(['background', 'objects'] as const).map((role) => (
              <div key={role}>
                <small>{role === 'background' ? 'Фон и тени' : 'Акценты'}</small>
                {palette[role].slice(0, 3).map((c, i) => (
                  <input key={i} type="color" value={c.toLowerCase()} onChange={(e) => editPaletteColor(role, i, e.target.value, false)} onBlur={(e) => editPaletteColor(role, i, e.target.value, true)} />
                ))}
              </div>
            ))}
          </div>
          <div className="palette-load">
            <textarea rows={2} placeholder="3 цвета фона, затем 3 акцента: #FDD7B9 #FAC896 #D27532 #F9ECB0 #80DADA #BEEBEB" value={paletteText} onChange={(e) => setPaletteText(e.target.value)} />
            <div className="row">
              <button onClick={() => addPalette(paletteText)} disabled={!paletteText.trim()}>Применить</button>
              <label className="upload">Файл палитры<input type="file" accept=".json,.txt,.css" onChange={async (e) => { const f = e.target.files?.[0]; if (f) addPalette(await f.text(), f.name.replace(/\.\w+$/, '')); e.target.value = ''; }} /></label>
            </div>
          </div>

          {sel ? (
            <>
              <h3>Объект: {ctx.objects.get(sel.objectId)?.name}</h3>
              <div className="fields">
                <label>X<input type="number" value={Math.round(sel.x)} onChange={(e) => patchLayer(sel.uid, { x: +e.target.value })} /></label>
                <label>Y<input type="number" value={Math.round(sel.y)} onChange={(e) => patchLayer(sel.uid, { y: +e.target.value })} /></label>
                <label>Ширина<input type="number" value={Math.round(sel.width)} onChange={(e) => patchLayer(sel.uid, { width: Math.max(8, +e.target.value) })} /></label>
                <label>Угол<input type="number" value={Math.round(sel.rotation)} onChange={(e) => patchLayer(sel.uid, { rotation: +e.target.value })} /></label>
              </div>
              <input type="range" min={-180} max={180} value={sel.rotation} onChange={(e) => patchLayer(sel.uid, { rotation: +e.target.value }, false)} onPointerUp={() => setLayers(scene.layers)} />
              <div className="btns">
                <button onClick={() => patchLayer(sel.uid, { flip: !sel.flip })}>⇋ Отразить</button>
                <button onClick={() => patchLayer(sel.uid, { variant: sel.variant === 'main' ? 'background' : 'main' })} disabled={!ctx.objects.get(sel.objectId)?.variants.background[scene.size]}>{sel.variant === 'main' ? 'В фоновый' : 'В главный'}</button>
                <button onClick={() => duplicate(sel)}>Дублировать</button>
                <button onClick={() => move(sel, 'top')}>Наверх</button>
                <button onClick={() => move(sel, 'bottom')}>Вниз</button>
                <button className="danger" onClick={() => remove(sel)}>Удалить</button>
              </div>
            </>
          ) : null}

          <h3>Слои <small>{scene.layers.length}</small></h3>
          <ol className="layers">
            {[...scene.layers].reverse().map((l) => (
              <li key={l.uid} className={l.uid === selected ? 'on' : ''} onClick={() => setSelected(l.uid)}>
                <button className="eye" onClick={(e) => { e.stopPropagation(); patchLayer(l.uid, { hidden: !l.hidden }); }} title="Показать/скрыть">{l.hidden ? '○' : '●'}</button>
                <span>{ctx.objects.get(l.objectId)?.name ?? l.objectId}{l.variant === 'background' ? ' · фон' : ''}</span>
                <button onClick={(e) => { e.stopPropagation(); move(l, 'up'); }} title="Выше">↑</button>
                <button onClick={(e) => { e.stopPropagation(); move(l, 'down'); }} title="Ниже">↓</button>
              </li>
            ))}
          </ol>
          {scene.layers.length > 0 && <button className="ghost" onClick={() => { setScene({ ...scene, layers: [] }); setVariations([]); setNote(''); }}>Очистить холст</button>}
        </aside>
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
