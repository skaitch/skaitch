import type { SurveyLevel, SurveyRoom, SurveyWall } from './surveyFile.js';
import { alignedFaces, linkedFaces, wallLinks, type FaceLink } from './surveyFile.js';
import { solveRoom } from './solve.js';
import { tr } from './lang.js';

/**
 * Room placement (ADR 0012): each resolved room is placed rigidly against an already placed room
 * from one linked face — the wall's direction, its surveyed thickness and the link offset —
 * starting from the reference room. Each room is placed by a single path, fully measured links
 * first; every other link between placed rooms is a closure check. Nothing is moved here: the
 * drawing follows only on an explicit "Replace" (see replaceRooms).
 */

type Pt = [number, number];

export const PLACEMENT_TOLERANCE_M = 0.02;
/** Cost of a link relying on an assumed offset or thickness: any fully measured path is preferred. */
const ASSUMED_COST = 1000;

export type PlacementStatus = 'reference' | 'placed' | 'assumed' | 'unplaced';

export interface RoomPlacement {
  roomId: string;
  status: PlacementStatus;
  /** Inner-face polygon at its place on the plan (placed, assumed and reference rooms only). */
  polygon?: Pt[];
  /** The link that placed the room: its face, in this room, and the placed room it leans on. */
  via?: { wallId: string; fromRoomId: string; fromWallId: string; assumed: boolean };
  /** The drawing differs from the placement: "Replace" would move it. */
  toReplace: boolean;
  /** Not resolved by its own measurements, but by the directions of walls linked to placed rooms. */
  resolvedByNeighbours?: boolean;
  /** Its shape is not given by the cotes: it was placed as drawn (an assumed placement). */
  fromSketch?: boolean;
}

/** The single measurement (or action) the app asks for to unblock a room (ADR 0012). */
export interface SuggestedCote {
  /** Room to show: the one to measure, or to link. */
  roomId: string;
  kind: 'room' | 'offset' | 'thickness' | 'link';
  /** Wall of `roomId` to show (the face to measure along, or to link). */
  wallId?: string;
  /** For an offset or a thickness: the other face of that link. */
  other?: { roomId: string; wallId: string };
  message: string;
  /** Rooms this measurement (or link) would unblock. */
  affects: string[];
}

export interface ClosureCheck {
  roomIds: [string, string];
  wallIds: [string, string];
  /** Distance between where the link puts the face and where the placement put it (m). */
  gap: number;
  message: string;
}

export interface Placement {
  referenceId: string | null;
  rooms: Map<string, RoomPlacement>;
  closures: ClosureCheck[];
  suggestions: SuggestedCote[];
  /** The suggestion to ask for first: the one that unblocks the most rooms. */
  next?: SuggestedCote;
}

const P = (i: number) => `P${i + 1}`;
const cm = (m: number) => `${Math.round(m * 100)} cm`;
const wallName = (room: SurveyRoom, wall: SurveyWall) => `${room.name} ${wall.name || `${P(wall.from)}–${P(wall.to)}`}`;

/** The reference room: the one chosen on the level, else its first room. */
export function referenceRoom(level: SurveyLevel): SurveyRoom | undefined {
  return level.rooms.find(r => r.id === level.referenceRoomId) ?? level.rooms[0];
}

/** What a link between a placed face and the face to place says, read from its authoritative side. */
interface LinkRead { offset: number; fromPlaced: boolean; thickness: number; offsetMeasured: boolean; thicknessMeasured: boolean }

/** `a`: the link on the placed face (to the other one); `b`: its back link on the other face. */
function readLink(placed: SurveyWall, other: SurveyWall, a: FaceLink, b: FaceLink, placedFirst: boolean): LinkRead {
  const aMeasured = a.offsetStatus === 'measured', bMeasured = b.offsetStatus === 'measured';
  // A side's offset derived from the other is clamped at 0, so it may not tell where the faces
  // meet: a side is a source when the offset derived from it, clamped, is what the other side holds.
  const source = (x: number, lx: number, y: number, ly: number) => Math.abs(Math.max(0, x + ly - lx) - y) < 1e-6;
  const aSource = source(a.offset_m, placed.length_m, b.offset_m, other.length_m);
  const bSource = source(b.offset_m, other.length_m, a.offset_m, placed.length_m);
  const fromPlaced = aSource !== bSource ? aSource : aMeasured !== bMeasured ? aMeasured : placedFirst;
  return {
    offset: fromPlaced ? a.offset_m : b.offset_m, fromPlaced,
    thickness: placed.thicknessStatus === 'measured' || other.thicknessStatus !== 'measured' ? placed.thickness_m : other.thickness_m,
    offsetMeasured: aMeasured || bMeasured,
    thicknessMeasured: placed.thicknessStatus === 'measured' || other.thicknessStatus === 'measured',
  };
}

