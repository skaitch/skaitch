import type { IfcAnnotationEntity, ItemsMap } from '../types/ifc.js';

/**
 * Dimensions, markers and saved sections travel through IFC as IfcAnnotation entities.
 * ObjectType names the editor kind; Description holds the editor geometry as JSON, so the
 * annotation comes back exactly as drawn (another tool only sees a named, placed annotation).
 */
export const ANNOTATION_KINDS = ['Dimension', 'Marker', 'Section'] as const;
export type AnnotationKind = typeof ANNOTATION_KINDS[number];

const OBJECT_TYPE_PREFIX = 'SkAItch:';
const ID_PREFIX: Record<AnnotationKind, string> = { Dimension: 'dim', Marker: 'm', Section: 'sec' };

export const annotationObjectType = (kind: AnnotationKind) => OBJECT_TYPE_PREFIX + kind;

export function annotationKind(objectType: string): AnnotationKind | null {
  if (!objectType.startsWith(OBJECT_TYPE_PREFIX)) return null;
  const kind = objectType.slice(OBJECT_TYPE_PREFIX.length);
  return (ANNOTATION_KINDS as readonly string[]).includes(kind) ? kind as AnnotationKind : null;
}

export function isAnnotation(item: ItemsMap[string] | undefined): item is IfcAnnotationEntity {
  return !!item && (ANNOTATION_KINDS as readonly string[]).includes(item.type);
}

type AnnotationGeom = IfcAnnotationEntity['geom'] & Record<string, unknown>;

/** Moves plan coordinates by (dx, dy). Section origins are 3D view points: x right, y up, z = -plan y. */
export function shiftAnnotationGeom(geom: AnnotationGeom, dx: number, dy: number): AnnotationGeom {
  const g: any = { ...geom };
  for (const [kx, ky] of [['x1', 'y1'], ['x2', 'y2'], ['x', 'y']]) {
    if (typeof g[kx] === 'number') g[kx] += dx;
    if (typeof g[ky] === 'number') g[ky] += dy;
  }
  if (Array.isArray(g.origin) && g.origin.length === 3) g.origin = [g.origin[0] + dx, g.origin[1], g.origin[2] - dy];
  return g;
}

/** Plan point where the annotation is placed in IFC. */
export function annotationAnchor(item: IfcAnnotationEntity): [number, number] {
  const g: any = item.geom;
  const x = typeof g.x1 === 'number' ? g.x1 : g.x, y = typeof g.y1 === 'number' ? g.y1 : g.y;
  return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0];
}

/** JSON written in Description; `offset` turns editor coordinates back into file coordinates. */
export function annotationPayload(item: IfcAnnotationEntity, offset: [number, number] = [0, 0]): string {
  const description = (item as any).description;
  return JSON.stringify({
    geom: shiftAnnotationGeom(item.geom as AnnotationGeom, offset[0], offset[1]),
    ...(typeof description === 'string' && description ? { description } : {}),
  });
}

/** Rebuilds an editor item from an IfcAnnotation written by annotationPayload; null for other annotations. */
export function annotationFromIfc(args: {
  expressId: number; globalId: string; name: string; objectType: string; description: string; parentId: string;
}): IfcAnnotationEntity | null {
  const kind = annotationKind(args.objectType);
  if (!kind) return null;
  let data: any;
  try { data = JSON.parse(args.description); } catch { return null; }
  const g = data?.geom;
  if (!g || typeof g !== 'object') return null;
  const numbers = (keys: string[]) => keys.every(key => typeof g[key] === 'number' && Number.isFinite(g[key]));
  if (kind === 'Marker' ? !numbers(['x', 'y']) : !numbers(['x1', 'y1', 'x2', 'y2'])) return null;
  for (const key of ['origin', 'normal']) {
    if (g[key] !== undefined && !(Array.isArray(g[key]) && g[key].length === 3 && g[key].every((n: unknown) => typeof n === 'number' && Number.isFinite(n)))) return null;
  }
  if (g.depth !== undefined && !(typeof g.depth === 'number' && Number.isFinite(g.depth) && g.depth > 0)) return null;
  const id = `${ID_PREFIX[kind]}_${args.expressId}`;
  const name = args.name || (kind === 'Dimension' ? 'Cote' : kind === 'Marker' ? 'Jalon' : 'Coupe');
  return {
    id, type: kind, ifcType: 'IfcAnnotation', name, Name: name, GlobalId: args.globalId, parentId: args.parentId, geom: g,
    ...(typeof data.description === 'string' ? { description: data.description } : {}),
  } as IfcAnnotationEntity;
}
