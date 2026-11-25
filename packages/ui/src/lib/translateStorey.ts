import type { IfcEntity, ItemsMap } from '@skaitch/core/types/ifc';
import { validateStairOpenings } from '@skaitch/core/lib/stairGeometry';

export interface StoreyTranslation { items: ItemsMap; warnings: string[]; movedIds: string[] }

type P = [number, number];
const shift = (p: P, dx: number, dy: number): P => [p[0] + dx, p[1] + dy];

/** Items that belong to a storey, directly or through an intermediate parent. */
export function storeyDescendants(items: ItemsMap, storeyId: string): Set<string> {
  const ids = new Set<string>();
  let size = -1;
  while (size !== ids.size) {
    size = ids.size;
    for (const item of Object.values(items)) {
      if (item.parentId && (item.parentId === storeyId || ids.has(item.parentId))) ids.add(item.id);
    }
  }
  return ids;
}

/**
 * Rigidly translate a storey (its elements and its background plan) as one immutable change.
 *
 * IFC rules kept here:
 * - every moved element is flagged `_edited` (never `_shapeEdited`), so the IFC
 *   patch only rewrites placements and keeps the original bodies;
 * - doors and windows stay hosted (wall + t); their stored world placement follows;
 * - a stair trémie belongs to its slab: it moves with the storey of that slab,
 *   whichever storey the stair starts from;
 * - general sections cut the whole building and are left in place.
 */
export function translateStorey(items: ItemsMap, storeyId: string, dx: number, dy: number): StoreyTranslation {
  const storey = items[storeyId];
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || storey?.type !== 'Storey') throw new Error('Déplacement invalide.');
  if (dx === 0 && dy === 0) return { items, warnings: [], movedIds: [] };

  const members = storeyDescendants(items, storeyId);
  const movedSlabs = new Set([...members].filter(id => items[id]?.type === 'Slab'));
  const next: ItemsMap = { ...items };
  const movedIds: string[] = [];

  if (storey.geom.plan) {
    const plan = storey.geom.plan;
    next[storeyId] = { ...storey, geom: { ...storey.geom, plan: {
      ...plan, x: plan.x + dx, y: plan.y + dy,
      ...(plan.calibrationPoints ? { calibrationPoints: plan.calibrationPoints.map(p => shift(p, dx, dy)) } : {}),
    } } };
    movedIds.push(storeyId);
  }

  for (const item of Object.values(items)) {
    const inStorey = members.has(item.id);
    const opening = item.type === 'Stair' ? item.geom.opening : undefined;
    const openingMoves = !!opening && movedSlabs.has(opening.slabId);
    if (!inStorey && !openingMoves) continue;
    if (!('geom' in item) || !item.geom || item.type === 'Section') continue;

    const geom: any = { ...item.geom, _edited: true };
    if (inStorey) {
      for (const [x, y] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']] as const) {
        if (typeof geom[x] === 'number' && typeof geom[y] === 'number') { geom[x] += dx; geom[y] += dy; }
      }
      for (const key of ['polygon', 'footprint'] as const) {
        if (Array.isArray(geom[key])) geom[key] = geom[key].map((p: P) => shift(p, dx, dy));
      }
      if (Array.isArray(geom._placementWorld)) geom._placementWorld = shift(geom._placementWorld, dx, dy);
    }
    if (openingMoves) geom.opening = { ...opening, x: opening!.x + dx, y: opening!.y + dy };
    next[item.id] = { ...item, geom } as IfcEntity;
    movedIds.push(item.id);
  }

  // The trémies that moved stay inside their slab and keep their mutual layout;
  // this only fails if the model was already inconsistent.
  validateStairOpenings(next);

  const warnings: string[] = [];
  for (const id of movedIds) {
    const item = next[id];
    if (item.type !== 'Stair' || !item.geom.opening) continue;
    const stairMoved = members.has(id), openingMoved = movedSlabs.has(item.geom.opening.slabId);
    if (stairMoved === openingMoved) continue;
    warnings.push(`${item.name || id} : l’escalier et sa trémie ne sont plus alignés ; réajuster la trémie.`);
  }
  return { items: next, warnings, movedIds };
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** Footprint of a storey: wall axes, or slab outlines when it has no walls. */
export function storeyFootprint(items: ItemsMap, storeyId: string): Box | null {
  const members = storeyDescendants(items, storeyId);
  const points: P[] = [];
  for (const id of members) {
    const item = items[id];
    if (item?.type === 'Wall') points.push([item.geom.x1, item.geom.y1], [item.geom.x2, item.geom.y2]);
  }
  if (!points.length) for (const id of members) {
    const item = items[id];
    if (item?.type === 'Slab') points.push(...item.geom.polygon);
  }
  const finite = points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (!finite.length) return null;
  return {
    minX: Math.min(...finite.map(p => p[0])), minY: Math.min(...finite.map(p => p[1])),
    maxX: Math.max(...finite.map(p => p[0])), maxY: Math.max(...finite.map(p => p[1])),
  };
}

