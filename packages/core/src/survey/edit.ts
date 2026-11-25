import { surveyDefaults, wallLinks, isLinked, linkedFaces, linkStretch, type SurveyDefaults, isAssumedRectangle, isSimplePolygon, signedArea, openingProblem, OPENING_OPERATIONS, type MeasureSource, type OpeningKind, type Survey, type FaceLink, type FaceAlignment, type SurveyOpening, type SurveyRoom, type SurveyWall, type SurveyPhoto, type SurveySurface, type SurveyTechnicalPoint } from './surveyFile.js';
import { TECHNICAL_CATALOGUE } from '../data/technicalCatalogue.js';
import { validSurveyFurniture, type SurveyFurniture } from './surveyFile.js';
import { roomGroups } from './globalPlan.js';
import { solveRoom } from './solve.js';
import { placeRooms, replacedLevel } from './placement.js';
import { tr } from './lang.js';

/**
 * Editing operations of the Survey app. All are pure: they return a new survey.
 * A typed length is a measurement: it is locked and never changed by another operation.
 */


export function newSurvey(name: string, now = new Date()): Survey {
  const at = now.toISOString();
  const stamp = now.getTime().toString(36);
  return { id: `srv_${stamp}`, name, createdAt: at, updatedAt: at, levels: [{ id: `lvl_${stamp}`, name: 'RDC', rooms: [] }] };
}

/**
 * Marks the survey changed. Alignments whose other face is gone (deleted room or wall, a wall
 * split or merged) are dropped on both sides, so no edit leaves one pointing nowhere.
 */
function touch(survey: Survey, now: Date): Survey {
  const levels = survey.levels.map(level => {
    const walls = new Map(level.rooms.flatMap(r => r.walls.map(w => [`${r.id}/${w.id}`, w] as const)));
    const ok = (from: string, fromWall: string, a: FaceAlignment) => !!walls.get(`${a.roomId}/${a.wallId}`)?.alignments?.some(b => b.roomId === from && b.wallId === fromWall);
    if (!level.rooms.some(r => r.walls.some(w => w.alignments?.some(a => !ok(r.id, w.id, a))))) return level;
    return { ...level, rooms: level.rooms.map(r => ({ ...r, walls: r.walls.map(w => {
      if (!w.alignments) return w;
      const kept = w.alignments.filter(a => ok(r.id, w.id, a));
      const { alignments: _, ...rest } = w;
      return kept.length ? { ...rest, alignments: kept } : rest;
    }) })) };
  });
  return { ...survey, levels, updatedAt: now.toISOString() };
}

/** A wall with these links (the field is dropped when there is none). */
function setLinks(w: SurveyWall, links: FaceLink[]): SurveyWall {
  const { links: _, shared: __, ...rest } = w as SurveyWall & { shared?: FaceLink };
  return links.length ? { ...rest, links } : rest;
}
/** A room whose walls lose the links matching `drop`. */
function dropLinks(r: SurveyRoom, drop: (l: FaceLink, w: SurveyWall) => boolean): SurveyRoom {
  return r.walls.some(w => wallLinks(w).some(l => drop(l, w))) ? { ...r, walls: r.walls.map(w => setLinks(w, wallLinks(w).filter(l => !drop(l, w)))) } : r;
}
/** A room whose wall `wallId` gains `link` (or has it replaced, for the same other face). */
function addLink(r: SurveyRoom, wallId: string, link: FaceLink, extra: Partial<SurveyWall> = {}): SurveyRoom {
  return { ...r, walls: r.walls.map(w => (w.id !== wallId ? w : { ...setLinks(w, [...wallLinks(w).filter(l => !(l.roomId === link.roomId && l.wallId === link.wallId)), link]), ...extra })) };
}
/** Refuses a new link over [lo, hi] on `wall` that overlaps one of its existing links. */
function checkFreeStretch(level: Survey['levels'][number], wall: SurveyWall, lo: number, hi: number, except?: { roomId: string; wallId: string }) {
  for (const f of linkedFaces(level, wall)) {
    if (except && f.link.roomId === except.roomId && f.link.wallId === except.wallId) continue;
    const [a, b] = linkStretch(wall, f);
    if (Math.min(hi, b) - Math.max(lo, a) > 0.05)
      throw new Error(tr(`Ce tronçon du mur est déjà lié à « ${f.room.name.trim()} ».`, `This stretch of the wall is already linked to “${f.room.name.trim()}”.`));
  }
}

const frozenError = (room: SurveyRoom) => new Error(tr(`« ${room.name} » est figée : défigez-la pour la modifier.`, `“${room.name}” is frozen: unfreeze it to change it.`));

function mapRoom(survey: Survey, roomId: string, f: (room: SurveyRoom) => SurveyRoom, now: Date, evenFrozen = false): Survey {
  let found = false;
  const levels = survey.levels.map(level => ({
    ...level,
    rooms: level.rooms.map(room => {
      if (room.id !== roomId) return room;
      if (room.frozen && !evenFrozen) throw frozenError(room);
      found = true;
      return f(room);
    }),
  }));
  if (!found) throw new Error(tr(`Pièce introuvable : ${roomId}`, `Room not found: ${roomId}`));
  return touch({ ...survey, levels }, now);
}

/** True for a room drawn as a rectangle whose shape still relies on the right-angle hypothesis. */
export { isAssumedRectangle };

/** Adds a rectangle drawn at (x, y) with sketched, unlocked lengths (assumed geometry). */
export function addRectangleRoom(
  survey: Survey, levelId: string, name: string, x: number, y: number, width: number, depth: number, now = new Date(),
): { survey: Survey; roomId: string } {
  if (!(width > 0 && depth > 0)) throw new Error(tr('Une pièce doit avoir une largeur et une profondeur positives.', 'A room needs a positive width and depth.'));
  const level = survey.levels.find(l => l.id === levelId);
  if (!level) throw new Error(tr(`Niveau introuvable : ${levelId}`, `Level not found: ${levelId}`));
  const roomId = `room_${now.getTime().toString(36)}_${level.rooms.length}`;
  const walls: SurveyWall[] = [width, depth, width, depth].map((length_m, i) => ({
    id: `${roomId}_w${i + 1}`, from: i, to: (i + 1) % 4, length_m, source: 'estimated', locked: false,
    thickness_m: surveyDefaults(survey).exteriorThickness_m, thicknessStatus: 'estimated',
  }));
  const room: SurveyRoom = {
    id: roomId, name, geometryStatus: 'assumed', shape: 'rectangle', walls,
    polygon: [[x, y], [x + width, y], [x + width, y + depth], [x, y + depth]],
  };
  const levels = survey.levels.map(l => (l.id === levelId ? { ...l, rooms: [...l.rooms, room] } : l));
  return { survey: touch({ ...survey, levels }, now), roomId };
}

/**
 * Records a measured wall length (face length). On an assumed rectangle the drawing follows:
 * the wall and its opposite side take the new length on the plan, but the opposite wall keeps
 * its own value; if both were measured differently, the survey warns instead of choosing.
 */
export function setWallLength(
  survey: Survey, roomId: string, wallId: string, length: number, source: MeasureSource = 'manual', now = new Date(),
): Survey {
  if (!(length > 0)) throw new Error(tr('La longueur doit être strictement positive.', 'The length must be greater than zero.'));
  return mapRoom(survey, roomId, room => {
    const wall = room.walls.find(w => w.id === wallId);
    if (!wall) throw new Error(tr(`Mur introuvable : ${wallId}`, `Wall not found: ${wallId}`));
    const rectangle = isAssumedRectangle(room);
    // A sketched (unlocked) opposite side follows the drawing; a measured one is never changed.
    const follows = (w: SurveyWall) => rectangle && !w.locked && w.from === (wall.from + 2) % 4;
    const walls = room.walls.map(w => (w.id === wallId ? { ...w, length_m: length, source, locked: true } : follows(w) ? { ...w, length_m: length } : w));
    let polygon = room.polygon;
    if (rectangle) {
      // Along the rectangle's own sides, whatever its orientation on the sketch.
      const [p0, p1, , p3] = room.polygon;
      const w0 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), d0 = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
      const u = [(p1[0] - p0[0]) / w0, (p1[1] - p0[1]) / w0], v = [(p3[0] - p0[0]) / d0, (p3[1] - p0[1]) / d0];
      const horizontal = wall.from % 2 === 0;
      const width = horizontal ? length : w0, depth = horizontal ? d0 : length;
      const at = (a: number, b: number): [number, number] => [+(p0[0] + u[0] * a + v[0] * b).toFixed(6), +(p0[1] + u[1] * a + v[1] * b).toFixed(6)];
      polygon = [at(0, 0), at(width, 0), at(width, depth), at(0, depth)];
    }
    const problem = openingProblem({ ...room, walls });
    if (problem) throw new Error(problem);
    return resolve(completeOrthogonal({ ...room, walls, polygon }));
  }, now);
}


/**
 * Deletes a wall's measured length: the wall goes back to an estimated length read from the
 * drawing (« ≈ »), and lengths deduced from it are deduced again. The room's geometry follows.
 */
export function clearWallLength(survey: Survey, roomId: string, wallId: string, now = new Date()): Survey {
  return mapRoom(survey, roomId, room => {
    const wall = room.walls.find(w => w.id === wallId);
    if (!wall) throw new Error(tr(`Mur introuvable : ${wallId}`, `Wall not found: ${wallId}`));
    const sketched = (w: SurveyWall): SurveyWall => ({ ...w, length_m: drawn(room.polygon, w.from), source: 'estimated', locked: false });
    // Deduced lengths may rest on the deleted one: they become sketches until deduced again.
    const walls = room.walls.map(w => (w.id === wallId || (!w.locked && w.source === 'computed') ? sketched(w) : w));
    return completeOrthogonal(resolve({ ...room, walls }));
  }, now);
}

