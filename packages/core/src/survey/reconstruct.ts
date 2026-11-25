import type { IfcAnnotationEntity, IfcDoorEntity, IfcEntity, IfcFurnitureEntity, IfcSpaceEntity, IfcStoreyEntity, IfcTechnicalEntity, IfcWallEntity, IfcWindowEntity, ItemsMap } from '../types/ifc.js';
import { guid } from '../data/starter.js';
import { TECHNICAL_CATALOGUE } from '../data/technicalCatalogue.js';
import { roomGroups } from './globalPlan.js';
import { surveyDefaults, linkedFaces, technicalPointPlanPosition, technicalPointReady, wallLinks, type PhotoAnnotation, type SurveyLevel, type SurveyOpening, type SurveyRoom } from './surveyFile.js';
import { tr } from './lang.js';
import { SURVEY_FURNITURE_MODELS, SURVEY_STRUCTURE_MODELS } from './surveyFile.js';
import { chimneyGeom, chimneyHeightThroughRoof, columnGeom } from '../lib/structuralElements.js';
import { levelReliability, type StoredReliability, type SurveyReliability } from './reliability.js';

/**
 * Survey correlation (CONTEXT.md): carried by every BIM element produced by a reconstruction,
 * so a new reconstruction updates that element instead of creating another one.
 */
export interface SurveyRef {
  surveyId: string;
  roomId: string;
  /** Absent for elements without a host wall. */
  wallId?: string;
  /** Set for a door or window; a door that becomes a window is a new BIM element. */
  openingId?: string;
  openingKind?: 'door' | 'window';
  technicalPointId?: string;
  furnitureId?: string;
  /** Set for the cote of a measured wall face. */
  dimension?: true;
  /** What the last reconstruction wrote; a differing element was modified in skAItch since. */
  snapshot?: string;
  /** Survey reliability computed at the last reconstruction (ADR 0016). */
  reliability?: StoredReliability;
}

/** An element produced by the survey and modified by hand since the last reconstruction. */
export interface ReconstructionConflict {
  id: string;
  name: string;
  /** What the reconstruction would do to it. */
  action: 'update' | 'delete';
  /**
   * Produced by another survey than the one now on the storey (a survey started anew): the
   * reconstruction no longer follows it. "overwrite" deletes it, "keep" turns it into an
   * ordinary element. `modified` tells whether it was also changed by hand.
   */
  previousSurvey?: { modified: boolean };
}

/** keep: leave the hand-modified element as it is; overwrite: apply the survey. */
export type ConflictResolution = 'keep' | 'overwrite';

export interface ReconstructionResult {
  items: ItemsMap;
  created: string[];
  updated: string[];
  deleted: string[];
  /** Hand-modified elements left as they are (resolution "keep"). */
  kept: string[];
  /**
   * Conflicts without a resolution. When non-empty nothing is applied: `items` is the input
   * map unchanged, and the caller asks the user before reconstructing again with resolutions.
   */
  conflicts: ReconstructionConflict[];
}

export const DEFAULT_WALL_HEIGHT = 2.8;
const ROOM_GAP = 1;
/** Two linked faces further apart than this on the plan are not merged into one wall. */
const MAX_LINKED_GAP = 0.8;

/**
 * Room offsets in the storey frame until the global plan places rooms (#55). Rooms joined by
 * linked faces keep their drawn relative position; separate groups are laid side by side along x.
 */
export function layoutRooms(level: SurveyLevel): Map<string, [number, number]> {
  const offsets = new Map<string, [number, number]>();
  let cursor = 0;
  for (const rooms of roomGroups(level)) {
    const pts = rooms.flatMap(r => r.polygon);
    const minX = Math.min(...pts.map(p => p[0])), maxX = Math.max(...pts.map(p => p[0])), minY = Math.min(...pts.map(p => p[1]));
    for (const room of rooms) offsets.set(room.id, [cursor - minX, -minY]);
    cursor += maxX - minX + ROOM_GAP;
  }
  return offsets;
}

/** Distance of a measured cote from its face, inside the room (m). */
const DIMENSION_INSET = 0.3;

const faceKey = (roomId: string, wallId: string) => `${roomId}|${wallId}`;

type Pt = [number, number];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];

/**
 * One BIM wall per physical wall. Linked faces lie on the same axis but are often measured with
 * slightly different lengths (one face of a wall is longer than the other, or the rooms are only
 * partly facing): a face covered by its linked face produces no wall (the longer face carries it),
 * and a partial overlap is cut from the face with the larger key so the two walls only meet.
 * Returns the faces without a wall (→ the face hosting their openings) and the trimmed axes.
 */
