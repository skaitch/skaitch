import { describe, expect, it } from 'vitest';
import { buildEmpty } from '@skaitch/core/data/starter';
import { reconstructStorey, surveyRefOf } from '@skaitch/core/survey/reconstruct';
import { wallLinks, type StoreySurvey } from '@skaitch/core/survey/surveyFile';
import type { ItemsMap } from '@skaitch/core/types/ifc';

function salon(width = 4, depth = 3, thickness = [0.2, 0.2, 0.2, 0.2]): StoreySurvey {
  return {
    surveyId: 'srv_01', surveyName: 'Appartement', importedAt: '2026-11-17T10:00:00.000Z',
    level: {
      id: 'rdc', name: 'RDC', rooms: [{
        id: 'room_salon', name: 'Salon', geometryStatus: 'assumed', ceilingHeight_m: 2.5,
        polygon: [[0, 0], [width, 0], [width, depth], [0, depth]],
        walls: [width, depth, width, depth].map((length_m, i) => ({
          id: `wall_${i + 1}`, from: i, to: (i + 1) % 4, length_m, source: 'laser' as const, locked: true,
          thickness_m: thickness[i], thicknessStatus: 'estimated' as const,
        })),
      }],
    },
  };
}

function storeyWith(survey: StoreySurvey) {
  const items = buildEmpty();
  const storey = Object.values(items).find(i => i.type === 'Storey')!;
  (storey as any).survey = survey;
  return { items, storeyId: storey.id };
}

const fromSurvey = (items: ItemsMap) => Object.values(items).filter(i => surveyRefOf(i));
const walls = (items: ItemsMap) => fromSurvey(items).filter(i => i.type === 'Wall') as any[];

