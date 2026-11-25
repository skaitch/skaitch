/**
 * Vector background plan: the normalized geometry kept in the project (ADR 0014).
 *
 * Local coordinates are integer millimetres, x right and y up, with (0, 0) at the bottom-left
 * corner of the imported extent. The storey's `plan` places them in the world the same way it
 * places an image: `plan.x/plan.y` is the bottom-left corner and one local unit spans
 * `(plan.w / data.w) * plan.scale` metres, so translation and two-point calibration work for
 * both kinds. `plan.url` holds a raster preview of the visible layers, so every consumer that
 * reads the plan as an image keeps working.
 */
import { gzipSync, strToU8 } from 'fflate';
import { DXF_UNIT_MM, type DxfBounds, type DxfDrawing, type DxfUnit } from './dxf.js';

export interface VectorLayer {
  name: string;
  color: string;
  visible: boolean;
}

export interface VectorPath {
  /** Layer index. */
  l: number;
  /** '#rrggbb' */
  c: string;
  /** Flat [x0, y0, x1, y1, …], local millimetres. */
  p: number[];
}

export interface VectorText {
  l: number;
  c: string;
  x: number;
  y: number;
  /** Height, millimetres. */
  h: number;
  /** Rotation, degrees counter-clockwise. */
  r: number;
  s: string;
}

export interface VectorPlanData {
  v: 1;
  /** Unit chosen at import for the drawing's coordinates. */
  unit: DxfUnit;
  /** Origin offset: the local origin in the drawing's own coordinates, in metres. */
  origin: [number, number];
  /** Extent, millimetres. */
  w: number;
  h: number;
  layers: VectorLayer[];
  paths: VectorPath[];
  texts: VectorText[];
  /** Circle and arc centres [l, x, y, l, x, y, …], snap targets. */
  centers: number[];
  /** Draw every layer in one neutral colour. */
  monochrome?: boolean;
}

/** Placement fields shared with image background plans. */
export interface PlanPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
}

/** Entity count above which the import asks to hide layers first. */
export const VECTOR_ENTITY_WARNING = 200_000;
/** Compressed size above which the project could no longer be saved on the web. */
export const VECTOR_MAX_COMPRESSED_BYTES = 2_000_000;

// ── Normalization ────────────────────────────────────────────────────────────

/** Liang–Barsky: clips a polyline to a rectangle, returning the pieces inside. */
export function clipPolyline(pts: number[], r: DxfBounds): number[][] {
  const pieces: number[][] = [];
  let current: number[] = [];
  const flush = () => { if (current.length >= 4) pieces.push(current); current = []; };
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const x0 = pts[k], y0 = pts[k + 1], x1 = pts[k + 2], y1 = pts[k + 3];
    const dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1, inside = true;
    for (const [p, q] of [[-dx, x0 - r.minX], [dx, r.maxX - x0], [-dy, y0 - r.minY], [dy, r.maxY - y0]] as const) {
      if (p === 0) { if (q < 0) { inside = false; break; } continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) { inside = false; break; } if (t > t0) t0 = t; }
      else { if (t < t0) { inside = false; break; } if (t < t1) t1 = t; }
    }
    if (!inside) { flush(); continue; }
    const ax = x0 + t0 * dx, ay = y0 + t0 * dy, bx = x0 + t1 * dx, by = y0 + t1 * dy;
    const n = current.length;
    if (t0 > 0 || n === 0 || current[n - 2] !== ax || current[n - 1] !== ay) { flush(); current.push(ax, ay); }
    current.push(bx, by);
    if (t1 < 1) flush();
  }
  flush();
  return pieces;
}

const inRect = (x: number, y: number, r: DxfBounds) => x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;

export interface NormalizeOptions {
  unit: DxfUnit;
  /** Crop rectangle in the drawing's own coordinates; the whole drawing when absent. */
  crop?: DxfBounds;
  /** Reuse this origin offset (metres) instead of the crop's bottom-left corner. */
  origin?: [number, number];
}