function resolveLinkedFaces(level: SurveyLevel, axes: Map<string, { start: Pt; end: Pt }>) {
  const secondary = new Map<string, string>();
  const trimmed = new Map<string, { start: Pt; end: Pt }>();
  const TOL = 0.02;
  for (const room of level.rooms) for (const wall of room.walls) for (const link of linkedFaces(level, wall)) {
    if (secondary.has(faceKey(room.id, wall.id))) break;
    const self = faceKey(room.id, wall.id), other = faceKey(link.room.id, link.wall.id);
    const a = axes.get(self), b = axes.get(other);
    if (!a || !b) continue;
    // Positions of this face's ends along the other face's axis.
    const bd = sub(b.end, b.start), bl = Math.hypot(bd[0], bd[1]);
    if (bl < 1e-9) continue;
    const u: Pt = [bd[0] / bl, bd[1] / bl];
    const along = (p: Pt) => (p[0] - b.start[0]) * u[0] + (p[1] - b.start[1]) * u[1];
    // Faces drawn further apart than a wall (a room not placed yet) each keep their own wall.
    const across = Math.abs((a.start[0] - b.start[0]) * u[1] - (a.start[1] - b.start[1]) * u[0]);
    if (across > MAX_LINKED_GAP) continue;
    const [s0, s1] = [along(a.start), along(a.end)];
    const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
    const selfCovered = lo >= -TOL && hi <= bl + TOL;
    const otherCovered = lo <= TOL && hi >= bl - TOL;
    if (selfCovered && (!otherCovered || self > other)) { secondary.set(self, other); continue; }
    if (selfCovered || otherCovered || self < other) continue; // the other face is the one cut
    const ovLo = Math.max(lo, 0), ovHi = Math.min(hi, bl);
    if (ovHi - ovLo <= TOL) continue; // not facing each other
    // Keep the part of this face outside the other one.
    const keep: [number, number] = lo < 0 ? [lo, 0] : [bl, hi];
    const at = (t: number): Pt => [b.start[0] + u[0] * t, b.start[1] + u[1] * t];
    const [p, q] = s0 < s1 ? [at(keep[0]), at(keep[1])] : [at(keep[1]), at(keep[0])];
    trimmed.set(self, { start: p, end: q });
  }
  return { secondary, trimmed };
}

/**
 * The two faces of a linked wall are the two sides of one physical wall: its thickness is the gap
 * between them as placed on the plan, unless it was measured. Both rooms put the wall axis on the
 * midline between the faces, so the pair gives one wall and the corners of both rooms join it. A gap outside 3–60 cm (faces drawn
 * overlapping or far apart) keeps the typed thicknesses.
 */
function withLinkedThickness(level: SurveyLevel, worldOf: (roomId: string) => (p: Pt) => Pt): SurveyLevel {
  // With several linked faces, the first one gives the gap: one BIM wall has one thickness (ADR 0013).
  const gap = (room: SurveyRoom, wall: SurveyRoom['walls'][number]): number | null => {
    const link = linkedFaces(level, wall)[0];
    if (!link) return null;
    const w = worldOf(room.id), wo = worldOf(link.room.id);
    const [a, b] = [w(room.polygon[wall.from]), w(room.polygon[wall.to])];
    const c = wo(link.room.polygon[link.wall.from]);
    const d = sub(b, a), l = Math.hypot(d[0], d[1]);
    if (l < 1e-9) return null;
    // Distance from the other face to this face's line, on the outer side (right of a CCW edge).
    const g = ((c[0] - a[0]) * d[1] - (c[1] - a[1]) * d[0]) / l;
    return g >= 0.03 && g <= 0.6 ? +g.toFixed(4) : null;
  };
  return {
    ...level,
    rooms: level.rooms.map(room => ({
      ...room,
      // A measured thickness is kept (a 5 cm partition drawn 20 cm away from the other room);
      // otherwise the wall fills the gap.
      walls: room.walls.map(wall => {
        const g = gap(room, wall);
        if (g === null) return wall;
        const other = linkedFaces(level, wall)[0].wall;
        const measured = wall.thicknessStatus === 'measured' ? wall.thickness_m : other.thicknessStatus === 'measured' ? other.thickness_m : null;
        return { ...wall, thickness_m: measured ?? g, axisOffset_m: g / 2 };
      }),
    })),
  };
}