/** Polygon of `room` (its resolved shape) moved rigidly so that face `wall` is the other side of `face` at its place. */
function placeAgainst(face: { a: Pt; b: Pt }, shape: Pt[], wall: SurveyWall, link: LinkRead): Pt[] {
  const len = Math.hypot(face.b[0] - face.a[0], face.b[1] - face.a[1]) || 1;
  const u: Pt = [(face.b[0] - face.a[0]) / len, (face.b[1] - face.a[1]) / len];
  const n: Pt = [u[1], -u[0]]; // outward normal of a counter-clockwise room
  const t = link.thickness;
  // Along the placed face, the other face ends at `offset`; seen from the other face, the placed face ends at `offset`.
  const [anchorIdx, target]: [number, Pt] = link.fromPlaced
    ? [wall.to, [face.a[0] + u[0] * link.offset + n[0] * t, face.a[1] + u[1] * link.offset + n[1] * t]]
    : [wall.from, [face.b[0] + u[0] * link.offset + n[0] * t, face.b[1] + u[1] * link.offset + n[1] * t]];
  const [p0, p1] = [shape[wall.from], shape[wall.to]];
  const angle = Math.atan2(-u[1], -u[0]) - Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const anchor = shape[anchorIdx];
  return shape.map(([x, y]) => {
    const [dx, dy] = [x - anchor[0], y - anchor[1]];
    return [target[0] + dx * c - dy * s, target[1] + dx * s + dy * c] as Pt;
  });
}

const maxGap = (a: Pt[], b: Pt[]) => Math.max(0, ...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])));

