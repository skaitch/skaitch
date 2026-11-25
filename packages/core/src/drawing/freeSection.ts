import { bbox } from '../data/query.js';
import { DEFAULT_SECTION_PENS, type SectionPens } from './section.js';
import type { Drawing, Point, Primitive } from './plan.js';

/**
 * A free (mesh) section as a drawing, in the section plane's own axes (x along u, y up along v), in metres.
 * The 3D view computes the loops and edges from the scene's meshes; this only turns them into primitives,
 * so the editor's 2D section and printed sheets draw the same thing.
 */
export interface FreeSectionInput {
  /** Cut solids: an outer loop and the holes inside it. */
  fills: { outer: Point[]; holes: Point[][] }[];
  /** Cut contour segments. */
  cut: [Point, Point][];
  /** Edges seen beyond the plane, within the section depth. */
  background: [Point, Point][];
}

export function freeSectionDrawing(input: FreeSectionInput, pens: Partial<SectionPens> = {}): Drawing {
  const p: SectionPens = { ...DEFAULT_SECTION_PENS, ...pens };
  const primitives: Primitive[] = [
    ...input.background.map((s): Primitive => ({ kind: 'polyline', layer: 'beyond', points: s, pen: p.beyond })),
    ...input.fills.map((f): Primitive => ({ kind: 'polygon', layer: 'cut', points: f.outer, holes: f.holes, fill: p.wallFill })),
    ...input.cut.map((s): Primitive => ({ kind: 'polyline', layer: 'cut', points: s, pen: p.wallCut })),
  ];
  const pts = primitives.flatMap((q) => (q.kind === 'text' ? [q.at] : q.points));
  return { bounds: pts.length ? bbox(pts) : { minX: 0, minY: 0, maxX: 0, maxY: 0 }, primitives };
}
