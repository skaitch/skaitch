import { describe, expect, it } from 'vitest';
import { addDiagonal, addRectangleRoom, newSurvey, setCeilingHeight, setWallLength, setWallThickness } from '@skaitch/core/survey/edit';
import { surveyChecks } from '@skaitch/core/survey/checks';

const now = new Date('2026-11-18T10:00:00Z');
describe('survey check', () => {
  it('lists missing measurements first, each pointing at what to fix, and is empty once complete', () => {
    let s = newSurvey('x', now);
    expect(surveyChecks(s).map(c => c.severity)).toEqual(['error']);
    const r = addRectangleRoom(s, s.levels[0].id, 'Salon', 0, 0, 4, 3, now);
    s = r.survey;
    let checks = surveyChecks(s);
    expect(checks[0]).toMatchObject({ severity: 'error', roomId: r.roomId, targetId: `${r.roomId}_w1` });
    expect(checks[0].message).toMatch(/4 mur\(s\) sans cote mesurée/);
    [4, 3, 4, 3].forEach((l, i) => { s = setWallLength(s, r.roomId, `${r.roomId}_w${i + 1}`, l, 'laser', now); });
    checks = surveyChecks(s);
    expect(checks.find(c => c.severity === 'warning')!.message).toMatch(/diagonale P1–P3/);
    s = addDiagonal(s, r.roomId, 0, 2, 5, 'laser', now);
    s = setCeilingHeight(s, r.roomId, 2.5, now);
    for (let i = 1; i <= 4; i++) s = setWallThickness(s, r.roomId, `${r.roomId}_w${i}`, 0.2, true, now);
    expect(surveyChecks(s)).toEqual([]);
  });
});
