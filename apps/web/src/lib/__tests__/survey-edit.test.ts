import { describe, expect, it } from 'vitest';
import { addRectangleRoom, deleteRoom, moveRoom, newSurvey, setWallLength, setWallThickness } from '@skaitch/core/survey/edit';
import { readSurveyFile, surveyWarnings, writeSurveyFile } from '@skaitch/core/survey/surveyFile';

const now = new Date('2026-11-17T10:00:00Z');
function sketch() {
  const s = newSurvey('Appartement', now);
  const { survey, roomId } = addRectangleRoom(s, s.levels[0].id, 'Salon', 0, 0, 4, 3, now);
  return { survey, roomId, room: () => survey.levels[0].rooms[0] };
}

describe('survey editing', () => {
  it('draws a rectangle with sketched, unlocked lengths and assumed geometry', () => {
    const { survey } = sketch();
    const room = survey.levels[0].rooms[0];
    expect(room.geometryStatus).toBe('assumed');
    expect(room.walls.map(w => [w.length_m, w.source, w.locked])).toEqual([[4, 'estimated', false], [3, 'estimated', false], [4, 'estimated', false], [3, 'estimated', false]]);
    expect(readSurveyFile(writeSurveyFile(survey, '0'))).toEqual(survey);
  });

  it('a typed length is locked and redraws the rectangle; the sketched opposite side follows', () => {
    const { survey, roomId } = sketch();
    const before = JSON.stringify(survey);
    const next = setWallLength(survey, roomId, `${roomId}_w1`, 4.32, 'laser', now);
    expect(JSON.stringify(survey)).toBe(before);
    const room = next.levels[0].rooms[0];
    expect(room.walls[0]).toMatchObject({ length_m: 4.32, source: 'laser', locked: true });
    expect(room.walls[2]).toMatchObject({ length_m: 4.32, locked: false });
    expect(room.polygon[2]).toEqual([4.32, 3]);
    expect(surveyWarnings(next)).toEqual([]);
  });

  it('never changes a measured opposite side: a disagreement becomes a warning', () => {
    const { survey, roomId } = sketch();
    let s = setWallLength(survey, roomId, `${roomId}_w3`, 4.30, 'laser', now);
    s = setWallLength(s, roomId, `${roomId}_w1`, 4.32, 'laser', now);
    const room = s.levels[0].rooms[0];
    expect(room.walls[2]).toMatchObject({ length_m: 4.30, locked: true });
    expect(surveyWarnings(s)).toHaveLength(1);
  });

  it('moves, sets thickness and deletes rooms', () => {
    const { survey, roomId } = sketch();
    let s = moveRoom(survey, roomId, 1, 2, now);
    expect(s.levels[0].rooms[0].polygon[0]).toEqual([1, 2]);
    s = setWallThickness(s, roomId, `${roomId}_w2`, 0.3, true, now);
    expect(s.levels[0].rooms[0].walls[1]).toMatchObject({ thickness_m: 0.3, thicknessStatus: 'measured' });
    expect(deleteRoom(s, roomId, now).levels[0].rooms).toEqual([]);
    expect(() => setWallLength(s, roomId, `${roomId}_w1`, 0)).toThrow();
  });
});

import { addOpening, moveOpening, openingCotes, setOpeningCote, updateOpening, deleteOpening } from '@skaitch/core/survey/edit';

