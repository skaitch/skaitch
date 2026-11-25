import { BUILTIN_CATALOGUE, type ElementDef } from '../data/elementCatalogue.js';
import type { ItemsMap } from '../types/ifc.js';
import { catalogueLabel, defaultName } from './defaultNames.js';

const finite = (v: unknown, key: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Invalid ${key}.`);
  return v;
};

export function placementPoint(v: unknown, items: ItemsMap, storeyId: string,
  convert: (p: [number, number]) => [number, number] = p => p): [number, number] {
  if (Array.isArray(v) && v.length === 2) return convert([finite(v[0], 'x'), finite(v[1], 'y')]);
  if (typeof v === 'string') {
    const markers = Object.values(items).filter(i => i.type === 'Marker' && i.parentId === storeyId);
    const exact = markers.find(i => i.id === v || i.GlobalId === v);
    const matches = exact ? [exact] : markers.filter(i => i.name === v || i.Name === v);
    if (matches.length !== 1) throw new Error(`Unknown or ambiguous marker in this storey: ${v}`);
    const g = (matches[0] as any).geom;
    return [finite(g.x, 'marker x'), finite(g.y, 'marker y')];
  }
  throw new Error('point must be [x,y] or a marker ID, GlobalId or unique name.');
}

/** Resolve placement in world metres; furniture rotates around its footprint centre. */
export function furniturePlacement(args: Record<string, unknown>, items: ItemsMap, storeyId: string,
  catalogue: ElementDef[], current?: any, convert: (p: [number, number]) => [number, number] = p => p,
  lang: unknown = 'fr') {
  const def = args.catalogue_id === undefined ? undefined : catalogue.find(d => d.id === args.catalogue_id && d.type === 'Furniture');
  if (args.catalogue_id !== undefined && !def) throw new Error('Unknown furniture catalogue_id.');
  const modelDef = def ?? catalogue.find(d => d.id === (args.model ?? current?.model));
  const frontAngle = finite(modelDef?.frontAngle ?? BUILTIN_CATALOGUE.find(d => d.id === modelDef?.iconKey)?.frontAngle ?? 0, 'frontAngle');
  const point = (v: unknown) => placementPoint(v, items, storeyId, convert);
  const g = { ...current?.geom };
  for (const [field, arg, fallback] of [['w', 'width', 0.6], ['d', 'depth', 0.6], ['h', 'height', 0.85]] as const) {
    const value = finite(args[arg] ?? (def ? def.defaults[arg] : undefined) ?? g[field] ?? fallback, arg);
    if (value <= 0) throw new Error(`${arg} must be positive.`);
    g[field] = value;
  }
  if (args.anchor !== undefined && args.anchor !== 'origin' && args.anchor !== 'center' && args.anchor !== 'back') throw new Error('anchor must be origin, center or back.');
  if (args.point === undefined && !current) throw new Error('point is required for creation.');
  if (args.anchor !== undefined && args.point === undefined) throw new Error('anchor requires point.');
  let [x, y] = args.point === undefined ? [g.x, g.y] : point(args.point);
  if (args.point !== undefined && (args.anchor === 'center' || args.anchor === 'back')) { x -= g.w / 2; y -= g.d / 2; }
  if (args.offset !== undefined) {
    if (!Array.isArray(args.offset) || args.offset.length !== 2) throw new Error('offset must be [dx,dy] in world metres.');
    x += finite(args.offset[0], 'offset x'); y += finite(args.offset[1], 'offset y');
  }
  g.x = finite(x, 'x'); g.y = finite(y, 'y');
  if (args.rotation !== undefined && args.facing_point !== undefined) throw new Error('Use rotation or facing_point, not both.');
  g.rotation = finite(args.rotation ?? g.rotation ?? 0, 'rotation');
  if (args.facing_point !== undefined) {
    const target = point(args.facing_point);
    const dx = target[0] - (g.x + g.w / 2), dy = target[1] - (g.y + g.d / 2);
    if (Math.hypot(dx, dy) < 1e-9) throw new Error('facing_point must differ from the furniture centre.');
    g.rotation = Math.atan2(dy, dx) - frontAngle;
  }
  if (args.point !== undefined && args.anchor === 'back') {
    const front = g.rotation + frontAngle;
    // Intersect the local front axis with the footprint, including custom oblique fronts.
    const halfDepth = Math.min(g.w / (2 * Math.abs(Math.cos(frontAngle))), g.d / (2 * Math.abs(Math.sin(frontAngle))));
    g.x += Math.cos(front) * halfDepth; g.y += Math.sin(front) * halfDepth;
  }
  if (def) g.catalogueId = def.id;
  g._edited = true;
  const label = String(args.name ?? (def ? catalogueLabel(def, lang) : defaultName('mcpFurniture', lang)));
  return { geom: g, category: String(args.category ?? def?.category ?? current?.category ?? 'Cuisine'),
    model: String(args.model ?? def?.id ?? current?.model ?? 'custom'),
    ...(args.name !== undefined || !current ? { name: label, Name: label } : {}) };
}