export function normalizeDxf(drawing: DxfDrawing, options: NormalizeOptions): VectorPlanData {
  const k = DXF_UNIT_MM[options.unit];
  const crop = options.crop ?? drawing.bounds;
  if (!crop) throw new Error('The drawing is empty.');
  const layerIndex = new Map(drawing.layers.map((l, i) => [l.name, i]));
  const kept = (pts: number[]) => options.crop ? clipPolyline(pts, crop) : [pts];

  // Bounds of what is kept, in drawing units.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  const rawPaths: { l: number; c: string; p: number[] }[] = [];
  for (const pl of drawing.polylines) {
    for (const piece of kept(pl.pts)) {
      for (let i = 0; i < piece.length; i += 2) grow(piece[i], piece[i + 1]);
      rawPaths.push({ l: layerIndex.get(pl.layer) ?? 0, c: pl.color, p: piece });
    }
  }
  const rawTexts = drawing.texts.filter(t => !options.crop || inRect(t.x, t.y, crop));
  for (const t of rawTexts) grow(t.x, t.y);
  if (!Number.isFinite(minX)) throw new Error('Nothing of the drawing lies inside the selected area.');

  const origin: [number, number] = options.origin ?? [minX * k / 1000, minY * k / 1000];
  const ox = origin[0] * 1000 / k, oy = origin[1] * 1000 / k;
  const q = (v: number, o: number) => Math.round((v - o) * k);

  const paths: VectorPath[] = [];
  for (const rp of rawPaths) {
    const p: number[] = [];
    for (let i = 0; i < rp.p.length; i += 2) {
      const x = q(rp.p[i], ox), y = q(rp.p[i + 1], oy);
      const n = p.length;
      if (n && p[n - 2] === x && p[n - 1] === y) continue; // collapsed by rounding
      p.push(x, y);
    }
    if (p.length >= 4) paths.push({ l: rp.l, c: rp.c, p });
  }
  const texts: VectorText[] = rawTexts.map(t => ({
    l: layerIndex.get(t.layer) ?? 0, c: t.color, x: q(t.x, ox), y: q(t.y, oy),
    h: Math.max(1, Math.round(t.h * k)), r: Math.round(t.rot * 10) / 10, s: t.s,
  }));
  const centers: number[] = [];
  for (const c of drawing.centers) {
    if (options.crop && !inRect(c.x, c.y, crop)) continue;
    centers.push(layerIndex.get(c.layer) ?? 0, q(c.x, ox), q(c.y, oy));
  }

  return {
    v: 1,
    unit: options.unit,
    origin,
    w: Math.max(1, q(maxX, ox)),
    h: Math.max(1, q(maxY, oy)),
    layers: drawing.layers.map(l => ({ ...l })),
    paths,
    texts,
    centers,
  };
}

/** Number of drawn entities (polylines and texts). */
export const vectorEntityCount = (d: VectorPlanData) => d.paths.length + d.texts.length;

/** Size of the geometry once compressed, as the web save path stores it. */
export const vectorCompressedBytes = (d: VectorPlanData) => gzipSync(strToU8(JSON.stringify(d)), { level: 6 }).length;

// ── Placement ────────────────────────────────────────────────────────────────

/** Metres per local millimetre for this placement. */
export const vectorMetresPerUnit = (plan: PlanPlacement, d: VectorPlanData) => (plan.w / d.w) * plan.scale;

export function vectorToWorld(plan: PlanPlacement, d: VectorPlanData, x: number, y: number): [number, number] {
  const s = vectorMetresPerUnit(plan, d);
  return [plan.x + x * s, plan.y + y * s];
}

export function worldToVector(plan: PlanPlacement, d: VectorPlanData, x: number, y: number): [number, number] {
  const s = vectorMetresPerUnit(plan, d);
  return [(x - plan.x) / s, (y - plan.y) / s];
}