/** Names a wall (« mur fenêtre »); an empty name goes back to its corners (P1–P2). */
export function renameWall(survey: Survey, roomId: string, wallId: string, name: string, now = new Date()): Survey {
  return mapRoom(survey, roomId, room => {
    if (!room.walls.some(w => w.id === wallId)) throw new Error(tr(`Mur introuvable : ${wallId}`, `Wall not found: ${wallId}`));
    const trimmed = name.trim();
    return { ...room, walls: room.walls.map(w => (w.id !== wallId ? w : trimmed ? { ...w, name: trimmed } : (({ name: _, ...rest }) => rest)(w))) };
  }, now);
}

/** What to call a wall: its name, or its corners (P1–P2). */
export const wallLabel = (wall: SurveyWall) => wall.name || `P${wall.from + 1}–P${wall.to + 1}`;

const AXIS_TOLERANCE = Math.sin((3 * Math.PI) / 180);

/**
 * Deduced length (« cote déduite »): in a room drawn with right angles, the walls running one way
 * add up to those running back, along each axis. When a single wall of an axis is not measured,
 * its length follows from the others: it is set as `computed` (never locked, a measurement
 * replaces it). Once every length is known, the outline is redrawn on them. The room stays
 * assumed geometry: right angles are a hypothesis until a diagonal or an angle confirms them.
 */
export function completeOrthogonal(room: SurveyRoom): SurveyRoom {
  if (room.geometryStatus === 'resolved') return room;
  const edges = room.walls.map(w => {
    const a = room.polygon[w.from], b = room.polygon[w.to];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const axis = Math.abs(dy) / len < AXIS_TOLERANCE ? 'x' : Math.abs(dx) / len < AXIS_TOLERANCE ? 'y' : null;
    return { w, axis, sign: axis === 'x' ? Math.sign(dx) : Math.sign(dy) };
  });
  if (edges.some(e => !e.axis || !e.sign)) return room; // not drawn with right angles
  const walls = room.walls.map(w => ({ ...w }));
  const byId = new Map(walls.map(w => [w.id, w]));
  for (const axis of ['x', 'y'] as const) {
    const group = edges.filter(e => e.axis === axis);
    const unknown = group.filter(e => !e.w.locked);
    if (unknown.length !== 1) {
      // Not deducible (any more): a former deduced length is a sketch again.
      for (const e of unknown) if (e.w.source === 'computed') byId.get(e.w.id)!.source = 'estimated';
      continue;
    }
    const needed = -group.filter(e => e.w.locked).reduce((sum, e) => sum + e.sign * e.w.length_m, 0);
    const target = byId.get(unknown[0].w.id)!;
    if (Math.sign(needed) === unknown[0].sign && Math.abs(needed) > 0.01) {
      target.length_m = +Math.abs(needed).toFixed(4);
      target.source = 'computed';
    } else if (target.source === 'computed') target.source = 'estimated';
  }
  let polygon = room.polygon;
  if (walls.every(w => w.locked || w.source === 'computed')) {
    // Every length known: redraw the outline on them, from its first vertex, in the drawn directions.
    const next: [number, number][] = [room.polygon[0]];
    const ordered = [...edges].sort((p, q) => p.w.from - q.w.from);
    for (const e of ordered.slice(0, -1)) {
      const len = byId.get(e.w.id)!.length_m, [x, y] = next[next.length - 1];
      next.push(e.axis === 'x' ? [+(x + e.sign * len).toFixed(6), y] : [x, +(y + e.sign * len).toFixed(6)]);
    }
    if (signedArea(next) > 0 && isSimplePolygon(next)) polygon = next;
  }
  return { ...room, walls, polygon };
}


/**
 * Turns a room back into a rectangle: the axis-aligned rectangle around its outline, with four
 * walls. Openings and wall photos move to the side they were on, at the same place; a side that
 * had a single measured wall keeps its measure; links with neighbouring rooms are made again on the
 * new side (linkFaces); diagonals and angles, which no longer match any corner, are dropped.
 * Returns how many links could not be made again.
 */
export function makeRectangle(survey: Survey, roomId: string, now = new Date()): { survey: Survey; lostLinks: number } {
  const level = survey.levels.find(l => l.rooms.some(r => r.id === roomId));
  const room = level?.rooms.find(r => r.id === roomId);
  if (!level || !room) throw new Error(tr(`Pièce introuvable : ${roomId}`, `Room not found: ${roomId}`));
  if (room.frozen) throw frozenError(room);
  const xs = room.polygon.map(p => p[0]), ys = room.polygon.map(p => p[1]);
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  // Which side each old wall belongs to: the one its outward normal points to (0 bottom, 1 right, 2 top, 3 left).
  const sideOf = (w: SurveyWall) => {
    const a = room.polygon[w.from], b = room.polygon[w.to];
    const [nx, ny] = [b[1] - a[1], -(b[0] - a[0])];
    return Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? 1 : 3) : (ny > 0 ? 2 : 0);
  };
  const groups = [0, 1, 2, 3].map(k => room.walls.filter(w => sideOf(w) === k));
  if (groups.some(g => g.length > 1 && g.some(w => room.technicalPoints?.some(p => p.wallId === w.id))))
    throw new Error(tr('Des points techniques sont cotés sur les murs à regrouper.', 'The walls to be merged carry dimensioned technical points.'));
  const kept = (k: number) => (groups[k].length === 1 && groups[k][0].locked ? groups[k][0].length_m : undefined);
  // A side that keeps its measure sizes the rectangle; otherwise the drawing does.
  const width = kept(0) ?? kept(2) ?? Math.max(...xs) - x0, height = kept(1) ?? kept(3) ?? Math.max(...ys) - y0;
  if (width < 0.3 || height < 0.3) throw new Error(tr('Pièce trop étroite pour un rectangle.', 'Room too narrow for a rectangle.'));
  const [x1, y1] = [+(x0 + width).toFixed(6), +(y0 + height).toFixed(6)];
  // Sides in counter-clockwise order: bottom, right, top, left; each with its start and direction.
  const sides = [
    { start: [x0, y0], dir: [1, 0], len: x1 - x0 }, { start: [x1, y0], dir: [0, 1], len: y1 - y0 },
    { start: [x1, y1], dir: [-1, 0], len: x1 - x0 }, { start: [x0, y1], dir: [0, -1], len: y1 - y0 },
  ] as const;
  const stamp = now.getTime().toString(36);
  const walls: SurveyWall[] = sides.map((side, k) => {
    const g = groups[k];
    // The longest old wall of the side lends its id (openings, photos and correlation follow).
    const base = [...g].sort((p, q) => q.length_m - p.length_m)[0];
    const keep = kept(k) !== undefined;
    return {
      id: base?.id ?? `${roomId}_w${stamp}${k}`, from: k, to: (k + 1) % 4,
      length_m: keep ? base.length_m : +side.len.toFixed(3), source: keep ? base.source : 'estimated', locked: keep,
      thickness_m: base?.thickness_m ?? 0.2, thicknessStatus: base?.thicknessStatus ?? 'estimated',
    };
  });
  const sideWall = (old: string) => walls[sideOf(room.walls.find(w => w.id === old)!)];
  const openings = room.openings?.map(o => {
    const old = room.walls.find(w => w.id === o.wallId)!, k = sideOf(old), side = sides[k];
    const a = room.polygon[old.from], b = room.polygon[old.to], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t = (o.offset_m / old.length_m) * len; // drawn distance from the old wall's start
    const p = [a[0] + ((b[0] - a[0]) / len) * t, a[1] + ((b[1] - a[1]) / len) * t];
    const along = (p[0] - side.start[0]) * side.dir[0] + (p[1] - side.start[1]) * side.dir[1];
    const w = walls[k], k2 = w.length_m / side.len;
    return { ...o, wallId: w.id, offset_m: +Math.min(Math.max(0, along * k2), w.length_m - o.width_m).toFixed(3) };
  });
  const photos = room.photos?.map(p => (p.surface.kind === 'wall' ? { ...p, surface: { kind: 'wall' as const, wallId: sideWall(p.surface.wallId).id } } : p));
  const links = room.walls.flatMap(w => wallLinks(w).map(other => ({ side: sideWall(w.id).id, other: { roomId: other.roomId, wallId: other.wallId } })));
  const polygon: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const reshaped: SurveyRoom = {
    ...room, polygon, walls, ...(openings ? { openings } : {}), ...(photos ? { photos } : {}),
    // Choosing « rectangle » is the user confirming its right angles: typed at the four corners.
    diagonals: [], angles: [0, 1, 2, 3].map(v => ({ id: `ang_${v}`, vertex: v, deg: 90 })), shape: 'rectangle', geometryStatus: 'assumed',
  };
  // Links are made again from scratch: dropped on both sides first.
  const unlink = (r: SurveyRoom): SurveyRoom => dropLinks(r, l => l.roomId === roomId);
  let next = touch({ ...survey, levels: survey.levels.map(l => (l !== level ? l : {
    ...l, rooms: l.rooms.map(r => (r.id === roomId ? resolve(completeOrthogonal(reshaped)) : unlink(r))),
  })) }, now);
  let lostLinks = 0;
  for (const { side, other } of links) {
    try { next = linkFaces(next, { roomId, wallId: side }, other, now); } catch { lostLinks++; }
  }
  const problem = openingProblem(next.levels.find(l => l.id === level.id)!.rooms.find(r => r.id === roomId)!);
  if (problem) throw new Error(problem);
  return { survey: next, lostLinks };
}

export function setWallThickness(survey: Survey, roomId: string, wallId: string, thickness: number, measured: boolean, now = new Date()): Survey {
  if (!(thickness > 0)) throw new Error(tr("L'épaisseur doit être strictement positive.", 'The thickness must be greater than zero.'));
  // One physical wall: its linked face gets the same thickness.
  const own = survey.levels.flatMap(l => l.rooms).find(r => r.id === roomId)?.walls.find(w => w.id === wallId);
  // A face linked to several rooms: a partition whose thickness was measured otherwise keeps it.
  for (const link of own ? wallLinks(own) : []) survey = mapRoom(survey, link.roomId, room => ({
    ...room,
    walls: room.walls.map(w => (w.id !== link.wallId || (w.thicknessStatus === 'measured' && Math.abs(w.thickness_m - thickness) > 1e-6 && wallLinks(own!).length > 1) ? w
      : { ...w, thickness_m: thickness, thicknessStatus: measured ? 'measured' : 'estimated' })),
  }), now);
  return mapRoom(survey, roomId, room => ({
    ...room,
    walls: room.walls.map(w => (w.id === wallId ? { ...w, thickness_m: thickness, thicknessStatus: measured ? 'measured' : 'estimated' } : w)),
  }), now);
}