export function placeRooms(level: SurveyLevel, tolerance = PLACEMENT_TOLERANCE_M): Placement {
  const reference = referenceRoom(level);
  const rooms = new Map<string, RoomPlacement>();
  const closures: ClosureCheck[] = [];
  const suggestions: SuggestedCote[] = [];
  const byId = new Map(level.rooms.map(r => [r.id, r]));
  const solved = new Map(level.rooms.map(r => [r.id, solveRoom(r)]));
  const shape = (id: string) => { const s = solved.get(id)!; return s.status === 'resolved' ? s.polygon : null; };
  for (const room of level.rooms) rooms.set(room.id, { roomId: room.id, status: 'unplaced', toReplace: false });
  if (!reference) return { referenceId: null, rooms, closures, suggestions };

  // The reference room stays where it is drawn (with its drawn shape when its cotes do not give one).
  const sketched = new Set<string>();
  const refShape = shape(reference.id) ?? (sketched.add(reference.id), reference.polygon);
  const world = new Map<string, Pt[]>();
  const cost = new Map<string, number>();
  if (refShape) {
    world.set(reference.id, refShape);
    cost.set(reference.id, 0);
    rooms.set(reference.id, { roomId: reference.id, status: 'reference', polygon: refShape, toReplace: maxGap(reference.polygon, refShape) > tolerance });
  } else {
    rooms.set(reference.id, { roomId: reference.id, status: 'reference', toReplace: false });
  }

  // Cheapest path from the reference room (Dijkstra; ties broken by room id for a stable result).
  // A room not resolved alone may be resolved by the directions of its walls linked to placed rooms.
  const byNeighbours = new Set<string>();
  const solveWithNeighbours = (room: SurveyRoom): Pt[] | null => {
    const directions = new Map<string, number>();
    for (const wall of room.walls) for (const link of linkedFaces(level, wall)) {
      const poly = world.get(link.room.id);
      if (!poly) continue;
      const [a, b] = [poly[link.wall.from], poly[link.wall.to]];
      directions.set(wall.id, Math.atan2(a[1] - b[1], a[0] - b[0])); // the two faces run opposite
    }
    for (const wall of room.walls) for (const f of alignedFaces(level, wall)) {
      const poly = world.get(f.room.id);
      if (!poly) continue;
      const [a, b] = [poly[f.wall.from], poly[f.wall.to]];
      directions.set(wall.id, Math.atan2(b[1] - a[1], b[0] - a[0])); // aligned faces run the same way
    }
    if (directions.size < 2) return null;
    const result = solveRoom(room, undefined, directions);
    if (result.status !== 'resolved') return null;
    solved.set(room.id, result);
    byNeighbours.add(room.id);
    return result.polygon;
  };
  /**
   * Slides a room placed by a link along that link's wall (`along`) so that one of its walls lies on
   * the line of a placed room's wall it continues, at the measured set-back. Null when no such
   * alignment crosses the link's direction.
   */
  const alignAlong = (room: SurveyRoom, polygon: Pt[], along: Pt): Pt[] | null => {
    const ul = Math.hypot(along[0], along[1]) || 1;
    const u: Pt = [along[0] / ul, along[1] / ul];
    for (const wall of room.walls) for (const f of alignedFaces(level, wall)) {
      const pc = f.room.id === room.id ? undefined : world.get(f.room.id);
      if (!pc) continue;
      const [a, b] = [pc[f.wall.from], pc[f.wall.to]];
      const lc = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const dc: Pt = [(b[0] - a[0]) / lc, (b[1] - a[1]) / lc], n: Pt = [dc[1], -dc[0]];
      const [p, q] = [polygon[wall.from], polygon[wall.to]];
      const lb = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      if (((q[0] - p[0]) * dc[0] + (q[1] - p[1]) * dc[1]) / lb < 0.966) continue; // not running the same way
      const k = u[0] * n[0] + u[1] * n[1];
      if (Math.abs(k) < 0.5) continue; // parallel to the link's wall: it fixes nothing along it
      const d = (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1];
      const t = (f.back.step_m - d) / k;
      return polygon.map(([x, y]) => [x + u[0] * t, y + u[1] * t] as Pt);
    }
    return null;
  };
  /** What placed each room: whether its link's offset and thickness are known. */
  const state = new Map<string, { offsetKnown: boolean; thicknessKnown: boolean }>();
  /**
   * Like `alignAlong`, with every constraint a room has besides the link that placed it: its other
   * links (the faces one wall thickness apart) and its alignments, to rooms not in `skip`.
   * Returns the slide along `u` and whether the room it meets is itself placed by measurements.
   */
  const slideAlong = (room: SurveyRoom, polygon: Pt[], u: Pt, skip: Set<string>): { t: number; exact: boolean } | null => {
    for (const wall of room.walls) {
      const targets = [
        ...linkedFaces(level, wall).map(f => ({ room: f.room, wall: f.wall, same: false, target: wall.thicknessStatus === 'measured' || f.wall.thicknessStatus !== 'measured' ? wall.thickness_m : f.wall.thickness_m })),
        ...alignedFaces(level, wall).map(f => ({ room: f.room, wall: f.wall, same: true, target: f.back.step_m })),
      ];
      for (const f of targets) {
        if (skip.has(f.room.id)) continue;
        const pc = world.get(f.room.id);
        if (!pc) continue;
        const [a, b] = [pc[f.wall.from], pc[f.wall.to]];
        const lc = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const dc: Pt = [(b[0] - a[0]) / lc, (b[1] - a[1]) / lc], n: Pt = [dc[1], -dc[0]];
        const [p, q] = [polygon[wall.from], polygon[wall.to]];
        const lb = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        const cos = ((q[0] - p[0]) * dc[0] + (q[1] - p[1]) * dc[1]) / lb;
        if (f.same ? cos < 0.966 : cos > -0.966) continue; // aligned faces run the same way, linked ones face each other
        const k = u[0] * n[0] + u[1] * n[1];
        if (Math.abs(k) < 0.5) continue; // parallel to the sliding wall: fixes nothing along it
        const d = (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1];
        const st = rooms.get(f.room.id)!;
        return { t: (f.target - d) / k, exact: st.status === 'reference' ? !sketched.has(f.room.id) : !!st.via && !sketched.has(f.room.id) && !!state.get(f.room.id)?.offsetKnown };
      }
    }
    return null;
  };
  const used = new Set<string>(); // links that placed a room, by their pair of faces (both ways)
  const pair = (r1: string, w1: string, r2: string, w2: string) => `${r1}/${w1}>${r2}/${w2}`;
  const done = new Set<string>();
  const assumedPath = new Map<string, boolean>([[reference.id, sketched.has(reference.id)]]);
  for (;;) {
    let current: string | undefined;
    for (const [id, c] of cost) if (!done.has(id) && (current === undefined || c < cost.get(current)! || (c === cost.get(current)! && id < current))) current = id;
    if (current === undefined) break;
    done.add(current);
    const room = byId.get(current)!, poly = world.get(current)!;
    for (const wall of room.walls) for (const link of linkedFaces(level, wall)) {
      if (done.has(link.room.id)) continue;
      // A room whose cotes do not give its shape is placed as drawn, rigidly: an assumed placement.
      const measuredShape = shape(link.room.id) ?? solveWithNeighbours(link.room);
      const other = measuredShape ?? link.room.polygon;
      const read = readLink(wall, link.wall, link.link, link.back, room.id < link.room.id);
      let polygon = placeAgainst({ a: poly[wall.from], b: poly[wall.to] }, other, link.wall, read);
      // An offset not measured may follow from a wall of this room continuing a placed room's wall.
      let offsetKnown = read.offsetMeasured;
      if (!offsetKnown) {
        const fixed = alignAlong(link.room, polygon, [poly[wall.to][0] - poly[wall.from][0], poly[wall.to][1] - poly[wall.from][1]]);
        if (fixed) { polygon = fixed; offsetKnown = true; }
      }
      const assumed = !offsetKnown || !read.thicknessMeasured || !measuredShape;
      const c = cost.get(current)! + (measuredShape ? (assumed ? ASSUMED_COST : 1) : 2 * ASSUMED_COST);
      const known = cost.get(link.room.id);
      if (known !== undefined && (known < c || (known === c && rooms.get(link.room.id)!.via!.fromRoomId < current))) continue;
      cost.set(link.room.id, c);
      world.set(link.room.id, polygon);
      if (measuredShape) sketched.delete(link.room.id); else sketched.add(link.room.id);
      state.set(link.room.id, { offsetKnown, thicknessKnown: read.thicknessMeasured });
      assumedPath.set(link.room.id, assumedPath.get(current)! || assumed);
      rooms.set(link.room.id, {
        roomId: link.room.id, status: 'placed', polygon,
        via: { wallId: link.wall.id, fromRoomId: current, fromWallId: wall.id, assumed }, toReplace: false,
      });
    }
  }
  // Cascade: a room placed by a link whose offset is not measured slides along that link's wall to
  // meet its other links or alignments with rooms placed elsewhere; the rooms placed from it follow.
  const children = (id: string) => [...rooms.values()].filter(p => p.via?.fromRoomId === id).map(p => p.roomId);
  const subtree = (id: string): string[] => [id, ...children(id).flatMap(subtree)];
  for (let pass = 0; pass < level.rooms.length; pass++) {
    let changed = false;
    for (const p of rooms.values()) {
      if (p.status !== 'placed' || !p.via || state.get(p.roomId)?.offsetKnown) continue;
      const from = world.get(p.via.fromRoomId)!, fw = byId.get(p.via.fromRoomId)!.walls.find(w => w.id === p.via!.fromWallId)!;
      const ul = Math.hypot(from[fw.to][0] - from[fw.from][0], from[fw.to][1] - from[fw.from][1]) || 1;
      const u: Pt = [(from[fw.to][0] - from[fw.from][0]) / ul, (from[fw.to][1] - from[fw.from][1]) / ul];
      const moving = subtree(p.roomId);
      const fix = slideAlong(byId.get(p.roomId)!, world.get(p.roomId)!, u, new Set([...moving, p.via.fromRoomId]));
      if (!fix) continue;
      if (Math.abs(fix.t) > 1e-6) {
        for (const id of moving) {
          const moved = world.get(id)!.map(([x, y]) => [x + u[0] * fix.t, y + u[1] * fix.t] as Pt);
          world.set(id, moved);
          rooms.get(id)!.polygon = moved;
        }
        changed = true;
      }
      state.set(p.roomId, { ...state.get(p.roomId)!, offsetKnown: fix.exact });
      p.via.assumed = !fix.exact || !state.get(p.roomId)!.thicknessKnown || sketched.has(p.roomId);
    }
    if (!changed) break;
  }
  // Assumed placements follow the path from the reference room.
  const pathAssumed = (id: string): boolean => {
    const via = rooms.get(id)!.via;
    return via ? via.assumed || pathAssumed(via.fromRoomId) : sketched.has(id);
  };
  for (const p of rooms.values()) if (p.status === 'placed') assumedPath.set(p.roomId, pathAssumed(p.roomId));
  for (const [id, p] of rooms) {
    if (p.status !== 'placed') continue;
    p.status = assumedPath.get(id) ? 'assumed' : 'placed';
    p.toReplace = maxGap(byId.get(id)!.polygon, p.polygon!) > tolerance;
    const via = p.via!;
    used.add(pair(id, via.wallId, via.fromRoomId, via.fromWallId)).add(pair(via.fromRoomId, via.fromWallId, id, via.wallId));
  }

  // Closure checks: every other link between two placed rooms.
  for (const room of level.rooms) for (const wall of room.walls) for (const link of linkedFaces(level, wall)) {
    if (room.id > link.room.id || used.has(pair(room.id, wall.id, link.room.id, link.wall.id))) continue;
    const [pa, pb] = [world.get(room.id), world.get(link.room.id)];
    if (!pa || !pb) continue;
    const expected = placeAgainst({ a: pa[wall.from], b: pa[wall.to] }, pb, link.wall, readLink(wall, link.wall, link.link, link.back, room.id < link.room.id));
    const gap = Math.max(...[link.wall.from, link.wall.to].map(i => Math.hypot(expected[i][0] - pb[i][0], expected[i][1] - pb[i][1])));
    if (gap <= tolerance) continue;
    const other = link.room;
    closures.push({
      roomIds: [room.id, other.id], wallIds: [wall.id, link.wall.id], gap,
      message: tr(
        `Le tour ne se referme pas de ${cm(gap)} au mur commun ${wallName(room, wall)} / ${wallName(other, link.wall)} : vérifiez les cotes des pièces du tour, le décalage et l'épaisseur de ce mur. Aucune valeur n'a été modifiée.`,
        `The loop does not close by ${cm(gap)} at the shared wall ${wallName(room, wall)} / ${wallName(other, link.wall)}: check the cotes of the rooms around the loop, this wall's offset and thickness. No value was changed.`),
    });
  }

  // Aligned faces between placed rooms: on one line, at the set-back.
  for (const room of level.rooms) for (const wall of room.walls) for (const f of alignedFaces(level, wall)) {
    if (room.id > f.room.id) continue;
    const [pa, pb] = [world.get(room.id), world.get(f.room.id)];
    if (!pa || !pb) continue;
    const [a, b] = [pa[wall.from], pa[wall.to]];
    const la = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const n: Pt = [(b[1] - a[1]) / la, -(b[0] - a[0]) / la];
    const gap = Math.max(...[f.wall.from, f.wall.to].map(i => Math.abs((pb[i][0] - a[0]) * n[0] + (pb[i][1] - a[1]) * n[1] - f.alignment.step_m)));
    if (gap <= tolerance) continue;
    closures.push({
      roomIds: [room.id, f.room.id], wallIds: [wall.id, f.wall.id], gap,
      message: tr(
        `Les murs ${wallName(room, wall)} et ${wallName(f.room, f.wall)} ne se prolongent pas d'après les cotes (écart de ${cm(gap)}) : vérifiez les cotes des pièces et le décrochement. Aucune valeur n'a été modifiée.`,
        `Walls ${wallName(room, wall)} and ${wallName(f.room, f.wall)} do not continue each other according to the cotes (gap of ${cm(gap)}): check the rooms' cotes and the set-back. No value was changed.`),
    });
  }

  for (const id of byNeighbours) rooms.get(id)!.resolvedByNeighbours = true;
  for (const id of sketched) if (rooms.get(id)!.polygon) rooms.get(id)!.fromSketch = true;

  // Suggested cotes: one per thing to measure or link, with the rooms it would unblock.
  const placedIds = new Set([...rooms.values()].filter(p => p.polygon).map(p => p.roomId));
  const unresolved = (id: string) => solved.get(id)!.status !== 'resolved';
  const byKey = new Map<string, SuggestedCote>();
  const suggest = (key: string, make: () => Omit<SuggestedCote, 'affects'>, affected: string) => {
    if (!byKey.has(key)) byKey.set(key, { ...make(), affects: [] });
    const sg = byKey.get(key)!;
    if (!sg.affects.includes(affected)) sg.affects.push(affected);
  };
  // Rooms joined by links (a local walk: the level's groups, without importing the global plan).
  const groupOf = (id: string) => {
    const seen = new Set([id]), queue = [id];
    while (queue.length) for (const w of byId.get(queue.shift()!)!.walls) for (const l of wallLinks(w)) {
      if (byId.has(l.roomId) && !seen.has(l.roomId)) { seen.add(l.roomId); queue.push(l.roomId); }
    }
    return seen;
  };
  for (const room of level.rooms) {
    const p = rooms.get(room.id)!;
    const s = solved.get(room.id)!;
    if (s.status !== 'resolved') suggest(`room:${room.id}`, () => ({ roomId: room.id, kind: 'room', message: `${room.name} : ${s.status === 'underconstrained' ? s.hint : s.message}` }), room.id);
    if (p.status === 'assumed') {
      // The first assumed link on its path: measuring it is what makes the placement exact.
      let id = room.id, via = rooms.get(id)!.via;
      while (via && !via.assumed) { id = via.fromRoomId; via = rooms.get(id)!.via; }
      // Assumed because a shape on its path is only drawn: that room's cotes unblock this one too.
      const sketchOnPath = (rid: string) => { const sr = byId.get(rid)!, ss = solved.get(rid)!; if (ss.status !== 'resolved') suggest(`room:${rid}`, () => ({ roomId: rid, kind: 'room', message: `${sr.name} : ${ss.status === 'underconstrained' ? ss.hint : ss.message}` }), room.id); };
      if (!via) { sketchOnPath(id); continue; }
      const r = byId.get(id)!, from = byId.get(via.fromRoomId)!;
      const wall = r.walls.find(w => w.id === via.wallId)!, fromWall = from.walls.find(w => w.id === via.fromWallId)!;
      const f = linkedFaces(level, fromWall).find(x => x.room.id === r.id && x.wall.id === wall.id)!;
      const read = readLink(fromWall, wall, f.link, f.back, from.id < r.id);
      if (read.offsetMeasured && read.thicknessMeasured) { sketchOnPath(r.id); continue; } // assumed only for its drawn shape
      const other = { roomId: r.id, wallId: wall.id };
      suggest(`link:${pair(from.id, fromWall.id, r.id, wall.id)}`, () => !read.offsetMeasured
        ? { roomId: from.id, kind: 'offset', wallId: fromWall.id, other, message: tr(
          `${r.name} : placement supposé. Mesurez, le long du mur ${wallName(from, fromWall)}, la distance depuis ${P(fromWall.from)} jusqu'à l'angle de la pièce « ${r.name} », ou indiquez un mur de ${r.name} qui en prolonge un d'une pièce placée.`,
          `${r.name}: assumed placement. Measure, along wall ${wallName(from, fromWall)}, the distance from ${P(fromWall.from)} to the corner of the room “${r.name}”, or name a wall of ${r.name} that continues one of a placed room.`) }
        : { roomId: from.id, kind: 'thickness', wallId: fromWall.id, other, message: tr(
          `${r.name} : placement supposé. Mesurez l'épaisseur du mur commun ${wallName(from, fromWall)} / ${r.name} (au tableau d'une porte, par exemple).`,
          `${r.name}: assumed placement. Measure the thickness of the shared wall ${wallName(from, fromWall)} / ${r.name} (at a door jamb, for instance).`) }, room.id);
      continue;
    }
    if (p.status !== 'unplaced' || unresolved(room.id)) continue;
    const group = groupOf(room.id);
    if (group.has(reference.id)) {
      // Linked to the reference, but behind a room that is not resolved: that room's measurement unblocks it.
      const blockers = [...group].filter(unresolved);
      const blocker = blockers.find(id => byId.get(id)!.walls.some(w => wallLinks(w).some(l => placedIds.has(l.roomId)))) ?? blockers[0];
      if (blocker) {
        const b = byId.get(blocker)!, bs = solved.get(blocker)!;
        suggest(`room:${blocker}`, () => ({ roomId: blocker, kind: 'room', message: `${b.name} : ${bs.status === 'underconstrained' ? bs.hint : bs.status === 'inconsistent' ? bs.message : ''}` }), room.id);
      }
      continue;
    }
    // A group with no link to the reference: one link to a placed room places it all.
    const key = `group:${[...group].sort()[0]}`;
    if (!byKey.has(key)) {
      const candidate = [...group].map(id => linkCandidate(level, byId.get(id)!, placedIds)).filter(c => c).sort((x, y) => x!.score - y!.score)[0];
      const name = room.name;
      suggest(key, () => candidate
        ? { roomId: candidate.from.id, kind: 'link', wallId: candidate.wall.id, message: tr(
          `${name} : aucun mur lié à une pièce placée. Liez par exemple ${wallName(candidate.from, candidate.wall)} à ${wallName(candidate.room, candidate.other)}.`,
          `${name}: no wall linked to a placed room. Link, for instance, ${wallName(candidate.from, candidate.wall)} to ${wallName(candidate.room, candidate.other)}.`) }
        : { roomId: room.id, kind: 'link', message: tr(
          `${name} : aucun mur lié à une pièce placée. Liez un de ses murs au mur d'en face d'une pièce placée.`,
          `${name}: no wall linked to a placed room. Link one of its walls to the opposite wall of a placed room.`) }, room.id);
    } else suggest(key, () => { throw new Error('unreachable'); }, room.id);
  }
  suggestions.push(...byKey.values());
  const next = suggestions.reduce<SuggestedCote | undefined>((best, sg) => (!best || sg.affects.length > best.affects.length ? sg : best), undefined);
  return { referenceId: reference.id, rooms, closures, suggestions, next };
}

