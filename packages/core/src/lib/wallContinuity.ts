import type { IfcWallEntity, ItemsMap, WallGeom } from '../types/ifc.js';

export type WallEnd = 'start' | 'end';

export interface WallEndpoint {
  wallId: string;
  end: WallEnd;
  point: [number, number];
  parentId: string | null;
}

export interface WallJunction {
  point: [number, number];
  endpoints: WallEndpoint[];
}

function wallEndpoints(wall: IfcWallEntity): WallEndpoint[] {
  return [
    { wallId: wall.id, end: 'start', point: [wall.geom.x1, wall.geom.y1], parentId: wall.parentId },
    { wallId: wall.id, end: 'end', point: [wall.geom.x2, wall.geom.y2], parentId: wall.parentId },
  ];
}

export function findWallJunctions(items: ItemsMap, tolerance = 0.2): WallJunction[] {
  const endpoints = Object.values(items)
    .filter((item): item is IfcWallEntity => item.type === 'Wall')
    .flatMap(wallEndpoints);
  const groups: WallEndpoint[][] = [];

  for (const endpoint of endpoints) {
    const group = groups.find((candidate) =>
      candidate[0].parentId === endpoint.parentId
      && candidate.some((other) => Math.hypot(other.point[0] - endpoint.point[0], other.point[1] - endpoint.point[1]) <= tolerance));
    if (group) group.push(endpoint);
    else groups.push([endpoint]);
  }

  return groups
    .filter((group) => new Set(group.map((endpoint) => endpoint.wallId)).size > 1)
    .map((endpoints) => ({
      point: [
        endpoints.reduce((sum, endpoint) => sum + endpoint.point[0], 0) / endpoints.length,
        endpoints.reduce((sum, endpoint) => sum + endpoint.point[1], 0) / endpoints.length,
      ],
      endpoints,
    }));
}

export function connectedWallEndpoints(
  items: ItemsMap,
  wallId: string,
  end: WallEnd,
  tolerance = 0.2,
): WallEndpoint[] {
  const junction = findWallJunctions(items, tolerance)
    .find((candidate) => candidate.endpoints.some((endpoint) => endpoint.wallId === wallId && endpoint.end === end));
  return junction?.endpoints ?? [];
}

export function wallGeomWithEndpoint(geom: WallGeom, end: WallEnd, point: [number, number]): WallGeom {
  return end === 'start'
    ? { ...geom, x1: point[0], y1: point[1] }
    : { ...geom, x2: point[0], y2: point[1] };
}

export function connectWallEndpoints(
  items: ItemsMap,
  aWallId: string,
  aEnd: WallEnd,
  bWallId: string,
  bEnd: WallEnd,
): void {
  const a = items[aWallId] as IfcWallEntity | undefined;
  const b = items[bWallId] as IfcWallEntity | undefined;
  if (!a || !b || a.parentId !== b.parentId) return;
  const aPoint: [number, number] = aEnd === 'start' ? [a.geom.x1, a.geom.y1] : [a.geom.x2, a.geom.y2];
  const bPoint: [number, number] = bEnd === 'start' ? [b.geom.x1, b.geom.y1] : [b.geom.x2, b.geom.y2];
  const shared: [number, number] = [(aPoint[0] + bPoint[0]) / 2, (aPoint[1] + bPoint[1]) / 2];
  a.geom = wallGeomWithEndpoint(a.geom, aEnd, shared);
  b.geom = wallGeomWithEndpoint(b.geom, bEnd, shared);
}

export function normalizeWallContinuity(items: ItemsMap, tolerance = 0.05): void {
  for (const junction of findWallJunctions(items, tolerance)) {
    for (const endpoint of junction.endpoints) {
      const wall = items[endpoint.wallId] as IfcWallEntity | undefined;
      if (!wall) continue;
      wall.geom = wallGeomWithEndpoint(wall.geom, endpoint.end, junction.point);
    }
  }
}

/** Local wall body limits for butt joints; axes and hosted openings stay unchanged. */
export function wallBodyLimits(wall: IfcWallEntity, items: ItemsMap): [number, number] {
  const g = wall.geom;
  const length = Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
  const limits: [number, number] = [0, length];
  if (length < 1e-6 || g.roofId || g.roofIds?.length) return limits;
  const ux = (g.x2 - g.x1) / length, uy = (g.y2 - g.y1) / length;
  for (const other of Object.values(items)) {
    if (other.type !== 'Wall' || other.id === wall.id || other.parentId !== wall.parentId) continue;
    const h = other.geom;
    const span = Math.hypot(h.x2 - h.x1, h.y2 - h.y1);
    if (span < 1e-6) continue;
    const vx = (h.x2 - h.x1) / span, vy = (h.y2 - h.y1) / span;
    const cross = ux * vy - uy * vx;
    // shortcut: near-parallel joins keep their existing ends; use polygon mitres for acute junctions.
    if (Math.abs(cross) < 0.25) continue;
    for (const end of [0, 1] as const) {
      const x = end ? g.x2 : g.x1, y = end ? g.y2 : g.y1;
      const along = (x - h.x1) * vx + (y - h.y1) * vy;
      const across = (x - h.x1) * -vy + (y - h.y1) * vx;
      if (along < -0.01 || along > span + 0.01 || Math.abs(across) > h.thickness / 2 + 0.01) continue;
      const corner = along < 0.01 || along > span - 0.01;
      // At corners only one wall runs through, avoiding two protruding end caps.
      if (corner && (g.thickness < h.thickness || (g.thickness === h.thickness && wall.id > other.id))) continue;
      const target = h.thickness / (2 * Math.abs(cross)) + (end ? 1 : -1) * across / cross;
      if (target <= 0 || target > Math.max(g.thickness, h.thickness) * 2) continue;
      limits[end] = end ? Math.max(limits[1], length + target) : Math.min(limits[0], -target);
    }
  }
  return limits;
}
