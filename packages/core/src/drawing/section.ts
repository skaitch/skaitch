import type { ItemsMap } from '../types/ifc.js';
import { buildSection, type SectionLine } from '../lib/sectionGeometry.js';
import { DEFAULT_PENS, formatMetres, type Drawing, type PlanPens, type Point, type Primitive } from './plan.js';
import { bbox } from '../data/query.js';

/**
 * Pure general section drawing: x is the distance along the section line, y the elevation, both in metres.
 * Same primitives and pens as the plan, so it prints and shows the same way.
 */
export interface SectionOptions {
  pens?: Partial<SectionPens>;
  /** Storey level lines with their name and elevation. */
  showLevels?: boolean;
  /** How far level lines run past the cut elements, in metres. */
  levelOverrun?: number;
}

export interface SectionPens extends PlanPens {
  level: { weight: number; color?: string; dash?: number[] };
  stairFill: string;
  beyond: { weight: number; color?: string; dash?: number[] };
}

export const DEFAULT_SECTION_PENS: SectionPens = {
  ...DEFAULT_PENS,
  level: { weight: 0.13, dash: [3, 1, 0.5, 1] },
  stairFill: '#b89970',
  beyond: { weight: 0.18 },
};

/** Elements cut in poché; the rest (furniture, generic objects) in outline. */
const POCHE = new Set(['Wall', 'Slab']);

export function renderSection(items: ItemsMap, line: SectionLine, options: SectionOptions = {}): Drawing {
  const pens: SectionPens = { ...DEFAULT_SECTION_PENS, ...options.pens };
  const faces = buildSection(items, line);
  const outlines: Primitive[] = [], fills: Primitive[] = [], others: Primitive[] = [];

  for (const f of faces) {
    const points = f.points as Point[];
    if (f.kind === 'Roof') {
      // A roof face cut by the plane is a line (two hits) or, rarely, a closed contour.
      others.push(points.length > 2
        ? { kind: 'polygon', id: f.id, layer: 'cut', points, fill: 'none', pen: pens.wallCut }
        : { kind: 'polyline', id: f.id, layer: 'cut', points, pen: { ...pens.wallCut, weight: pens.wallCut.weight * 1.5 } });
    } else if (POCHE.has(f.kind)) {
      // Same trick as plan walls: double-weight outlines under all fills, so walls and slabs merge.
      outlines.push({ kind: 'polygon', id: f.id, layer: 'cut', points, fill: 'none', pen: { ...pens.wallCut, weight: pens.wallCut.weight * 2 } });
      fills.push({ kind: 'polygon', id: f.id, layer: 'cut', points, fill: pens.wallFill });
    } else if (f.kind === 'Stair') {
      others.push({ kind: 'polygon', id: f.id, layer: 'cut', points, fill: pens.stairFill, pen: pens.stair });
    } else {
      others.push({ kind: 'polygon', id: f.id, layer: 'cut', points, fill: 'none', pen: pens.beyond });
    }
  }

  const cut = [...outlines, ...fills, ...others];
  const pts = cut.flatMap((p) => (p.kind === 'text' ? [p.at] : p.points));
  if (!pts.length) return { bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, primitives: [] };

  const levels: Primitive[] = [];
  if (options.showLevels ?? true) {
    const b = bbox(pts), over = options.levelOverrun ?? 1;
    for (const st of Object.values(items)) {
      if (st.type !== 'Storey') continue;
      const z = Number((st as any).geom?.elevation);
      if (!Number.isFinite(z)) continue;
      levels.push({ kind: 'polyline', id: st.id, layer: 'level', points: [[b.minX - over, z], [b.maxX + over, z]], pen: pens.level });
      levels.push({ kind: 'text', id: st.id, layer: 'level', at: [b.minX - over, z], size: 2, shift: 0.8, color: pens.ink,
        text: `${st.name ?? ''} · ${z >= 0 ? '+' : ''}${formatMetres(z)} m` });
    }
  }

  const primitives = [...levels, ...cut];
  const all = primitives.flatMap((p) => (p.kind === 'text' ? [p.at] : p.points));
  return { bounds: bbox(all), primitives };
}