describe('reconstruction', () => {
  it('creates four walls on the face-to-axis offset and one space on the inner faces', () => {
    const { items, storeyId } = storeyWith(salon(4, 3, [0.3, 0.1, 0.1, 0.1]));
    const result = reconstructStorey(items, storeyId);
    // 4 walls, 1 space and the 4 measured cotes.
    expect(result.created).toHaveLength(9);
    const cotes = fromSurvey(result.items).filter(i => i.type === 'Dimension') as any[];
    expect(cotes.map(c => c.geom.value).sort()).toEqual([3, 3, 4, 4]);
    // Inside the room, 30 cm from the bottom face.
    expect(cotes.find(c => c.surveyRef.wallId === 'wall_1').geom.y1).toBeCloseTo(0.3);
    const bottom = walls(result.items).find(w => w.surveyRef.wallId === 'wall_1');
    // Bottom wall 0.30 thick: axis 0.15 below the inner face, ends on the side walls' axes (0.05 out).
    expect(bottom.geom.y1).toBeCloseTo(-0.15);
    expect(bottom.geom.x1).toBeCloseTo(-0.05);
    expect(bottom.geom.x2).toBeCloseTo(4.05);
    expect(bottom.geom.thickness).toBe(0.3);
    // Wall inner face length = axis length − half thickness of each neighbour = the measured 4.00.
    expect(Math.hypot(bottom.geom.x2 - bottom.geom.x1, bottom.geom.y2 - bottom.geom.y1) - 0.05 - 0.05).toBeCloseTo(4);
    const space = fromSurvey(result.items).find(i => i.type === 'Room') as any;
    expect(space.geom.polygon).toEqual([[0, 0], [4, 0], [4, 3], [0, 3]]);
    expect(space.geom.height).toBe(2.5);
    expect(bottom.geom.height).toBe(2.8);
  });

  it('closes the corners: consecutive wall axes share their endpoints', () => {
    const { items, storeyId } = storeyWith(salon(4, 3, [0.3, 0.1, 0.2, 0.1]));
    const ws = walls(reconstructStorey(items, storeyId).items).sort((a, b) => a.surveyRef.wallId.localeCompare(b.surveyRef.wallId));
    for (let i = 0; i < 4; i++) {
      const a = ws[i].geom, b = ws[(i + 1) % 4].geom;
      expect(a.x2).toBeCloseTo(b.x1); expect(a.y2).toBeCloseTo(b.y1);
    }
  });

  it('updates the same elements on a second reconstruction', () => {
    const { items, storeyId } = storeyWith(salon());
    const first = reconstructStorey(items, storeyId);
    const ids = fromSurvey(first.items).map(i => i.id).sort();
    (first.items[storeyId] as any).survey = salon(5, 3);
    const second = reconstructStorey(first.items, storeyId, Date.now() + 1);
    expect(second.created).toEqual([]);
    // The left wall and its cote do not move when the room gets wider; everything else is updated in place.
    expect(second.updated).toHaveLength(7);
    expect(fromSurvey(second.items).map(i => i.id).sort()).toEqual(ids);
    expect(walls(second.items).find(w => w.surveyRef.wallId === 'wall_1').geom.x2).toBeCloseTo(5.1);
  });

  it('never touches elements that do not come from the survey', () => {
    const { items, storeyId } = storeyWith(salon());
    const manual = { id: 'w_manual', type: 'Wall', parentId: storeyId, geom: { x1: 10, y1: 0, x2: 12, y2: 0, thickness: 0.2, height: 2.8 } } as any;
    items[manual.id] = manual;
    const result = reconstructStorey(items, storeyId);
    expect(result.items.w_manual).toBe(manual);
    for (const id of Object.keys(items)) if (id !== storeyId) expect(result.items[id]).toBe(items[id]);
  });

  it('removes elements whose room left the survey', () => {
    const { items, storeyId } = storeyWith(salon());
    const first = reconstructStorey(items, storeyId);
    const s = salon();
    s.level.rooms = [];
    (first.items[storeyId] as any).survey = s;
    const second = reconstructStorey(first.items, storeyId);
    expect(second.deleted).toHaveLength(9);
    expect(fromSurvey(second.items)).toEqual([]);
  });

  it('reports a hand-modified element as a conflict and applies nothing until resolved', () => {
    const { items, storeyId } = storeyWith(salon());
    const first = reconstructStorey(items, storeyId);
    const wall = walls(first.items).find(w => w.surveyRef.wallId === 'wall_1');
    first.items[wall.id] = { ...wall, geom: { ...wall.geom, thickness: 0.35 } } as any;
    (first.items[storeyId] as any).survey = salon(5, 3);

    const blocked = reconstructStorey(first.items, storeyId);
    expect(blocked.conflicts).toEqual([{ id: wall.id, name: wall.name, action: 'update' }]);
    expect(blocked.items).toBe(first.items);

    const kept = reconstructStorey(first.items, storeyId, 1, { [wall.id]: 'keep' });
    expect(kept.conflicts).toEqual([]);
    expect(kept.kept).toEqual([wall.id]);
    expect((kept.items[wall.id] as any).geom.thickness).toBe(0.35);
    expect(kept.updated).not.toContain(wall.id);

    const overwritten = reconstructStorey(first.items, storeyId, 1, { [wall.id]: 'overwrite' });
    expect((overwritten.items[wall.id] as any).geom.thickness).toBe(0.2);
    expect((overwritten.items[wall.id] as any).geom.x2).toBeCloseTo(5.1);
    // Stamped again: the next reconstruction sees no conflict.
    expect(reconstructStorey(overwritten.items, storeyId).conflicts).toEqual([]);
  });

  it('ignores edits to fields the survey does not own', () => {
    const { items, storeyId } = storeyWith(salon());
    const first = reconstructStorey(items, storeyId);
    const wall = walls(first.items)[0];
    first.items[wall.id] = { ...wall, Material: 'Béton', LoadBearing: true } as any;
    const second = reconstructStorey(first.items, storeyId);
    expect(second.conflicts).toEqual([]);
    expect((second.items[wall.id] as any).Material).toBe('Béton');
  });

  it('asks before deleting a hand-modified element whose room left the survey', () => {
    const { items, storeyId } = storeyWith(salon());
    const first = reconstructStorey(items, storeyId);
    const space = fromSurvey(first.items).find(i => i.type === 'Room') as any;
    first.items[space.id] = { ...space, name: 'Séjour' };
    const s = salon(); s.level.rooms = [];
    (first.items[storeyId] as any).survey = s;
    const blocked = reconstructStorey(first.items, storeyId);
    expect(blocked.conflicts).toEqual([{ id: space.id, name: 'Séjour', action: 'delete' }]);
    const kept = reconstructStorey(first.items, storeyId, 1, { [space.id]: 'keep' });
    expect(kept.items[space.id]).toBeDefined();
    expect(kept.deleted).toHaveLength(8);
  });
});

