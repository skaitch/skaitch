import type { IfcEntityBase, ItemsMap } from '../types/ifc.js';

/**
 * Printable sheets (docs/plans/feuilles-pdf.md, lot 4).
 *
 * A sheet is a model item (`type: 'Sheet'`) under the project, like saved sections: it then travels with
 * the model everywhere it already goes (Firestore, `.skaitch`, the desktop library, undo, MCP edits).
 * It has no IFC counterpart: IFC export and patching ignore it, so it lives only in skAItch projects.
 */
export const SHEET_TYPE = 'Sheet';
export const SHEET_IFC_TYPE = 'SkaitchSheet';

export const PAPER_FORMATS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] } as const;
export type PaperFormat = keyof typeof PAPER_FORMATS;
export type Orientation = 'landscape' | 'portrait';
export const SHEET_SCALES = [20, 50, 100, 200] as const;
export type SheetScale = typeof SHEET_SCALES[number];

export interface SheetViewport {
  id: string;
  /** A storey's floor plan, or a section: a saved section item (model-based general section). */
  kind: 'plan' | 'section';
  /** Storey id for a plan, Section item id for a section. */
  sourceId: string;
  scale: SheetScale;
  /** Centre of the view frame on the sheet, in mm from the sheet's top-left corner. */
  position: [number, number];
  /** Model region shown, in metres (plan x/y, or section along/elevation); the whole drawing when absent. */
  crop?: { min: [number, number]; max: [number, number] };
  title?: string;
}

export interface TitleBlock {
  project?: string;
  author?: string;
  date?: string;
  revision?: string;
}

export interface SheetGeom {
  number: string;
  format: PaperFormat;
  orientation: Orientation;
  viewports: SheetViewport[];
  titleBlock: TitleBlock;
}

export interface SheetEntity extends IfcEntityBase {
  type: typeof SHEET_TYPE;
  ifcType: typeof SHEET_IFC_TYPE;
  geom: SheetGeom;
}

export function isSheet(item: unknown): item is SheetEntity {
  return !!item && typeof item === 'object' && (item as { type?: unknown }).type === SHEET_TYPE;
}

export function listSheets(items: ItemsMap): SheetEntity[] {
  return (Object.values(items) as unknown[]).filter(isSheet)
    .sort((a, b) => a.geom.number.localeCompare(b.geom.number, 'fr', { numeric: true }));
}

/** Paper width × height in mm. */
export function sheetPaperSize(geom: Pick<SheetGeom, 'format' | 'orientation'>): { width: number; height: number } {
  const [long, short] = PAPER_FORMATS[geom.format];
  return geom.orientation === 'portrait' ? { width: short, height: long } : { width: long, height: short };
}

/** Next free sheet number in the A101, A102… series. */
export function nextSheetNumber(items: ItemsMap): string {
  const used = new Set(listSheets(items).map((s) => s.geom.number));
  for (let n = 101; ; n++) if (!used.has(`A${n}`)) return `A${n}`;
}

const randomId = () => Math.random().toString(36).slice(2, 10);

/** IFC-style 22-character id; sheets never reach IFC but every model item carries one. */
function globalId(): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  let s = '';
  for (let i = 0; i < 22; i++) s += chars[Math.floor(Math.random() * 64)];
  return s;
}

export function createSheet(items: ItemsMap, options: {
  name?: string; number?: string; format?: PaperFormat; orientation?: Orientation; titleBlock?: TitleBlock; id?: string;
} = {}): SheetEntity {
  const project = Object.values(items).find((i) => i.type === 'Project');
  const number = options.number ?? nextSheetNumber(items);
  const name = options.name?.trim() || `Feuille ${number}`;
  return {
    id: options.id ?? `sheet_${randomId()}`,
    type: SHEET_TYPE,
    ifcType: SHEET_IFC_TYPE,
    name, Name: name,
    GlobalId: globalId(),
    parentId: project?.id ?? null,
    geom: {
      number,
      format: options.format ?? 'A3',
      orientation: options.orientation ?? 'landscape',
      viewports: [],
      titleBlock: { project: project?.name, ...options.titleBlock },
    },
  };
}