/** Moves a room on the sketch; lengths are unchanged. */
/** Moves a room on the sketch, with the rooms linked to it so shared walls stay closed; lengths are unchanged. */
export function moveRoom(survey: Survey, roomId: string, dx: number, dy: number, now = new Date()): Survey {
  const level = survey.levels.find(l => l.rooms.some(r => r.id === roomId));
  if (!level) throw new Error(tr(`Pièce introuvable : ${roomId}`, `Room not found: ${roomId}`));
  const groupRooms = roomGroups(level).find(g => g.some(r => r.id === roomId))!;
  const frozen = groupRooms.find(r => r.frozen);
  if (frozen) throw frozenError(frozen);
  const group = new Set(groupRooms.map(r => r.id));
  const shift = ([x, y]: [number, number]): [number, number] => [+(x + dx).toFixed(6), +(y + dy).toFixed(6)];
  return touch({ ...survey, levels: survey.levels.map(l => (l !== level ? l : { ...l, rooms: l.rooms.map(r => group.has(r.id)
    ? { ...r, polygon: r.polygon.map(shift), ...(r.furniture && { furniture: r.furniture.map(f => ({ ...f, center: shift(f.center) })) }) }
    : r) })) }, now);
}

export function renameRoom(survey: Survey, roomId: string, name: string, now = new Date()): Survey {
  return mapRoom(survey, roomId, room => ({ ...room, name }), now);
}

export function setCeilingHeight(survey: Survey, roomId: string, height: number | undefined, now = new Date()): Survey {
  if (height !== undefined && !(height > 0)) throw new Error(tr('La hauteur sous plafond doit être strictement positive.', 'The ceiling height must be greater than zero.'));
  return mapRoom(survey, roomId, room => ({ ...room, ceilingHeight_m: height }), now);
}

export function deleteRoom(survey: Survey, roomId: string, now = new Date()): Survey {
  const target = survey.levels.flatMap(l => l.rooms).find(r => r.id === roomId);
  if (target?.frozen) throw frozenError(target);
  // Its neighbours' faces stop being linked to it.
  const unlink = (r: SurveyRoom): SurveyRoom => dropLinks(r, l => l.roomId === roomId);
  return touch({ ...survey, levels: survey.levels.map(l => ({ ...l, rooms: l.rooms.filter(r => r.id !== roomId).map(unlink) })) }, now);
}

// ── Openings ────────────────────────────────────────────────────────────────────

const OPENING_DEFAULTS: Record<OpeningKind, Pick<SurveyOpening, 'operation' | 'width_m' | 'height_m' | 'sill_m'>> = {
  door: { operation: 'single_swing', width_m: 0.83, height_m: 2.04 },
  window: { operation: 'double_swing', width_m: 1.2, height_m: 1.25, sill_m: 0.9 },
};

/** The three cotes of an opening on its wall: before, width, after. */
export function openingCotes(room: SurveyRoom, opening: SurveyOpening) {
  const wall = room.walls.find(w => w.id === opening.wallId)!;
  return { before: opening.offset_m, width: opening.width_m, after: wall.length_m - opening.offset_m - opening.width_m };
}

function withOpenings(room: SurveyRoom, openings: SurveyOpening[]): SurveyRoom {
  const next = { ...room, openings };
  const problem = openingProblem(next);
  if (problem) throw new Error(problem);
  return next;
}