describe('opening reconstruction', () => {
  function withOpenings(kind: 'door' | 'window' = 'door', extra: Partial<Record<string, unknown>> = {}) {
    const s = salon(4, 3, [0.3, 0.1, 0.1, 0.1]);
    s.level.rooms[0].openings = [{
      id: 'op_1', wallId: 'wall_1', kind, operation: kind === 'door' ? 'single_swing' : 'double_swing',
      offset_m: 1, width_m: 0.9, height_m: 2.04, hinge: 'end', swing: 'in', ...(kind === 'window' ? { sill_m: 0.9 } : {}), ...extra,
    } as any];
    return storeyWith(s);
  }
  const openings = (items: ItemsMap) => fromSurvey(items).filter(i => i.type === 'Door' || i.type === 'Window') as any[];

  it('hosts the door on the reconstructed wall at the measured face position', () => {
    const { items, storeyId } = withOpenings();
    const r = reconstructStorey(items, storeyId);
    const [door] = openings(r.items);
    const wall = walls(r.items).find(w => w.surveyRef.wallId === 'wall_1');
    expect(door.geom.wallId).toBe(wall.id);
    // Axis starts 0.05 before the inner face (left wall is 0.10 thick): centre at 0.05 + 1 + 0.45 along the axis.
    const len = Math.hypot(wall.geom.x2 - wall.geom.x1, wall.geom.y2 - wall.geom.y1);
    expect(door.geom.t * len).toBeCloseTo(1.5);
    expect(wall.geom.x1 + door.geom.t * (wall.geom.x2 - wall.geom.x1)).toBeCloseTo(1.45);
    expect(door).toMatchObject({ OperationType: 'SINGLE_SWING_RIGHT', geom: { swing: 'right', side: 1, width: 0.9, catalogueId: 'door-single-right' } });
  });

  it('updates the same door, and a door that becomes a window is replaced', () => {
    const { items, storeyId } = withOpenings();
    const first = reconstructStorey(items, storeyId);
    const [door] = openings(first.items);
    const st = first.items[storeyId] as any;
    st.survey.level.rooms[0].openings[0].offset_m = 2;
    const second = reconstructStorey(first.items, storeyId);
    expect(second.updated).toContain(door.id);
    st.survey.level.rooms[0].openings[0] = { ...st.survey.level.rooms[0].openings[0], kind: 'window', operation: 'tilt_turn', sill_m: 1 };
    const third = reconstructStorey(second.items, storeyId);
    expect(third.deleted).toEqual([door.id]);
    expect(openings(third.items)).toEqual([expect.objectContaining({ type: 'Window', OperationType: 'TILT_AND_TURN', geom: expect.objectContaining({ sillHeight: 1 }) })]);
  });
});

import { addAdjacentRoom, addOpening, addRectangleRoom, newSurvey, setWallLength } from '@skaitch/core/survey/edit';
describe('shared wall reconstruction', () => {
  it('builds one wall for a shared pair, keeps the rooms adjacent, and hosts the door once', () => {
    const now = new Date('2026-11-17T10:00:00Z');
    let s = newSurvey('M', now);
    const a = addRectangleRoom(s, s.levels[0].id, 'Salon', 0, 0, 4, 3, now);
    s = setWallLength(a.survey, a.roomId, `${a.roomId}_w1`, 4, 'laser', now);
    const d = addOpening(s, a.roomId, `${a.roomId}_w1`, 'door', 1, now);
    const b = addAdjacentRoom(d.survey, a.roomId, d.openingId, 'Entrée', now);
    const { items, storeyId } = storeyWith({ surveyId: b.survey.id, surveyName: 'M', importedAt: '', level: b.survey.levels[0] });
    const out = reconstructStorey(items, storeyId).items;
    const ws = walls(out);
    expect(ws).toHaveLength(7);
    const shared = ws.filter(w => w.surveyRef.wallId === `${a.roomId}_w1`);
    expect(shared).toHaveLength(1);
    expect(ws.some(w => w.surveyRef.wallId === `${b.roomId}_w1`)).toBe(false);
    const doors = Object.values(out).filter((i: any) => i.type === 'Door') as any[];
    expect(doors).toHaveLength(1);
    expect(doors[0].geom.wallId).toBe(shared[0].id);
    // Door opens into the living room (side 1 of a wall running along the living room's face).
    expect(doors[0].geom.side).toBe(1);
    // The entrance sits right under the living room (0.20 wall between them), not laid out apart.
    const spaces = Object.values(out).filter((i: any) => i.type === 'Room' && i.surveyRef) as any[];
    const ys = (name: string) => spaces.find(sp => sp.name === name).geom.polygon.map((p: number[]) => p[1]);
    expect(Math.min(...ys('Salon')) - Math.max(...ys('Entrée'))).toBeCloseTo(0.2);
    // The entrance's side walls end on the shared wall's axis.
    expect(ws.filter(w => w.surveyRef.roomId === b.roomId).some(w => Math.abs(w.geom.y1 - shared[0].geom.y1) < 1e-9 || Math.abs(w.geom.y2 - shared[0].geom.y1) < 1e-9)).toBe(true);
  });
});

