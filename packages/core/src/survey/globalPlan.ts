import type { SurveyLevel, SurveyRoom, SurveyWarning } from './surveyFile.js';
import { linkedFaces, wallLinks } from './surveyFile.js';
import { tr } from './lang.js';
import { referenceRoom } from './placement.js';

/**
 * Global plan (spec F-16, F-18): which rooms are positioned relative to the reference room,
 * and where the measurements or the drawing of linked rooms disagree. Nothing is corrected.
 */

const TOLERANCE_M = 0.02;

/** Groups of rooms joined by linked faces, in level order; the first group holds the reference room. */
export function roomGroups(level: SurveyLevel): SurveyRoom[][] {
  const parent = new Map(level.rooms.map(r => [r.id, r.id]));
  const find = (id: string): string => (parent.get(id) === id ? id : find(parent.get(id)!));
  for (const room of level.rooms) for (const wall of room.walls) {
    for (const link of wallLinks(wall)) if (parent.has(link.roomId)) {
      const [a, b] = [find(room.id), find(link.roomId)];
      if (a !== b) parent.set(b, a);
    }
  }
  const groups = new Map<string, SurveyRoom[]>();
  for (const room of level.rooms) groups.set(find(room.id), [...(groups.get(find(room.id)) ?? []), room]);
  return [...groups.values()];
}

export interface GlobalPlan {
  /** The reference room: the one chosen on the level, else its first room. */
  referenceId: string | null;
  /** Rooms positioned relative to the reference room, through linked faces. */
  anchored: Set<string>;
  /** Rooms with no measured relation to the reference room yet. */
  unplaced: SurveyRoom[];
  discrepancies: SurveyWarning[];
}

type Pt = [number, number];

export function globalPlan(level: SurveyLevel, tolerance = TOLERANCE_M): GlobalPlan {
  const groups = roomGroups(level);
  const referenceId = referenceRoom(level)?.id ?? null;
  const anchored = new Set((groups.find(g => g.some(r => r.id === referenceId)) ?? []).map(r => r.id));
  const discrepancies: SurveyWarning[] = [];
  for (const room of level.rooms) for (const wall of room.walls) for (const link of linkedFaces(level, wall)) {
    if (room.id > link.room.id) continue; // each pair once
    const other = link.wall;
    // Same physical stretch measured from both sides: the two cotes must agree.
    const whole = link.link.offset_m === 0 && link.back.offset_m === 0;
    if (whole && wall.locked && other.locked && Math.abs(wall.length_m - other.length_m) > tolerance) {
      discrepancies.push({
        roomId: room.id, wallIds: [wall.id, other.id],
        message: tr(`${room.name} / ${link.room.name} : le mur commun mesure ${wall.length_m.toFixed(3)} m d'un côté et ${other.length_m.toFixed(3)} m de l'autre.`, `${room.name} / ${link.room.name}: the shared wall measures ${wall.length_m.toFixed(3)} m on one side and ${other.length_m.toFixed(3)} m on the other.`),
      });
    }
    // Bouclage: on the drawing, the two faces must be parallel, one wall thickness apart, facing each other.
    const [a1, b1] = [room.polygon[wall.from], room.polygon[wall.to]];
    const [a2, b2] = [link.room.polygon[other.from], link.room.polygon[other.to]];
    const len = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]) || 1;
    const n: Pt = [(b1[1] - a1[1]) / len, -(b1[0] - a1[0]) / len];
    const dist = (p: Pt) => (p[0] - a1[0]) * n[0] + (p[1] - a1[1]) * n[1];
    const gap = Math.max(Math.abs(dist(a2) - wall.thickness_m), Math.abs(dist(b2) - wall.thickness_m));
    if (gap > tolerance) {
      discrepancies.push({
        roomId: room.id, wallIds: [wall.id, other.id],
        message: tr(`${room.name} / ${link.room.name} : sur le plan, le mur commun ne se referme pas (écart de ${gap.toFixed(2)} m).`, `${room.name} / ${link.room.name}: on the plan, the shared wall does not close (gap of ${gap.toFixed(2)} m).`),
      });
    }
  }
  return { referenceId, anchored, unplaced: level.rooms.filter(r => !anchored.has(r.id)), discrepancies };
}
