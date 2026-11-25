import { buildRoof, roofFaces } from './roofGeometry.js';
import type { ItemsMap, IfcColumnEntity, IfcChimneyEntity, ColumnGeom, ChimneyGeom, ColumnShape, ChimneyKind } from '../types/ifc.js';

/**
 * Columns (IfcColumn) and chimneys (IfcChimney): point-placed vertical elements.
 * `geom.x/y` is the centre of the footprint in world plan metres, `rotation` is in radians.
 * Body parts are expressed in the element's local frame (centred, Z up from the storey floor)
 * so the 2D plan, the 3D view and both IFC writers share one geometry.
 */

export const COLUMN_DEFAULTS = { shape: 'rect' as ColumnShape, w: 0.3, d: 0.3 };
export const CHIMNEY_DEFAULTS = { kind: 'flue' as ChimneyKind, w: 0.5, d: 0.5, flueW: 0.4, flueD: 0.4, hearthH: 1.0, fireplaceW: 1.2, fireplaceD: 0.6,
  /** Wood/pellet stove: body w × d × hearthH, round flue pipe of diameter flueW. */
  stoveW: 0.5, stoveD: 0.45, stoveH: 0.9, stovePipe: 0.15 };
const FALLBACK_STOREY_HEIGHT = 2.7;
const CIRCLE_SEGMENTS = 24;

/** Local-frame extruded part: closed polygon (no repeated end point) lifted from `z` over `h`. */
export interface SolidPart { polygon: [number, number][]; z: number; h: number; role: 'column' | 'hearth' | 'flue' }

/** Floor-to-floor height of a storey: next storey elevation minus this one, 2.70 m when unknown. */
export function storeyHeight(items: ItemsMap, storeyId: string | null | undefined): number {
  const storey = storeyId ? items[storeyId] : undefined;
  if (storey?.type !== 'Storey') return FALLBACK_STOREY_HEIGHT;
  const elevation = storey.geom.elevation;
  const above = Object.values(items)
    .filter((i): i is Extract<typeof i, { type: 'Storey' }> => i.type === 'Storey' && i.parentId === storey.parentId && i.geom.elevation > elevation + 1e-6)
    .map(i => i.geom.elevation);
  const h = above.length ? Math.min(...above) - elevation : NaN;
  return Number.isFinite(h) && h > 0.5 && h < 20 ? Math.round(h * 1000) / 1000 : FALLBACK_STOREY_HEIGHT;
}

/** Minimum rise of a chimney above the roof surface it crosses (common rule of thumb). */
export const CHIMNEY_ABOVE_ROOF = 0.5;

/**
 * Highest roof surface above plan point (x, y), as a height relative to `storeyId`'s floor,
 * over every roof of the same building (any storey). Null when no roof covers the point.
 */
export function roofTopAt(items: ItemsMap, storeyId: string | null | undefined, x: number, y: number): number | null {
  const storey = storeyId ? items[storeyId] : undefined;
  const base = storey?.type === 'Storey' ? storey.geom.elevation : 0;
  let top: number | null = null;
  for (const roof of Object.values(items)) {
    if (roof.type !== 'Roof') continue;
    const roofStorey = roof.parentId ? items[roof.parentId] : undefined;
    if (storey?.type === 'Storey' && roofStorey?.type === 'Storey' && roofStorey.parentId !== storey.parentId) continue;
    const solid = buildRoof(roof.geom as any);
    if (!solid) continue;
    const offset = (roofStorey?.type === 'Storey' ? roofStorey.geom.elevation : 0) - base;
    for (const face of roofFaces(solid)) {
      if (face.length < 3 || !pointInPolygon([x, y], face.map(([fx, fy]) => [fx, fy] as [number, number]))) continue;
      // Plane through the first three non-collinear vertices; vertical faces are skipped.
      const [a, b, c] = face;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (Math.abs(nz) < 1e-9) continue;
      const z = a[2] - (nx * (x - a[0]) + ny * (y - a[1])) / nz + offset;
      if (top === null || z > top) top = z;
    }
  }
  return top;
}