describe('linked faces of unequal length (field survey)', () => {
  // Kitchen and living room as surveyed on site: linked faces measured 4.60 / 4.50 m and 2.90 / 2.60 m.
  const wall = (id: string, from: number, to: number, length_m: number, thickness_m: number, shared?: { roomId: string; wallId: string; offset_m: number }) =>
    ({ id, from, to, length_m, source: 'laser' as const, locked: true, thickness_m, thicknessStatus: 'estimated' as const, ...(shared ? { shared } : {}) });
  const survey: StoreySurvey = {
    surveyId: 'srv_field', surveyName: 'Maison', importedAt: '2026-11-18T10:00:00.000Z',
    level: { id: 'rdc', name: 'RDC', rooms: [
      { id: 'k', name: 'Cuisine', geometryStatus: 'assumed', polygon: [[18.95, 22.6], [23.55, 22.6], [23.55, 25.5], [18.95, 25.5]],
        walls: [wall('k1', 0, 1, 4.6, 0.05, { roomId: 's', wallId: 's1', offset_m: 0 }), wall('k2', 1, 2, 2.9, 0.2), wall('k3', 2, 3, 4.6, 0.2),
          wall('k4', 3, 0, 2.9, 0.05, { roomId: 's', wallId: 's2', offset_m: 0 })] },
      { id: 's', name: 'Salon', geometryStatus: 'assumed', polygon: [[23.45, 22.4], [18.75, 22.4], [18.75, 25.5], [15, 25.5], [14.95, 19.7], [23.45, 19.7]],
        walls: [wall('s1', 0, 1, 4.5, 0.05, { roomId: 'k', wallId: 'k1', offset_m: 0 }), wall('s2', 1, 2, 2.6, 0.05, { roomId: 'k', wallId: 'k4', offset_m: 0.187 }),
          wall('s3', 2, 3, 3.55, 0.2), wall('s4', 3, 4, 5.8, 0.2), wall('s5', 4, 5, 8.05, 0.2), wall('s6', 5, 0, 2.7, 0.2)] },
    ] } as StoreySurvey['level'],
  };

  it('keeps a measured thickness on linked faces, the axis staying between the two rooms', () => {
    const measured = structuredClone(survey);
    for (const r of measured.level.rooms) for (const w of r.walls) if (wallLinks(w).length) w.thicknessStatus = 'measured';
    const { items, storeyId } = storeyWith(measured);
    const ws = walls(reconstructStorey(items, storeyId).items);
    expect(ws).toHaveLength(8);
    const shared = ws.filter(w => w.geom.thickness === 0.05).map(w => w.geom);
    expect(shared).toHaveLength(2);
    // Same axis as with the estimated thickness: midway between the kitchen and the living room.
    expect(shared.some(g => Math.abs(g.y1 - 2.8) < 1e-6 && Math.abs(g.y2 - 2.8) < 1e-6)).toBe(true);
  });

  it('builds one wall where two linked faces overlap', () => {
    const { items, storeyId } = storeyWith(survey);
    const ws = walls(reconstructStorey(items, storeyId).items).map(w => w.geom);
    // No two collinear walls may overlap by more than a corner joint.
    for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
      const [a, b] = [ws[i], ws[j]];
      const d = [a.x2 - a.x1, a.y2 - a.y1], l = Math.hypot(d[0], d[1]), u = [d[0] / l, d[1] / l];
      const off = (x: number, y: number) => Math.abs((x - a.x1) * u[1] - (y - a.y1) * u[0]);
      if (off(b.x1, b.y1) > 0.15 || off(b.x2, b.y2) > 0.15) continue; // not on the same line
      const t = (x: number, y: number) => (x - a.x1) * u[0] + (y - a.y1) * u[1];
      const [lo, hi] = [Math.min(t(b.x1, b.y1), t(b.x2, b.y2)), Math.max(t(b.x1, b.y1), t(b.x2, b.y2))];
      expect(Math.min(hi, l) - Math.max(lo, 0)).toBeLessThan(0.3);
    }
    // Kitchen 4 + living room 6 faces, minus the 2 faces carried by their linked face.
    expect(ws.length).toBe(8);
    // The shared wall takes the 20 cm gap between the two rooms, and the corners join it.
    expect(ws.every(g => Math.abs(g.thickness - 0.2) < 1e-6)).toBe(true);
    // Every wall end meets another wall: at its end (corner) or along it (T junction).
    const onOther = (x: number, y: number, self: any) => ws.some(g => g !== self && (() => {
      const dx = g.x2 - g.x1, dy = g.y2 - g.y1, l2 = dx * dx + dy * dy;
      const t = ((x - g.x1) * dx + (y - g.y1) * dy) / l2;
      return t > -1e-6 && t < 1 + 1e-6 && Math.hypot(g.x1 + dx * t - x, g.y1 + dy * t - y) < 1e-3;
    })());
    expect(ws.filter(g => !onOther(g.x1, g.y1, g) || !onOther(g.x2, g.y2, g))).toEqual([]);
  });
});