/** On the drawing, the free wall of `room` that faces a free wall of a placed room most closely. */
function linkCandidate(level: SurveyLevel, room: SurveyRoom, placed: Set<string>) {
  let best: { from: SurveyRoom; wall: SurveyWall; room: SurveyRoom; other: SurveyWall; score: number } | undefined;
  for (const wall of room.walls) {
    const [a0, a1] = [room.polygon[wall.from], room.polygon[wall.to]];
    const la = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1;
    const u: Pt = [(a1[0] - a0[0]) / la, (a1[1] - a0[1]) / la], n: Pt = [u[1], -u[0]];
    for (const other of level.rooms) {
      if (other.id === room.id || !placed.has(other.id)) continue;
      for (const ow of other.walls) {
        if (wallLinks(wall).some(l => l.roomId === other.id && l.wallId === ow.id)) continue;
        const [b0, b1] = [other.polygon[ow.from], other.polygon[ow.to]];
        const lb = Math.hypot(b1[0] - b0[0], b1[1] - b0[1]) || 1;
        if (((b1[0] - b0[0]) * u[0] + (b1[1] - b0[1]) * u[1]) / lb > -0.966) continue; // not facing
        const gap = ((b0[0] - a0[0]) * n[0] + (b0[1] - a0[1]) * n[1] + (b1[0] - a0[0]) * n[0] + (b1[1] - a0[1]) * n[1]) / 2;
        const along = [b0, b1].map(p => (p[0] - a0[0]) * u[0] + (p[1] - a0[1]) * u[1]);
        const overlap = Math.min(la, Math.max(...along)) - Math.max(0, Math.min(...along));
        if (gap < -0.5 || gap > 0.8 || overlap < 0.1) continue;
        const score = Math.abs(gap) - overlap * 0.01;
        if (!best || score < best.score) best = { from: room, wall, room: other, other: ow, score };
      }
    }
  }
  return best;
}