/** Adds a door or window centred at `center` metres from the wall start, clamped inside the wall. */
export function addOpening(
  survey: Survey, roomId: string, wallId: string, kind: OpeningKind, center: number, now = new Date(),
): { survey: Survey; openingId: string } {
  const openingId = `op_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const next = mapRoom(survey, roomId, room => {
    const wall = room.walls.find(w => w.id === wallId);
    if (!wall) throw new Error(tr(`Mur introuvable : ${wallId}`, `Wall not found: ${wallId}`));
    const d = OPENING_DEFAULTS[kind];
    const width = Math.min(d.width_m, wall.length_m);
    const offset = Math.min(Math.max(0, center - width / 2), wall.length_m - width);
    const opening: SurveyOpening = { id: openingId, wallId, kind, ...d, width_m: width, offset_m: +offset.toFixed(3), hinge: 'start', swing: 'in' };
    return withOpenings(room, [...(room.openings ?? []), opening]);
  }, now);
  return { survey: next, openingId };
}

function mapOpening(survey: Survey, roomId: string, openingId: string, f: (o: SurveyOpening, room: SurveyRoom) => SurveyOpening, now: Date): Survey {
  return mapRoom(survey, roomId, room => {
    const opening = room.openings?.find(o => o.id === openingId);
    if (!opening) throw new Error(tr(`Ouverture introuvable : ${openingId}`, `Opening not found: ${openingId}`));
    const updated = f(opening, room);
    if (!OPENING_OPERATIONS[updated.kind].includes(updated.operation)) throw new Error(tr('Mécanisme impossible pour ce type d\'ouverture.', 'This mechanism is not possible for this type of opening.'));
    if (!(updated.width_m > 0 && updated.height_m > 0)) throw new Error(tr('Largeur et hauteur doivent être strictement positives.', 'Width and height must be greater than zero.'));
    return withOpenings(room, room.openings!.map(o => (o.id === openingId ? updated : o)));
  }, now);
}

/** Changes type, mechanism, hinge, swing, height or sill. */
export function updateOpening(
  survey: Survey, roomId: string, openingId: string,
  patch: Partial<Pick<SurveyOpening, 'kind' | 'operation' | 'hinge' | 'swing' | 'height_m' | 'sill_m'>>, now = new Date(),
): Survey {
  return mapOpening(survey, roomId, openingId, o => {
    const next = { ...o, ...patch };
    if (patch.kind && patch.kind !== o.kind) {
      next.operation = OPENING_OPERATIONS[patch.kind].includes(next.operation) ? next.operation : OPENING_DEFAULTS[patch.kind].operation;
      next.sill_m = patch.kind === 'window' ? (o.sill_m ?? OPENING_DEFAULTS.window.sill_m) : undefined;
    }
    return next;
  }, now);
}

/**
 * Sets one of the three cotes (spec F-10). « avant » moves the opening, « largeur » keeps the
 * avant unless the far side lacks room, then it grows towards free space on the near side;
 * « après » moves it keeping its width. Overflow and overlap that cannot be absorbed are refused.
 */
export function setOpeningCote(
  survey: Survey, roomId: string, openingId: string, cote: 'before' | 'width' | 'after', value: number, now = new Date(),
): Survey {
  if (!(value >= 0) || (cote === 'width' && value === 0)) throw new Error(tr('Valeur invalide.', 'Invalid value.'));
  return mapOpening(survey, roomId, openingId, (o, room) => {
    const wall = room.walls.find(w => w.id === o.wallId)!;
    if (cote === 'before') return { ...o, offset_m: value };
    if (cote === 'width') {
      // Keep the avant when possible; if the far side lacks room, slide back into free space on the near side.
      let min = 0, max = wall.length_m;
      for (const other of room.openings ?? []) {
        if (other.id === o.id || other.wallId !== o.wallId) continue;
        if (other.offset_m + other.width_m <= o.offset_m + 1e-9) min = Math.max(min, other.offset_m + other.width_m);
        else if (other.offset_m >= o.offset_m + o.width_m - 1e-9) max = Math.min(max, other.offset_m);
      }
      const offset = o.offset_m + value > max + 1e-9 ? Math.max(min, max - value) : o.offset_m;
      return { ...o, width_m: value, offset_m: +offset.toFixed(6) };
    }
    return { ...o, offset_m: wall.length_m - value - o.width_m };
  }, now);
}

/** Drag along the wall: the offset is clamped to the wall and between the neighbouring openings. */
export function moveOpening(survey: Survey, roomId: string, openingId: string, offset: number, now = new Date()): Survey {
  return mapOpening(survey, roomId, openingId, (o, room) => {
    const wall = room.walls.find(w => w.id === o.wallId)!;
    let min = 0, max = wall.length_m - o.width_m;
    for (const other of room.openings ?? []) {
      if (other.id === o.id || other.wallId !== o.wallId) continue;
      if (other.offset_m + other.width_m <= o.offset_m + 1e-9) min = Math.max(min, other.offset_m + other.width_m);
      else if (other.offset_m >= o.offset_m + o.width_m - 1e-9) max = Math.min(max, other.offset_m - o.width_m);
    }
    return { ...o, offset_m: +Math.min(max, Math.max(min, offset)).toFixed(3) };
  }, now);
}

export function deleteOpening(survey: Survey, roomId: string, openingId: string, now = new Date()): Survey {
  return mapRoom(survey, roomId, room => ({ ...room, openings: (room.openings ?? []).filter(o => o.id !== openingId) }), now);
}

export function setTechnicalPoint(survey: Survey, roomId: string, point: SurveyTechnicalPoint, now = new Date()): Survey {
  return mapRoom(survey, roomId, room => {
    if (!room.walls.some(w => w.id === point.wallId) || !TECHNICAL_CATALOGUE.some(m => m.id === point.model)
      || !Number.isFinite(point.distance_m) || point.distance_m < 0 || !Number.isFinite(point.height_m) || point.height_m < 0)
      throw new Error(tr('Point technique invalide.', 'Invalid technical point.'));
    const points = room.technicalPoints ?? [];
    const technicalPoints = points.some(p => p.id === point.id) ? points.map(p => p.id === point.id ? point : p) : [...points, point];
    return { ...room, technicalPoints };
  }, now);
}

export function deleteTechnicalPoint(survey: Survey, roomId: string, pointId: string, now = new Date()): Survey {
  return mapRoom(survey, roomId, room => ({ ...room, technicalPoints: (room.technicalPoints ?? []).filter(p => p.id !== pointId) }), now);
}

export function setSurveyFurniture(survey: Survey, roomId: string, furniture: SurveyFurniture, now = new Date()): Survey {
  if (!validSurveyFurniture(furniture)) throw new Error(tr('Meuble invalide.', 'Invalid furniture.'));
  return mapRoom(survey, roomId, room => {
    const entries = room.furniture ?? [];
    return { ...room, furniture: entries.some(f => f.id === furniture.id)
      ? entries.map(f => f.id === furniture.id ? furniture : f)
      : [...entries, furniture] };
  }, now);
}

export function deleteSurveyFurniture(survey: Survey, roomId: string, id: string, now = new Date()): Survey {
  return mapRoom(survey, roomId, room => ({ ...room, furniture: (room.furniture ?? []).filter(f => f.id !== id) }), now);
}

// ── Free-form rooms ─────────────────────────────────────────────────────────────

const drawn = (polygon: [number, number][], i: number) => {
  const a = polygon[i], b = polygon[(i + 1) % polygon.length];
  return +Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(3);
};

/** Adds a room drawn vertex by vertex; any winding is accepted and stored counter-clockwise. */
export function addPolygonRoom(survey: Survey, levelId: string, name: string, points: [number, number][], now = new Date()): { survey: Survey; roomId: string } {
  if (points.length < 3) throw new Error(tr('Une pièce a au moins trois sommets.', 'A room has at least three corners.'));
  const polygon = signedArea(points) < 0 ? [...points].reverse() : [...points];
  if (!isSimplePolygon(polygon)) throw new Error(tr('Le contour se recoupe.', 'The outline crosses itself.'));
  if (Math.abs(signedArea(polygon)) < 0.25) throw new Error(tr('Pièce trop petite.', 'Room too small.'));
  const level = survey.levels.find(l => l.id === levelId);
  if (!level) throw new Error(tr(`Niveau introuvable : ${levelId}`, `Level not found: ${levelId}`));
  const roomId = `room_${now.getTime().toString(36)}_${level.rooms.length}`;
  const room: SurveyRoom = {
    id: roomId, name, geometryStatus: 'assumed', shape: 'polygon', polygon,
    walls: polygon.map((_, i) => ({
      id: `${roomId}_w${i + 1}`, from: i, to: (i + 1) % polygon.length, length_m: drawn(polygon, i), source: 'estimated', locked: false,
      thickness_m: surveyDefaults(survey).exteriorThickness_m, thicknessStatus: 'estimated',
    })),
  };
  const levels = survey.levels.map(l => (l.id === levelId ? { ...l, rooms: [...l.rooms, room] } : l));
  return { survey: touch({ ...survey, levels }, now), roomId };
}

/**
 * Moves one vertex of the sketch. Sketched (unlocked) lengths of the two adjacent walls follow
 * the drawing; measured ones are kept, and any disagreement becomes a warning.
 * A rectangle whose vertex is moved becomes a free-form room.
 */
export function moveVertex(survey: Survey, roomId: string, index: number, point: [number, number], now = new Date()): Survey {
  return mapRoom(survey, roomId, room => {
    if (index < 0 || index >= room.polygon.length) throw new Error(tr('Sommet introuvable.', 'Corner not found.'));
    const polygon = room.polygon.map((p, i) => (i === index ? point : p));
    if (signedArea(polygon) <= 0 || !isSimplePolygon(polygon)) throw new Error(tr('Le contour se recoupe.', 'The outline crosses itself.'));
    const walls = room.walls.map(w => (!w.locked && (w.from === index || w.to === index) ? { ...w, length_m: drawn(polygon, w.from) } : w));
    // On a sketched wall the opening's place is a sketch too: when the wall gets shorter, the
    // opening slides back inside it instead of blocking the drag. Measured walls keep their length.
    const resized = new Map(walls.filter(w => !w.locked && (w.from === index || w.to === index)).map(w => [w.id, w.length_m]));
    const openings = room.openings?.map(o => {
      const len = resized.get(o.wallId);
      if (len === undefined || o.offset_m + o.width_m <= len) return o;
      return { ...o, offset_m: +Math.max(0, len - o.width_m).toFixed(3) };
    });
    // Moving a vertex by hand is a sketch again: the shape no longer comes from the measurements.
    const next = { ...room, polygon, walls, ...(openings ? { openings } : {}), shape: 'polygon' as const, geometryStatus: 'assumed' as const };
    const problem = openingProblem(next);
    if (problem) throw new Error(problem);
    return next;
  }, now);
}

/**
 * Removes one vertex of a room: its two walls become one. The merged wall is a new sketch
 * (unlocked, drawn length); refused when either wall carries an opening or fewer than
 * three vertices would remain.
 */
export function deleteVertex(survey: Survey, roomId: string, index: number, now = new Date()): Survey {
  return mapRoom(survey, roomId, room => {
    const n = room.polygon.length;
    if (index < 0 || index >= n) throw new Error(tr('Sommet introuvable.', 'Corner not found.'));
    if (n <= 3) throw new Error(tr('Une pièce garde au moins trois sommets.', 'A room keeps at least three corners.'));
    const before = room.walls.find(w => w.to === index)!, after = room.walls.find(w => w.from === index)!;
    if ((room.openings ?? []).some(o => o.wallId === before.id || o.wallId === after.id))
      throw new Error(tr('Supprimez ou déplacez d’abord les ouvertures des deux murs de ce point.', 'First delete or move the openings on the two walls of this point.'));
    if (room.technicalPoints?.some(p => p.wallId === before.id || p.wallId === after.id))
      throw new Error(tr('Des points techniques sont cotés sur les murs à regrouper.', 'The walls to be merged carry dimensioned technical points.'));
    if (isLinked(before) || isLinked(after)) throw new Error(tr('Ce point appartient à un mur partagé avec une autre pièce.', 'This point belongs to a wall shared with another room.'));
    const polygon = room.polygon.filter((_, i) => i !== index);
    if (signedArea(polygon) <= 0 || !isSimplePolygon(polygon)) throw new Error(tr('Le contour se recouperait.', 'The outline would cross itself.'));
    const shift = (i: number) => (i > index ? i - 1 : i);
    const walls = room.walls
      .filter(w => w.id !== after.id)
      .map(w => {
        if (w.id !== before.id) return { ...w, from: shift(w.from), to: shift(w.to) };
        const from = shift(w.from), to = shift(after.to);
        const [a, b] = [polygon[from], polygon[to]];
        return { ...w, from, to, length_m: +Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(3), source: 'estimated' as const, locked: false };
      });
    const diagonals = (room.diagonals ?? []).filter(d => d.from !== index && d.to !== index)
      .map(d => ({ ...d, from: shift(d.from), to: shift(d.to) }))
      .filter(d => { const m = polygon.length; return (d.to - d.from + m) % m !== 1 && (d.from - d.to + m) % m !== 1; });
    const angles = (room.angles ?? []).filter(a => a.vertex !== index).map(a => ({ ...a, vertex: shift(a.vertex) }));
    // Photos of the removed wall now document the merged one.
    const photos = room.photos?.map(p => (p.surface.kind === 'wall' && p.surface.wallId === after.id ? { ...p, surface: { kind: 'wall' as const, wallId: before.id } } : p));
    return { ...room, polygon, walls, shape: 'polygon' as const, diagonals, angles, ...(photos ? { photos } : {}), geometryStatus: 'assumed' as const };
  }, now);
}

/**
 * Adds a vertex on a wall at `t` (0–1 along its drawn length): the wall becomes two sketched
 * walls, ready to be dragged into an L or a cut corner. Openings stay on the part they sit on;
 * refused when an opening straddles the split or the wall is shared with another room.
 */
export function insertVertex(survey: Survey, roomId: string, wallId: string, t: number, now = new Date()): { survey: Survey; index: number } {
  let index = -1;
  const next = mapRoom(survey, roomId, room => {
    const wall = room.walls.find(w => w.id === wallId);
    if (!wall) throw new Error(tr(`Mur introuvable : ${wallId}`, `Wall not found: ${wallId}`));
    if (isLinked(wall)) throw new Error(tr('Ce mur est partagé avec une autre pièce : ajoutez le point sur un mur non partagé.', 'This wall is shared with another room: add the point on a wall that is not shared.'));
    if (!(t > 0.02 && t < 0.98)) throw new Error(tr('Le point doit être placé à l’intérieur du mur.', 'The point must be inside the wall.'));
    const split = t * wall.length_m; // where the split falls on the measured face
    const openings = room.openings ?? [];
    if (openings.some(o => o.wallId === wallId && o.offset_m < split && o.offset_m + o.width_m > split))
      throw new Error(tr('Une ouverture se trouve à cet endroit : placez le point à côté.', 'An opening is at this spot: place the point next to it.'));
    const at = wall.from + 1; // new vertex index, right after the wall's start
    index = at;
    const a = room.polygon[wall.from], b = room.polygon[wall.to];
    const p: [number, number] = [+(a[0] + (b[0] - a[0]) * t).toFixed(6), +(a[1] + (b[1] - a[1]) * t).toFixed(6)];
    const polygon = [...room.polygon.slice(0, at), p, ...room.polygon.slice(at)];
    const shift = (i: number) => (i >= at ? i + 1 : i);
    const drawn = (i: number, j: number) => +Math.hypot(polygon[j][0] - polygon[i][0], polygon[j][1] - polygon[i][1]).toFixed(3);
    const newId = `${roomId}_w${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const second: SurveyWall = { ...wall, id: newId, from: at, to: shift(wall.to), length_m: drawn(at, shift(wall.to)), source: 'estimated', locked: false };
    const walls = room.walls.flatMap(w => w.id !== wallId
      ? [{ ...w, from: shift(w.from), to: shift(w.to) }]
      : [{ ...w, from: w.from, to: at, length_m: drawn(w.from, at), source: 'estimated' as const, locked: false }, second]);
    const moved = openings.map(o => (o.wallId === wallId && o.offset_m >= split ? { ...o, wallId: newId, offset_m: +(o.offset_m - split).toFixed(3) } : o));
    const technicalPoints = room.technicalPoints?.map(p => {
      if (p.wallId !== wallId) return p;
      const fromStart = p.edge === 'right' ? p.distance_m : wall.length_m - p.distance_m;
      const onSecond = fromStart > split || (fromStart === split && p.edge === 'left');
      const sameEdge = onSecond === (p.edge === 'left');
      return { ...p, wallId: onSecond ? newId : wallId,
        distance_m: sameEdge ? p.distance_m : Math.abs(fromStart - split),
        distanceMeasured: sameEdge ? p.distanceMeasured : undefined };
    });
    const diagonals = (room.diagonals ?? []).map(d => ({ ...d, from: shift(d.from), to: shift(d.to) }));
    const angles = (room.angles ?? []).map(g => ({ ...g, vertex: shift(g.vertex) }));
    const result = { ...room, polygon, walls, openings: moved, ...(technicalPoints ? { technicalPoints } : {}), diagonals, angles, shape: 'polygon' as const, geometryStatus: 'assumed' as const };
    const problem = openingProblem(result);
    if (problem) throw new Error(problem);
    return result;
  }, now);
  return { survey: next, index };
}