describe('openings', () => {
  function withDoor() {
    const { survey, roomId } = sketch();
    const s = setWallLength(survey, roomId, `${roomId}_w1`, 4, 'laser', now);
    const r = addOpening(s, roomId, `${roomId}_w1`, 'door', 1.5, now);
    return { survey: r.survey, roomId, id: r.openingId, room: (x: typeof s) => x.levels[0].rooms[0] };
  }

  it('adds a door centred where tapped and exposes the before / width / after cotes', () => {
    const { survey, id, room } = withDoor();
    const o = room(survey).openings![0];
    expect(o).toMatchObject({ id, kind: 'door', operation: 'single_swing', width_m: 0.83 });
    const c = openingCotes(room(survey), o);
    expect(c.before + c.width + c.after).toBeCloseTo(4);
    expect(c.before).toBeCloseTo(1.085);
    expect(readSurveyFile(writeSurveyFile(survey, '0'))).toEqual(survey);
  });

  it('typing a cote repositions the opening; overflow is refused, not clamped', () => {
    const { survey, roomId, id, room } = withDoor();
    let s = setOpeningCote(survey, roomId, id, 'after', 0.5, now);
    expect(room(s).openings![0].offset_m).toBeCloseTo(4 - 0.5 - 0.83);
    s = setOpeningCote(s, roomId, id, 'width', 0.93, now);
    expect(openingCotes(room(s), room(s).openings![0]).before).toBeCloseTo(2.67);
    expect(() => setOpeningCote(s, roomId, id, 'before', 3.5, now)).toThrow(/dépasse/);
  });

  it('widening past the wall end grows towards free space on the other side', () => {
    const { survey, roomId, id, room } = withDoor();
    let s = setOpeningCote(survey, roomId, id, 'after', 0.2, now);
    s = setOpeningCote(s, roomId, id, 'width', 1.5, now);
    const c = openingCotes(room(s), room(s).openings![0]);
    expect(c.after).toBeCloseTo(0);
    expect(c.before).toBeCloseTo(2.5);
    expect(() => setOpeningCote(s, roomId, id, 'width', 4.5, now)).toThrow(/dépasse/);
  });

  it('dragging is clamped to the wall and stops at the neighbouring opening', () => {
    const { survey, roomId, id, room } = withDoor();
    const r = addOpening(survey, roomId, `${roomId}_w1`, 'window', 3.3, now);
    let s = moveOpening(r.survey, roomId, id, 99, now);
    const win = room(s).openings!.find(o => o.kind === 'window')!;
    expect(room(s).openings!.find(o => o.id === id)!.offset_m).toBeCloseTo(win.offset_m - 0.83);
    s = moveOpening(s, roomId, id, -5, now);
    expect(room(s).openings!.find(o => o.id === id)!.offset_m).toBe(0);
    expect(() => setOpeningCote(s, roomId, id, 'width', 3.5, now)).toThrow(/chevauchent|dépasse/);
  });

  it('switching to a window keeps a valid mechanism and adds a sill; shortening the wall under it is refused', () => {
    const { survey, roomId, id, room } = withDoor();
    const s = updateOpening(survey, roomId, id, { kind: 'window' }, now);
    expect(room(s).openings![0]).toMatchObject({ kind: 'window', operation: 'single_swing', sill_m: 0.9 });
    expect(() => updateOpening(survey, roomId, id, { operation: 'tilt_turn' }, now)).toThrow(/Mécanisme/);
    expect(() => setWallLength(s, roomId, `${roomId}_w1`, 1.5, 'laser', now)).toThrow(/dépasse/);
    expect(room(deleteOpening(s, roomId, id, now)).openings).toEqual([]);
  });
});

import { addPolygonRoom, moveVertex } from '@skaitch/core/survey/edit';
import { reconstructStorey as rebuild } from '@skaitch/core/survey/reconstruct';
import { buildEmpty } from '@skaitch/core/data/starter';