/**
 * "Replace" (ADR 0012): moves the drawing of placed rooms rigidly to their placement; lengths
 * are unchanged and unplaced rooms stay where they are drawn.
 */
export function replacedLevel(level: SurveyLevel, roomIds?: string[], tolerance = PLACEMENT_TOLERANCE_M): SurveyLevel {
  const plan = placeRooms(level, tolerance);
  return {
    ...level,
    rooms: level.rooms.map(room => {
      const p = plan.rooms.get(room.id)!;
      if (!p.polygon || !p.toReplace || room.frozen || (roomIds && !roomIds.includes(room.id))) return room;
      const polygon = p.polygon.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)] as Pt);
      if (!room.furniture?.length) return { ...room, polygon };
      const wall = room.walls.find(w => w.id === p.via?.wallId) ?? room.walls[0];
      const [a, b] = [room.polygon[wall.from], room.polygon[wall.to]];
      const [c, d] = [polygon[wall.from], polygon[wall.to]];
      const rotation = Math.atan2(d[1] - c[1], d[0] - c[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
      const cos = Math.cos(rotation), sin = Math.sin(rotation);
      return { ...room, polygon, furniture: room.furniture.map(f => {
        const x = f.center[0] - a[0], y = f.center[1] - a[1];
        return { ...f, center: [c[0] + x * cos - y * sin, c[1] + x * sin + y * cos], rotation: f.rotation + rotation };
      }) };
    }),
  };
}