// ── Adjacent rooms (linked faces, ADR 0008) ───────────────────────────────────────

const ADJACENT_DEPTH = 3;

/**
 * Creates the room on the other side of a door's wall (spec F-13): a rectangle drawn against
 * the wall's outer face, whose first wall is linked to the door's wall. The door stays a single
 * object of its room; the new room sees it through the link.
 */
export function addAdjacentRoom(
  survey: Survey, roomId: string, openingId: string, name: string, now = new Date(),
): { survey: Survey; roomId: string } {
  const level = survey.levels.find(l => l.rooms.some(r => r.id === roomId));
  const room = level?.rooms.find(r => r.id === roomId);
  const door = room?.openings?.find(o => o.id === openingId);
  if (!level || !room || !door) throw new Error(tr('Porte introuvable.', 'Door not found.'));
  if (door.kind !== 'door') throw new Error(tr('Une pièce adjacente se crée depuis une porte.', 'An adjacent room is created from a door.'));
  const wall = room.walls.find(w => w.id === door.wallId)!;
  if (isLinked(wall)) throw new Error(tr('Ce mur est déjà partagé avec une autre pièce.', 'This wall is already shared with another room.'));
  const a = room.polygon[wall.from], b = room.polygon[wall.to];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n: [number, number] = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len]; // outward, counter-clockwise room
  // An estimated thickness becomes the survey's interior one: the wall now separates two rooms.
  const t = wall.thicknessStatus === 'measured' ? wall.thickness_m : surveyDefaults(survey).interiorThickness_m, d = ADJACENT_DEPTH;
  const at = (p: [number, number], k: number): [number, number] => [+(p[0] + n[0] * k).toFixed(6), +(p[1] + n[1] * k).toFixed(6)];
  // Runs b → a on the far face, so the new room is counter-clockwise too.
  const polygon: [number, number][] = [at(b, t), at(a, t), at(a, t + d), at(b, t + d)];
  const newId = `room_${now.getTime().toString(36)}_${level.rooms.length}`;
  const walls: SurveyWall[] = [len, d, len, d].map((length_m, i) => ({
    id: `${newId}_w${i + 1}`, from: i, to: (i + 1) % 4,
    // The shared face is the same wall seen from the other side: same length until measured.
    length_m: i === 0 ? wall.length_m : +length_m.toFixed(3), source: 'estimated', locked: false,
    thickness_m: i === 0 ? t : surveyDefaults(survey).exteriorThickness_m, thicknessStatus: i === 0 ? wall.thicknessStatus : 'estimated',
  }));
  walls[0].links = [{ roomId, wallId: wall.id, offset_m: 0, offsetStatus: 'estimated' }];
  const adjacent: SurveyRoom = { id: newId, name, geometryStatus: 'assumed', shape: 'rectangle', polygon, walls };
  const levels = survey.levels.map(l => l.id !== level.id ? l : {
    ...l,
    rooms: [
      ...l.rooms.map(r => r.id !== roomId ? r : { ...r, walls: r.walls.map(w => (w.id === wall.id ? { ...setLinks(w, [{ roomId: newId, wallId: walls[0].id, offset_m: 0, offsetStatus: 'estimated' }]), thickness_m: t } : w)) }),
      adjacent,
    ],
  });
  return { survey: touch({ ...survey, levels }, now), roomId: newId };
}

/**
 * Unlinks a wall from its linked face in the other room: both faces become separate walls again.
 * Openings stay in the room that holds them; thicknesses are kept.
 */
export function unlinkFaces(survey: Survey, face: { roomId: string; wallId: string }, other?: { roomId: string; wallId: string }, now = new Date()): Survey {
  const room = survey.levels.flatMap(l => l.rooms).find(r => r.id === face.roomId);
  const links = wallLinks(room?.walls.find(w => w.id === face.wallId) ?? ({} as SurveyWall));
  // Without the other face, the wall must have a single link: which one would be ambiguous.
  const link = other ? links.find(l => l.roomId === other.roomId && l.wallId === other.wallId) : links.length === 1 ? links[0] : undefined;
  if (!link) throw new Error(links.length ? tr('Indiquez quel lien de ce mur supprimer.', 'Say which link of this wall to remove.') : tr('Ce mur n’est lié à aucune autre pièce.', 'This wall is not linked to any other room.'));
  const drop = (r: SurveyRoom, wallId: string, to: { roomId: string; wallId: string }): SurveyRoom =>
    dropLinks(r, (l, w) => w.id === wallId && l.roomId === to.roomId && l.wallId === to.wallId);
  let next = mapRoom(survey, face.roomId, r => drop(r, face.wallId, link), now);
  // The other face may already be gone (deleted room): nothing to undo there.
  if (next.levels.some(l => l.rooms.some(r => r.id === link.roomId))) next = mapRoom(next, link.roomId, r => drop(r, link.wallId, face), now);
  return next;
}

/**
 * Declares that two walls already facing each other on the plan are the two sides of one wall
 * (linked faces, ADR 0008), without moving anything: for rooms placed together that share a
 * wall with no opening. The common stretch and the thickness are read from the drawing; refused
 * when the faces are not parallel, not facing, or further apart than a plausible wall.
 */
