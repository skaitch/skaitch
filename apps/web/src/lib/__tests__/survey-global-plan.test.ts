import { describe, expect, it } from 'vitest';
import { addAdjacentRoom, addOpening, addRectangleRoom, moveRoom, newSurvey, setWallLength } from '@skaitch/core/survey/edit';
import { globalPlan } from '@skaitch/core/survey/globalPlan';

const now = new Date('2026-11-17T10:00:00Z');
function house() {
  let s = newSurvey('M', now);
  const a = addRectangleRoom(s, s.levels[0].id, 'Salon', 0, 0, 4, 3, now);
  s = setWallLength(a.survey, a.roomId, `${a.roomId}_w1`, 4, 'laser', now);
  const d = addOpening(s, a.roomId, `${a.roomId}_w1`, 'door', 1, now);
  const b = addAdjacentRoom(d.survey, a.roomId, d.openingId, 'Entrée', now);
  const c = addRectangleRoom(b.survey, b.survey.levels[0].id, 'Garage', 10, 0, 3, 5, now);
  return { survey: c.survey, a: a.roomId, b: b.roomId, c: c.roomId };
}

describe('global plan', () => {
  it('anchors the rooms linked to the reference room and lists the others as unplaced', () => {
    const { survey, a, b, c } = house();
    const plan = globalPlan(survey.levels[0]);
    expect(plan.referenceId).toBe(a);
    expect([...plan.anchored].sort()).toEqual([a, b].sort());
    expect(plan.unplaced.map(r => r.id)).toEqual([c]);
    expect(plan.discrepancies).toEqual([]);
  });

  it('moving a room moves its linked rooms: the shared wall stays closed', () => {
    const { survey, a, b, c } = house();
    const moved = moveRoom(survey, b, 2, 1, now);
    const [ra, rb, rc] = moved.levels[0].rooms;
    expect(ra.polygon[0]).toEqual([2, 1]);
    expect(rb.polygon[0]).toEqual([6, 0.8]);
    expect(rc.polygon[0]).toEqual([10, 0]);
    expect(globalPlan(moved.levels[0]).discrepancies).toEqual([]);
    void a; void c;
  });

  it('reports, without correcting, two sides measured differently and a wall that does not close', () => {
    const { survey, a, b } = house();
    let s = setWallLength(survey, b, `${b}_w1`, 4.05, 'laser', now);
    const plan = globalPlan(s.levels[0]);
    expect(plan.discrepancies.map(d => d.message).join()).toMatch(/4\.000 m d'un côté et 4\.050 m/);
    expect(s.levels[0].rooms.find(r => r.id === a)!.walls[0].length_m).toBe(4);
    // Break the drawing: pull the entrance away from the living room without its link.
    s = structuredClone(survey);
    s.levels[0].rooms[1].polygon = s.levels[0].rooms[1].polygon.map(([x, y]) => [x, y - 0.5] as [number, number]);
    expect(globalPlan(s.levels[0]).discrepancies.map(d => d.message).join()).toMatch(/ne se referme pas \(écart de 0\.50 m\)/);
  });
});

import { connectRooms } from '@skaitch/core/survey/edit';
import { readSurveyFile, writeSurveyFile } from '@skaitch/core/survey/surveyFile';
describe('connecting two rooms', () => {
  it('places the unplaced room against the reference wall from measured offset and thickness', () => {
    const { survey, a, c } = house();
    // Garage's left wall (w4, running down) becomes the other side of the living room's right wall (w2).
    const s = connectRooms(survey, { roomId: a, wallId: `${a}_w2` }, { roomId: c, wallId: `${c}_w4` }, 0.5, 0.25, now);
    const level = s.levels[0];
    const plan = globalPlan(level);
    expect(plan.unplaced).toEqual([]);
    expect(plan.discrepancies).toEqual([]);
    const garage = level.rooms.find(r => r.id === c)!;
    // Right wall of the living room is x = 4, from y 0 to 3; the garage face ends 0.5 up it, 0.25 outside.
    expect(garage.polygon[0][0]).toBeCloseTo(4.25);
    expect(garage.polygon[0][1]).toBeCloseTo(0.5);
    expect(garage.walls[3]).toMatchObject({ thickness_m: 0.25, thicknessStatus: 'measured', length_m: 5 });
    expect(readSurveyFile(writeSurveyFile(s, '0'))).toEqual(s);
  });

  it('rotates the room when the faces are not already opposite, and keeps lengths', () => {
    const { survey, a, c } = house();
    // Garage's bottom wall (w1) against the living room's top wall (w3): garage turns upside down.
    const s = connectRooms(survey, { roomId: a, wallId: `${a}_w3` }, { roomId: c, wallId: `${c}_w1` }, 0, 0.2, now);
    expect(globalPlan(s.levels[0]).discrepancies).toEqual([]);
    const garage = s.levels[0].rooms.find(r => r.id === c)!;
    expect(garage.walls.map(w => w.length_m)).toEqual([3, 5, 3, 5]);
    expect(Math.min(...garage.polygon.map(p => p[1]))).toBeCloseTo(3.2);
  });

  it('refuses rooms already linked and shared walls', () => {
    const { survey, a, b } = house();
    expect(() => connectRooms(survey, { roomId: a, wallId: `${a}_w2` }, { roomId: b, wallId: `${b}_w2` }, 0, 0.2, now)).toThrow(/déjà reliées/);
    expect(() => connectRooms(survey, { roomId: a, wallId: `${a}_w1` }, { roomId: b, wallId: `${b}_w2` }, 0, 0.2, now)).toThrow(/déjà (partagé|lié)/);
  });
});

import { linkFaces, moveVertex } from '@skaitch/core/survey/edit';
describe('linking two walls without an opening', () => {
  it('links walls facing each other on the plan, without moving anything, thickness from the drawing', () => {
    let s = newSurvey('M', now);
    const a = addRectangleRoom(s, s.levels[0].id, 'Cuisine', 0, 0, 4, 3, now);
    // Salon drawn to the right, 0.15 m away.
    const b = addRectangleRoom(a.survey, a.survey.levels[0].id, 'Salon', 4.15, -1, 5, 5, now);
    s = linkFaces(b.survey, { roomId: a.roomId, wallId: `${a.roomId}_w2` }, { roomId: b.roomId, wallId: `${b.roomId}_w4` }, now);
    const [ra, rb] = s.levels[0].rooms;
    expect(ra.polygon).toEqual(b.survey.levels[0].rooms[0].polygon);
    expect(rb.polygon).toEqual(b.survey.levels[0].rooms[1].polygon);
    expect(ra.walls[1]).toMatchObject({ links: [{ roomId: b.roomId, wallId: `${b.roomId}_w4` }], thickness_m: 0.15 });
    expect(rb.walls[3].links![0].roomId).toBe(a.roomId);
    // Salon's left face (y from 4 down to -1) ends 1 m past the kitchen's start.
    expect(rb.walls[3].links![0].offset_m).toBeCloseTo(1);
    expect(readSurveyFile(writeSurveyFile(s, '0'))).toEqual(s);
    const plan = globalPlan(s.levels[0]);
    expect(plan.unplaced).toEqual([]);
    expect(plan.discrepancies).toEqual([]);
  });

  it('moves a separate sketched room against the wall (as « Raccorder » did), refuses facing errors within a group', () => {
    let s = newSurvey('M', now);
    const a = addRectangleRoom(s, s.levels[0].id, 'A', 0, 0, 4, 3, now);
    const b = addRectangleRoom(a.survey, a.survey.levels[0].id, 'B', 6, 0, 4, 3, now);
    // Drawn 2 m away: B is moved one wall thickness from A's right wall, the link stays estimated.
    s = linkFaces(b.survey, { roomId: a.roomId, wallId: `${a.roomId}_w2` }, { roomId: b.roomId, wallId: `${b.roomId}_w4` }, now);
    const rb = s.levels[0].rooms[1];
    expect(rb.polygon[0][0]).toBeCloseTo(4.2, 6);
    expect(rb.walls[3].links![0].offsetStatus).toBe('estimated');
    expect(rb.walls[3].thicknessStatus).toBe('estimated');
    // Now in one group: a wall that does not face the other one is refused.
    expect(() => linkFaces(s, { roomId: a.roomId, wallId: `${a.roomId}_w1` }, { roomId: b.roomId, wallId: `${b.roomId}_w1` }, now)).toThrow(/ne se font pas face/);
  });

  it('aligns a hand-drawn wall that is slightly off, then links it', () => {
    let s = newSurvey('M', now);
    const a = addRectangleRoom(s, s.levels[0].id, 'Cuisine', 0, 0, 4, 3, now);
    const b = addRectangleRoom(a.survey, a.survey.levels[0].id, 'Salon', 4.1, -1, 5, 5, now);
    // Tilt the salon's left wall by a few degrees, as drawn with a finger.
    s = moveVertex(b.survey, b.roomId, 3, [4.4, 4], now);
    s = linkFaces(s, { roomId: a.roomId, wallId: `${a.roomId}_w2` }, { roomId: b.roomId, wallId: `${b.roomId}_w4` }, now);
    const rb = s.levels[0].rooms[1];
    expect(rb.polygon[3][0]).toBeCloseTo(4.25, 6);
    expect(rb.polygon[0][0]).toBeCloseTo(4.25, 6);
    expect(rb.walls[3].links![0].roomId).toBe(a.roomId);
    expect(globalPlan(s.levels[0]).discrepancies).toEqual([]);
  });
});

import { duplicateOpenings, surveyWarnings as warningsOf } from '@skaitch/core/survey/surveyFile';
describe('the same opening entered from both rooms of a shared wall', () => {
  // Cuisine's right face (x = 4, y 0 → 3) faces Salon's left face (x = 4.15, y 3 → 0).
  function rooms(salonCentre: number) {
    const s = newSurvey('M', now);
    const a = addRectangleRoom(s, s.levels[0].id, 'Cuisine', 0, 0, 4, 3, now);
    const b = addRectangleRoom(a.survey, a.survey.levels[0].id, 'Salon', 4.15, 0, 4, 3, now);
    const da = addOpening(b.survey, a.roomId, `${a.roomId}_w2`, 'door', 1, now);
    const db = addOpening(da.survey, b.roomId, `${b.roomId}_w4`, 'door', salonCentre, now);
    const linked = linkFaces(db.survey, { roomId: a.roomId, wallId: `${a.roomId}_w2` }, { roomId: b.roomId, wallId: `${b.roomId}_w4` }, now);
    return { linked, a, b, faces: [{ roomId: a.roomId, wallId: `${a.roomId}_w2` }, { roomId: b.roomId, wallId: `${b.roomId}_w4` }] };
  }

  it('is reported once, with both openings, and flagged as a warning', () => {
    // Centre 2 m along the Salon face, which runs the other way: y = 1, where the kitchen door is.
    const { linked, a, b, faces } = rooms(2);
    const dups = duplicateOpenings(linked.levels[0]);
    expect(dups).toHaveLength(1);
    expect(dups[0]).toMatchObject({ roomId: a.roomId, otherRoomId: b.roomId });
    expect(dups[0].overlap_m).toBeGreaterThan(0.5);
    expect(duplicateOpenings(linked.levels[0], faces)).toHaveLength(1);
    expect(warningsOf(linked).some(w => /deux pièces|both rooms/.test(w.message))).toBe(true);
  });

  it('two separate openings on the shared wall are not reported', () => {
    // Centre 0.5 m along the Salon face: y = 2.5, clear of the kitchen door around y = 1.
    const { linked } = rooms(0.5);
    expect(duplicateOpenings(linked.levels[0])).toEqual([]);
    expect(warningsOf(linked).some(w => /deux pièces|both rooms/.test(w.message))).toBe(false);
  });
});