describe('free-form rooms', () => {
  // L-shaped room drawn clockwise on purpose.
  const L: [number, number][] = [[0, 0], [0, 4], [2, 4], [2, 2], [5, 2], [5, 0]];
  function lRoom() {
    const s = newSurvey('Maison', now);
    const r = addPolygonRoom(s, s.levels[0].id, 'Séjour', L, now);
    return { survey: r.survey, roomId: r.roomId, room: (x: typeof s) => x.levels[0].rooms[0] };
  }

  it('stores a free-form room counter-clockwise with one sketched wall per edge', () => {
    const { survey, room } = lRoom();
    const r = room(survey);
    expect(r.shape).toBe('polygon');
    expect(r.polygon[0]).toEqual([5, 0]);
    expect(r.walls.map(w => w.length_m)).toEqual([2, 3, 2, 2, 4, 5]);
    expect(r.walls.every(w => !w.locked && w.source === 'estimated')).toBe(true);
    expect(readSurveyFile(writeSurveyFile(survey, '0'))).toEqual(survey);
  });

  it('refuses self-intersecting outlines and too few vertices', () => {
    const s = newSurvey('x', now);
    expect(() => addPolygonRoom(s, s.levels[0].id, 'x', [[0, 0], [2, 2], [2, 0], [0, 2]], now)).toThrow(/recoupe/);
    expect(() => addPolygonRoom(s, s.levels[0].id, 'x', [[0, 0], [2, 2]], now)).toThrow(/trois/);
  });

  it('a typed length on a free-form quad does not reshape it like a rectangle', () => {
    const s = newSurvey('x', now);
    const r = addPolygonRoom(s, s.levels[0].id, 'Trapèze', [[0, 0], [4, 0], [3, 2], [1, 2]], now);
    const next = setWallLength(r.survey, r.roomId, `${r.roomId}_w1`, 4.2, 'laser', now);
    expect(next.levels[0].rooms[0].polygon).toEqual(r.survey.levels[0].rooms[0].polygon);
    expect(surveyWarnings(next)).toHaveLength(1);
  });

  it('moving a vertex updates sketched lengths, keeps measured ones, and turns a rectangle into a polygon', () => {
    const { survey, roomId } = sketch();
    let s = setWallLength(survey, roomId, `${roomId}_w1`, 4, 'laser', now);
    s = moveVertex(s, roomId, 2, [4, 3.5], now);
    const room = s.levels[0].rooms[0];
    expect(room.shape).toBe('polygon');
    expect(room.walls[1].length_m).toBe(3.5);
    expect(room.walls[2].length_m).toBeCloseTo(4.031, 3);
    expect(room.walls[0]).toMatchObject({ length_m: 4, locked: true });
    expect(() => moveVertex(s, roomId, 2, [-1, -1], now)).toThrow(/recoupe/);
  });

  it('reconstructs a concave room with closed corners', () => {
    const { survey } = lRoom();
    const items = buildEmpty();
    const storey = Object.values(items).find(i => i.type === 'Storey')! as any;
    storey.survey = { surveyId: survey.id, surveyName: survey.name, importedAt: '', level: survey.levels[0] };
    const out = rebuild(items, storey.id);
    const ws = Object.values(out.items).filter((i: any) => i.surveyRef && i.type === 'Wall') as any[];
    expect(ws).toHaveLength(6);
    ws.sort((a, b) => a.surveyRef.wallId.localeCompare(b.surveyRef.wallId));
    for (let i = 0; i < 6; i++) {
      const a = ws[i].geom, b = ws[(i + 1) % 6].geom;
      expect(a.x2).toBeCloseTo(b.x1); expect(a.y2).toBeCloseTo(b.y1);
    }
    // Reflex corner at (2,2): the axes meet 0.1 inside the L's notch.
    expect(ws.some(w => Math.abs(w.geom.x1 - 2.1) < 1e-9 && Math.abs(w.geom.y1 - 2.1) < 1e-9)).toBe(true);
  });
});

