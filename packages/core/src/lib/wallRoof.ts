import type { IfcWallEntity, ItemsMap } from '../types/ifc.js';
import { buildRoof, roofHeightAt } from './roofGeometry.js';

/** Wall-local distances and heights along the attached roof's underside. */
export function wallRoofProfile(wall: IfcWallEntity, items: ItemsMap): [number, number][] | null {
  if (wall.ifcType === 'IfcCurtainWall' || !Number.isFinite(wall.geom.thickness) || wall.geom.thickness <= 0) return null;
  const solids = (wall.geom.roofIds ?? [wall.geom.roofId ?? '']).map(id => items[id])
    .filter(roof => roof?.type === 'Roof' && roof.parentId === wall.parentId)
    .map(roof => buildRoof((roof as any).geom)).filter(s => s !== null && !s.approximate);
  if (!solids.length) return null;
  const { x1, y1, x2, y2 } = wall.geom;
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  if (len < 0.01) return null;
  const cuts = [0, 1];
  for (const solid of solids) for (const f of solid.top) for (let i = 0; i < f.pts.length; i++) {
    const a = f.pts[i], b = f.pts[(i + 1) % f.pts.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const det = dx * ey - dy * ex;
    if (Math.abs(det) < 1e-10) continue;
    const t = ((a[0] - x1) * ey - (a[1] - y1) * ex) / det;
    const u = ((a[0] - x1) * dy - (a[1] - y1) * dx) / det;
    if (t > 0 && t < 1 && u >= -1e-8 && u <= 1 + 1e-8) cuts.push(t);
  }
  const sorted = cuts.sort((a, b) => a - b).filter((t, i, all) => !i || t - all[i - 1] > 1e-8);
  const result: [number, number][] = [];
  for (let i = 1; i < sorted.length; i++) {
    const mid = (sorted[i - 1] + sorted[i]) / 2;
    const covering = solids.filter(s => roofHeightAt(s, [x1 + dx * mid, y1 + dy * mid]) !== null);
    if (!covering.length) return null;
    const solid = covering.reduce((a, b) =>
      a.elevation + roofHeightAt(a, [x1 + dx * mid, y1 + dy * mid])! - a.thickness >=
      b.elevation + roofHeightAt(b, [x1 + dx * mid, y1 + dy * mid])! - b.thickness ? a : b);
    for (const t of [sorted[i - 1], sorted[i]]) {
      const z = roofHeightAt(solid, [x1 + dx * t, y1 + dy * t]);
      if (z === null) return null;
      const h = solid.elevation + z - solid.thickness;
      if (!Number.isFinite(h) || h <= 0) return null;
      const last = result[result.length - 1];
      if (!last || Math.abs(last[0] - t * len) > 1e-8 || Math.abs(last[1] - h) > 1e-8) result.push([t * len, h]);
    }
  }
  for (const item of Object.values(items)) {
    if ((item.type !== 'Door' && item.type !== 'Window') || item.geom.wallId !== wall.id) continue;
    const top = item.geom.height + (item.type === 'Window' ? Number((item.geom as any).sillHeight ?? 0.9) : 0);
    const a = Math.max(0, item.geom.t * len - item.geom.width / 2);
    const b = Math.min(len, item.geom.t * len + item.geom.width / 2);
    const heightAt = (x: number) => {
      const i = Math.max(1, result.findIndex(p => p[0] >= x));
      const p = result[i - 1], q = result[i];
      return p[1] + (q[1] - p[1]) * (x - p[0]) / (q[0] - p[0]);
    };
    const heights = [heightAt(a), heightAt(b), ...result.filter(p => p[0] > a && p[0] < b).map(p => p[1])];
    if (top >= Math.min(...heights)) return null;
  }
  return result;
}

/** IFC extrusion of a wall elevation, with its hosted openings retained as voids. */
export function wallRoofShape(wall: IfcWallEntity, items: ItemsMap, emit: (text: string) => number, context: number): number | null {
  const profile = wallRoofProfile(wall, items);
  if (!profile) return null;
  const ref = (n: number) => `#${n}`;
  const poly = (points: number[][]) => {
    const ids = points.map(p => emit(`IFCCARTESIANPOINT((${p[0]},${p[1]}))`));
    return emit(`IFCPOLYLINE((${[...ids, ids[0]].map(ref).join(',')}))`);
  };
  const length = profile[profile.length - 1][0];
  const outer = poly([[0, 0], [length, 0], ...profile.slice().reverse()]);
  const holes: number[] = [];
  for (const item of Object.values(items)) {
    if (item.type !== 'Door' && item.type !== 'Window') continue;
    if (item.geom.wallId !== wall.id) continue;
    const g = item.geom;
    const a = g.t * length - g.width / 2, b = a + g.width;
    const bottom = item.type === 'Window' ? Number((g as any).sillHeight ?? 0.9) : 0;
    const top = bottom + g.height;
    // Door voids touching the base are represented by their IFC opening relation.
    if (bottom <= 0 || a <= 0 || b >= length) continue;
    holes.push(poly([[a, bottom], [a, top], [b, top], [b, bottom]]));
  }
  const area = holes.length
    ? emit(`IFCARBITRARYPROFILEDEFWITHVOIDS(.AREA.,$,${ref(outer)},(${holes.map(ref).join(',')}))`)
    : emit(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${ref(outer)})`);
  const origin = emit(`IFCCARTESIANPOINT((0.,${wall.geom.thickness / 2},0.))`);
  const axis = emit('IFCDIRECTION((0.,-1.,0.))');
  const x = emit('IFCDIRECTION((1.,0.,0.))');
  const placement = emit(`IFCAXIS2PLACEMENT3D(${ref(origin)},${ref(axis)},${ref(x)})`);
  const direction = emit('IFCDIRECTION((0.,0.,1.))');
  const solid = emit(`IFCEXTRUDEDAREASOLID(${ref(area)},${ref(placement)},${ref(direction)},${wall.geom.thickness})`);
  const rep = emit(`IFCSHAPEREPRESENTATION(#${context},'Body','SweptSolid',(${ref(solid)}))`);
  return emit(`IFCPRODUCTDEFINITIONSHAPE($,$,(${ref(rep)}))`);
}