export function linkFaces(
  survey: Survey, a: { roomId: string; wallId: string }, b: { roomId: string; wallId: string }, now = new Date(),
): Survey {
  const find = (sv: Survey) => {
    const level = sv.levels.find(l => l.rooms.some(r => r.id === a.roomId));
    const ra = level?.rooms.find(r => r.id === a.roomId), rb = level?.rooms.find(r => r.id === b.roomId);
    const wa = ra?.walls.find(w => w.id === a.wallId), wb = rb?.walls.find(w => w.id === b.wallId);
    if (!level || !ra || !rb || !wa || !wb) throw new Error(tr('Mur introuvable.', 'Wall not found.'));
    return { level, ra, rb, wa, wb };
  };
  let { level, ra, rb, wa, wb } = find(survey);
  if (ra.id === rb.id) throw new Error(tr('Choisissez un mur d’une autre pièce.', 'Choose a wall of another room.'));
  if (wallLinks(wa).some(l => l.roomId === rb.id && l.wallId === wb.id)) throw new Error(tr('Ces deux murs sont déjà liés.', 'These two walls are already linked.'));
  // A room that will not be moved (resolved by its measurements, or frozen) may be drawn anywhere:
  // the link is recorded and the global plan places it (ADR 0013).
  const fixed = rb.geometryStatus === 'resolved' || !!rb.frozen;
  // A sketched room not yet connected to this one (what « Raccorder » did): its group is turned
  // and moved against the face, from estimated values that the user can measure afterwards.
  const groupOf = (id: string) => roomGroups(level).find(gr => gr.some(r => r.id === id))!;
  // Faces already drawn facing each other, a wall apart: linked as drawn (below), nothing turned.
  const facing = (() => {
    const [a0, a1] = [ra.polygon[wa.from], ra.polygon[wa.to]], [b0, b1] = [rb.polygon[wb.from], rb.polygon[wb.to]];
    const la = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1, lb = Math.hypot(b1[0] - b0[0], b1[1] - b0[1]) || 1;
    const u = [(a1[0] - a0[0]) / la, (a1[1] - a0[1]) / la], n = [u[1], -u[0]];
    const cos = (u[0] * (b1[0] - b0[0]) + u[1] * (b1[1] - b0[1])) / lb;
    const gap = ((b0[0] - a0[0]) * n[0] + (b0[1] - a0[1]) * n[1] + (b1[0] - a0[0]) * n[0] + (b1[1] - a0[1]) * n[1]) / 2;
    const along = (p: [number, number]) => (p[0] - a0[0]) * u[0] + (p[1] - a0[1]) * u[1];
    return cos <= -0.966 && gap >= -0.5 && gap <= 0.8 && Math.min(la, along(b0)) - Math.max(0, along(b1)) >= 0.1;
  })();
  if (!fixed && !facing && !groupOf(ra.id).some(r => r.id === rb.id) && !groupOf(rb.id).some(r => r.frozen)) {
    const measuredWall = [wa, wb].find(w => w.thicknessStatus === 'measured');
    const t = measuredWall ? measuredWall.thickness_m : surveyDefaults(survey).interiorThickness_m;
    // Where the drawing puts the end of the other face along this one, when they roughly face each other.
    const [a0, a1] = [ra.polygon[wa.from], ra.polygon[wa.to]], b1 = rb.polygon[wb.to];
    const la = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1;
    const along = (((b1[0] - a0[0]) * (a1[0] - a0[0]) + (b1[1] - a0[1]) * (a1[1] - a0[1])) / la) * (wa.length_m / la);
    const offset = +Math.min(wa.length_m, Math.max(0, along)).toFixed(3);
    const moved = connectRooms(survey, a, b, offset, t, now);
    const estimate = (r: SurveyRoom, wallId: string, to: { roomId: string; wallId: string }): SurveyRoom => ({
      ...r, walls: r.walls.map(w => (w.id !== wallId ? w : {
        ...setLinks(w, wallLinks(w).map(l => (l.roomId === to.roomId && l.wallId === to.wallId ? { ...l, offsetStatus: 'estimated' as const } : l))),
        thicknessStatus: measuredWall ? 'measured' as const : 'estimated' as const,
      })),
    });
    return mapRoom(mapRoom(moved, a.roomId, r => estimate(r, a.wallId, b), now, true), b.roomId, r => estimate(r, b.wallId, a), now, true);
  }
  const geom = () => {
    const [a0, a1] = [ra.polygon[wa.from], ra.polygon[wa.to]], [b0, b1] = [rb.polygon[wb.from], rb.polygon[wb.to]];
    const la = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]), lb = Math.hypot(b1[0] - b0[0], b1[1] - b0[1]);
    const u = [(a1[0] - a0[0]) / la, (a1[1] - a0[1]) / la], v = [(b1[0] - b0[0]) / lb, (b1[1] - b0[1]) / lb];
    const n = [u[1], -u[0]]; // outward normal of a
    const dist = (p: [number, number]) => (p[0] - a0[0]) * n[0] + (p[1] - a0[1]) * n[1];
    const along = (p: [number, number]) => (p[0] - a0[0]) * u[0] + (p[1] - a0[1]) * u[1];
    return { a0, a1, b0, b1, la, lb, u, v, n, dist, along };
  };
  let g = geom();
  // Two sides of one wall run in opposite directions (both rooms counter-clockwise). Hand-drawn
  // walls are never exactly parallel: up to 15° is accepted and the other wall is aligned.
  if (g.u[0] * g.v[0] + g.u[1] * g.v[1] > -0.966) throw new Error(tr('Ces deux murs ne se font pas face (angle trop différent) : choisissez le mur d’en face.', 'These two walls do not face each other (angle too different): choose the opposite wall.'));
  const gap = (g.dist(g.b0) + g.dist(g.b1)) / 2;
  if (!fixed && (gap < -0.5 || gap > 0.8)) throw new Error(tr(`Ces murs sont à ${Math.abs(gap).toFixed(2).replace('.', ',')} m l’un de l’autre sur le plan : rapprochez les pièces d’abord.`, `These walls are ${Math.abs(gap).toFixed(2)} m apart on the plan: bring the rooms closer first.`));
  if (!fixed && Math.min(g.la, g.along(g.b0)) - Math.max(0, g.along(g.b1)) < 0.1) throw new Error(tr('Ces deux murs ne se recouvrent pas sur le plan.', 'These two walls do not overlap on the plan.'));
  // A measured thickness wins; else the gap drawn between the faces when plausible; else the survey's interior thickness.
  const measured = [wa, wb].find(w => w.thicknessStatus === 'measured');
  const thickness = +(measured ? measured.thickness_m : gap >= 0.05 && gap <= 0.6 ? gap : surveyDefaults(survey).interiorThickness_m).toFixed(3);
  // Align the other wall on the face line, one thickness out, keeping where its ends are along it.
  const target = (p: [number, number]): [number, number] => {
    const s0 = g.along(p);
    return [+(g.a0[0] + g.u[0] * s0 + g.n[0] * thickness).toFixed(6), +(g.a0[1] + g.u[1] * s0 + g.n[1] * thickness).toFixed(6)];
  };
  const [t0, t1] = [target(g.b0), target(g.b1)];
  const off = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.001;
  // A sketched room is aligned on the other face; a room resolved by its measurements (or frozen) is
  // not moved: the link is recorded and the global plan places it, or reports the gap (ADR 0012).
  if ((off(t0, g.b0) || off(t1, g.b1)) && !fixed) {
    survey = moveVertex(moveVertex(survey, rb.id, wb.from, t0, now), rb.id, wb.to, t1, now);
    ({ level, ra, rb, wa, wb } = find(survey));
    g = geom();
  }
  // Offsets are measured on each face: where the other face ends, from this face's start.
  const ka = wa.length_m / g.la, kb = wb.length_m / g.lb;
  const offA = Math.max(0, g.along(g.b1)) * ka;
  const offB = Math.max(0, (g.a1[0] - g.b0[0]) * g.v[0] + (g.a1[1] - g.b0[1]) * g.v[1]) * kb;
  // The new stretch must not overlap another link of either face.
  checkFreeStretch(level, wa, offA, Math.min(wa.length_m, offA + wb.length_m));
  checkFreeStretch(level, wb, offB, Math.min(wb.length_m, offB + wa.length_m));
  const link = (room: SurveyRoom, wallId: string, l: FaceLink): SurveyRoom =>
    addLink(room, wallId, l, { thickness_m: thickness, thicknessStatus: measured ? 'measured' : 'estimated' });
  const lvl = level;
  return touch({
    ...survey,
    levels: survey.levels.map(l => (l !== lvl ? l : {
      ...l,
      rooms: l.rooms.map(r => r.id === ra.id ? link(r, wa.id, { roomId: rb.id, wallId: wb.id, offset_m: +offA.toFixed(6), offsetStatus: 'estimated' })
        : r.id === rb.id ? link(r, wb.id, { roomId: ra.id, wallId: wa.id, offset_m: +offB.toFixed(6), offsetStatus: 'estimated' }) : r),
    })),
  }, now);
}

/**
 * Connecting rooms (spec F-17): declares that a face of a room not yet placed and a face of a placed
 * room are the two sides of one wall, from measured references: `offset_m` is where the moved
 * face ends along the reference face, `thickness_m` the measured wall thickness. The moved
 * room's group is rotated and translated onto the reference; no length is changed.
 */
export function connectRooms(
  survey: Survey, ref: { roomId: string; wallId: string }, moved: { roomId: string; wallId: string },
  offset_m: number, thickness_m: number, now = new Date(),
): Survey {
  if (!(thickness_m > 0)) throw new Error(tr("L'épaisseur doit être strictement positive.", 'The thickness must be greater than zero.'));
  if (!(offset_m >= 0)) throw new Error(tr('Le décalage doit être positif ou nul.', 'The offset must be zero or more.'));
  const level = survey.levels.find(l => l.rooms.some(r => r.id === ref.roomId));
  const refRoom = level?.rooms.find(r => r.id === ref.roomId), movedRoom = level?.rooms.find(r => r.id === moved.roomId);
  const refWall = refRoom?.walls.find(w => w.id === ref.wallId), movedWall = movedRoom?.walls.find(w => w.id === moved.wallId);
  if (!level || !refRoom || !movedRoom || !refWall || !movedWall) throw new Error(tr('Mur introuvable.', 'Wall not found.'));
  checkFreeStretch(level, refWall, offset_m, Math.min(refWall.length_m, offset_m + movedWall.length_m));
  checkFreeStretch(level, movedWall, Math.max(0, movedWall.length_m - (refWall.length_m - offset_m)), movedWall.length_m);
  const group = roomGroups(level).find(g => g.some(r => r.id === moved.roomId))!;
  if (group.some(r => r.id === ref.roomId)) throw new Error(tr('Ces pièces sont déjà reliées.', 'These rooms are already connected.'));
  const frozenMoved = group.find(r => r.frozen);
  if (frozenMoved) throw frozenError(frozenMoved);
  if (offset_m > refWall.length_m) throw new Error(tr('Le décalage dépasse la longueur du mur de référence.', 'The offset exceeds the length of the reference wall.'));

  // Target: the moved face runs opposite the reference face, one thickness outside it, and ends at `offset_m`.
  const [ra, rb] = [refRoom.polygon[refWall.from], refRoom.polygon[refWall.to]];
  const rl = Math.hypot(rb[0] - ra[0], rb[1] - ra[1]);
  const d = [(rb[0] - ra[0]) / rl, (rb[1] - ra[1]) / rl], n = [d[1], -d[0]];
  const k = rl / refWall.length_m; // measured → sketch along the reference face
  const target: [number, number] = [ra[0] + d[0] * offset_m * k + n[0] * thickness_m, ra[1] + d[1] * offset_m * k + n[1] * thickness_m];
  const [ma, mb] = [movedRoom.polygon[movedWall.from], movedRoom.polygon[movedWall.to]];
  const angle = Math.atan2(-d[1], -d[0]) - Math.atan2(mb[1] - ma[1], mb[0] - ma[0]);
  const [c, sn] = [Math.cos(angle), Math.sin(angle)];
  const place = ([x, y]: [number, number]): [number, number] => {
    const [dx, dy] = [x - mb[0], y - mb[1]];
    return [+(target[0] + dx * c - dy * sn).toFixed(6), +(target[1] + dx * sn + dy * c).toFixed(6)];
  };
  const ids = new Set(group.map(r => r.id));
  const link = (room: SurveyRoom, wallId: string, l: FaceLink): SurveyRoom => addLink(room, wallId, l, { thickness_m, thicknessStatus: 'measured' });
  const movedEnd = movedWall.length_m; // the reference face's end along the moved face, both measured
  const refEnd = Math.max(0, movedEnd - (refWall.length_m - offset_m));
  return touch({
    ...survey,
    levels: survey.levels.map(l => (l !== level ? l : {
      ...l,
      rooms: l.rooms.map(r => {
        let room = ids.has(r.id) ? { ...r, polygon: r.polygon.map(place),
          ...(r.furniture && { furniture: r.furniture.map(f => ({ ...f, center: place(f.center), rotation: f.rotation + angle })) }),
        } : r;
        if (r.id === ref.roomId) room = link(room, ref.wallId, { roomId: moved.roomId, wallId: moved.wallId, offset_m, offsetStatus: 'measured' });
        if (r.id === moved.roomId) room = link(room, moved.wallId, { roomId: ref.roomId, wallId: ref.wallId, offset_m: +refEnd.toFixed(6), offsetStatus: 'measured' });
        return room;
      }),
    })),
  }, now);
}

/**
 * Link offset measured on site (ADR 0012): where the opposite face ends, along this face from its
 * start. The opposite face's offset follows from the two face lengths; both become measured.
 */