import { deleteVertex } from '@skaitch/core/survey/edit';
describe('vertex deletion', () => {
  it('merges the two walls of the vertex into one sketched wall and keeps the file valid', () => {
    const s = newSurvey('x', now);
    const r = addPolygonRoom(s, s.levels[0].id, 'L', [[0, 0], [5, 0], [5, 2], [2, 2], [2, 4], [0, 4]], now);
    let next = setWallLength(r.survey, r.roomId, `${r.roomId}_w1`, 5, 'laser', now);
    next = deleteVertex(next, r.roomId, 3, now);
    const room = next.levels[0].rooms[0];
    expect(room.polygon).toEqual([[0, 0], [5, 0], [5, 2], [2, 4], [0, 4]]);
    expect(room.walls).toHaveLength(5);
    expect(room.walls[0]).toMatchObject({ length_m: 5, locked: true });
    expect(room.walls[2]).toMatchObject({ from: 2, to: 3, locked: false, length_m: 3.606 });
    expect(readSurveyFile(writeSurveyFile(next, '0'))).toEqual(next);
  });

  it('refuses below three vertices and when an opening sits on a merged wall', () => {
    const { survey, roomId } = sketch();
    const tri = deleteVertex(survey, roomId, 2, now);
    expect(() => deleteVertex(tri, roomId, 0, now)).toThrow(/trois/);
    const withDoor = addOpening(setWallLength(survey, roomId, `${roomId}_w1`, 4, 'laser', now), roomId, `${roomId}_w1`, 'door', 2, now).survey;
    expect(() => deleteVertex(withDoor, roomId, 1, now)).toThrow(/ouvertures/);
  });
});

import { addAdjacentRoom } from '@skaitch/core/survey/edit';
import { faceOpenings } from '@skaitch/core/survey/surveyFile';
describe('adjacent room', () => {
  function withDoor() {
    const { survey, roomId } = sketch();
    let s = setWallLength(survey, roomId, `${roomId}_w1`, 4, 'laser', now);
    const d = addOpening(s, roomId, `${roomId}_w1`, 'door', 1, now);
    return { survey: d.survey, roomId, doorId: d.openingId };
  }

  it('creates the room on the other side of the door wall, linked both ways', () => {
    const { survey, roomId, doorId } = withDoor();
    const r = addAdjacentRoom(survey, roomId, doorId, 'Entrée', now);
    const [a, b] = r.survey.levels[0].rooms;
    // Bottom wall of A (y = 0) is 0.20 thick: B lies below, from y = −0.20 down.
    expect(b.polygon).toEqual([[4, -0.2], [0, -0.2], [0, -3.2], [4, -3.2]]);
    expect(a.walls[0].links).toEqual([{ roomId: b.id, wallId: b.walls[0].id, offset_m: 0, offsetStatus: 'estimated' }]);
    expect(b.walls[0].links).toEqual([{ roomId, wallId: a.walls[0].id, offset_m: 0, offsetStatus: 'estimated' }]);
    expect(b.walls[0]).toMatchObject({ length_m: 4, locked: false });
    expect(readSurveyFile(writeSurveyFile(r.survey, '0'))).toEqual(r.survey);
    expect(() => addAdjacentRoom(r.survey, roomId, doorId, 'x', now)).toThrow(/déjà partagé/);
  });

  it('the door is one object, seen from the other room mirrored', () => {
    const { survey, roomId, doorId } = withDoor();
    const r = addAdjacentRoom(survey, roomId, doorId, 'Entrée', now);
    const level = r.survey.levels[0];
    const seen = faceOpenings(level, level.rooms[1]);
    expect(seen).toHaveLength(1);
    const door = level.rooms[0].openings![0];
    expect(seen[0]).toMatchObject({ owner: roomId, wallId: level.rooms[1].walls[0].id, hinge: 'end', swing: 'out' });
    expect(seen[0].offset_m).toBeCloseTo(4 - door.offset_m - door.width_m);
    expect(level.rooms[1].openings ?? []).toEqual([]);
  });

  it('shares the thickness, and deleting a room unlinks its neighbour', () => {
    const { survey, roomId, doorId } = withDoor();
    const r = addAdjacentRoom(survey, roomId, doorId, 'Entrée', now);
    const s = setWallThickness(r.survey, r.roomId, `${r.roomId}_w1`, 0.25, true, now);
    expect(s.levels[0].rooms[0].walls[0]).toMatchObject({ thickness_m: 0.25, thicknessStatus: 'measured' });
    const del = deleteRoom(s, r.roomId, now);
    expect(del.levels[0].rooms[0].walls[0].links).toBeUndefined();
    expect(readSurveyFile(writeSurveyFile(del, '0'))).toEqual(del);
  });

  it('refuses a one-sided link', () => {
    const { survey, roomId, doorId } = withDoor();
    const r = addAdjacentRoom(survey, roomId, doorId, 'Entrée', now);
    const broken = structuredClone(r.survey);
    delete broken.levels[0].rooms[1].walls[0].links;
    expect(() => writeSurveyFile(broken, '0')).toThrow(/pointe pas en retour/);
  });
});