/** Storey used by default to align on: the nearest one below, else the nearest one above. */
export function defaultAlignmentReference(items: ItemsMap, storeyId: string): string | null {
  const storey = items[storeyId];
  if (storey?.type !== 'Storey') return null;
  const others = Object.values(items).filter(i => i.type === 'Storey' && i.id !== storeyId && storeyFootprint(items, i.id)) as Extract<IfcEntity, { type: 'Storey' }>[];
  const z = storey.geom.elevation;
  const below = others.filter(s => s.geom.elevation < z).sort((a, b) => b.geom.elevation - a.geom.elevation)[0];
  const above = others.filter(s => s.geom.elevation >= z).sort((a, b) => a.geom.elevation - b.geom.elevation)[0];
  return (below ?? above)?.id ?? null;
}

export type AlignmentAnchor = 'corner' | 'center';

/**
 * Offset that lines up a storey's footprint with a reference storey: same lower-left
 * corner of the wall axes, or same centre. Rounded to the millimetre.
 */
export function storeyAlignmentOffset(items: ItemsMap, storeyId: string, referenceId: string, anchor: AlignmentAnchor = 'corner'): [number, number] {
  const moved = storeyFootprint(items, storeyId), reference = storeyFootprint(items, referenceId);
  if (!moved || !reference) throw new Error('Aucun mur ni dalle pour aligner ces étages.');
  const pick = (b: Box): P => anchor === 'center' ? [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] : [b.minX, b.minY];
  const [rx, ry] = pick(reference), [mx, my] = pick(moved);
  const round = (n: number) => Math.round(n * 1000) / 1000 || 0;
  return [round(rx - mx), round(ry - my)];
}

/**
 * Plan alignment: the storey's background plan (image or vector) translated so that `from`,
 * picked on the plan, lands on `to`, picked on the reference storey. Elements do not move.
 */
export function alignBackgroundPlan<T extends { x: number; y: number; calibrationPoints?: [number, number][] }>(plan: T, from: [number, number], to: [number, number]): T {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  return {
    ...plan, x: plan.x + dx, y: plan.y + dy,
    ...(plan.calibrationPoints ? { calibrationPoints: plan.calibrationPoints.map(([x, y]) => [x + dx, y + dy] as [number, number]) } : {}),
  };
}

/** Wall ends and polygon corners of a storey: the points a plan can be aligned on. */
export function storeyAlignmentPoints(items: ItemsMap, storeyId: string): [number, number][] {
  const pts: [number, number][] = [];
  for (const it of Object.values(items)) {
    if (it.parentId !== storeyId) continue;
    const g = (it as any).geom;
    if (it.type === 'Wall') pts.push([g.x1, g.y1], [g.x2, g.y2]);
    else if ((it.type === 'Room' || it.type === 'Slab') && Array.isArray(g?.polygon)) pts.push(...g.polygon);
  }
  return pts;
}