export function setLinkOffset(survey: Survey, face: { roomId: string; wallId: string }, to: { roomId: string; wallId: string }, offset: number, now = new Date()): Survey {
  if (!(offset >= 0)) throw new Error(tr('Le décalage doit être positif ou nul.', 'The offset must be zero or more.'));
  const level = survey.levels.find(l => l.rooms.some(r => r.id === face.roomId));
  const wall = level?.rooms.find(r => r.id === face.roomId)?.walls.find(w => w.id === face.wallId);
  if (!level || !wall) throw new Error(tr('Mur introuvable.', 'Wall not found.'));
  const found = linkedFaces(level, wall).find(f => f.link.roomId === to.roomId && f.link.wallId === to.wallId);
  if (!found) throw new Error(tr('Ce mur n’est pas lié à ce mur.', 'This wall is not linked to that wall.'));
  if (offset > wall.length_m) throw new Error(tr('Le décalage dépasse la longueur du mur.', 'The offset exceeds the length of the wall.'));
  const { link, back: backLink, wall: other } = found;
  checkFreeStretch(level, wall, offset, Math.min(wall.length_m, offset + other.length_m), to);
  // Along this face, the other face runs from offset + its length down to offset: this face's end, seen from there.
  const back = Math.max(0, offset + other.length_m - wall.length_m);
  let next = mapRoom(survey, face.roomId, r => addLink(r, face.wallId, { ...link, offset_m: offset, offsetStatus: 'measured' }), now);
  next = mapRoom(next, link.roomId, r => addLink(r, link.wallId, { ...backLink, offset_m: +back.toFixed(6), offsetStatus: 'measured' }), now);
  return next;
}

/**
 * Aligned faces: `b` continues `a` on the same line, both inner faces running the same way (a
 * façade along two rooms). Nothing is moved: the global plan uses it to turn and place rooms.
 */
export function alignFaces(survey: Survey, a: { roomId: string; wallId: string }, b: { roomId: string; wallId: string }, now = new Date()): Survey {
  const level = survey.levels.find(l => l.rooms.some(r => r.id === a.roomId));
  const ra = level?.rooms.find(r => r.id === a.roomId), rb = level?.rooms.find(r => r.id === b.roomId);
  const wa = ra?.walls.find(w => w.id === a.wallId), wb = rb?.walls.find(w => w.id === b.wallId);
  if (!level || !ra || !rb || !wa || !wb) throw new Error(tr('Mur introuvable.', 'Wall not found.'));
  if (ra.id === rb.id) throw new Error(tr('Choisissez un mur d’une autre pièce.', 'Choose a wall of another room.'));
  if (wa.alignments?.some(x => x.roomId === rb.id && x.wallId === wb.id)) throw new Error(tr('Ces murs sont déjà dans le prolongement l’un de l’autre.', 'These walls already continue each other.'));
  const add = (r: SurveyRoom, wallId: string, x: FaceAlignment): SurveyRoom => ({ ...r, walls: r.walls.map(w => (w.id === wallId ? { ...w, alignments: [...(w.alignments ?? []), x] } : w)) });
  return touch({ ...survey, levels: survey.levels.map(l => (l !== level ? l : { ...l, rooms: l.rooms.map(r =>
    r.id === ra.id ? add(r, wa.id, { roomId: rb.id, wallId: wb.id, step_m: 0, stepStatus: 'estimated' })
      : r.id === rb.id ? add(r, wb.id, { roomId: ra.id, wallId: wa.id, step_m: 0, stepStatus: 'estimated' }) : r) })) }, now);
}

/** Set-back measured between two aligned faces (positive: `b`'s face lies further out than `a`'s). */
export function setAlignmentStep(survey: Survey, a: { roomId: string; wallId: string }, b: { roomId: string; wallId: string }, step: number, now = new Date()): Survey {
  if (!Number.isFinite(step)) throw new Error(tr('Décrochement attendu.', 'A set-back is expected.'));
  const set = (r: SurveyRoom, wallId: string, to: { roomId: string; wallId: string }, v: number): SurveyRoom => ({ ...r, walls: r.walls.map(w => (w.id !== wallId ? w : {
    ...w, alignments: (w.alignments ?? []).map(x => (x.roomId === to.roomId && x.wallId === to.wallId ? { ...x, step_m: +v.toFixed(4), stepStatus: 'measured' as const } : x)),
  })) });
  const level = survey.levels.find(l => l.rooms.some(r => r.id === a.roomId));
  if (!level?.rooms.find(r => r.id === a.roomId)?.walls.find(w => w.id === a.wallId)?.alignments?.some(x => x.roomId === b.roomId && x.wallId === b.wallId))
    throw new Error(tr('Ces murs ne sont pas dans le prolongement l’un de l’autre.', 'These walls do not continue each other.'));
  return touch({ ...survey, levels: survey.levels.map(l => (l !== level ? l : { ...l, rooms: l.rooms.map(r =>
    r.id === a.roomId ? set(r, a.wallId, b, step) : r.id === b.roomId ? set(r, b.wallId, a, -step) : r) })) }, now);
}

/** Removes the alignment between two faces, on both sides. */
export function unalignFaces(survey: Survey, a: { roomId: string; wallId: string }, b: { roomId: string; wallId: string }, now = new Date()): Survey {
  const drop = (r: SurveyRoom, wallId: string, to: { roomId: string; wallId: string }): SurveyRoom => ({ ...r, walls: r.walls.map(w => {
    if (w.id !== wallId || !w.alignments) return w;
    const kept = w.alignments.filter(x => !(x.roomId === to.roomId && x.wallId === to.wallId));
    const { alignments: _, ...rest } = w;
    return kept.length ? { ...rest, alignments: kept } : rest;
  }) });
  return touch({ ...survey, levels: survey.levels.map(l => ({ ...l, rooms: l.rooms.map(r =>
    r.id === a.roomId ? drop(r, a.wallId, b) : r.id === b.roomId ? drop(r, b.wallId, a) : r) })) }, now);
}

/** "Replace" (ADR 0012): moves the drawing of placed rooms (all, or `roomIds`) to their placement. */
export function replaceRooms(survey: Survey, levelId: string, roomIds?: string[], now = new Date()): Survey {
  if (!survey.levels.some(l => l.id === levelId)) throw new Error(tr('Niveau introuvable.', 'Level not found.'));
  return touch({ ...survey, levels: survey.levels.map(l => (l.id === levelId ? replacedLevel(l, roomIds) : l)) }, now);
}

/**
 * « Ajuster le tracé aux cotes »: redraws a room with the shape its measurements give (alone, or
 * with the directions of walls linked to placed rooms, ADR 0012), where it is drawn: same
 * centre, first wall in the same direction. Refused, with the measurement to take, when the
 * cotes do not determine the shape. Neighbouring rooms are not moved ("Replace" does that).
 */
export function fitRoomToCotes(survey: Survey, roomId: string, now = new Date()): Survey {
  const level = survey.levels.find(l => l.rooms.some(r => r.id === roomId));
  const room = level?.rooms.find(r => r.id === roomId);
  if (!level || !room) throw new Error(tr(`Pièce introuvable : ${roomId}`, `Room not found: ${roomId}`));
  const alone = solveRoom(room);
  const shape = alone.status === 'resolved' ? alone.polygon : placeRooms(level).rooms.get(roomId)?.resolvedByNeighbours ? placeRooms(level).rooms.get(roomId)!.polygon! : null;
  if (!shape) throw new Error(alone.status === 'inconsistent' ? alone.message : alone.status === 'underconstrained' ? alone.hint : '');
  const centre = (poly: [number, number][]) => poly.reduce<[number, number]>((c, p) => [c[0] + p[0] / poly.length, c[1] + p[1] / poly.length], [0, 0]);
  const w = room.walls[0];
  const dir = (poly: [number, number][]) => Math.atan2(poly[w.to][1] - poly[w.from][1], poly[w.to][0] - poly[w.from][0]);
  const angle = dir(room.polygon) - dir(shape);
  const [c, sn] = [Math.cos(angle), Math.sin(angle)];
  const [from, to] = [centre(shape), centre(room.polygon)];
  const polygon = shape.map(([x, y]) => {
    const [dx, dy] = [x - from[0], y - from[1]];
    return [+(to[0] + dx * c - dy * sn).toFixed(6), +(to[1] + dx * sn + dy * c).toFixed(6)] as [number, number];
  });
  return mapRoom(survey, roomId, r => ({ ...r, polygon, geometryStatus: 'resolved', shape: r.shape === 'rectangle' && polygon.length === 4 ? 'rectangle' : 'polygon' }), now);
}

/** Freezes a room (no edit accepted until unfrozen) or unfreezes it. */
export function setRoomFrozen(survey: Survey, roomId: string, frozen: boolean, now = new Date()): Survey {
  return mapRoom(survey, roomId, room => (frozen ? { ...room, frozen: true } : (({ frozen: _, ...rest }) => rest)(room)), now, true);
}

/**
 * Survey properties: default ceiling height and wall thicknesses. Estimated thicknesses still
 * at the previous default follow the new one (linked walls: interior; others: exterior);
 * measured or typed values are kept.
 */
export function setSurveyDefaults(survey: Survey, defaults: SurveyDefaults, now = new Date()): Survey {
  for (const v of Object.values(defaults)) if (v !== undefined && !(v > 0)) throw new Error(tr('Les valeurs par défaut doivent être strictement positives.', 'Default values must be greater than zero.'));
  const before = surveyDefaults(survey);
  const next = { ...survey, defaults: { ...survey.defaults, ...defaults } };
  const after = surveyDefaults(next);
  const follow = (w: SurveyWall): SurveyWall => {
    if (w.thicknessStatus !== 'estimated') return w;
    const [old, fresh] = isLinked(w) ? [before.interiorThickness_m, after.interiorThickness_m] : [before.exteriorThickness_m, after.exteriorThickness_m];
    return Math.abs(w.thickness_m - old) < 1e-6 ? { ...w, thickness_m: fresh } : w;
  };
  return touch({ ...next, levels: next.levels.map(l => ({ ...l, rooms: l.rooms.map(r => (r.frozen ? r : { ...r, walls: r.walls.map(follow) })) })) }, now);
}