import { insertVertex } from '@skaitch/core/survey/edit';
describe('vertex insertion', () => {
  it('splits a wall at the point, keeps openings on their part, and the file stays valid', () => {
    const { survey, roomId } = sketch();
    let s = setWallLength(survey, roomId, `${roomId}_w1`, 4, 'laser', now);
    s = addOpening(s, roomId, `${roomId}_w1`, 'door', 3.2, now).survey;
    const r = insertVertex(s, roomId, `${roomId}_w1`, 0.5, now);
    const room = r.survey.levels[0].rooms[0];
    expect(r.index).toBe(1);
    expect(room.polygon).toEqual([[0, 0], [2, 0], [4, 0], [4, 3], [0, 3]]);
    expect(room.walls.map(w => [w.from, w.to, w.length_m, w.locked])).toEqual([[0, 1, 2, false], [1, 2, 2, false], [2, 3, 3, false], [3, 4, 4, false], [4, 0, 3, false]]);
    // The door (centre 3.2 m) is on the second half now, 1.2 m further from its start.
    expect(room.openings![0]).toMatchObject({ wallId: room.walls[1].id });
    expect(room.openings![0].offset_m).toBeCloseTo(3.2 - 0.415 - 2, 3);
    expect(room.shape).toBe('polygon');
    expect(readSurveyFile(writeSurveyFile(r.survey, '0'))).toEqual(r.survey);
    // The new point can be dragged right away.
    expect(moveVertex(r.survey, roomId, 1, [2, 1], now).levels[0].rooms[0].polygon[1]).toEqual([2, 1]);
  });

  it('refuses a split through an opening or on a shared wall', () => {
    const { survey, roomId } = sketch();
    let s = setWallLength(survey, roomId, `${roomId}_w1`, 4, 'laser', now);
    const d = addOpening(s, roomId, `${roomId}_w1`, 'door', 2, now);
    expect(() => insertVertex(d.survey, roomId, `${roomId}_w1`, 0.5, now)).toThrow(/ouverture/);
    const adj = addAdjacentRoom(d.survey, roomId, d.openingId, 'Entrée', now);
    expect(() => insertVertex(adj.survey, roomId, `${roomId}_w1`, 0.1, now)).toThrow(/partagé/);
  });
});

describe('moving a vertex next to an opening', () => {
  it('slides an opening back inside a sketched wall that gets shorter, instead of refusing the move', () => {
    const { survey, roomId } = sketch();
    // Sketched 4 m wall, door against its end.
    let s = addOpening(survey, roomId, `${roomId}_w1`, 'door', 3.9, now).survey;
    expect(s.levels[0].rooms[0].openings![0].offset_m).toBeCloseTo(4 - 0.83);
    s = moveVertex(s, roomId, 1, [3.5, 0], now);
    const room = s.levels[0].rooms[0];
    expect(room.walls[0].length_m).toBe(3.5);
    expect(room.openings![0].offset_m).toBeCloseTo(3.5 - 0.83);
    // Narrower than the door: refused.
    expect(() => moveVertex(s, roomId, 1, [0.5, 0], now)).toThrow(/dépasse|chevauchent/);
  });

  it('never changes an opening on a measured wall', () => {
    const { survey, roomId } = sketch();
    let s = setWallLength(survey, roomId, `${roomId}_w1`, 4, 'laser', now);
    s = addOpening(s, roomId, `${roomId}_w1`, 'door', 3.9, now).survey;
    const before = s.levels[0].rooms[0].openings![0].offset_m;
    s = moveVertex(s, roomId, 1, [3.5, 0], now);
    expect(s.levels[0].rooms[0].openings![0].offset_m).toBe(before);
  });
});

