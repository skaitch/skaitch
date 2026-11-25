import { describe, expect, it } from 'vitest';
import { buildEmpty } from '@skaitch/core/data/starter';
import { reconstructStorey, surveyRefOf, surveyReliability } from '@skaitch/core/survey/reconstruct';
import type { StoreySurvey, SurveyRoom } from '@skaitch/core/survey/surveyFile';
import type { ItemsMap } from '@skaitch/core/types/ifc';

function room(over: Partial<SurveyRoom> = {}, wall: Partial<SurveyRoom['walls'][number]> = {}): SurveyRoom {
  return {
    id: 'r1', name: 'Salon', geometryStatus: 'resolved', ceilingHeight_m: 2.5,
    polygon: [[0, 0], [4, 0], [4, 3], [0, 3]],
    walls: [4, 3, 4, 3].map((length_m, i) => ({
      id: `w${i + 1}`, from: i, to: (i + 1) % 4, length_m, source: 'laser' as const, locked: true,
      thickness_m: 0.2, thicknessStatus: 'measured' as const, ...wall,
    })),
    openings: [
      { id: 'd1', wallId: 'w1', kind: 'door', operation: 'single_swing', offset_m: 0.5, width_m: 0.9, height_m: 2.1, hinge: 'start', swing: 'in' },
      { id: 'f1', wallId: 'w3', kind: 'window', operation: 'fixed', offset_m: 1, width_m: 1, height_m: 1.2, hinge: 'start', swing: 'in' },
    ],
    ...over,
  };
}

function build(r: SurveyRoom) {
  const items = buildEmpty();
  const storey = Object.values(items).find(i => i.type === 'Storey')!;
  (storey as any).survey = { surveyId: 's', surveyName: 'S', importedAt: '2026-11-22T00:00:00Z', level: { id: 'l', name: 'RDC', rooms: [r] } } satisfies StoreySurvey;
  return reconstructStorey(items, storey.id).items;
}

const of = (items: ItemsMap, type: string, pick: (ref: any) => boolean = () => true) =>
  Object.values(items).filter(i => i.type === type && surveyRefOf(i) && pick(surveyRefOf(i))).map(surveyReliability);

describe('survey reliability (ADR 0016)', () => {
  it('marks a fully measured room, its walls and its door as measured', () => {
    const items = build(room());
    expect(of(items, 'Room')).toEqual(['measured']);
    expect(new Set(of(items, 'Wall'))).toEqual(new Set(['measured']));
    expect(of(items, 'Door')).toEqual(['measured']);
    expect(new Set(of(items, 'Dimension'))).toEqual(new Set(['measured']));
  });

  it('a window without a typed sill relies on the default: partly estimated', () => {
    expect(of(build(room()), 'Window')).toEqual(['partial']);
  });

  it('an estimated thickness or source makes walls partly estimated', () => {
    const items = build(room({}, { thicknessStatus: 'estimated' }));
    expect(new Set(of(items, 'Wall'))).toEqual(new Set(['partial']));
    expect(of(items, 'Room')).toEqual(['partial']);
    expect(new Set(of(build(room({}, { source: 'estimated' })), 'Wall'))).toEqual(new Set(['partial']));
  });

  it('the default ceiling height is never measured', () => {
    expect(of(build(room({ ceilingHeight_m: undefined })), 'Room')).toEqual(['partial']);
  });

  it('assumed geometry wins over everything but a hand edit', () => {
    const items = build(room({ geometryStatus: 'assumed' }));
    expect(new Set([...of(items, 'Room'), ...of(items, 'Wall'), ...of(items, 'Door')])).toEqual(new Set(['assumed']));
  });

  it('a wall changed by hand becomes "modified"', () => {
    const items = build(room());
    const wall = Object.values(items).find(i => i.type === 'Wall')! as any;
    expect(surveyReliability({ ...wall, geom: { ...wall.geom, thickness: 0.3 } })).toBe('modified');
    // A property edit is the user's and leaves the reliability alone.
    expect(surveyReliability({ ...wall, Material: 'Brique' })).toBe('measured');
  });

  it('elements that do not come from a survey have no reliability', () => {
    expect(Object.values(buildEmpty()).map(surveyReliability).every(r => r === undefined)).toBe(true);
  });
});

describe('Pset_skAItchSurvey (ADR 0016)', () => {
  it('is exported for survey elements and read back at IFC import', async () => {
    const { exportIFC } = await import('@skaitch/core/bim/exportIFC');
    const { importIFCBuffer } = await import('@skaitch/core/bim/importIFC');
    const items = build(room());
    const ifc = exportIFC(items);
    expect(ifc).toContain("'Pset_skAItchSurvey'");
    expect(ifc).toContain("IFCLABEL('Measured')");
    expect(ifc).toContain("IFCLABEL('PartlyEstimated')"); // the window without a typed sill
    const { items: back } = await importIFCBuffer(new TextEncoder().encode(ifc).buffer as ArrayBuffer);
    const walls = Object.values(back).filter(i => i.type === 'Wall');
    expect(walls.length).toBeGreaterThan(0);
    expect(walls.map(surveyReliability)).toEqual(walls.map(() => 'measured'));
    expect((walls[0] as any).SurveyName).toBe('S');
  });

  it('is not written for elements drawn in skAItch', async () => {
    const { exportIFC } = await import('@skaitch/core/bim/exportIFC');
    expect(exportIFC(buildEmpty())).not.toContain('Pset_skAItchSurvey');
  });
});

describe('a different survey on a storey', () => {
  function twice() {
    const items = buildEmpty();
    const storey = Object.values(items).find(i => i.type === 'Storey')! as any;
    const attach = (surveyId: string, its: ItemsMap) => ({ ...its, [storey.id]: { ...its[storey.id], survey: { surveyId, surveyName: surveyId, importedAt: '', level: { id: 'l', name: 'RDC', rooms: [room()] } } } });
    const first = reconstructStorey(attach('old', items), storey.id).items;
    return { storeyId: storey.id as string, items: attach('new', first) };
  }
  const walls = (items: ItemsMap) => Object.values(items).filter(i => i.type === 'Wall' && surveyRefOf(i));

  it('asks before touching the elements of the previous survey, and applies nothing meanwhile', () => {
    const { items, storeyId } = twice();
    const r = reconstructStorey(items, storeyId);
    expect(r.conflicts.length).toBeGreaterThan(0);
    expect(r.conflicts.every(c => c.previousSurvey && !c.previousSurvey.modified)).toBe(true);
    expect(r.items).toBe(items);
  });

  it('"overwrite" deletes them: no duplicate walls', () => {
    const { items, storeyId } = twice();
    const ask = reconstructStorey(items, storeyId);
    const r = reconstructStorey(items, storeyId, Date.now(), Object.fromEntries(ask.conflicts.map(c => [c.id, 'overwrite'])));
    expect(walls(r.items)).toHaveLength(4);
    expect(walls(r.items).every(w => surveyRefOf(w)!.surveyId === 'new')).toBe(true);
  });

  it('"keep" turns them into ordinary elements, not asked again', () => {
    const { items, storeyId } = twice();
    const ask = reconstructStorey(items, storeyId);
    const r = reconstructStorey(items, storeyId, Date.now(), Object.fromEntries(ask.conflicts.map(c => [c.id, 'keep'])));
    expect(walls(r.items)).toHaveLength(4);
    expect(Object.values(r.items).filter(i => i.type === 'Wall')).toHaveLength(8);
    expect(reconstructStorey(r.items, storeyId).conflicts).toHaveLength(0);
  });
});
