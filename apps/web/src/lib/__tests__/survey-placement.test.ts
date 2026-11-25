import { describe, expect, it } from 'vitest';
import { buildEmpty } from '@skaitch/core/data/starter';
import { reconstructStorey } from '@skaitch/core/survey/reconstruct';
import type { StoreySurvey } from '@skaitch/core/survey/surveyFile';
import {
  addAdjacentRoom, addOpening, addRectangleRoom, connectRooms, linkFaces, unlinkFaces, newSurvey, replaceRooms, setLinkOffset,
  setReferenceRoom, setRightAngles, fitRoomToCotes, moveVertex, setRoomFrozen, deleteRoom, clearWallLength, renameWall, setSurveyDefaults, alignFaces, setAlignmentStep, unalignFaces, moveRoom, renameRoom, setWallLength, setWallThickness,
} from '@skaitch/core/survey/edit';
import { placeRooms } from '@skaitch/core/survey/placement';
import { surveyChecks } from '@skaitch/core/survey/checks';
import { linkedFaces, linkStretch, migrateSurvey, type Survey } from '@skaitch/core/survey/surveyFile';

const now = new Date('2026-11-21T10:00:00Z');

/** A rectangle room resolved by its four measured walls and right angles. */
function measuredRoom(s: Survey, name: string, x: number, y: number, w: number, h: number) {
  const r = addRectangleRoom(s, s.levels[0].id, name, x, y, w, h, now);
  let next = r.survey;
  [w, h, w, h].forEach((len, i) => { next = setWallLength(next, r.roomId, `${r.roomId}_w${i + 1}`, len, 'laser', now); });
  return { survey: setRightAngles(next, r.roomId, now), roomId: r.roomId };
}

const room = (s: Survey, id: string) => s.levels[0].rooms.find(r => r.id === id)!;
const round = (poly: [number, number][]) => poly.map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]);

