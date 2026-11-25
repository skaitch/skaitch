import type { LangType } from '../types/ifc.js';
import frUi from './locales/fr-ui.json' with { type: 'json' };
import de from './locales/de.json' with { type: 'json' };
import es from './locales/es.json' with { type: 'json' };
import pt from './locales/pt.json' with { type: 'json' };
import it from './locales/it.json' with { type: 'json' };
import nl from './locales/nl.json' with { type: 'json' };
import ar from './locales/ar.json' with { type: 'json' };
import zh from './locales/zh.json' with { type: 'json' };
import ja from './locales/ja.json' with { type: 'json' };
import ru from './locales/ru.json' with { type: 'json' };

const frenchUi: Readonly<Record<string, string>> = frUi;

export const LANGUAGES = [
  { code: 'fr', name: 'Français' },
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'pt', name: 'Português' },
  { code: 'it', name: 'Italiano' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'ar', name: 'العربية' },
  { code: 'zh', name: '中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ru', name: 'Русский' },
] as const;

export type I18nKey =
  | 'stair' | 'project' | 'building' | 'storey' | 'room' | 'slab' | 'roof'
  | 'wall' | 'door' | 'window' | 'furniture' | 'technical' | 'column' | 'chimney'
  | 'select' | 'search'
  | 'properties' | 'tree' | 'items_by_type'
  | 'plan_2d' | 'view_3d'
  | 'no_selection' | 'click_to_select'
  | 'geometry' | 'metadata' | 'psets'
  | 'add' | 'delete' | 'duplicate'
  | 'import_ifc' | 'export_ifc' | 'settings'
  | 'assistant' | 'new_project'
  | 'save' | 'last_saved'
  | 'plan_units' | 'meters'
  | 'storeys' | 'items' | 'selected'
  | 'grid' | 'zoom' | 'rotate'
  | 'type' | 'name' | 'position' | 'dimensions'
  | 'height' | 'width' | 'depth' | 'thickness'
  | 'rotation' | 'material' | 'fire_rating'
  | 'load_bearing' | 'external' | 'occupancy'
  | 'function_' | 'area' | 'volume' | 'perimeter'
  | 'swing' | 'sill_height' | 'u_value'
  | 'elevation' | 'level'
  | 'instances'
  | 'process_sketch_ai' | 'clear_sketch' | 'sketch_tool_wall' | 'sketch_tool_door' | 'sketch_tool_window' | 'sketch_tool_select';

export type I18nDict = Record<I18nKey, string>;