/** Initial placement: the bottom-left corner at the project origin, at true scale, for a raster of `maxSide` pixels. */
export function initialVectorPlacement(d: VectorPlanData, maxSide: number): PlanPlacement {
  const k = maxSide / Math.max(d.w, d.h);
  const w = Math.max(1, Math.round(d.w * k)), h = Math.max(1, Math.round(d.h * k));
  return { x: 0, y: 0, w, h, scale: d.w / w / 1000 };
}

// ── Snapping ─────────────────────────────────────────────────────────────────

export type VectorSnapKind = 'endpoint' | 'midpoint' | 'center' | 'nearest';

export interface VectorSnapIndex {
  data: VectorPlanData;
  cell: number;
  cols: number;
  rows: number;
  /** Per cell: segment refs as [path, vertex] pairs, flat. */
  segments: Map<number, number[]>;
  /** Per cell: point targets [x, y, kind] flat (kind 0 endpoint, 1 midpoint, 2 centre). */
  points: Map<number, number[]>;
}

const KINDS: VectorSnapKind[] = ['endpoint', 'midpoint', 'center'];

/** Builds a bucket grid over the visible layers; rebuild when layer visibility changes. */
export function buildVectorSnapIndex(d: VectorPlanData): VectorSnapIndex {
  const cell = Math.max(50, Math.max(d.w, d.h) / 256);
  const cols = Math.ceil(d.w / cell) + 1, rows = Math.ceil(d.h / cell) + 1;
  const key = (cx: number, cy: number) => Math.min(rows - 1, Math.max(0, cy)) * cols + Math.min(cols - 1, Math.max(0, cx));
  const segments = new Map<number, number[]>();
  const points = new Map<number, number[]>();
  const addPoint = (x: number, y: number, kind: number) => {
    const k = key(Math.floor(x / cell), Math.floor(y / cell));
    let list = points.get(k); if (!list) points.set(k, list = []);
    list.push(x, y, kind);
  };
  d.paths.forEach((path, pi) => {
    if (!d.layers[path.l]?.visible) return;
    const p = path.p;
    for (let v = 0; v + 3 < p.length; v += 2) {
      const x0 = p[v], y0 = p[v + 1], x1 = p[v + 2], y1 = p[v + 3];
      const c0 = Math.floor(Math.min(x0, x1) / cell), c1 = Math.floor(Math.max(x0, x1) / cell);
      const r0 = Math.floor(Math.min(y0, y1) / cell), r1 = Math.floor(Math.max(y0, y1) / cell);
      for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
        const k = key(cx, cy);
        let list = segments.get(k); if (!list) segments.set(k, list = []);
        list.push(pi, v);
      }
      // Arcs and splines are many short segments: only polyline ends and real corners
      // (a turn above 20°) are endpoints, and only long straight runs get a midpoint.
      if (v === 0) addPoint(x0, y0, 0);
      const last = v + 4 >= p.length;
      if (last) addPoint(x1, y1, 0);
      else {
        const a = Math.atan2(y1 - y0, x1 - x0), b = Math.atan2(p[v + 5] - y1, p[v + 4] - x1);
        let turn = Math.abs(b - a);
        if (turn > Math.PI) turn = 2 * Math.PI - turn;
        if (turn > Math.PI / 9) addPoint(x1, y1, 0);
      }
      if (Math.hypot(x1 - x0, y1 - y0) > cell / 2) addPoint((x0 + x1) / 2, (y0 + y1) / 2, 1);
    }
  });
  for (let i = 0; i + 2 < d.centers.length; i += 3) {
    if (d.layers[d.centers[i]]?.visible) addPoint(d.centers[i + 1], d.centers[i + 2], 2);
  }
  return { data: d, cell, cols, rows, segments, points };
}

/**
 * Nearest snap target within `tol` (local millimetres) of (x, y): endpoints, midpoints and
 * centres win over the nearest point on a line.
 */
