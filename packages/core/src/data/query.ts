import type { IfcEntity, ItemsMap } from '../types/ifc.js';

// Polygon area (shoelace)
export function polyArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function polyPerimeter(pts: [number, number][]): number {
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    p += Math.hypot(x2 - x1, y2 - y1);
  }
  return p;
}

export function wallLength(g: { x1: number; y1: number; x2: number; y2: number }): number {
  return Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
}

export function wallAngle(g: { x1: number; y1: number; x2: number; y2: number }): number {
  return Math.atan2(g.y2 - g.y1, g.x2 - g.x1);
}

export function wallPointAtT(
  g: { x1: number; y1: number; x2: number; y2: number },
  t: number,
): [number, number] {
  return [g.x1 + (g.x2 - g.x1) * t, g.y1 + (g.y2 - g.y1) * t];
}

export function pointInPoly(pt: [number, number], poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect =
      yi > pt[1] !== yj > pt[1] &&
      pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function bbox(pts: [number, number][]): {
  minX: number; minY: number; maxX: number; maxY: number;
} {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

// IFC query helpers
export const AS_IFC = {
  typeOf: (entity: IfcEntity) => entity.type,

  getChildren: (items: ItemsMap, parentId: string): IfcEntity[] =>
    Object.values(items).filter((i) => i.parentId === parentId),

  getStoreyElements: (items: ItemsMap, storeyId: string): IfcEntity[] => {
    const rel = Object.values(items).find(
      (i) =>
        i.ifcType === 'IfcRelContainedInSpatialStructure' &&
        (i as any).RelatingStructure === storeyId,
    );
    if (!rel) return Object.values(items).filter((i) => i.parentId === storeyId);
    const ids: string[] = (rel as any).RelatedElements ?? [];
    return ids.map((id) => items[id]).filter(Boolean) as IfcEntity[];
  },

  getHostWall: (items: ItemsMap, doorOrWindowId: string): IfcEntity | null => {
    const el = items[doorOrWindowId];
    if (!el) return null;
    const geom = (el as any).geom;
    if (geom?.wallId) return items[geom.wallId] ?? null;
    return null;
  },

  isRelationship: (entity: IfcEntity) => entity.type.startsWith('_'),

  getRelAggregatesChildren: (items: ItemsMap, parentId: string): IfcEntity[] => {
    const rel = Object.values(items).find(
      (i) => i.ifcType === 'IfcRelAggregates' && (i as any).RelatingObject === parentId,
    );
    if (!rel) return [];
    const ids: string[] = (rel as any).RelatedObjects ?? [];
    return ids.map((id) => items[id]).filter(Boolean) as IfcEntity[];
  },
};