describe('deduced length', () => {
  it('measured walls of a rectangle give the missing ones, and the outline follows them', () => {
    const { survey, roomId } = sketch();
    let s = setWallLength(survey, roomId, `${roomId}_w1`, 4.2, 'laser', now);
    s = setWallLength(s, roomId, `${roomId}_w2`, 3.1, 'laser', now);
    // Right angles: two adjacent walls already give the opposite ones.
    expect(s.levels[0].rooms[0].walls[2]).toMatchObject({ length_m: 4.2, source: 'computed' });
    s = setWallLength(s, roomId, `${roomId}_w3`, 4.2, 'laser', now);
    const room = s.levels[0].rooms[0];
    expect(room.walls[3]).toMatchObject({ length_m: 3.1, source: 'computed', locked: false });
    expect(room.polygon).toEqual([[0, 0], [4.2, 0], [4.2, 3.1], [0, 3.1]]);
    expect(room.geometryStatus).toBe('assumed');
    expect(readSurveyFile(writeSurveyFile(s, '0'))).toEqual(s);
    // Measuring it replaces the deduced value.
    s = setWallLength(s, roomId, `${roomId}_w4`, 3.12, 'laser', now);
    expect(s.levels[0].rooms[0].walls[3]).toMatchObject({ length_m: 3.12, source: 'laser', locked: true });
  });

  it('works for an L-shaped room: the last horizontal and vertical walls follow', () => {
    let s = newSurvey('x', now);
    const r = addPolygonRoom(s, s.levels[0].id, 'L', [[0, 0], [5, 0], [5, 2], [2, 2], [2, 4], [0, 4]], now);
    s = r.survey;
    // Measure all but the top (w5, 2 m going left) and the left (w6, 4 m going down).
    [5, 2.1, 3, 2.2].forEach((l, i) => { s = setWallLength(s, r.roomId, `${r.roomId}_w${i + 1}`, l, 'laser', now); });
    const room = s.levels[0].rooms[0];
    expect(room.walls[4]).toMatchObject({ length_m: 2, source: 'computed' });
    expect(room.walls[5]).toMatchObject({ length_m: 4.3, source: 'computed' });
    expect(room.polygon[3]).toEqual([2, 2.1]);
  });

  it('does not deduce on a room that is not drawn with right angles', () => {
    let s = newSurvey('x', now);
    const r = addPolygonRoom(s, s.levels[0].id, 'T', [[0, 0], [4, 0], [3, 2], [1, 2]], now);
    s = r.survey;
    [4, 2.24, 2].forEach((l, i) => { s = setWallLength(s, r.roomId, `${r.roomId}_w${i + 1}`, l, 'laser', now); });
    expect(s.levels[0].rooms[0].walls[3].source).toBe('estimated');
  });
});

