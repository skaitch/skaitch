import { describe, expect, it } from 'vitest';
import { addDiagonal, addPolygonRoom, addRectangleRoom, deleteControl, moveVertex, newSurvey, setAngle, setWallLength } from '@skaitch/core/survey/edit';
import { solveRoom } from '@skaitch/core/survey/solve';
import { readSurveyFile, writeSurveyFile, type Survey } from '@skaitch/core/survey/surveyFile';

const now = new Date('2026-11-17T10:00:00Z');
const room = (s: Survey) => s.levels[0].rooms[0];

function measuredQuad(lengths = [4, 3, 4, 3]) {
  let s = newSurvey('x', now);
  const r = addRectangleRoom(s, s.levels[0].id, 'Salon', 0, 0, 4, 3, now);
  s = r.survey;
  lengths.forEach((l, i) => { s = setWallLength(s, r.roomId, `${r.roomId}_w${i + 1}`, l, 'laser', now); });
  return { survey: s, roomId: r.roomId };
}

describe('solver', () => {
  it('four sides alone do not define a quadrilateral: unresolved geometry, asks for a diagonal', () => {
    const { survey } = measuredQuad();
    const r = solveRoom(room(survey));
    expect(r.status).toBe('underconstrained');
    expect(r.status === 'underconstrained' && r.hint).toMatch(/diagonale P\d–P\d/);
    expect(room(survey).geometryStatus).toBe('assumed');
  });

  it('a diagonal resolves it and replaces the assumed rectangle with the measured shape', () => {
    const { survey, roomId } = measuredQuad([4, 3, 4.1, 3]);
    // Not a rectangle: diagonal P1–P3 = 5.10 m.
    const s = addDiagonal(survey, roomId, 0, 2, 5.1, 'laser', now);
    const r = room(s);
    expect(r.geometryStatus).toBe('resolved');
    const d = (i: number, j: number) => Math.hypot(r.polygon[i][0] - r.polygon[j][0], r.polygon[i][1] - r.polygon[j][1]);
    expect(d(0, 1)).toBeCloseTo(4, 6); expect(d(1, 2)).toBeCloseTo(3, 6); expect(d(2, 3)).toBeCloseTo(4.1, 6); expect(d(3, 0)).toBeCloseTo(3, 6);
    expect(d(0, 2)).toBeCloseTo(5.1, 6);
    // Kept where it was drawn: first wall from the origin, along x.
    expect(r.polygon[0]).toEqual([0, 0]); expect(r.polygon[1]).toEqual([4, 0]);
    // Locked lengths never change.
    expect(r.walls.map(w => w.length_m)).toEqual([4, 3, 4.1, 3]);
    expect(readSurveyFile(writeSurveyFile(s, '0'))).toEqual(s);
  });

  it('an angle can replace the diagonal', () => {
    const { survey, roomId } = measuredQuad([4, 3, 4, 3]);
    const s = setAngle(survey, roomId, 1, 90, now);
    expect(room(s).geometryStatus).toBe('resolved');
    expect(room(s).polygon[2][0]).toBeCloseTo(4); expect(room(s).polygon[2][1]).toBeCloseTo(3);
  });

  it('extra measurements must agree within 1 cm, otherwise nothing is changed', () => {
    const { survey, roomId } = measuredQuad([4, 3, 4, 3]);
    let s = addDiagonal(survey, roomId, 0, 2, 5, 'laser', now);
    expect(room(s).geometryStatus).toBe('resolved');
    const before = room(s).polygon;
    s = addDiagonal(s, roomId, 1, 3, 5.2, 'laser', now);
    const r = solveRoom(room(s));
    expect(r.status).toBe('inconsistent');
    expect(r.status === 'inconsistent' && r.message).toMatch(/Mesures incompatibles : P\d–P\d mesuré .* \(écart 0\.\d+ m\)/);
    expect(room(s).geometryStatus).toBe('assumed');
    expect(room(s).polygon).toEqual(before);
    s = addDiagonal(s, roomId, 1, 3, 5.005, 'laser', now);
    expect(room(s).geometryStatus).toBe('resolved');
  });

  it('removing a control measurement or moving a vertex by hand falls back to the sketch', () => {
    const { survey, roomId } = measuredQuad();
    let s = addDiagonal(survey, roomId, 0, 2, 5, 'laser', now);
    s = deleteControl(s, roomId, room(s).diagonals![0].id, now);
    expect(room(s).geometryStatus).toBe('assumed');
    s = addDiagonal(s, roomId, 0, 2, 5, 'laser', now);
    s = moveVertex(s, roomId, 2, [4.5, 3.2], now);
    expect(room(s).geometryStatus).toBe('assumed');
  });

  it('a triangle is resolved by its three sides, an L needs three diagonals', () => {
    let s = newSurvey('x', now);
    const t = addPolygonRoom(s, s.levels[0].id, 'T', [[0, 0], [3, 0], [0, 4]], now);
    s = t.survey;
    [3, 5, 4].forEach((l, i) => { s = setWallLength(s, t.roomId, `${t.roomId}_w${i + 1}`, l, 'laser', now); });
    expect(room(s).geometryStatus).toBe('resolved');

    let l = newSurvey('x', now);
    const L = addPolygonRoom(l, l.levels[0].id, 'L', [[0, 0], [5, 0], [5, 2], [2, 2], [2, 4], [0, 4]], now);
    l = L.survey;
    [5, 2, 3, 2, 2, 4].forEach((v, i) => { l = setWallLength(l, L.roomId, `${L.roomId}_w${i + 1}`, v, 'laser', now); });
    expect(solveRoom(room(l)).status).toBe('underconstrained');
    l = addDiagonal(l, L.roomId, 0, 2, Math.hypot(5, 2), 'laser', now);
    l = addDiagonal(l, L.roomId, 0, 3, Math.hypot(2, 2), 'laser', now);
    l = addDiagonal(l, L.roomId, 0, 4, Math.hypot(2, 4), 'laser', now);
    expect(room(l).geometryStatus).toBe('resolved');
    expect(room(l).polygon[3][0]).toBeCloseTo(2); expect(room(l).polygon[3][1]).toBeCloseTo(2);
  });
});