/** Chimney height reaching CHIMNEY_ABOVE_ROOF over the roof at (x, y); null without a roof there. */
export function chimneyHeightThroughRoof(items: ItemsMap, storeyId: string | null | undefined, x: number, y: number): number | null {
  const top = roofTopAt(items, storeyId, x, y);
  return top === null || top <= 0 ? null : Math.round((top + CHIMNEY_ABOVE_ROOF) * 100) / 100;
}

const rect = (w: number, d: number): [number, number][] => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
const circle = (diameter: number): [number, number][] =>
  Array.from({ length: CIRCLE_SEGMENTS }, (_, i) => {
    const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    return [Math.cos(a) * diameter / 2, Math.sin(a) * diameter / 2] as [number, number];
  });

export function columnParts(g: ColumnGeom): SolidPart[] {
  return [{ polygon: g.shape === 'circle' ? circle(g.w) : rect(g.w, g.d), z: 0, h: g.h, role: 'column' }];
}

/**
 * A flue is one shaft over the full height. A fireplace is a hearth block (w × d × hearthH) with a
 * narrower flue (flueW × flueD) rising from its top to the full height, flush with its back (+Y).
 */
export function chimneyParts(kind: ChimneyKind, g: ChimneyGeom): SolidPart[] {
  if (kind === 'stove') {
    // Stove body on the floor, round flue pipe rising from the middle of its top.
    const bodyH = Math.min(g.hearthH, g.h), pipe = Math.min(g.flueW, g.w, g.d);
    const parts: SolidPart[] = [{ polygon: rect(g.w, g.d), z: 0, h: bodyH, role: 'hearth' }];
    if (g.h - bodyH > 0.01) parts.push({ polygon: circle(pipe), z: bodyH, h: g.h - bodyH, role: 'flue' });
    return parts;
  }
  if (kind !== 'fireplace') return [{ polygon: rect(g.w, g.d), z: 0, h: g.h, role: 'flue' }];
  const hearthH = Math.min(g.hearthH, g.h);
  const flueW = Math.min(g.flueW, g.w), flueD = Math.min(g.flueD, g.d);
  const backShift = (g.d - flueD) / 2;
  const parts: SolidPart[] = [{ polygon: rect(g.w, g.d), z: 0, h: hearthH, role: 'hearth' }];
  if (g.h - hearthH > 0.01) parts.push({ polygon: rect(flueW, flueD).map(([x, y]) => [x, y + backShift]), z: hearthH, h: g.h - hearthH, role: 'flue' });
  return parts;
}

export function structuralParts(item: IfcColumnEntity | IfcChimneyEntity): SolidPart[] {
  return item.type === 'Column' ? columnParts(item.geom) : chimneyParts(item.kind, item.geom);
}

/** Local point → world plan point. */
export function toWorld(g: { x: number; y: number; rotation: number }, [lx, ly]: [number, number]): [number, number] {
  const c = Math.cos(g.rotation || 0), s = Math.sin(g.rotation || 0);
  return [g.x + lx * c - ly * s, g.y + lx * s + ly * c];
}

/** World-plan outlines of every part, for the 2D symbol, hit-testing and bounds. */
export function structuralOutlines(item: IfcColumnEntity | IfcChimneyEntity): [number, number][][] {
  return structuralParts(item).map(p => p.polygon.map(pt => toWorld(item.geom, pt)));
}

