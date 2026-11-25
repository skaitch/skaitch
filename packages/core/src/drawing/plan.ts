import type { IfcEntity, IfcWallEntity, ItemsMap } from '../types/ifc.js';
import { bbox, polyArea, wallLength } from '../data/query.js';
import { wallBodyLimits } from '../lib/wallContinuity.js';
import { openingSwing } from '../lib/openingOrientation.js';
import { buildStair, stairAscentPath } from '../lib/stairGeometry.js';
import { structuralParts, toWorld } from '../lib/structuralElements.js';

/**
 * Pure floor-plan drawing: model → primitives in world metres (x right, y up).
 * No DOM, no React, no zoom: line weights and text sizes are paper millimetres,
 * so the same drawing prints identically at 1:50 or 1:100.
 */

export type Point = [number, number];

/** Pen: weight in paper mm (ISO 128 series), optional dash pattern in paper mm. */
export interface Pen { weight: number; color?: string; dash?: number[] }

export type Primitive =
  | { kind: 'polygon'; id?: string; layer: Layer; points: Point[]; fill?: string; pen?: Pen;
      /** Inner loops cut out of the fill (even-odd). */
      holes?: Point[][] }
  | { kind: 'polyline'; id?: string; layer: Layer; points: Point[]; pen: Pen }
  | { kind: 'text'; id?: string; layer: Layer; at: Point; text: string; size: number; angle?: number;
      anchor?: 'start' | 'middle' | 'end'; bold?: boolean; color?: string;
      /** Baseline shift in paper mm, in the text's own frame (positive = up on the page). */
      shift?: number };

export type Layer = 'room' | 'stair' | 'wall' | 'opening' | 'dimension' | 'label' | 'cut' | 'level' | 'beyond';

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export interface Drawing { bounds: Bounds; primitives: Primitive[] }

export interface PlanOptions {
  showRooms?: boolean;
  showDimensions?: boolean;
  showStairs?: boolean;
  showLabels?: boolean;
  /** Element types to leave out, as the editor's hidden types. */
  hiddenTypes?: ReadonlySet<string>;
  /** Room name shown on the plan; defaults to its name. */
  roomLabel?: (room: IfcEntity) => string;
  pens?: Partial<PlanPens>;
  /** Walls left out of the plan; defaults to curtain walls. */
  skipWall?: (wall: IfcEntity) => boolean;
  /** Draw window leaves and swings (the editor does; printed plans usually don't). */
  windowSwings?: boolean;
}

export interface PlanPens {
  wallCut: Pen; opening: Pen; swing: Pen; glass: Pen; stair: Pen; dimension: Pen;
  /** Poché of exterior walls and of partitions. */
  wallFill: string; partitionFill: string; roomFill: string; ink: string;
}

export const DEFAULT_PENS: PlanPens = {
  wallCut: { weight: 0.5 },
  opening: { weight: 0.25 },
  swing: { weight: 0.13 },
  glass: { weight: 0.18 },
  stair: { weight: 0.18 },
  dimension: { weight: 0.13 },
  wallFill: '#4a4a4a',
  partitionFill: '#8a8a8a',
  roomFill: 'none',
  ink: '#000000',
};

const ARC_STEPS = 16;

/** Curtain walls are drawn by their bays elsewhere in the editor; the print plan leaves them out too. */
function isCurtainWall(it: IfcEntity): boolean {
  const name = String((it as any).name ?? '').toUpperCase();
  return (it as any).ifcType === 'IfcCurtainWall' || /CURTAIN|EXTERIOR[_ -]?GLAZING|SLIDING_BAY/.test(name);
}

function isSlidingOpening(it: IfcEntity): boolean {
  const op = String((it as any).OperationType ?? '').toUpperCase();
  const name = String((it as any).name ?? '').toUpperCase();
  return op.includes('SLIDING') || name.includes('COULISS') || name.includes('BAIE') || Boolean((it as any).isBayWindow);
}

function isDoubleOpening(it: IfcEntity): boolean {
  const op = String((it as any).OperationType ?? '').toUpperCase();
  return op.includes('DOUBLE') || String((it as any).name ?? '').toUpperCase().includes('DBL');
}