import { surveyWarnings } from '@skaitch/core/survey/surveyFile';
describe('conflicting measurements', () => {
  it('names every measurement involved and changes no value (AT-08)', () => {
    const { survey, roomId } = measuredQuad([4, 3, 4, 3]);
    let s = addDiagonal(survey, roomId, 0, 2, 5, 'laser', now);
    const snapshot = JSON.stringify(room(s));
    s = addDiagonal(s, roomId, 1, 3, 5.2, 'laser', now);
    const r = solveRoom(room(s));
    expect(r.status).toBe('inconsistent');
    if (r.status !== 'inconsistent') return;
    const labels = r.conflicting.map(m => m.label);
    expect(labels.some(l => l.startsWith('diagonale P2–P4'))).toBe(true);
    expect(labels.some(l => l.startsWith('diagonale P1–P3'))).toBe(true);
    expect(r.message).toMatch(/Aucune valeur n'a été modifiée/);
    // Lengths, diagonals and outline: untouched; only the status says it is no longer resolved.
    const after = room(s);
    expect(after.walls).toEqual(JSON.parse(snapshot).walls);
    expect(after.polygon).toEqual(JSON.parse(snapshot).polygon);
    expect(after.diagonals!.map(d => d.length_m)).toEqual([5, 5.2]);
    const w = surveyWarnings(s).find(x => x.message.includes('incompatibles'))!;
    expect(w.wallIds).toEqual(expect.arrayContaining([after.diagonals![1].id, after.diagonals![0].id]));
  });

  it('reports sides that cannot form a triangle', () => {
    let s = newSurvey('x', now);
    const t = addPolygonRoom(s, s.levels[0].id, 'T', [[0, 0], [3, 0], [0, 4]], now);
    s = t.survey;
    [1, 5, 1].forEach((l, i) => { s = setWallLength(s, t.roomId, `${t.roomId}_w${i + 1}`, l, 'laser', now); });
    const r = solveRoom(room(s));
    expect(r.status === 'inconsistent' && r.message).toMatch(/ne peuvent pas former un triangle/);
    expect(r.status === 'inconsistent' && r.conflicting).toHaveLength(3);
  });
});

import { setRightAngles } from '@skaitch/core/survey/edit';
describe('right angles everywhere', () => {
  it('confirms 90° and 270° corners of an L, and its measured walls resolve it', () => {
    let s = newSurvey('x', now);
    const L = addPolygonRoom(s, s.levels[0].id, 'L', [[0, 0], [5, 0], [5, 2], [2, 2], [2, 4], [0, 4]], now);
    s = L.survey;
    expect(solveRoom(room(s)).status === 'underconstrained' && (solveRoom(room(s)) as any).hint).toMatch(/0 mesures sur 9/);
    [5, 2, 3, 2].forEach((v, i) => { s = setWallLength(s, L.roomId, `${L.roomId}_w${i + 1}`, v, 'laser', now); });
    s = setRightAngles(s, L.roomId, now);
    const r = room(s);
    expect(r.angles!.map(a => a.deg)).toEqual([90, 90, 90, 270, 90, 90]);
    expect(r.geometryStatus).toBe('resolved');
  });

  it('asks for a wall before a diagonal when a wall reaching the next corner is not measured', () => {
    let s = newSurvey('x', now);
    const r = addRectangleRoom(s, s.levels[0].id, 'R', 0, 0, 4, 3, now);
    s = setWallLength(r.survey, r.roomId, `${r.roomId}_w1`, 4, 'laser', now);
    const res = solveRoom(room(s));
    expect(res.status === 'underconstrained' && res.hint).toMatch(/mesurez le mur P(2–P3|4–P1) \(1 mesures sur 5/);
  });
});