describe('room placement', () => {
  it('places a room connected by a measured offset and thickness, and flags a drawing that moved', () => {
    let s = newSurvey('M', now);
    const a = measuredRoom(s, 'Salon', 0, 0, 4, 3);
    const c = measuredRoom(a.survey, 'Garage', 10, 0, 3, 5);
    s = connectRooms(c.survey, { roomId: a.roomId, wallId: `${a.roomId}_w2` }, { roomId: c.roomId, wallId: `${c.roomId}_w4` }, 0.5, 0.25, now);
    const plan = placeRooms(s.levels[0]);
    expect(plan.rooms.get(a.roomId)!.status).toBe('reference');
    expect(plan.rooms.get(c.roomId)!.status).toBe('placed');
    expect(plan.rooms.get(c.roomId)!.toReplace).toBe(false);
    expect(plan.suggestions).toEqual([]);

    // The garage's drawing is dragged away: its placement does not change, it is "to replace".
    const dragged = structuredClone(s);
    const g = room(dragged, c.roomId);
    g.polygon = g.polygon.map(([x, y]) => [x + 1, y + 0.3] as [number, number]);
    const moved = placeRooms(dragged.levels[0]);
    expect(moved.rooms.get(c.roomId)!.toReplace).toBe(true);
    expect(surveyChecks(dragged).map(ch => ch.message).join()).toMatch(/à replacer/);
    const back = replaceRooms(dragged, dragged.levels[0].id, undefined, now);
    expect(round(room(back, c.roomId).polygon)).toEqual(round(room(s, c.roomId).polygon));
    expect(room(back, a.roomId).polygon).toEqual(room(s, a.roomId).polygon);
  });

  it('marks an adjacent room as an assumed placement and asks for the offset, then the thickness', () => {
    const a = measuredRoom(newSurvey('M', now), 'Salon', 0, 0, 4, 3);
    const d = addOpening(a.survey, a.roomId, `${a.roomId}_w1`, 'door', 1, now);
    const b = addAdjacentRoom(d.survey, a.roomId, d.openingId, 'Entrée', now);
    let s = b.survey;
    [4, 3, 4, 3].forEach((len, i) => { s = setWallLength(s, b.roomId, `${b.roomId}_w${i + 1}`, len, 'laser', now); });
    s = setRightAngles(s, b.roomId, now);

    let plan = placeRooms(s.levels[0]);
    expect(plan.rooms.get(b.roomId)!.status).toBe('assumed');
    expect(plan.suggestions.map(x => x.kind)).toEqual(['offset']);
    expect(plan.suggestions[0].message).toMatch(/le long du mur Salon P1–P2/);

    s = setLinkOffset(s, { roomId: a.roomId, wallId: `${a.roomId}_w1` }, { roomId: b.roomId, wallId: `${b.roomId}_w1` }, 0, now);
    plan = placeRooms(s.levels[0]);
    expect(plan.suggestions.map(x => x.kind)).toEqual(['thickness']);

    s = setWallThickness(s, a.roomId, `${a.roomId}_w1`, 0.2, true, now);
    plan = placeRooms(s.levels[0]);
    expect(plan.rooms.get(b.roomId)!.status).toBe('placed');
    expect(plan.suggestions).toEqual([]);
  });

  it('suggests linking a wall for a room with no link, naming the wall facing it on the drawing', () => {
    const a = measuredRoom(newSurvey('M', now), 'Salon', 0, 0, 4, 3);
    const c = measuredRoom(a.survey, 'Cuisine', 4.2, 0, 3, 3);
    const plan = placeRooms(c.survey.levels[0]);
    expect(plan.rooms.get(c.roomId)!.status).toBe('unplaced');
    expect(plan.suggestions).toHaveLength(1);
    expect(plan.suggestions[0]).toMatchObject({ kind: 'link', wallId: `${c.roomId}_w4` });
    expect(plan.suggestions[0].message).toMatch(/Cuisine P4–P1 à Salon P2–P3/);
  });

  it('places from the chosen reference room', () => {
    const a = measuredRoom(newSurvey('M', now), 'Salon', 0, 0, 4, 3);
    const c = measuredRoom(a.survey, 'Garage', 10, 0, 3, 5);
    const s = setReferenceRoom(c.survey, c.roomId, now);
    const plan = placeRooms(s.levels[0]);
    expect(plan.referenceId).toBe(c.roomId);
    expect(plan.rooms.get(a.roomId)!.status).toBe('unplaced');
  });

  it('reports a loop that does not close without changing any value', () => {
    // Four rooms in a square, 0.20 m walls: A–B, A–C and B–D place every room; C–D closes the loop.
    let s = newSurvey('M', now);
    const a = measuredRoom(s, 'A', 0, 0, 3, 3);
    const b = measuredRoom(a.survey, 'B', 10, 0, 3, 3);
    const c = measuredRoom(b.survey, 'C', 20, 0, 3, 3);
    const d = measuredRoom(c.survey, 'D', 30, 0, 3, 3);
    s = connectRooms(d.survey, { roomId: a.roomId, wallId: `${a.roomId}_w2` }, { roomId: b.roomId, wallId: `${b.roomId}_w4` }, 0, 0.2, now);
    s = connectRooms(s, { roomId: a.roomId, wallId: `${a.roomId}_w3` }, { roomId: c.roomId, wallId: `${c.roomId}_w1` }, 0, 0.2, now);
    s = connectRooms(s, { roomId: b.roomId, wallId: `${b.roomId}_w3` }, { roomId: d.roomId, wallId: `${d.roomId}_w1` }, 0, 0.2, now);
    s = linkFaces(s, { roomId: c.roomId, wallId: `${c.roomId}_w2` }, { roomId: d.roomId, wallId: `${d.roomId}_w4` }, now);
    expect(placeRooms(s.levels[0]).closures).toEqual([]);

    s = setWallThickness(s, c.roomId, `${c.roomId}_w2`, 0.3, true, now);
    const plan = placeRooms(s.levels[0]);
    expect(plan.rooms.get(d.roomId)!.via!.fromRoomId).toBe(b.roomId);
    expect(plan.closures).toHaveLength(1);
    expect(plan.closures[0].gap).toBeCloseTo(0.1, 6);
    expect(plan.closures[0].message).toMatch(/ne se referme pas de 10 cm/);
    expect(room(s, d.roomId).walls[3].length_m).toBe(3);
  });

  it('resolves a room without diagonal or angle from the directions of two walls linked to placed rooms', () => {
    let s = newSurvey('M', now);
    const a = measuredRoom(s, 'A', 0, 0, 3, 3);
    const b = measuredRoom(a.survey, 'B', 10, 0, 3, 3);
    const c = measuredRoom(b.survey, 'C', 20, 0, 3, 3);
    // D: four measured walls, no angle, no diagonal.
    const d = addRectangleRoom(c.survey, c.survey.levels[0].id, 'D', 30, 0, 3, 3, now);
    s = d.survey;
    [3, 3, 3, 3].forEach((len, i) => { s = setWallLength(s, d.roomId, `${d.roomId}_w${i + 1}`, len, 'laser', now); });
    s = connectRooms(s, { roomId: a.roomId, wallId: `${a.roomId}_w2` }, { roomId: b.roomId, wallId: `${b.roomId}_w4` }, 0, 0.2, now);
    s = connectRooms(s, { roomId: a.roomId, wallId: `${a.roomId}_w3` }, { roomId: c.roomId, wallId: `${c.roomId}_w1` }, 0, 0.2, now);
    s = connectRooms(s, { roomId: b.roomId, wallId: `${b.roomId}_w3` }, { roomId: d.roomId, wallId: `${d.roomId}_w1` }, 0, 0.2, now);

    // One linked wall only orients D: its shape stays unresolved, it is placed as drawn (assumed).
    expect(placeRooms(s.levels[0]).rooms.get(d.roomId)).toMatchObject({ status: 'assumed', fromSketch: true });
    s = linkFaces(s, { roomId: c.roomId, wallId: `${c.roomId}_w2` }, { roomId: d.roomId, wallId: `${d.roomId}_w4` }, now);
    const plan = placeRooms(s.levels[0]);
    expect(plan.rooms.get(d.roomId)!.status).toBe('placed');
    expect(round(plan.rooms.get(d.roomId)!.polygon!)).toEqual([[3.2, 3.2], [6.2, 3.2], [6.2, 6.2], [3.2, 6.2]]);
    expect(plan.suggestions.filter(x => x.roomId === d.roomId)).toEqual([]);
    expect(plan.rooms.get(d.roomId)!.resolvedByNeighbours).toBe(true);
    expect(surveyChecks(s).filter(ch => ch.roomId === d.roomId).map(ch => ch.message).join()).not.toMatch(/non résolue/);
  });

  it('gives the same placement whichever room is the reference, when a derived offset was clamped at 0', () => {
    // Kitchen top wall (3 m) flush with the start of the living room's bottom wall (4 m).
    let s = newSurvey('M', now);
    const a = measuredRoom(s, 'Salon', 0, 0, 4, 3);
    const c = measuredRoom(a.survey, 'Cuisine', 10, 0, 3, 3);
    s = connectRooms(c.survey, { roomId: a.roomId, wallId: `${a.roomId}_w1` }, { roomId: c.roomId, wallId: `${c.roomId}_w3` }, 0, 0.2, now);
    const fromA = placeRooms(s.levels[0]);
    const fromC = placeRooms(setReferenceRoom(s, c.roomId, now).levels[0]);
    expect(round(fromA.rooms.get(c.roomId)!.polygon!)).toEqual(round(room(s, c.roomId).polygon));
    expect(round(fromC.rooms.get(a.roomId)!.polygon!)).toEqual(round(room(s, a.roomId).polygon));
  });

  it('points a room behind an unresolved one at that room, not at linking a wall', () => {
    // A (reference) – X (unresolved) – Y – Z, all linked.
    let s = newSurvey('M', now);
    const a = measuredRoom(s, 'A', 0, 0, 3, 3);
    const x = addRectangleRoom(a.survey, a.survey.levels[0].id, 'X', 10, 0, 3, 3, now);
    const y = measuredRoom(x.survey, 'Y', 20, 0, 3, 3);
    const z = measuredRoom(y.survey, 'Z', 30, 0, 3, 3);
    s = connectRooms(z.survey, { roomId: a.roomId, wallId: `${a.roomId}_w2` }, { roomId: x.roomId, wallId: `${x.roomId}_w4` }, 0, 0.2, now);
    s = connectRooms(s, { roomId: x.roomId, wallId: `${x.roomId}_w2` }, { roomId: y.roomId, wallId: `${y.roomId}_w4` }, 0, 0.2, now);
    s = connectRooms(s, { roomId: y.roomId, wallId: `${y.roomId}_w2` }, { roomId: z.roomId, wallId: `${z.roomId}_w4` }, 0, 0.2, now);
    const plan = placeRooms(s.levels[0]);
    expect(plan.suggestions.map(sg => sg.kind)).toEqual(['room']);
    expect(plan.next).toMatchObject({ roomId: x.roomId, kind: 'room' });
    expect([...plan.next!.affects].sort()).toEqual([x.roomId, y.roomId, z.roomId].sort());
  });

  it('redraws a room from its cotes where it is drawn, and asks for a measurement when they are not enough', () => {
    const a = measuredRoom(newSurvey('M', now), 'Salon', 0, 0, 4, 3);
    const dragged = moveVertex(a.survey, a.roomId, 2, [4.5, 3.4], now);
    expect(room(dragged, a.roomId).geometryStatus).toBe('assumed');
    const fitted = fitRoomToCotes(dragged, a.roomId, now);
    const r = room(fitted, a.roomId);
    expect(r.geometryStatus).toBe('resolved');
    const sides = r.polygon.map((p, i) => { const q = r.polygon[(i + 1) % 4]; return +Math.hypot(q[0] - p[0], q[1] - p[1]).toFixed(6); });
    expect(sides).toEqual([4, 3, 4, 3]);
    const centre = (poly: [number, number][]) => poly.reduce((c, p) => [c[0] + p[0] / 4, c[1] + p[1] / 4], [0, 0]).map(v => +v.toFixed(6));
    expect(centre(r.polygon)).toEqual(centre(room(dragged, a.roomId).polygon));

    const blank = newSurvey('M', now);
    const s2 = addRectangleRoom(blank, blank.levels[0].id, 'Croquis', 0, 0, 3, 3, now);
    expect(() => fitRoomToCotes(s2.survey, s2.roomId, now)).toThrow(/mesurez un mur/);
  });

  it('refuses every change to a frozen room until it is unfrozen, and Replace leaves it in place', () => {
    const a = measuredRoom(newSurvey('M', now), 'Salon', 0, 0, 4, 3);
    const frozen = setRoomFrozen(a.survey, a.roomId, true, now);
    expect(() => setWallLength(frozen, a.roomId, `${a.roomId}_w1`, 5, 'laser', now)).toThrow(/figée/);
    expect(() => renameRoom(frozen, a.roomId, 'X', now)).toThrow(/figée/);
    expect(() => moveRoom(frozen, a.roomId, 1, 0, now)).toThrow(/figée/);
    expect(() => deleteRoom(frozen, a.roomId, now)).toThrow(/figée/);
    expect(() => fitRoomToCotes(frozen, a.roomId, now)).toThrow(/figée/);
    const thawed = setRoomFrozen(frozen, a.roomId, false, now);
    expect(room(thawed, a.roomId).frozen).toBeUndefined();
    expect(room(renameRoom(thawed, a.roomId, 'Séjour', now), a.roomId).name).toBe('Séjour');
  });

  it('deletes a measured length: the wall goes back to an estimated length from the drawing', () => {
    const blank = newSurvey('M', now);
    const a = addRectangleRoom(blank, blank.levels[0].id, 'Salon', 0, 0, 4, 3, now);
    const measured = setWallLength(a.survey, a.roomId, `${a.roomId}_w1`, 4.02, 'laser', now);
    const cleared = clearWallLength(measured, a.roomId, `${a.roomId}_w1`, now);
    const w = room(cleared, a.roomId).walls[0];
    expect(w).toMatchObject({ locked: false, source: 'estimated' });
    expect(w.length_m).toBeCloseTo(4.02, 3);
  });

  it('names a wall, and an empty name goes back to its corners', () => {
    const blank = newSurvey('M', now);
    const a = addRectangleRoom(blank, blank.levels[0].id, 'Salon', 0, 0, 4, 3, now);
    const named = renameWall(a.survey, a.roomId, `${a.roomId}_w1`, '  Mur fenêtre ', now);
    expect(room(named, a.roomId).walls[0].name).toBe('Mur fenêtre');
    expect(room(renameWall(named, a.roomId, `${a.roomId}_w1`, ' ', now), a.roomId).walls[0].name).toBeUndefined();
  });

  it('links two resolved rooms drawn flush without moving them; the placement then shows the wall thickness', () => {
    const a = measuredRoom(newSurvey('M', now), 'Salon', 0, 0, 4, 3);
    const c = measuredRoom(a.survey, 'Cuisine', 4, 0, 3, 3);
    const linked = linkFaces(c.survey, { roomId: a.roomId, wallId: `${a.roomId}_w2` }, { roomId: c.roomId, wallId: `${c.roomId}_w4` }, now);
    expect(room(linked, c.roomId).polygon).toEqual(room(c.survey, c.roomId).polygon);
    expect(room(linked, a.roomId).walls[1]).toMatchObject({ thickness_m: 0.2, thicknessStatus: 'estimated' });
    const plan = placeRooms(linked.levels[0]);
    expect(plan.rooms.get(c.roomId)).toMatchObject({ status: 'assumed', toReplace: true });
    expect(round(plan.rooms.get(c.roomId)!.polygon!)[0]).toEqual([4.2, 0]);
  });

  it('survey defaults: new and estimated walls follow them, measured ones are kept', () => {
    let s = setSurveyDefaults(newSurvey('M', now), { interiorThickness_m: 0.07, exteriorThickness_m: 0.3 }, now);
    const a = addRectangleRoom(s, s.levels[0].id, 'Salon', 0, 0, 4, 3, now);
    expect(room(a.survey, a.roomId).walls.map(w => w.thickness_m)).toEqual([0.3, 0.3, 0.3, 0.3]);
    const d = addOpening(a.survey, a.roomId, `${a.roomId}_w1`, 'door', 1, now);
    const b = addAdjacentRoom(d.survey, a.roomId, d.openingId, 'Entrée', now);
    expect(room(b.survey, a.roomId).walls[0].thickness_m).toBe(0.07);
    expect(room(b.survey, b.roomId).walls.map(w => w.thickness_m)).toEqual([0.07, 0.3, 0.3, 0.3]);
    s = setWallThickness(b.survey, a.roomId, `${a.roomId}_w2`, 0.25, true, now);
    s = setSurveyDefaults(s, { interiorThickness_m: 0.1, exteriorThickness_m: 0.2, ceilingHeight_m: 2.7 }, now);
    expect(room(s, a.roomId).walls.map(w => w.thickness_m)).toEqual([0.1, 0.25, 0.2, 0.2]);
    expect(s.defaults).toEqual({ interiorThickness_m: 0.1, exteriorThickness_m: 0.2, ceilingHeight_m: 2.7 });
    expect(() => setSurveyDefaults(s, { ceilingHeight_m: 0 }, now)).toThrow();
  });

  it('links one face to several rooms over stretches that do not overlap (ADR 0013)', () => {
    // Salon's top wall (8 m) runs along a corridor (2 m), then a bedroom (3 m) drawn far away.
    let s = newSurvey('M', now);
    const salon = measuredRoom(s, 'Salon', 0, 0, 8, 3);
    const couloir = measuredRoom(salon.survey, 'Couloir', 0, 3.1, 2, 3);
    const chambre = measuredRoom(couloir.survey, 'Chambre', 4, 6, 3, 3);
    s = linkFaces(chambre.survey, { roomId: salon.roomId, wallId: `${salon.roomId}_w3` }, { roomId: couloir.roomId, wallId: `${couloir.roomId}_w1` }, now);
    s = linkFaces(s, { roomId: salon.roomId, wallId: `${salon.roomId}_w3` }, { roomId: chambre.roomId, wallId: `${chambre.roomId}_w1` }, now);
    const top = room(s, salon.roomId).walls[2];
    expect(top.links!.map(l => l.roomId)).toEqual([couloir.roomId, chambre.roomId]);
    expect(top.length_m).toBe(8);
    // Each link covers its own stretch of the 8 m wall: the corridor at the end, the bedroom before it.
    const stretches = linkedFaces(s.levels[0], top).map(f => linkStretch(top, f).map(v => +v.toFixed(3)));
    expect(stretches).toEqual([[6, 8], [1, 4]]);
    expect(room(s, chambre.roomId).polygon).toEqual(room(chambre.survey, chambre.roomId).polygon);
    const plan = placeRooms(s.levels[0]);
    expect(plan.rooms.get(couloir.roomId)!.status).not.toBe('unplaced');
    expect(plan.rooms.get(chambre.roomId)).toMatchObject({ toReplace: true });
    // Drawn 3 m away: the link takes the survey's interior thickness (0.20 m), not that gap.
    expect(round(plan.rooms.get(chambre.roomId)!.polygon!)[0][1]).toBeCloseTo(3.2, 3);

    // A room drawn over the corridor's stretch cannot take the same stretch.
    const other = measuredRoom(s, 'Placard', 0.5, 3.1, 1, 1);
    expect(() => linkFaces(other.survey, { roomId: salon.roomId, wallId: `${salon.roomId}_w3` }, { roomId: other.roomId, wallId: `${other.roomId}_w1` }, now)).toThrow(/déjà lié à « Couloir »/);
    // Unlinking the bedroom keeps the corridor's link.
    const unlinked = unlinkFaces(s, { roomId: salon.roomId, wallId: `${salon.roomId}_w3` }, { roomId: chambre.roomId, wallId: `${chambre.roomId}_w1` }, now);
    expect(room(unlinked, salon.roomId).walls[2].links!.map(l => l.roomId)).toEqual([couloir.roomId]);
    expect(() => unlinkFaces(s, { roomId: salon.roomId, wallId: `${salon.roomId}_w3` }, undefined, now)).toThrow(/quel lien/);
  });

  it('reconstructs a linked room still drawn far away as its own wall, until it is placed', () => {
    let s = newSurvey('M', now);
    const salon = measuredRoom(s, 'Salon', 0, 0, 8, 3);
    const chambre = measuredRoom(salon.survey, 'Chambre', 4, 6, 3, 3);
    s = linkFaces(chambre.survey, { roomId: salon.roomId, wallId: `${salon.roomId}_w3` }, { roomId: chambre.roomId, wallId: `${chambre.roomId}_w1` }, now);
    const items = buildEmpty();
    const storeyId = Object.values(items).find(i => i.type === 'Storey')!.id;
    (items[storeyId] as { survey?: StoreySurvey }).survey = { surveyId: s.id, surveyName: s.name, importedAt: now.toISOString(), level: s.levels[0] };
    const count = (lvl: StoreySurvey['level']) => {
      (items[storeyId] as { survey?: StoreySurvey }).survey!.level = lvl;
      return Object.values(reconstructStorey(items, storeyId).items).filter(i => i.type === 'Wall').length;
    };
    expect(count(s.levels[0])).toBe(8); // drawn 3 m apart: each face keeps its wall
    expect(count(replaceRooms(s, s.levels[0].id, undefined, now).levels[0])).toBe(7); // placed: one wall for both faces
  });

  it('aligned faces place a room linked with an offset not measured, and are checked', () => {
    let s = newSurvey('M', now);
    const salon = measuredRoom(s, 'Salon', 0, 0, 4, 3);
    const cuisine = measuredRoom(salon.survey, 'Cuisine', 4.2, 0.5, 3, 3); // drawn 0.50 m too high
    s = linkFaces(cuisine.survey, { roomId: salon.roomId, wallId: `${salon.roomId}_w2` }, { roomId: cuisine.roomId, wallId: `${cuisine.roomId}_w4` }, now);
    s = setWallThickness(s, salon.roomId, `${salon.roomId}_w2`, 0.2, true, now);
    expect(placeRooms(s.levels[0]).rooms.get(cuisine.roomId)!.status).toBe('assumed');

    // The façade (bottom walls) continues from the living room to the kitchen.
    s = alignFaces(s, { roomId: salon.roomId, wallId: `${salon.roomId}_w1` }, { roomId: cuisine.roomId, wallId: `${cuisine.roomId}_w1` }, now);
    let plan = placeRooms(s.levels[0]);
    expect(plan.rooms.get(cuisine.roomId)).toMatchObject({ status: 'placed', toReplace: true });
    expect(round(plan.rooms.get(cuisine.roomId)!.polygon!)[0]).toEqual([4.2, 0]);
    expect(plan.suggestions).toEqual([]);

    // A 10 cm set-back: the kitchen's façade lies further out (lower).
    s = setAlignmentStep(s, { roomId: salon.roomId, wallId: `${salon.roomId}_w1` }, { roomId: cuisine.roomId, wallId: `${cuisine.roomId}_w1` }, 0.1, now);
    plan = placeRooms(s.levels[0]);
    expect(round(plan.rooms.get(cuisine.roomId)!.polygon!)[0]).toEqual([4.2, -0.1]);

    // Top walls declared aligned too: they contradict the set-back, which is reported.
    s = alignFaces(s, { roomId: salon.roomId, wallId: `${salon.roomId}_w3` }, { roomId: cuisine.roomId, wallId: `${cuisine.roomId}_w3` }, now);
    expect(placeRooms(s.levels[0]).closures.map(c => c.message).join()).toMatch(/ne se prolongent pas .*écart de 10 cm/);
    s = unalignFaces(s, { roomId: salon.roomId, wallId: `${salon.roomId}_w3` }, { roomId: cuisine.roomId, wallId: `${cuisine.roomId}_w3` }, now);
    expect(placeRooms(s.levels[0]).closures).toEqual([]);
  });

  it('places a room whose cotes do not give its shape as drawn, marked assumed', () => {
    let s = newSurvey('M', now);
    const sdb = measuredRoom(s, 'Salle de bain', 0, 0, 3.6, 1.6);
    const ch = addRectangleRoom(sdb.survey, sdb.survey.levels[0].id, 'Chambre', -0.15, 1.7, 3.6, 3.3, now); // one wall measured at most
    s = setWallLength(ch.survey, ch.roomId, `${ch.roomId}_w3`, 3.6, 'laser', now);
    s = linkFaces(s, { roomId: sdb.roomId, wallId: `${sdb.roomId}_w3` }, { roomId: ch.roomId, wallId: `${ch.roomId}_w1` }, now);
    s = alignFaces(s, { roomId: sdb.roomId, wallId: `${sdb.roomId}_w2` }, { roomId: ch.roomId, wallId: `${ch.roomId}_w2` }, now);
    const plan = placeRooms(s.levels[0]);
    expect(plan.rooms.get(ch.roomId)).toMatchObject({ status: 'assumed', fromSketch: true, toReplace: true });
    // Its right wall continues the bathroom's: x of its right side = 3.6.
    expect(round(plan.rooms.get(ch.roomId)!.polygon!)[1][0]).toBeCloseTo(3.6, 3);
    const moved = replaceRooms(s, s.levels[0].id, [ch.roomId], now);
    expect(room(moved, ch.roomId).polygon[1][0]).toBeCloseTo(3.6, 3);
    expect(room(moved, ch.roomId).geometryStatus).toBe('assumed');
  });

  it('cascades: a room linked with an offset not measured slides to meet its other links, and its rooms follow', () => {
    let s = newSurvey('M', now);
    const a = measuredRoom(s, 'Salon', 0, 0, 8, 3);
    const d = measuredRoom(a.survey, 'Chambre', 20, 0, 3, 3);
    const b = measuredRoom(d.survey, 'Couloir', 0.5, 3.2, 2, 3); // drawn 0.80 m too far left
    const c = measuredRoom(b.survey, 'Bureau', 30, 0, 2, 2);
    // The bedroom is placed exactly: its left wall at x = 3.5, above the living room.
    s = connectRooms(c.survey, { roomId: a.roomId, wallId: `${a.roomId}_w3` }, { roomId: d.roomId, wallId: `${d.roomId}_w1` }, 1.5, 0.2, now);
    // The corridor leans on the living room (offset read from the drawing), the office on the corridor.
    s = linkFaces(s, { roomId: a.roomId, wallId: `${a.roomId}_w3` }, { roomId: b.roomId, wallId: `${b.roomId}_w1` }, now);
    s = setWallThickness(s, a.roomId, `${a.roomId}_w3`, 0.2, true, now);
    s = connectRooms(s, { roomId: b.roomId, wallId: `${b.roomId}_w3` }, { roomId: c.roomId, wallId: `${c.roomId}_w1` }, 0, 0.2, now);
    // Then the corridor's right wall is linked to the bedroom's left wall (0.20 m partition).
    s = linkFaces(s, { roomId: b.roomId, wallId: `${b.roomId}_w2` }, { roomId: d.roomId, wallId: `${d.roomId}_w4` }, now);
    s = setWallThickness(s, b.roomId, `${b.roomId}_w2`, 0.2, true, now);
    const plan = placeRooms(s.levels[0]);
    expect(round(plan.rooms.get(b.roomId)!.polygon!)[1][0]).toBeCloseTo(3.3, 3); // corridor's right side
    expect(plan.rooms.get(b.roomId)).toMatchObject({ status: 'placed', toReplace: true });
    const office = round(plan.rooms.get(c.roomId)!.polygon!);
    expect(office[0][0] - round(plan.rooms.get(b.roomId)!.polygon!)[3][0]).toBeCloseTo(0, 3); // the office followed
    expect(plan.closures).toEqual([]);
  });

  it('migrates format 3 links as estimated offsets', () => {
    const v3 = { id: 's', name: 'M', levels: [{ id: 'l', name: 'RDC', rooms: [{ id: 'r', walls: [{ shared: { roomId: 'q', wallId: 'w', offset_m: 0 } }] }] }] };
    // Up to the current format: the single link becomes a one-element list (format 5).
    const now5 = migrateSurvey(v3, 3) as { levels: { rooms: { walls: { shared?: unknown; links: { offsetStatus?: string }[] }[] }[] }[] };
    expect(now5.levels[0].rooms[0].walls[0].links).toEqual([{ roomId: 'q', wallId: 'w', offset_m: 0, offsetStatus: 'estimated' }]);
    expect(now5.levels[0].rooms[0].walls[0].shared).toBeUndefined();
  });
});