/** Adds a view, centred on the sheet unless placed. */
export function addSheetViewport(sheet: SheetEntity, view: Omit<SheetViewport, 'id' | 'position'> & { position?: [number, number]; id?: string }): SheetEntity {
  const { width, height } = sheetPaperSize(sheet.geom);
  const viewport: SheetViewport = { ...view, id: view.id ?? `vp_${randomId()}`, position: view.position ?? [width / 2, height / 2] };
  return { ...sheet, geom: { ...sheet.geom, viewports: [...sheet.geom.viewports, viewport] } };
}

export class SheetError extends Error {}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(finite);
const shortText = (v: unknown, max = 200) => v === undefined || (typeof v === 'string' && v.length <= max);

/** Throws a SheetError naming the first problem; checks references against the model. */
export function validateSheet(sheet: SheetEntity, items: ItemsMap): void {
  const g = sheet.geom as Partial<SheetGeom> | undefined;
  if (!g || typeof g !== 'object') throw new SheetError('Feuille sans définition.');
  if (typeof g.number !== 'string' || !g.number.trim() || g.number.length > 20) throw new SheetError('Numéro de feuille invalide.');
  if (!g.format || !(g.format in PAPER_FORMATS)) throw new SheetError('Format de feuille inconnu (A4 à A0).');
  if (g.orientation !== 'landscape' && g.orientation !== 'portrait') throw new SheetError('Orientation de feuille invalide.');
  if (!g.titleBlock || typeof g.titleBlock !== 'object' || !Object.values(g.titleBlock).every((v) => shortText(v))) throw new SheetError('Cartouche invalide.');
  if (!Array.isArray(g.viewports) || g.viewports.length > 20) throw new SheetError('Vues de la feuille invalides (20 au plus).');
  const { width, height } = sheetPaperSize(g as SheetGeom);
  const ids = new Set<string>();
  for (const v of g.viewports) {
    if (!v || typeof v.id !== 'string' || ids.has(v.id)) throw new SheetError('Identifiant de vue invalide ou en double.');
    ids.add(v.id);
    if (v.kind !== 'plan' && v.kind !== 'section') throw new SheetError('Type de vue inconnu.');
    const source = items[v.sourceId];
    if (v.kind === 'plan' ? source?.type !== 'Storey' : source?.type !== 'Section') {
      throw new SheetError(v.kind === 'plan' ? 'Étage de la vue introuvable.' : 'Coupe de la vue introuvable.');
    }
    if (!(SHEET_SCALES as readonly number[]).includes(v.scale)) throw new SheetError('Échelle de vue invalide (1/20, 1/50, 1/100 ou 1/200).');
    if (!pair(v.position) || v.position[0] < 0 || v.position[1] < 0 || v.position[0] > width || v.position[1] > height) {
      throw new SheetError('Position de vue hors de la feuille.');
    }
    if (v.crop !== undefined && !(pair(v.crop?.min) && pair(v.crop?.max) && v.crop.min[0] < v.crop.max[0] && v.crop.min[1] < v.crop.max[1])) {
      throw new SheetError('Recadrage de vue invalide.');
    }
    if (!shortText(v.title)) throw new SheetError('Titre de vue invalide.');
  }
}

/** Views whose source was deleted from the model are dropped, so a sheet never points at nothing. */
export function pruneSheetViewports(sheet: SheetEntity, items: ItemsMap): SheetEntity {
  const kept = sheet.geom.viewports.filter((v) => items[v.sourceId]?.type === (v.kind === 'plan' ? 'Storey' : 'Section'));
  return kept.length === sheet.geom.viewports.length ? sheet : { ...sheet, geom: { ...sheet.geom, viewports: kept } };
}