export const I18N: Record<LangType, I18nDict> = {
  fr: {
    project: 'Projet', building: 'Bâtiment', storey: 'Niveau', room: 'Pièce', stair: 'Escalier', slab: 'Dalle', roof: 'Toit',
    wall: 'Mur', door: 'Porte', window: 'Fenêtre', furniture: 'Meuble', technical: 'Technique', column: 'Poteau', chimney: 'Cheminée',
    select: 'Sélection', search: 'Rechercher…',
    properties: 'Propriétés', tree: 'Arborescence projet', items_by_type: 'Items par type',
    plan_2d: 'Plan 2D', view_3d: 'Vue 3D',
    no_selection: 'Aucune sélection', click_to_select: 'Cliquez sur un élément du plan ou de l\'arbre pour voir ses propriétés',
    geometry: 'Géométrie', metadata: 'Métadonnées', psets: 'Property Sets (IFC)',
    add: 'Ajouter', delete: 'Supprimer', duplicate: 'Dupliquer',
    import_ifc: 'Importer IFC', export_ifc: 'Exporter IFC', settings: 'Réglages',
    assistant: 'Assistant IA', new_project: 'Nouveau',
    save: 'Sauvegarder', last_saved: 'Sauvegardé',
    plan_units: 'Unités', meters: 'mètres',
    storeys: 'Niveaux', items: 'éléments', selected: 'sélectionnés',
    grid: 'Grille', zoom: 'Zoom', rotate: 'Rotation',
    type: 'Type', name: 'Nom', position: 'Position', dimensions: 'Dimensions',
    height: 'Hauteur', width: 'Largeur', depth: 'Profondeur', thickness: 'Épaisseur',
    rotation: 'Rotation', material: 'Matériau', fire_rating: 'Classement feu',
    load_bearing: 'Porteur', external: 'Extérieur', occupancy: 'Occupation',
    function_: 'Fonction', area: 'Surface', volume: 'Volume', perimeter: 'Périmètre',
    swing: 'Sens d\'ouverture', sill_height: 'Allège', u_value: 'Coefficient U',
    elevation: 'Altitude', level: 'Niveau',
    instances: 'Instances',
    process_sketch_ai: 'Transformer en plan IA', clear_sketch: 'Effacer le croquis', sketch_tool_wall: 'Tracer Mur', sketch_tool_door: 'Ajouter Porte', sketch_tool_window: 'Ajouter Fenêtre', sketch_tool_select: 'Sélectionner / Coter',
  },
  en: {
    project: 'Project', building: 'Building', storey: 'Storey', room: 'Room', stair: 'Stair', slab: 'Slab', roof: 'Roof',
    wall: 'Wall', door: 'Door', window: 'Window', furniture: 'Furniture', technical: 'Technical', column: 'Column', chimney: 'Chimney',
    select: 'Select', search: 'Search…',
    properties: 'Properties', tree: 'Project tree', items_by_type: 'Items by type',
    plan_2d: '2D Plan', view_3d: '3D View',
    no_selection: 'No selection', click_to_select: 'Click an element in the plan or tree to view properties',
    geometry: 'Geometry', metadata: 'Metadata', psets: 'Property Sets (IFC)',
    add: 'Add', delete: 'Delete', duplicate: 'Duplicate',
    import_ifc: 'Import IFC', export_ifc: 'Export IFC', settings: 'Settings',
    assistant: 'AI Assistant', new_project: 'New',
    save: 'Save', last_saved: 'Saved',
    plan_units: 'Units', meters: 'meters',
    storeys: 'Storeys', items: 'items', selected: 'selected',
    grid: 'Grid', zoom: 'Zoom', rotate: 'Rotate',
    type: 'Type', name: 'Name', position: 'Position', dimensions: 'Dimensions',
    height: 'Height', width: 'Width', depth: 'Depth', thickness: 'Thickness',
    rotation: 'Rotation', material: 'Material', fire_rating: 'Fire rating',
    load_bearing: 'Load-bearing', external: 'External', occupancy: 'Occupancy',
    function_: 'Function', area: 'Area', volume: 'Volume', perimeter: 'Perimeter',
    swing: 'Swing', sill_height: 'Sill height', u_value: 'U-value',
    elevation: 'Elevation', level: 'Level',
    instances: 'Instances',
    process_sketch_ai: 'Process with AI', clear_sketch: 'Clear sketch', sketch_tool_wall: 'Draw Wall', sketch_tool_door: 'Add Door', sketch_tool_window: 'Add Window', sketch_tool_select: 'Select / Dimension',
  },
  de,
  es,
  pt,
  it,
  nl,
  ar,
  zh,
  ja,
  ru,
};

export function resolveLanguage(value: unknown): LangType {
  return LANGUAGES.find(({ code }) => code === value)?.code ?? 'fr';
}

export function makeT(language: string) {
  const lang = resolveLanguage(language);
  const dict: Record<string, string> = I18N[lang];
  return (key: string, values: Record<string, string | number> = {}): string => {
    const text = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key]
      : lang === 'fr' && Object.prototype.hasOwnProperty.call(frenchUi, key) ? frenchUi[key] : key;
    return text.replace(/\{(\w+)\}/g, (placeholder, name) =>
      Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder);
  };
}