export function pointInPolygon([px, py]: [number, number], poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const positive = (value: unknown, label: string): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 100) throw new Error(`${label} must be a positive number of metres.`);
  return n;
};
const finite = (value: unknown, label: string): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a finite number.`);
  return n;
};

/** Raw editing input shared by MCP tools and the properties pane (metres, radians). */
export interface StructuralInput {
  x?: unknown; y?: unknown; rotation?: unknown;
  shape?: unknown; width?: unknown; depth?: unknown; diameter?: unknown; height?: unknown;
  kind?: unknown; flue_width?: unknown; flue_depth?: unknown; hearth_height?: unknown;
}

/** Builds (or updates from `current`) a column geometry; throws on invalid values. */
export function columnGeom(input: StructuralInput, current: ColumnGeom | undefined, defaultHeight: number): ColumnGeom {
  const shape = input.shape === undefined ? current?.shape ?? COLUMN_DEFAULTS.shape : input.shape;
  if (shape !== 'rect' && shape !== 'circle') throw new Error('shape must be "rect" or "circle".');
  const diameter = positive(input.diameter, 'diameter');
  let w = positive(input.width, 'width') ?? diameter ?? current?.w ?? COLUMN_DEFAULTS.w;
  let d = positive(input.depth, 'depth') ?? diameter ?? current?.d ?? COLUMN_DEFAULTS.d;
  if (shape === 'circle') { if (diameter === undefined && input.width === undefined && input.depth !== undefined) w = d; d = w; }
  return {
    x: finite(input.x, 'x') ?? current?.x ?? 0,
    y: finite(input.y, 'y') ?? current?.y ?? 0,
    rotation: finite(input.rotation, 'rotation') ?? current?.rotation ?? 0,
    shape, w, d,
    h: positive(input.height, 'height') ?? current?.h ?? defaultHeight,
  };
}

/** Builds (or updates from `current`) a chimney kind and geometry; throws on invalid values. */
export function chimneyGeom(input: StructuralInput, current: { kind: ChimneyKind; geom: ChimneyGeom } | undefined, defaultHeight: number): { kind: ChimneyKind; geom: ChimneyGeom } {
  const kind = input.kind === undefined ? current?.kind ?? CHIMNEY_DEFAULTS.kind : input.kind;
  if (kind !== 'flue' && kind !== 'fireplace' && kind !== 'stove') throw new Error('kind must be "flue", "fireplace" or "stove".');
  const switched = current && current.kind !== kind;
  const fresh = switched || !current;
  const isStove = kind === 'stove';
  const baseW = fresh ? (kind === 'fireplace' ? CHIMNEY_DEFAULTS.fireplaceW : isStove ? CHIMNEY_DEFAULTS.stoveW : CHIMNEY_DEFAULTS.w) : current.geom.w;
  const baseD = fresh ? (kind === 'fireplace' ? CHIMNEY_DEFAULTS.fireplaceD : isStove ? CHIMNEY_DEFAULTS.stoveD : CHIMNEY_DEFAULTS.d) : current.geom.d;
  return {
    kind,
    geom: {
      x: finite(input.x, 'x') ?? current?.geom.x ?? 0,
      y: finite(input.y, 'y') ?? current?.geom.y ?? 0,
      rotation: finite(input.rotation, 'rotation') ?? current?.geom.rotation ?? 0,
      w: positive(input.width, 'width') ?? baseW,
      d: positive(input.depth, 'depth') ?? baseD,
      h: positive(input.height, 'height') ?? current?.geom.h ?? defaultHeight,
      flueW: positive(input.flue_width, 'flue_width') ?? (fresh && isStove ? CHIMNEY_DEFAULTS.stovePipe : current?.geom.flueW ?? CHIMNEY_DEFAULTS.flueW),
      flueD: positive(input.flue_depth, 'flue_depth') ?? (fresh && isStove ? CHIMNEY_DEFAULTS.stovePipe : current?.geom.flueD ?? CHIMNEY_DEFAULTS.flueD),
      hearthH: positive(input.hearth_height, 'hearth_height') ?? (fresh && isStove ? CHIMNEY_DEFAULTS.stoveH : current?.geom.hearthH ?? CHIMNEY_DEFAULTS.hearthH),
    },
  };
}