import { makeRectangle } from '@skaitch/core/survey/edit';
describe('back to a rectangle', () => {
  it('replaces a free outline by its rectangle, keeping the door on its side and the link to the next room', () => {
    let s = newSurvey('M', now);
    const a = addRectangleRoom(s, s.levels[0].id, 'Cuisine', 0, 0, 4, 3, now);
    s = setWallLength(a.survey, a.roomId, `${a.roomId}_w1`, 4, 'laser', now);
    const d = addOpening(s, a.roomId, `${a.roomId}_w1`, 'door', 2, now);
    const adj = addAdjacentRoom(d.survey, a.roomId, d.openingId, 'Salon', now);
    // Make the kitchen free-form: a point on its right wall, pushed out.
    const ins = insertVertex(adj.survey, a.roomId, `${a.roomId}_w2`, 0.5, now);
    s = moveVertex(ins.survey, a.roomId, ins.index, [4.6, 1.5], now);
    expect(s.levels[0].rooms[0].polygon).toHaveLength(5);
    const r = makeRectangle(s, a.roomId, now);
    const room = r.survey.levels[0].rooms[0];
    expect(r.lostLinks).toBe(0);
    expect(room).toMatchObject({ shape: 'rectangle', geometryStatus: 'assumed' });
    // Width from the measured bottom wall (4 m), height from the drawing.
    expect(room.polygon).toEqual([[0, 0], [4, 0], [4, 3], [0, 3]]);
    // The bottom side had one measured wall: kept. The door stays on it at its place.
    expect(room.walls[0]).toMatchObject({ id: `${a.roomId}_w1`, locked: true, length_m: 4 });
    expect(room.openings![0]).toMatchObject({ wallId: `${a.roomId}_w1` });
    expect(room.openings![0].offset_m).toBeCloseTo(d.survey.levels[0].rooms[0].openings![0].offset_m, 2);
    expect(room.walls[0].links?.[0].roomId).toBe(adj.roomId);
    expect(readSurveyFile(writeSurveyFile(r.survey, '0'))).toEqual(r.survey);
  });
});

describe('confirmed rectangle', () => {
  it('types 90° at the four corners: two adjacent measured walls resolve the room', () => {
    const { survey, roomId } = sketch();
    let s = setWallLength(survey, roomId, `${roomId}_w1`, 4.2, 'laser', now);
    s = setWallLength(s, roomId, `${roomId}_w2`, 3.1, 'laser', now);
    expect(s.levels[0].rooms[0].geometryStatus).toBe('assumed');
    s = makeRectangle(s, roomId, now).survey;
    const room = s.levels[0].rooms[0];
    expect(room.angles!.map(a => a.deg)).toEqual([90, 90, 90, 90]);
    expect(room.geometryStatus).toBe('resolved');
    expect(room.polygon[2][0]).toBeCloseTo(4.2); expect(room.polygon[2][1]).toBeCloseTo(3.1);
    // A measurement that contradicts the deduced side is still reported, never forced.
    s = setWallLength(s, roomId, `${roomId}_w3`, 4.0, 'laser', now);
    expect(s.levels[0].rooms[0].geometryStatus).toBe('assumed');
  });
});

import { linkFaces as linkFacesForUnlink, unlinkFaces } from '@skaitch/core/survey/edit';
describe('unlinkFaces', () => {
  it('unlinks both faces of a shared wall', () => {
    let s = newSurvey('x', now);
    const a = addRectangleRoom(s, s.levels[0].id, 'A', 0, 0, 4, 3, now); s = a.survey;
    const b = addRectangleRoom(s, s.levels[0].id, 'B', 4.2, 0, 3, 3, now); s = b.survey;
    s = linkFacesForUnlink(s, { roomId: a.roomId, wallId: `${a.roomId}_w2` }, { roomId: b.roomId, wallId: `${b.roomId}_w4` }, now);
    s = unlinkFaces(s, { roomId: b.roomId, wallId: `${b.roomId}_w4` }, undefined, now);
    expect(s.levels[0].rooms.flatMap(r => r.walls).some(w => w.links)).toBe(false);
    expect(() => unlinkFaces(s, { roomId: a.roomId, wallId: `${a.roomId}_w2` }, undefined, now)).toThrow(/aucune/);
  });
});
