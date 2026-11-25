import { describe, expect, it } from 'vitest';
import { buildEmpty } from '@skaitch/core/data/starter';
import { applyAssociation, proposeAssociation } from '@skaitch/core/survey/association';
import { reconstructStorey } from '@skaitch/core/survey/reconstruct';
import type { Survey } from '@skaitch/core/survey/surveyFile';

const room = (id: string) => ({
  id, name: id, geometryStatus: 'assumed' as const, polygon: [[0, 0], [3, 0], [3, 2], [0, 2]] as [number, number][],
  walls: [3, 2, 3, 2].map((length_m, i) => ({ id: `${id}_w${i}`, from: i, to: (i + 1) % 4, length_m, source: 'laser' as const, locked: true, thickness_m: 0.2, thicknessStatus: 'estimated' as const })),
});
const survey: Survey = {
  id: 'srv_maison', name: 'Maison', createdAt: '', updatedAt: '',
  levels: [{ id: 'rdc', name: 'RDC', rooms: [room('salon')] }, { id: 'r1', name: 'R+1', rooms: [room('chambre')] }],
};

function project() {
  const items = buildEmpty();
  const storey = Object.values(items).find(i => i.type === 'Storey')!;
  return { items, storey, buildingId: storey.parentId! };
}

describe('level association', () => {
  it('proposes the current storey for the first level and new storeys for the others', () => {
    const { items, storey } = project();
    expect(proposeAssociation(items, survey, storey.id)).toEqual([
      { levelId: 'rdc', target: storey.id }, { levelId: 'r1', target: 'new' },
    ]);
  });

  it('matches levels to storeys of the same name first', () => {
    const { items, storey } = project();
    (items[storey.id] as any).name = 'r+1';
    expect(proposeAssociation(items, survey, storey.id)).toEqual([
      { levelId: 'rdc', target: 'new' }, { levelId: 'r1', target: storey.id },
    ]);
  });

  it('attaches levels, creates storeys above the building, and each storey reconstructs its own level', () => {
    const { items, storey, buildingId } = project();
    const top = Math.max(...Object.values(items).filter(i => i.type === 'Storey').map((s: any) => s.geom.elevation));
    const r = applyAssociation(items, survey, buildingId, proposeAssociation(items, survey, storey.id), 1000);
    const [first, created] = r.storeyIds.map(id => r.items[id] as any);
    expect(first.id).toBe(storey.id);
    expect(first.survey.level.id).toBe('rdc');
    expect(created).toMatchObject({ type: 'Storey', name: 'R+1', parentId: buildingId, survey: { level: { id: 'r1' } } });
    expect(created.geom.elevation).toBe(top + 3);
    const rooms = reconstructStorey(reconstructStorey(r.items, first.id).items, created.id).items;
    const names = (sid: string) => Object.values(rooms).filter((i: any) => i.surveyRef && i.parentId === sid && i.type === 'Room').map(i => i.name);
    expect(names(first.id)).toEqual(['salon']);
    expect(names(created.id)).toEqual(['chambre']);
  });

  it('leaves out levels with no target and refuses two levels on one storey', () => {
    const { items, storey, buildingId } = project();
    const r = applyAssociation(items, survey, buildingId, [{ levelId: 'rdc', target: null }, { levelId: 'r1', target: storey.id }]);
    expect(r.storeyIds).toEqual([storey.id]);
    expect((r.items[storey.id] as any).survey.level.id).toBe('r1');
    expect(() => applyAssociation(items, survey, buildingId, [{ levelId: 'rdc', target: storey.id }, { levelId: 'r1', target: storey.id }]))
      .toThrow(/même étage/);
  });
});
