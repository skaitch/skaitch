import { resolveLanguage } from '../data/i18n.js';

/**
 * Default names given to elements created without an explicit name.
 * Only French and English names exist (like catalogue labels): French stays French,
 * every other interface language gets English. Unknown or missing languages fall back to French.
 */
export type NameLang = 'fr' | 'en';

export function nameLang(lang: unknown): NameLang {
  return resolveLanguage(lang) === 'fr' ? 'fr' : 'en';
}

const NAMES = {
  // Created over MCP.
  mcpWall: { fr: 'Mur MCP', en: 'MCP wall' },
  mcpDoor: { fr: 'Porte MCP', en: 'MCP door' },
  mcpWindow: { fr: 'Fenêtre MCP', en: 'MCP window' },
  mcpRoom: { fr: 'Pièce MCP', en: 'MCP room' },
  mcpSlab: { fr: 'Dalle MCP', en: 'MCP slab' },
  mcpDimension: { fr: 'Cotation MCP', en: 'MCP dimension' },
  mcpMarker: { fr: 'Jalon MCP', en: 'MCP marker' },
  mcpFurniture: { fr: 'Meuble MCP', en: 'MCP furniture' },
  // Created from the editor or over MCP.
  section: { fr: 'Coupe', en: 'Section' },
  roof: { fr: 'Toit', en: 'Roof' },
  stair: { fr: 'Escalier', en: 'Stair' },
  wall: { fr: 'Mur', en: 'Wall' },
  room: { fr: 'Pièce', en: 'Room' },
  slab: { fr: 'Dalle', en: 'Slab' },
  furniture: { fr: 'Meuble', en: 'Furniture' },
  column: { fr: 'Poteau', en: 'Column' },
  chimney: { fr: 'Cheminée', en: 'Chimney' },
  newDoor: { fr: 'Nouvelle porte', en: 'New door' },
  newWindow: { fr: 'Nouvelle fenêtre', en: 'New window' },
  newMarker: { fr: 'Nouveau Jalon', en: 'New marker' },
  newBuilding: { fr: 'Nouveau Bâtiment', en: 'New building' },
  building: { fr: 'Bâtiment', en: 'Building' },
} as const satisfies Record<string, Record<NameLang, string>>;

export type DefaultNameKind = keyof typeof NAMES;

export function defaultName(kind: DefaultNameKind, lang?: unknown): string {
  return NAMES[kind][nameLang(lang)];
}

export function storeyName(level: number | string, lang?: unknown): string {
  return `${nameLang(lang) === 'fr' ? 'Étage' : 'Level'} ${level}`;
}

/** Catalogue label in the interface language; custom entries may lack an English label. */
export function catalogueLabel(def: { labelFr: string; labelEn?: string }, lang?: unknown): string {
  return nameLang(lang) === 'fr' ? def.labelFr : def.labelEn || def.labelFr;
}