/** Chooses the reference room of its level (ADR 0012): it stays where it is drawn and orients the plan. */
export function setReferenceRoom(survey: Survey, roomId: string, now = new Date()): Survey {
  const level = survey.levels.find(l => l.rooms.some(r => r.id === roomId));
  if (!level) throw new Error(tr(`Pièce introuvable : ${roomId}`, `Room not found: ${roomId}`));
  return touch({ ...survey, levels: survey.levels.map(l => (l !== level ? l : { ...l, referenceRoomId: roomId })) }, now);
}

// ── Control measurements and solver (ADR 0009) ──────────────────────────────────

/**
 * Re-solves a room after a measurement changed: when the measurements determine the shape,
 * the drawing is replaced by it and the geometry becomes "resolved"; otherwise the drawing is
 * kept and the room stays "assumed" (assumed / unresolved geometry).
 */
export function resolve(room: SurveyRoom): SurveyRoom {
  const r = solveRoom(room);
  // A confirmed rectangle stays one once resolved; any other shape is free-form from now on.
  if (r.status === 'resolved') return { ...room, polygon: r.polygon, geometryStatus: 'resolved', shape: room.shape === 'rectangle' && r.polygon.length === 4 ? 'rectangle' : 'polygon' };
  return room.geometryStatus === 'resolved' ? { ...room, geometryStatus: 'assumed' } : room;
}

/**
 * « Angles droits partout »: for a room drawn with right angles, the user confirms them all —
 * 90° at outer corners, 270° at inner ones (the notch of an L). Deduced lengths become usable.
 */
export function setRightAngles(survey: Survey, roomId: string, now = new Date()): Survey {
  return mapRoom(survey, roomId, room => {
    const n = room.polygon.length;
    const angles = room.polygon.map((p, i) => {
      const a = room.polygon[(i - 1 + n) % n], b = room.polygon[(i + 1) % n];
      const [ux, uy, vx, vy] = [p[0] - a[0], p[1] - a[1], b[0] - p[0], b[1] - p[1]];
      const lu = Math.hypot(ux, uy) || 1, lv = Math.hypot(vx, vy) || 1;
      if (Math.abs((ux * vx + uy * vy) / (lu * lv)) > AXIS_TOLERANCE) throw new Error(tr('Cette pièce n’est pas dessinée à angles droits : redressez le dessin ou saisissez les angles un par un.', 'This room is not drawn with right angles: straighten the drawing or enter the angles one by one.'));
      // Counter-clockwise outline: a left turn is an outer corner, a right turn an inner one.
      return { id: `ang_${i}`, vertex: i, deg: ux * vy - uy * vx > 0 ? 90 : 270 };
    });
    return resolve(completeOrthogonal({ ...room, angles }));
  }, now);
}

export function addDiagonal(survey: Survey, roomId: string, from: number, to: number, length: number, source: MeasureSource = 'laser', now = new Date()): Survey {
  if (!(length > 0)) throw new Error(tr('La longueur doit être strictement positive.', 'The length must be greater than zero.'));
  return mapRoom(survey, roomId, room => {
    const n = room.polygon.length;
    if (from === to || (to - from + n) % n === 1 || (from - to + n) % n === 1 || from < 0 || to < 0 || from >= n || to >= n)
      throw new Error(tr('Une diagonale relie deux sommets non voisins.', 'A diagonal links two corners that are not neighbours.'));
    const others = (room.diagonals ?? []).filter(d => !((d.from === from && d.to === to) || (d.from === to && d.to === from)));
    const id = `diag_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    return resolve({ ...room, diagonals: [...others, { id, from, to, length_m: length, source }] });
  }, now);
}

export function setAngle(survey: Survey, roomId: string, vertex: number, deg: number, now = new Date()): Survey {
  if (!(deg > 0 && deg < 360)) throw new Error(tr('Un angle est compris entre 0 et 360°.', 'An angle lies between 0 and 360°.'));
  return mapRoom(survey, roomId, room => {
    if (vertex < 0 || vertex >= room.polygon.length) throw new Error(tr('Sommet introuvable.', 'Corner not found.'));
    const others = (room.angles ?? []).filter(a => a.vertex !== vertex);
    return resolve({ ...room, angles: [...others, { id: `ang_${vertex}`, vertex, deg }] });
  }, now);
}

export function deleteControl(survey: Survey, roomId: string, id: string, now = new Date()): Survey {
  return mapRoom(survey, roomId, room => resolve({
    ...room,
    diagonals: (room.diagonals ?? []).filter(d => d.id !== id),
    angles: (room.angles ?? []).filter(a => a.id !== id),
  }), now);
}

// ── Photos (ADR 0010) ───────────────────────────────────────────────────────────

export const photoFile = (id: string) => `photos/${id}.jpg`;

/** References a photo already re-encoded by the app; its bytes are stored apart, under `photoFile(id)`. */
export function addPhoto(
  survey: Survey, roomId: string, surface: SurveySurface, image: { id: string; width: number; height: number }, now = new Date(),
): Survey {
  return mapRoom(survey, roomId, room => {
    if (surface.kind === 'wall' && !room.walls.some(w => w.id === surface.wallId)) throw new Error(tr('Mur introuvable.', 'Wall not found.'));
    const photo: SurveyPhoto = { id: image.id, surface, file: photoFile(image.id), width: image.width, height: image.height, takenAt: now.toISOString() };
    return { ...room, photos: [...(room.photos ?? []), photo] };
  }, now);
}

export function deletePhoto(survey: Survey, roomId: string, photoId: string, now = new Date()): Survey {
  return mapRoom(survey, roomId, room => ({ ...room, photos: (room.photos ?? []).filter(p => p.id !== photoId) }), now);
}

// ── Photo annotations (spec F-21, F-23) ─────────────────────────────────────────

const clamp01 = (v: number) => Math.min(1, Math.max(0, +v.toFixed(4)));

function mapPhoto(survey: Survey, roomId: string, photoId: string, f: (p: SurveyPhoto) => SurveyPhoto, now: Date): Survey {
  return mapRoom(survey, roomId, room => {
    if (!room.photos?.some(p => p.id === photoId)) throw new Error(tr('Photo introuvable.', 'Photo not found.'));
    return { ...room, photos: room.photos.map(p => (p.id === photoId ? f(p) : p)) };
  }, now);
}

const noteSize = (size: [number, number]): [number, number] => [Math.min(1, Math.max(0.02, size[0])), Math.min(1, Math.max(0.02, size[1]))];

export function addPhotoNote(
  survey: Survey, roomId: string, photoId: string, at: [number, number], text: string, now = new Date(), size?: [number, number],
): { survey: Survey; noteId: string } {
  const noteId = `note_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const note = { id: noteId, type: 'note' as const, p: [clamp01(at[0]), clamp01(at[1])] as [number, number], ...(size ? { size: noteSize(size) } : {}), text, createdAt: now.toISOString() };
  return { survey: mapPhoto(survey, roomId, photoId, p => ({ ...p, annotations: [...(p.annotations ?? []), note] }), now), noteId };
}

export function updatePhotoNote(
  survey: Survey, roomId: string, photoId: string, noteId: string, patch: { at?: [number, number]; text?: string; size?: [number, number]; collapsed?: boolean }, now = new Date(),
): Survey {
  return mapPhoto(survey, roomId, photoId, p => {
    if (!p.annotations?.some(a => a.id === noteId && a.type === 'note')) throw new Error(tr('Annotation introuvable.', 'Annotation not found.'));
    return { ...p, annotations: p.annotations.map(a => a.id !== noteId || a.type !== 'note' ? a : {
      ...a, ...(patch.text !== undefined ? { text: patch.text } : {}), ...(patch.at ? { p: [clamp01(patch.at[0]), clamp01(patch.at[1])] as [number, number] } : {}),
      ...(patch.size ? { size: noteSize(patch.size) } : {}),
      ...(patch.collapsed !== undefined ? { collapsed: patch.collapsed } : {}),
    }) };
  }, now);
}

export function deletePhotoAnnotation(survey: Survey, roomId: string, photoId: string, id: string, now = new Date()): Survey {
  return mapPhoto(survey, roomId, photoId, p => ({ ...p, annotations: (p.annotations ?? []).filter(a => a.id !== id) }), now);
}

/** Adds a photo cote: two anchors on the image and the value measured on site (never computed from pixels). */
export function addPhotoMeasure(
  survey: Survey, roomId: string, photoId: string, p1: [number, number], p2: [number, number], value: number, now = new Date(),
): { survey: Survey; measureId: string } {
  if (!(value > 0)) throw new Error(tr('La cote doit être strictement positive.', 'The dimension must be greater than zero.'));
  const measureId = `meas_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const m = { id: measureId, type: 'measure' as const, p1: [clamp01(p1[0]), clamp01(p1[1])] as [number, number], p2: [clamp01(p2[0]), clamp01(p2[1])] as [number, number], value_m: value, source: 'manual' as const, createdAt: now.toISOString() };
  return { survey: mapPhoto(survey, roomId, photoId, p => ({ ...p, annotations: [...(p.annotations ?? []), m] }), now), measureId };
}

export function updatePhotoMeasure(
  survey: Survey, roomId: string, photoId: string, id: string, patch: { p1?: [number, number]; p2?: [number, number]; value?: number }, now = new Date(),
): Survey {
  if (patch.value !== undefined && !(patch.value > 0)) throw new Error(tr('La cote doit être strictement positive.', 'The dimension must be greater than zero.'));
  const pt = (q: [number, number]): [number, number] => [clamp01(q[0]), clamp01(q[1])];
  return mapPhoto(survey, roomId, photoId, p => {
    if (!p.annotations?.some(a => a.id === id && a.type === 'measure')) throw new Error(tr('Cote introuvable.', 'Dimension not found.'));
    return { ...p, annotations: p.annotations.map(a => a.id !== id || a.type !== 'measure' ? a : {
      ...a, ...(patch.p1 ? { p1: pt(patch.p1) } : {}), ...(patch.p2 ? { p2: pt(patch.p2) } : {}), ...(patch.value !== undefined ? { value_m: patch.value } : {}),
    }) };
  }, now);
}