export function snapToVector(index: VectorSnapIndex, x: number, y: number, tol: number): { x: number; y: number; kind: VectorSnapKind } | null {
  const { cell, cols, rows } = index;
  const c0 = Math.max(0, Math.floor((x - tol) / cell)), c1 = Math.min(cols - 1, Math.floor((x + tol) / cell));
  const r0 = Math.max(0, Math.floor((y - tol) / cell)), r1 = Math.min(rows - 1, Math.floor((y + tol) / cell));
  let best: { x: number; y: number; kind: VectorSnapKind } | null = null;
  let bestD = tol;
  for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
    const list = index.points.get(cy * cols + cx);
    if (!list) continue;
    for (let i = 0; i < list.length; i += 3) {
      const dd = Math.hypot(list[i] - x, list[i + 1] - y);
      if (dd <= bestD) { bestD = dd; best = { x: list[i], y: list[i + 1], kind: KINDS[list[i + 2]] }; }
    }
  }
  if (best) return best;
  bestD = tol;
  for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
    const list = index.segments.get(cy * cols + cx);
    if (!list) continue;
    for (let i = 0; i < list.length; i += 2) {
      const p = index.data.paths[list[i]].p, v = list[i + 1];
      const x0 = p[v], y0 = p[v + 1], dx = p[v + 2] - x0, dy = p[v + 3] - y0;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2)) : 0;
      const px = x0 + t * dx, py = y0 + t * dy;
      const dd = Math.hypot(px - x, py - y);
      if (dd <= bestD) { bestD = dd; best = { x: px, y: py, kind: 'nearest' }; }
    }
  }
  return best;
}

// ── MCP ──────────────────────────────────────────────────────────────────────

const mm = (v: number) => Math.round(v * 1000) / 1000;

/** Geometry of the requested layers in world metres, as returned by get_background_geometry. */
export function vectorGeometryForMcp(plan: PlanPlacement, d: VectorPlanData, opts: { layers?: string[]; bbox?: number[]; maxPoints?: number } = {}) {
  const wanted = new Set(opts.layers?.length ? opts.layers : d.layers.filter(l => l.visible).map(l => l.name));
  const max = Math.max(1, Math.min(200_000, opts.maxPoints ?? 20_000));
  const b = opts.bbox?.length === 4 ? opts.bbox : null;
  const inside = (x: number, y: number) => !b || (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]);
  const out = new Map<string, { polylines: [number, number][][]; texts: { x: number; y: number; height: number; rotation: number; text: string }[] }>();
  const layerOut = (name: string) => {
    let l = out.get(name);
    if (!l) out.set(name, l = { polylines: [], texts: [] });
    return l;
  };
  const s = vectorMetresPerUnit(plan, d);
  let points = 0, truncated = false;
  for (const path of d.paths) {
    const name = d.layers[path.l]?.name;
    if (!name || !wanted.has(name)) continue;
    const pts: [number, number][] = [];
    let hit = false;
    for (let i = 0; i < path.p.length; i += 2) {
      const [x, y] = vectorToWorld(plan, d, path.p[i], path.p[i + 1]);
      if (inside(x, y)) hit = true;
      pts.push([mm(x), mm(y)]);
    }
    if (!hit) continue;
    if (points + pts.length > max) { truncated = true; break; }
    points += pts.length;
    layerOut(name).polylines.push(pts);
  }
  for (const t of d.texts) {
    const name = d.layers[t.l]?.name;
    if (!name || !wanted.has(name)) continue;
    const [x, y] = vectorToWorld(plan, d, t.x, t.y);
    if (!inside(x, y)) continue;
    layerOut(name).texts.push({ x: mm(x), y: mm(y), height: mm(t.h * s), rotation: t.r, text: t.s });
  }
  return {
    unit: 'm',
    origin_offset: d.origin,
    extent: { x: mm(plan.x), y: mm(plan.y), width: mm(d.w * s), height: mm(d.h * s) },
    layers: [...out.entries()].map(([name, v]) => ({ name, ...v })),
    points,
    truncated,
    ...(truncated ? { hint: 'Result truncated: narrow bbox or layers, or raise max_points.' } : {}),
  };
}