function intersect(p: Pt, d: Pt, q: Pt, e: Pt): Pt | null {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

/**
 * Wall axes of a room: each inner face edge is pushed outward by half its wall thickness,
 * and consecutive axes are joined at their intersection so the corners close.
 */
export function roomWallAxes(room: SurveyRoom): { wallId: string; start: Pt; end: Pt; thickness: number }[] {
  const n = room.polygon.length;
  const lines = room.walls.map(wall => {
    const a = room.polygon[wall.from], b = room.polygon[wall.to];
    const d = sub(b, a);
    const len = Math.hypot(d[0], d[1]);
    // Counter-clockwise polygon: the outward normal is on the right of each edge.
    const nx = d[1] / len, ny = -d[0] / len;
    // A linked wall's axis sits midway between its two faces, whatever its thickness.
    const h = (wall as { axisOffset_m?: number }).axisOffset_m ?? wall.thickness_m / 2;
    return { wall, p: [a[0] + nx * h, a[1] + ny * h] as Pt, q: [b[0] + nx * h, b[1] + ny * h] as Pt, d };
  });
  const byFrom = new Map(lines.map(l => [l.wall.from, l]));
  return lines.map(line => {
    const prev = byFrom.get((line.wall.from - 1 + n) % n)!;
    const next = byFrom.get(line.wall.to)!;
    const start = intersect(prev.p, prev.d, line.p, line.d) ?? line.p;
    const end = intersect(line.p, line.d, next.p, next.d) ?? line.q;
    return { wallId: line.wall.id, start, end, thickness: line.wall.thickness_m };
  });
}

/** Height between this storey and the next one up, used for walls; never the ceiling height. */
function wallHeight(items: ItemsMap, storey: IfcStoreyEntity): number {
  const above = Object.values(items)
    .filter((i): i is IfcStoreyEntity => i.type === 'Storey' && i.parentId === storey.parentId && i.geom.elevation > storey.geom.elevation)
    .sort((a, b) => a.geom.elevation - b.geom.elevation)[0];
  return above ? above.geom.elevation - storey.geom.elevation : DEFAULT_WALL_HEIGHT;
}

/** The fields a reconstruction owns; anything else (properties, materials…) is the user's. */
export function surveySnapshot(item: IfcEntity): string {
  const g = (item as { geom?: Record<string, unknown> }).geom ?? {};
  if (item.type === 'Wall') return JSON.stringify([g.x1, g.y1, g.x2, g.y2, g.thickness, g.height]);
  if (item.type === 'Door' || item.type === 'Window')
    return JSON.stringify([g.wallId, g.t, g.width, g.height, g.sillHeight, g.swing, g.side, (item as { OperationType?: string }).OperationType]);
  if (item.type === 'Dimension') return JSON.stringify([g.x1, g.y1, g.x2, g.y2, g.value]);
  if (item.type === 'Technical') return JSON.stringify([g.x, g.y, g.rotation, g.mountHeight, item.model]);
  if (item.type === 'Furniture') return JSON.stringify([g.x, g.y, g.w, g.d, g.h, g.rotation, item.model]);
  if (item.type === 'Column') return JSON.stringify([g.x, g.y, g.w, g.d, g.h, g.rotation, g.shape]);
  if (item.type === 'Chimney') return JSON.stringify([g.x, g.y, g.w, g.d, g.h, g.rotation, item.kind]);
  return JSON.stringify([item.name, g.polygon, g.height]);
}

export const surveyRefOf = (item: IfcEntity): SurveyRef | undefined => (item as { surveyRef?: SurveyRef }).surveyRef;

/**
 * Survey reliability of an element (ADR 0016): what the last reconstruction computed, or
 * `modified` when the element was changed by hand since. Undefined for elements not from a survey.
 */
export function surveyReliability(item: IfcEntity): SurveyReliability | undefined {
  const ref = surveyRefOf(item);
  // An element imported from an IFC keeps the reliability its Pset_skAItchSurvey gave.
  if (!ref) return reliabilityFromIfc((item as { SurveyReliability?: string }).SurveyReliability);
  if (ref.snapshot !== undefined && ref.snapshot !== surveySnapshot(item)) return 'modified';
  return ref.reliability;
}

const refKey = (r: SurveyRef) => r.technicalPointId
  ? JSON.stringify([r.surveyId, r.roomId, r.technicalPointId])
  : r.furnitureId ? JSON.stringify([r.surveyId, r.roomId, 'furniture', r.furnitureId])
  : `${r.surveyId}|${r.roomId}|${r.wallId ?? ''}|${r.openingId ?? ''}|${r.openingKind ?? ''}${r.dimension ? '|dim' : ''}`;

/** Survey mechanism → IFC operation type and catalogue symbol. */
function openingType(o: SurveyOpening): { operation: string; catalogueId: string } {
  if (o.kind === 'door') {
    if (o.operation === 'none') return { operation: 'NONE', catalogueId: 'door-opening' };
    if (o.operation === 'double_swing') return { operation: 'DOUBLE_DOOR_SINGLE_SWING', catalogueId: 'door-double' };
    if (o.operation === 'sliding') return { operation: 'SLIDING', catalogueId: 'door-sliding' };
    return o.hinge === 'start'
      ? { operation: 'SINGLE_SWING_LEFT', catalogueId: 'door-single-left' }
      : { operation: 'SINGLE_SWING_RIGHT', catalogueId: 'door-single-right' };
  }
  return {
    fixed: { operation: 'FIXED', catalogueId: 'win-fixed' },
    single_swing: { operation: 'SINGLE_PANEL', catalogueId: 'win-single' },
    double_swing: { operation: 'DOUBLE_PANEL', catalogueId: 'win-double' },
    sliding: { operation: 'SLIDING', catalogueId: 'win-sliding' },
    tilt_turn: { operation: 'TILT_AND_TURN', catalogueId: 'win-tilt' },
  }[o.operation];
}

/**
 * Creates or updates the BIM elements of a storey from its associated survey level.
 * Elements that do not come from this survey are never touched.
 */
export function reconstructStorey(
  items: ItemsMap, storeyId: string, now = Date.now(), resolutions: Record<string, ConflictResolution> = {},
): ReconstructionResult {
  const storey = items[storeyId];
  if (!storey || storey.type !== 'Storey') throw new Error(`Storey not found: ${storeyId}`);
  const survey = (storey as IfcStoreyEntity).survey;
  if (!survey) throw new Error('No survey is attached to this storey.');

  const next: ItemsMap = { ...items };
  const existing = new Map<string, IfcEntity>();
  const previous: IfcEntity[] = [];
  for (const item of Object.values(items)) {
    const ref = surveyRefOf(item);
    if (!ref || item.parentId !== storeyId) continue;
    if (ref.surveyId === survey.surveyId) existing.set(refKey(ref), item);
    else previous.push(item);
  }
  const created: string[] = [], updated: string[] = [], kept: string[] = [], seen = new Set<string>();
  const conflicts: ReconstructionConflict[] = [];
  const modified = (item: IfcEntity) => {
    const snapshot = surveyRefOf(item)?.snapshot;
    return snapshot !== undefined && snapshot !== surveySnapshot(item);
  };
  /** True when the survey may change this element; records a conflict or a "keep" otherwise. */
  const mayChange = (item: IfcEntity, action: ReconstructionConflict['action']) => {
    if (!modified(item)) return true;
    const resolution = resolutions[item.id];
    if (resolution === 'overwrite') return true;
    if (resolution === 'keep') kept.push(item.id);
    else conflicts.push({ id: item.id, name: item.name, action });
    return false;
  };
  const stamp = <T extends IfcEntity>(item: T, ref: SurveyRef): T => {
    const { snapshot: _, ...bare } = ref;
    return { ...item, surveyRef: { ...bare, snapshot: surveySnapshot(item) } };
  };
  const height = wallHeight(items, storey as IfcStoreyEntity);
  const offsets = layoutRooms(survey.level);
  let seq = 0;
  const newId = (prefix: string) => {
    let id: string;
    do id = `${prefix}_srv_${now}_${seq++}`; while (items[id]); // never reuse an id still in the model
    return id;
  };

  /** Creates or updates the element correlated with `ref`; returns its BIM id. */
  const upsert = <T extends IfcEntity>(ref: SurveyRef, build: (id: string) => T, patch: (cur: T) => T): string => {
    const cur = existing.get(refKey(ref)) as T | undefined;
    if (cur) {
      seen.add(cur.id);
      const patched = patch(cur);
      // Already what the survey asks for (possibly because the hand edit matches it): no conflict.
      if (surveySnapshot(patched) === surveySnapshot(cur)) {
        // Restamped anyway: the reliability may have changed without the geometry.
        next[cur.id] = stamp(cur, ref);
        return cur.id;
      }
      if (mayChange(cur, 'update')) {
        next[cur.id] = stamp(patched, ref);
        updated.push(cur.id);
      }
      return cur.id;
    }
    const item = build(newId(ref.technicalPointId ? 'tech' : ref.furnitureId ? 'fur' : ref.dimension ? 'dim' : ref.openingId ? 'op' : ref.wallId ? 'w' : 'rm'));
    next[item.id] = stamp(item, ref);
    created.push(item.id);
    return item.id;
  };

  const worldOf = (roomId: string) => { const [ox, oy] = offsets.get(roomId)!; return (p: Pt): Pt => [p[0] + ox, p[1] + oy]; };
  /** BIM wall per face, and the world axis of each face (a face's own axis, even when it has no BIM wall). */
  const hostIds = new Map<string, string>();
  const faceAxis = new Map<string, { start: Pt; end: Pt; faceStart: number }>();

  const level = withLinkedThickness(survey.level, worldOf);
  const reliability = levelReliability(survey.level);
  // World axis of every face first: linked faces are compared on them.
  const worldAxes = new Map<string, { start: Pt; end: Pt }>();
  for (const room of level.rooms) {
    const world = worldOf(room.id);
    for (const axis of roomWallAxes(room)) worldAxes.set(faceKey(room.id, axis.wallId), { start: world(axis.start), end: world(axis.end) });
  }
  const { secondary, trimmed } = resolveLinkedFaces(level, worldAxes);

  // Pass 1: walls and spaces.
  for (const room of level.rooms) {
    const world = worldOf(room.id);
    for (const axis of roomWallAxes(room)) {
      const wall = room.walls.find(w => w.id === axis.wallId)!;
      const [start, end] = [world(axis.start), world(axis.end)];
      const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
      const face = world(room.polygon[wall.from]);
      // The cotes run along the inner face from its start vertex: where that vertex falls on the axis.
      const faceStart = ((face[0] - start[0]) * (end[0] - start[0]) + (face[1] - start[1]) * (end[1] - start[1])) / len;
      faceAxis.set(faceKey(room.id, wall.id), { start, end, faceStart });
      if (secondary.has(faceKey(room.id, wall.id))) continue; // the linked face carries the wall
      const cut = trimmed.get(faceKey(room.id, wall.id));
      const [x1, y1] = cut?.start ?? start, [x2, y2] = cut?.end ?? end;
      const ref: SurveyRef = { surveyId: survey.surveyId, roomId: room.id, wallId: axis.wallId, reliability: reliability.wall(room.id, axis.wallId) };
      const name = `${room.name} — ${wall.name || axis.wallId}`;
      hostIds.set(faceKey(room.id, wall.id), upsert<IfcWallEntity>(ref, id => ({
        id, type: 'Wall', ifcType: 'IfcWall', name, Name: name, GlobalId: guid(id), parentId: storeyId,
        PredefinedType: 'STANDARD', IsExternal: false, LoadBearing: false, FireRating: '', ThermalTransmittance: 0.4, Material: '',
        material: '', fireRating: '', loadBearing: false, isExternal: false,
        geom: { x1, y1, x2, y2, thickness: axis.thickness, height },
        surveyRef: ref,
      } as IfcWallEntity), cur => ({ ...cur, geom: { ...cur.geom, x1, y1, x2, y2, thickness: axis.thickness, height } })));
    }
    // Measured cotes: one per measured face, inside the room along the face, showing the value measured.
    for (const wall of room.walls) {
      if (!wall.locked) continue;
      const [a, b] = [world(room.polygon[wall.from]), world(room.polygon[wall.to])];
      const d = sub(b, a), l = Math.hypot(d[0], d[1]);
      if (l < 1e-6) continue;
      // Counter-clockwise room: the interior is on the left of each edge.
      const [nx, ny] = [-d[1] / l * DIMENSION_INSET, d[0] / l * DIMENSION_INSET];
      const dgeom = { x1: a[0] + nx, y1: a[1] + ny, x2: b[0] + nx, y2: b[1] + ny, value: wall.length_m };
      const ref: SurveyRef = { surveyId: survey.surveyId, roomId: room.id, wallId: wall.id, dimension: true, reliability: reliability.wall(room.id, wall.id) };
      const name = `${room.name} — cote ${wall.length_m.toFixed(2).replace('.', ',')} m`;
      upsert<IfcAnnotationEntity>(ref, id => ({
        id, type: 'Dimension', ifcType: 'IfcAnnotation', name, Name: name, GlobalId: guid(id), parentId: storeyId,
        geom: dgeom, surveyRef: ref,
      } as IfcAnnotationEntity), cur => ({ ...cur, name, Name: name, geom: { ...cur.geom, ...dgeom } }));
    }
    const polygon = room.polygon.map(world);
    const ref: SurveyRef = { surveyId: survey.surveyId, roomId: room.id, reliability: reliability.room(room.id) };
    const spaceHeight = room.ceilingHeight_m ?? surveyDefaults(survey).ceilingHeight_m;
    upsert<IfcSpaceEntity>(ref, id => ({
      id, type: 'Room', ifcType: 'IfcSpace', name: room.name, Name: room.name, GlobalId: guid(id), parentId: storeyId,
      geom: { polygon, height: spaceHeight }, function: '', occupancy: 0, surveyRef: ref,
    } as IfcSpaceEntity), cur => ({ ...cur, name: room.name, Name: room.name, geom: { ...cur.geom, polygon, height: spaceHeight } }));
  }

  // Pass 2: openings, hosted by the BIM wall of their face or of its linked face.
  for (const room of level.rooms) {
    for (const opening of room.openings ?? []) {
      const key = faceKey(room.id, opening.wallId);
      const own = faceAxis.get(key)!;
      const ownLen = Math.hypot(own.end[0] - own.start[0], own.end[1] - own.start[1]);
      const u: Pt = [(own.end[0] - own.start[0]) / ownLen, (own.end[1] - own.start[1]) / ownLen];
      const along = own.faceStart + opening.offset_m + opening.width_m / 2;
      const centre: Pt = [own.start[0] + u[0] * along, own.start[1] + u[1] * along];
      // The BIM wall's actual axis (trimmed when it overlapped its linked face).
      const wallAxis = (k: string) => trimmed.get(k) ?? faceAxis.get(k)!;
      const tOn = (k: string) => { const h = wallAxis(k); const hx = h.end[0] - h.start[0], hy = h.end[1] - h.start[1]; return ((centre[0] - h.start[0]) * hx + (centre[1] - h.start[1]) * hy) / (hx * hx + hy * hy); };
      let hostKey = secondary.get(key) ?? key;
      // On a trimmed face, an opening in the cut part belongs to the linked face's wall.
      // The linked face whose wall holds the opening's centre (a face may be linked to several).
      if (trimmed.has(hostKey) && (tOn(hostKey) < 0 || tOn(hostKey) > 1)) {
        const links = wallLinks(room.walls.find(w => w.id === opening.wallId)!).map(l => faceKey(l.roomId, l.wallId)).filter(k => faceAxis.has(k));
        const holder = links.find(k => { const t = tOn(k); return t >= 0 && t <= 1; }) ?? links[0];
        if (holder) hostKey = holder;
      }
      const hostId = hostIds.get(hostKey)!;
      const host = wallAxis(hostKey);
      // Position on the host wall, whose direction may be opposite to this face.
      const hx = host.end[0] - host.start[0], hy = host.end[1] - host.start[1];
      const t = tOn(hostKey);
      const same = u[0] * hx + u[1] * hy > 0;
      const { operation, catalogueId } = openingType(opening);
      const geom = {
        wallId: hostId, t, width: opening.width_m, height: opening.height_m,
        // Hinge at the start of the host wall is "left"; side 1 is the host's left-hand normal, i.e. this
        // room's side when the face runs along the host (counter-clockwise rooms keep their interior on the left).
        swing: (opening.hinge === 'start') === same ? 'left' as const : 'right' as const,
        side: (opening.swing === 'in') === same ? 1 : -1,
        catalogueId, ...(opening.kind === 'window' ? { sillHeight: opening.sill_m ?? 0.9 } : {}),
      };
      const ref: SurveyRef = { surveyId: survey.surveyId, roomId: room.id, wallId: opening.wallId, openingId: opening.id, openingKind: opening.kind, reliability: reliability.opening(room.id, opening) };
      const name = `${room.name} — ${opening.kind === 'door' ? tr('Porte', 'Door') : tr('Fenêtre', 'Window')}`;
      if (opening.kind === 'door') {
        upsert<IfcDoorEntity>(ref, id => ({
          id, type: 'Door', ifcType: 'IfcDoor', name, Name: name, GlobalId: guid(id), parentId: storeyId,
          PredefinedType: 'DOOR', OperationType: operation as IfcDoorEntity['OperationType'], OverallWidth: geom.width, OverallHeight: geom.height,
          FireRating: '', Material: '', material: '', fireRating: '', geom, surveyRef: ref,
        } as IfcDoorEntity), cur => ({ ...cur, OperationType: operation as IfcDoorEntity['OperationType'], OverallWidth: geom.width, OverallHeight: geom.height, geom: { ...cur.geom, ...geom } }));
      } else {
        const wgeom = geom as typeof geom & { sillHeight: number };
        upsert<IfcWindowEntity>(ref, id => ({
          id, type: 'Window', ifcType: 'IfcWindow', name, Name: name, GlobalId: guid(id), parentId: storeyId,
          PredefinedType: 'WINDOW', OperationType: operation, OverallWidth: geom.width, OverallHeight: geom.height,
          ThermalTransmittance: 1.4, Material: '', material: '', uValue: 1.4, geom: wgeom, surveyRef: ref,
        } as IfcWindowEntity), cur => ({ ...cur, OperationType: operation, OverallWidth: geom.width, OverallHeight: geom.height, geom: { ...cur.geom, ...wgeom } }));
      }
    }
  }

  for (const room of level.rooms) {
    const world = worldOf(room.id);
    const ceiling = room.ceilingHeight_m ?? surveyDefaults(survey).ceilingHeight_m;
    for (const point of room.technicalPoints ?? []) {
      const wall = room.walls.find(w => w.id === point.wallId);
      const model = TECHNICAL_CATALOGUE.find(m => m.id === point.model);
      if (!wall || !model) continue;
      const wallReliability = reliability.wall(room.id, wall.id);
      const ref: SurveyRef = {
        surveyId: survey.surveyId, roomId: room.id, wallId: wall.id, technicalPointId: point.id,
        reliability: wallReliability === 'measured' && !(point.distanceMeasured && point.heightMeasured) ? 'partial' : wallReliability,
      };
      const position = technicalPointPlanPosition(point, room, wall);
      if (!position || !technicalPointReady(point, room, wall, ceiling)) {
        const previousPoint = existing.get(refKey(ref));
        if (previousPoint) seen.add(previousPoint.id);
        continue;
      }
      const [x, y] = world([position.x, position.y]);
      const geom = { x, y, rotation: position.rotation, mountHeight: point.height_m };
      const name = tr(model.labelFr, model.labelEn);
      const definition = { model: model.id, ifcType: model.ifcType, discipline: model.discipline, category: model.category };
      const defaults = { diameter: model.defaults.diameter, fluidType: model.defaults.fluidType };
      upsert<IfcTechnicalEntity>(ref, id => ({
        id, type: 'Technical', name, Name: name, GlobalId: guid(id), parentId: storeyId, ...definition, ...defaults, geom,
      }), cur => cur.model === model.id
        ? { ...cur, geom: { ...cur.geom, ...geom } }
        : { ...cur, ...definition, ...defaults, name, Name: name, geom: { ...cur.geom, ...geom } });
    }
  }

  for (const room of level.rooms) for (const furniture of room.furniture ?? []) {
    const model = SURVEY_FURNITURE_MODELS.find(m => m.id === furniture.model);
    if (!model) continue;
    const [cx, cy] = worldOf(room.id)(furniture.center);
    const { width_m: w, depth_m: d, height_m: h, rotation } = furniture;
    const geom = { x: cx - w / 2, y: cy - d / 2, w, d, h, rotation };
    const ref: SurveyRef = { surveyId: survey.surveyId, roomId: room.id, furnitureId: furniture.id, reliability: 'assumed' };
    const name = tr(model.labelFr, model.labelEn);
    const structure = SURVEY_STRUCTURE_MODELS.find(m => m.id === model.id)?.structure;
    if (structure) {
      // Columns and chimneys: centre-placed; a chimney under a roof rises 0.50 m above it.
      const at = { x: cx, y: cy, rotation, width: w, depth: d, height: h };
      const built = structure.type === 'Column'
        ? { type: 'Column' as const, ifcType: 'IfcColumn' as const, geom: columnGeom({ ...at, shape: structure.shape, ...(structure.shape === 'circle' && { diameter: w }) }, undefined, h) }
        : { type: 'Chimney' as const, ifcType: 'IfcChimney' as const, ...chimneyGeom({ ...at, kind: structure.kind, height: Math.max(h, chimneyHeightThroughRoof(items, storeyId, cx, cy) ?? 0) }, undefined, h) };
      upsert<IfcEntity>(ref, id => ({ id, name, Name: name, GlobalId: guid(id), parentId: storeyId, ...built }) as IfcEntity,
        cur => ({ ...cur, ...built, ...(cur.type !== built.type && { name, Name: name }), geom: { ...(cur as any).geom, ...built.geom } }) as IfcEntity);
      continue;
    }
    const definition = { model: model.id, category: model.category };
    upsert<IfcFurnitureEntity>(ref, id => ({
      id, type: 'Furniture', ifcType: 'IfcFurnishingElement', name, Name: name, GlobalId: guid(id), parentId: storeyId, ...definition, geom,
    }), cur => ({
      ...cur, ...definition, ...(cur.model !== model.id && { name, Name: name }), geom: { ...cur.geom, ...geom },
    }));
  }

  // Elements whose room or wall left the survey disappear with it.
  const deleted = [...existing.values()].filter(i => !seen.has(i.id) && mayChange(i, 'delete')).map(i => i.id);
  // Elements of a previous survey of this storey: the user decides, never silently kept or deleted.
  for (const item of previous) {
    const resolution = resolutions[item.id];
    if (resolution === 'overwrite') deleted.push(item.id);
    else if (resolution === 'keep') {
      const { surveyRef: _, ...ordinary } = item as IfcEntity & { surveyRef?: SurveyRef };
      next[item.id] = ordinary as IfcEntity;
      kept.push(item.id);
    } else conflicts.push({ id: item.id, name: item.name, action: 'delete', previousSurvey: { modified: modified(item) } });
  }
  for (const id of deleted) delete next[id];
  if (conflicts.length) return { items, created: [], updated: [], deleted: [], kept: [], conflicts };
  return { items: next, created, updated, deleted, kept, conflicts };
}

/** A survey photo seen from a BIM element (spec F-30): what it shows and its reduced copy. */
export interface ElementPhoto {
  id: string;
  url: string;
  surface: 'wall' | 'floor' | 'ceiling';
  roomName: string;
  annotations: number;
  /** Notes and photo cotes typed on site, positions relative to the image (0–1). */
  annotationList: PhotoAnnotation[];
}

/**
 * Photos of the surfaces a reconstructed element stands for, through the survey correlation:
 * a wall shows the photos of its face and of the linked face (other room), a space its floor
 * and ceiling. They survive a new reconstruction since the correlation does.
 */
export function photosForElement(items: ItemsMap, elementId: string): ElementPhoto[] {
  const item = items[elementId];
  const ref = item && surveyRefOf(item);
  const storey = item?.parentId ? items[item.parentId] as IfcStoreyEntity | undefined : undefined;
  const survey = storey?.type === 'Storey' ? storey.survey : undefined;
  if (!ref || !survey || ref.surveyId !== survey.surveyId || ref.openingId || ref.technicalPointId || ref.furnitureId || !survey.photos) return [];
  const level = survey.level;
  const room = level.rooms.find(r => r.id === ref.roomId);
  if (!room) return [];
  const faces: { roomId: string; wallId?: string }[] = [];
  if (ref.wallId) {
    faces.push({ roomId: room.id, wallId: ref.wallId });
    const wall = room.walls.find(w => w.id === ref.wallId);
    for (const link of wall ? wallLinks(wall) : []) faces.push({ roomId: link.roomId, wallId: link.wallId });
  } else faces.push({ roomId: room.id });
  return faces.flatMap(f => {
    const r = level.rooms.find(x => x.id === f.roomId);
    return (r?.photos ?? [])
      .filter(p => (f.wallId ? p.surface.kind === 'wall' && p.surface.wallId === f.wallId : p.surface.kind !== 'wall') && survey.photos![p.id])
      .map(p => ({ id: p.id, url: survey.photos![p.id], surface: p.surface.kind, roomName: r!.name, annotations: p.annotations?.length ?? 0, annotationList: p.annotations ?? [] }));
  });
}

/** Name of the IFC property set carrying the survey reliability (ADR 0016). */
export const SURVEY_PSET = 'Pset_skAItchSurvey';
const IFC_RELIABILITY: Record<SurveyReliability, string> = {
  measured: 'Measured', partial: 'PartlyEstimated', assumed: 'Assumed', modified: 'ModifiedAfterSurvey',
};

/**
 * Properties of `Pset_skAItchSurvey` for an element: its reliability and where it comes from.
 * An element imported from an IFC keeps the values it was read with.
 */
export function surveyPsetProps(items: ItemsMap, item: IfcEntity): Record<string, string> | null {
  const imported = item as { SurveyReliability?: string; SurveyName?: string; SurveyDate?: string };
  const ref = surveyRefOf(item);
  if (!ref) return imported.SurveyReliability
    ? { Reliability: imported.SurveyReliability, SurveyName: imported.SurveyName ?? '', SurveyDate: imported.SurveyDate ?? '' }
    : null;
  const r = surveyReliability(item);
  const survey = (items[item.parentId ?? ''] as IfcStoreyEntity | undefined)?.survey;
  return {
    Reliability: r ? IFC_RELIABILITY[r] : '',
    SurveyName: survey?.surveyName ?? '',
    SurveyDate: survey?.importedAt ?? '',
  };
}

/** Reliability read back from an IFC `Pset_skAItchSurvey` value. */
export function reliabilityFromIfc(value: string | undefined): SurveyReliability | undefined {
  return (Object.entries(IFC_RELIABILITY).find(([, v]) => v === value)?.[0]) as SurveyReliability | undefined;
}