/** Wall-local frame: a along the axis from (x1,y1), b along the left-hand normal (side = 1). */
function wallFrame(g: { x1: number; y1: number; x2: number; y2: number }) {
  const len = wallLength(g) || 1;
  const ux = (g.x2 - g.x1) / len, uy = (g.y2 - g.y1) / len;
  return (a: number, b: number): Point => [g.x1 + a * ux - b * uy, g.y1 + a * uy + b * ux];
}

/** Quarter arc in wall-local coordinates, centred on the hinge, from the closed leaf tip to the open leaf. */
function swingArc(P: (a: number, b: number) => Point, hingeA: number, tipA: number, side: number, radius: number): Point[] {
  const a0 = Math.atan2(0, tipA - hingeA);
  const a1 = Math.atan2(side, 0);
  let delta = a1 - a0;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  const pts: Point[] = [];
  for (let i = 0; i <= ARC_STEPS; i++) {
    const t = a0 + (delta * i) / ARC_STEPS;
    pts.push(P(hingeA + radius * Math.cos(t), radius * Math.sin(t)));
  }
  return pts;
}

function finite(...v: number[]) { return v.every(Number.isFinite); }

export function renderPlan(items: ItemsMap, storeyId: string, options: PlanOptions = {}): Drawing {
  const pens: PlanPens = { ...DEFAULT_PENS, ...options.pens };
  const hidden = options.hiddenTypes ?? new Set<string>();
  const show = (type: string) => !hidden.has(type);
  const showLabels = options.showLabels ?? true;
  const label = options.roomLabel ?? ((r: IfcEntity) => String((r as any).name ?? (r as any).Name ?? ''));
  const all = Object.values(items);
  const onStorey = all.filter((i) => i.parentId === storeyId);
  const out: Primitive[] = [];

  // Rooms first, so walls cover their edges.
  if ((options.showRooms ?? true) && show('Room')) {
    for (const r of onStorey) {
      if (r.type !== 'Room') continue;
      const poly = (r as any).geom?.polygon as Point[] | undefined;
      if (!poly || poly.length < 3) continue;
      const bb = bbox(poly);
      if (!finite(bb.minX, bb.minY, bb.maxX, bb.maxY)) continue;
      out.push({ kind: 'polygon', id: r.id, layer: 'room', points: poly, fill: pens.roomFill });
      if (showLabels) {
        const c: Point = [(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2];
        const name = label(r);
        if (name) out.push({ kind: 'text', id: r.id, layer: 'label', at: c, text: name, size: 2.5, bold: true, anchor: 'middle', color: pens.ink, shift: 0.6 });
        out.push({ kind: 'text', id: r.id, layer: 'label', at: c, text: formatArea(polyArea(poly)),
          size: 2, anchor: 'middle', color: pens.ink, shift: name ? -2.8 : 0 });
      }
    }
  }

  // Stairs starting or arriving on this storey: tread outlines and the walk line.
  if ((options.showStairs ?? true) && show('Stair')) {
    for (const s of all) {
      if (s.type !== 'Stair' || (s.parentId !== storeyId && (s as any).geom?.targetId !== storeyId)) continue;
      const parts = buildStair((s as any).geom, s.parentId, items).parts.filter((p) => p.kind !== 'rail');
      for (const p of parts) out.push({ kind: 'polygon', id: s.id, layer: 'stair', points: p.polygon, fill: 'none', pen: pens.stair });
      const walk = stairAscentPath(parts);
      if (walk.length > 1) out.push({ kind: 'polyline', id: s.id, layer: 'stair', points: walk, pen: pens.swing });
    }
  }

  // Walls in poché, cut where doors and windows sit, then the openings' symbols.
  if (show('Wall')) {
    const skip = options.skipWall ?? isCurtainWall;
    const wallOutlines: Primitive[] = [], wallFills: Primitive[] = [], symbols: Primitive[] = [];
    for (const w of onStorey) {
      if (w.type !== 'Wall' || skip(w)) continue;
      const g = (w as IfcWallEntity).geom;
      if (!finite(g.x1, g.y1, g.x2, g.y2, g.thickness)) continue;
      const len = wallLength(g);
      if (len < 1e-6) continue;
      const P = wallFrame(g);
      const half = g.thickness / 2;

      const openings = all
        .filter((o) => (o.type === 'Door' || o.type === 'Window') && (o as any).geom?.wallId === w.id && show(o.type))
        .map((o) => {
          const c = (o as any).geom.t * len, hw = (o as any).geom.width / 2;
          return { from: c - hw, to: c + hw, item: o };
        })
        .sort((a, b) => a.from - b.from);

      const [bodyStart, bodyEnd] = wallBodyLimits(w as IfcWallEntity, items);
      const segs: [number, number][] = [];
      let cursor = bodyStart;
      for (const { from, to } of openings) { if (from > cursor) segs.push([cursor, from]); cursor = Math.max(cursor, to); }
      if (cursor < bodyEnd) segs.push([cursor, bodyEnd]);
      const ext = isExternal(w);
      for (const [a, b] of segs) {
        const points = [P(a, -half), P(b, -half), P(b, half), P(a, half)];
        // Outline at twice the cut weight; the fills drawn over every outline hide its inner half and the
        // seams where walls overlap, so joined walls read as one poché with one contour (and jambs come free).
        wallOutlines.push({ kind: 'polygon', id: w.id, layer: 'wall', points, fill: 'none', pen: { ...pens.wallCut, weight: pens.wallCut.weight * 2 } });
        wallFills.push({ kind: 'polygon', id: w.id, layer: 'wall', points, fill: ext ? pens.wallFill : pens.partitionFill });
      }

      for (const { from, to, item } of openings) drawOpening(symbols, P, item, from, to, half, pens, options.windowSwings ?? false);
    }
    // Partitions before exterior walls: where a partition runs into an exterior wall, the darker exterior poché
    // covers its end, so the junction reads as one wall instead of a light patch inside the thick wall.
    const partitionFills = wallFills.filter((f) => f.kind === 'polygon' && f.fill === pens.partitionFill);
    const exteriorFills = wallFills.filter((f) => !partitionFills.includes(f));
    out.push(...wallOutlines, ...partitionFills, ...exteriorFills, ...symbols);
  }

  // Columns (cut, poché like walls) and chimneys (outline; flues crossed as voids/shafts).
  for (const it of onStorey) {
    if ((it.type !== 'Column' && it.type !== 'Chimney') || !show(it.type)) continue;
    const g = it.geom;
    if (!g || !finite(g.x, g.y, g.w, g.d)) continue;
    for (const part of structuralParts(it)) {
      const points = part.polygon.map(p => toWorld(g, p));
      if (it.type === 'Column') {
        out.push({ kind: 'polygon', id: it.id, layer: 'wall', points, fill: pens.wallFill, pen: pens.wallCut });
        continue;
      }
      out.push({ kind: 'polygon', id: it.id, layer: 'wall', points, fill: part.role === 'hearth' ? pens.partitionFill : 'none', pen: pens.wallCut });
      if (part.role === 'flue') {
        const n = points.length, q = Math.round(n / 4);
        out.push({ kind: 'polyline', id: it.id, layer: 'wall', points: [points[0], points[2 * q % n]], pen: pens.swing });
        out.push({ kind: 'polyline', id: it.id, layer: 'wall', points: [points[q], points[3 * q % n]], pen: pens.swing });
      }
    }
  }

  if ((options.showDimensions ?? true) && show('Dimension')) {
    for (const d of onStorey) {
      if (d.type !== 'Dimension') continue;
      const g = (d as any).geom;
      if (!g || !finite(g.x1, g.y1, g.x2, g.y2)) continue;
      drawDimension(out, d.id, [g.x1, g.y1], [g.x2, g.y2], pens);
    }
  }

  return { bounds: boundsOf(out), primitives: out };
}

function drawOpening(out: Primitive[], P: (a: number, b: number) => Point, item: IfcEntity,
  from: number, to: number, half: number, pens: PlanPens, windowSwings: boolean) {
  const id = item.id;
  const hw = (to - from) / 2, cx = (from + to) / 2;
  const op = String((item as any).OperationType ?? '').toUpperCase();
  const side = Number((item as any).geom.side ?? 1) >= 0 ? 1 : -1;

  if (item.type === 'Window') {
    // French plan convention: both reveal lines and the glazing on the wall axis.
    if (windowSwings && !isSlidingOpening(item)) drawLeaves(out, P, item, from, to, side, pens, true);
    out.push({ kind: 'polyline', id, layer: 'opening', points: [P(from, -half), P(to, -half)], pen: pens.opening });
    out.push({ kind: 'polyline', id, layer: 'opening', points: [P(from, half), P(to, half)], pen: pens.opening });
    if (isSlidingOpening(item)) {
      out.push({ kind: 'polyline', id, layer: 'opening', points: [P(from, half / 3), P(cx + hw * 0.1, half / 3)], pen: pens.glass });
      out.push({ kind: 'polyline', id, layer: 'opening', points: [P(cx - hw * 0.1, -half / 3), P(to, -half / 3)], pen: pens.glass });
    } else {
      out.push({ kind: 'polyline', id, layer: 'opening', points: [P(from, 0), P(to, 0)], pen: pens.glass });
    }
    return;
  }

  // Doors
  if (op === 'NONE') return;
  if (op === 'ROLLINGUP' || op === 'SECTIONAL' || op === 'TILT_UP') {
    out.push({ kind: 'polyline', id, layer: 'opening', points: [P(from, 0), P(to, 0)], pen: { ...pens.swing, dash: [1.5, 1] } });
    return;
  }
  if (isSlidingOpening(item)) {
    out.push({ kind: 'polyline', id, layer: 'opening', points: [P(from, half / 3), P(cx + hw * 0.1, half / 3)], pen: pens.opening });
    out.push({ kind: 'polyline', id, layer: 'opening', points: [P(cx - hw * 0.1, -half / 3), P(to, -half / 3)], pen: pens.opening });
    return;
  }
  drawLeaves(out, P, item, from, to, side, pens, false);
}

/** Opening leaves: the leaf open at 90° and its swing arc. Window leaves are drawn dashed, as in the editor. */
function drawLeaves(out: Primitive[], P: (a: number, b: number) => Point, item: IfcEntity,
  from: number, to: number, side: number, pens: PlanPens, dashed: boolean) {
  const id = item.id, hw = (to - from) / 2, cx = (from + to) / 2;
  const leaves: { hinge: number; tip: number; width: number }[] = isDoubleOpening(item)
    ? [{ hinge: from, tip: cx, width: hw }, { hinge: to, tip: cx, width: hw }]
    : (() => {
      const right = openingSwing(String((item as any).OperationType ?? ''), (item as any).geom.swing) === 'right';
      return [{ hinge: right ? to : from, tip: right ? from : to, width: 2 * hw }];
    })();
  const dash = dashed ? { dash: [1, 0.7] } : {};
  for (const leaf of leaves) {
    out.push({ kind: 'polyline', id, layer: 'opening', points: [P(leaf.hinge, 0), P(leaf.hinge, side * leaf.width)], pen: { ...pens.opening, ...dash } });
    out.push({ kind: 'polyline', id, layer: 'opening', points: swingArc(P, leaf.hinge, leaf.tip, side, leaf.width), pen: { ...pens.swing, ...dash } });
  }
}

function isExternal(w: IfcEntity): boolean {
  const a = w as any;
  return Boolean(a.isExternal || a.IsExternal || a.geom?.isExternal);
}

function drawDimension(out: Primitive[], id: string, a: Point, b: Point, pens: PlanPens) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return;
  out.push({ kind: 'polyline', id, layer: 'dimension', points: [a, b], pen: pens.dimension });
  // 45° architectural ticks, 0.15 m long in the model: scale-independent enough at 1:50–1:100.
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const t = 0.075, dx = (ux - uy) * t / Math.SQRT2, dy = (uy + ux) * t / Math.SQRT2;
  for (const p of [a, b]) out.push({ kind: 'polyline', id, layer: 'dimension', points: [[p[0] - dx, p[1] - dy], [p[0] + dx, p[1] + dy]], pen: { ...pens.dimension, weight: pens.wallCut.weight / 2 } });
  let angle = Math.atan2(uy, ux) * 180 / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  out.push({ kind: 'text', id, layer: 'dimension', at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], text: formatMetres(len),
    size: 1.8, angle, anchor: 'middle', color: pens.ink, shift: 0.6 });
}

/** French notation: decimal comma. */
export function formatMetres(value: number): string { return value.toFixed(2).replace('.', ','); }
export function formatArea(value: number): string { return `${formatMetres(value)} m²`; }

function boundsOf(prims: Primitive[]): Bounds {
  const pts: Point[] = [];
  for (const p of prims) {
    if (p.kind === 'text') pts.push(p.at);
    else pts.push(...p.points);
  }
  if (!pts.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return bbox(pts);
}
