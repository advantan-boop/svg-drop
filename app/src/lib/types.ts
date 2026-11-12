export type Size = 'L' | 'S';
export type Variant = 'main' | 'background';
export type Layout = 'assembled' | 'offset' | 'headline';

export interface FileRef { file: string; width: number; height: number }

export interface LibObject {
  id: string;
  name: string;
  /** surface — на него можно положить предмет; tall — высокий; item — обычный */
  kind: 'surface' | 'tall' | 'item';
  /** визуальный «вес» для выбора главного объекта композиции */
  weight: number;
  tags: string[];
  variants: Record<Variant, Partial<Record<Size, FileRef>>>;
  /** загружен пользователем */
  custom?: boolean;
  /** для своих SVG: перекрашивать ли под палитру (по умолчанию да) */
  recolor?: boolean;
}

export interface Palette {
  id: string;
  name: string;
  /** [светлый, средний, тёмный, контур] */
  background: string[];
  /** [акцент 1, акцент 2, акцент 3, светлый] */
  objects: string[];
  custom?: boolean;
}

export interface LibraryIndex {
  sizes: Size[];
  palettes: Palette[];
  backgrounds: { id: string; palette: string; files: Record<Size, FileRef> }[];
  objects: LibObject[];
}

/** Разобранный SVG: исходные фигуры как есть + их собственная система координат */
export interface Asset {
  markup: string;
  vb: [number, number, number, number];
}

export interface Layer {
  uid: string;
  objectId: string;
  variant: Variant;
  /** центр объекта в координатах холста */
  x: number;
  y: number;
  /** ширина на холсте; высота следует из пропорций исходника */
  width: number;
  rotation: number;
  flip: boolean;
  hidden?: boolean;
}

export interface Format { id: string; name: string; w: number; h: number }

export interface Scene {
  format: Format;
  size: Size;
  paletteId: string;
  /** null = однотонный фон; иначе id декоративного фона из библиотеки */
  backdrop: string | null;
  layers: Layer[];
}

export const FORMATS: Format[] = [
  { id: 'og', name: 'Обложка 1200×630', w: 1200, h: 630 },
  { id: 'square', name: 'Квадрат 1080×1080', w: 1080, h: 1080 },
  { id: 'story', name: 'Сторис 1080×1920', w: 1080, h: 1920 },
  { id: 'wide', name: 'Баннер 1920×1080', w: 1920, h: 1080 },
  { id: 'post', name: 'Пост 1080×1350', w: 1080, h: 1350 },
];

export const LAYOUTS: { id: Layout; name: string }[] = [
  { id: 'assembled', name: 'Собранно' },
  { id: 'offset', name: 'Со смещением' },
  { id: 'headline', name: 'Под заголовок' },
];
