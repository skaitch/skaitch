import { expect, it } from 'vitest';
import { computeMcpModel } from '@skaitch/core/bim/mcpModel';
import { buildStarter } from '@skaitch/core/data/starter';

it('computes wall creation on the server without mutating the input model', () => {
  const items = buildStarter();
  const before = JSON.stringify(items);
  const storey = Object.values(items).find(i => i.type === 'Storey')!;
  const response = computeMcpModel('create_wall', { start_point: [0, 0], end_point: [4, 0] }, items, storey.id, []);
  expect(response.result).toMatchObject({ success: true });
  expect(response.changes).toContainEqual(expect.objectContaining({ kind: 'add', item: expect.objectContaining({ type: 'Wall', parentId: storey.id, geom: expect.objectContaining({ x2: 4 }) }) }));
  expect(JSON.stringify(items)).toBe(before);
});

it('returns no changes for rejected geometry and refuses unsupported tools', () => {
  expect(computeMcpModel('create_wall', { start_point: [0, 0], end_point: [0, 0] }, {}, '', []).changes).toEqual([]);
  expect(() => computeMcpModel('generate_visualization', {}, {}, '', [])).toThrow('Unsupported');
});

it('uses persisted floorplan calibration for pixel coordinates', () => {
  const items = buildStarter();
  const storey = Object.values(items).find(i => i.type === 'Storey')!;
  (storey as any).geom.plan = { x: 10, y: 20, scale: 0.1, w: 100, h: 100 };
  const response = computeMcpModel('create_marker', { point: [20, 30], coordinates_in_pixels: true }, items, storey.id, []);
  expect(response.changes[0]).toMatchObject({ kind: 'add', item: { geom: { x: 12, y: 27 } } });
});

const roofGeometry = { polygon: [[0, 0], [6, 0], [6, 4], [0, 4]], roofType: 'flat', elevation: 3, thickness: 0.25 };
function roofModel(): any {
  const wall = { id: 'wall', type: 'Wall', ifcType: 'IfcWall', parentId: 's', geom: { x1: 1, y1: 1, x2: 5, y2: 1, thickness: 0.2, height: 2.5 } };
  return {
    s: { id: 's', type: 'Storey', geom: { elevation: 0 } }, wall,
    outside: { ...wall, id: 'outside', geom: { ...wall.geom, x1: 20, x2: 25 } },
    upstairs: { ...wall, id: 'upstairs', parentId: 't' },
    curtain: { ...wall, id: 'curtain', ifcType: 'IfcCurtainWall' },
    blocked: { ...wall, id: 'blocked' },
    window: { id: 'window', type: 'Window', geom: { wallId: 'blocked', t: 0.5, width: 1, height: 3, sillHeight: 0.9 } },
  };
}
it('optionally attaches covered walls to a new roof, preserving openings and other storeys', () => {
  const items = roofModel(), before = structuredClone(items);
  for (const attach_walls of [undefined, false]) {
    const unchanged = computeMcpModel('create_roof', { geometry: roofGeometry, attach_walls }, items, 's', []);
    expect(unchanged.changes).toHaveLength(1);
  }
  const attached = computeMcpModel('create_roof', { geometry: roofGeometry, attach_walls: true }, items, 's', []);
  expect(attached.result).toMatchObject({ success: true, attached_wall_ids: ['wall'] });
  const roofId = (attached.result as any).id;
  expect(attached.changes).toContainEqual({ kind: 'update', id: 'wall', patch: { geom: { ...items.wall.geom, roofId, roofIds: [roofId], _edited: true, _shapeEdited: true } } });
  expect(attached.changes).toHaveLength(2);
  expect(items).toEqual(before);
});
it('attaches walls using updated roof geometry and accepts a GlobalId', () => {
  const items = roofModel();
  items.roof = { id: 'roof', GlobalId: 'global-roof', type: 'Roof', parentId: 's', geom: { ...roofGeometry, polygon: [[20, 0], [26, 0], [26, 4], [20, 4]] } };
  const response = computeMcpModel('update_element', { id: 'global-roof', geometry: roofGeometry, attach_walls: true }, items, 's', []);
  expect(response.result).toMatchObject({ success: true, attached_wall_ids: ['wall'] });
  expect(response.changes).toContainEqual(expect.objectContaining({ kind: 'update', id: 'wall', patch: { geom: expect.objectContaining({ roofId: 'roof' }) } }));
  expect(computeMcpModel('update_element', { id: 'wall', attach_walls: true }, items, 's', []).changes).toEqual([]);
  expect(computeMcpModel('create_roof', { geometry: roofGeometry, attach_walls: 'true' }, items, 's', []).changes).toEqual([]);
  expect(computeMcpModel('create_roof', { geometry: { ...roofGeometry, pitch: -1 }, attach_walls: true }, items, 's', []).changes).toEqual([]);
});
