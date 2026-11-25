import { BUILTIN_CATALOGUE, exportLibraryToJson, parseCustomLibrary } from '@skaitch/core/data/elementCatalogue';
import { expect, it } from 'vitest';
import { furniturePlacement } from '@skaitch/core/lib/furniturePlacement';
import type { ItemsMap } from '@skaitch/core/types/ifc';
import type { ElementDef } from '@skaitch/core/data/elementCatalogue';
const items = {
  a: { id: 'a', type: 'Marker', name: 'A', parentId: 's', geom: { x: 10, y: 20 } },
  b: { id: 'b', type: 'Marker', name: 'B', parentId: 's', geom: { x: 11, y: 30 } },
} as unknown as ItemsMap;
const catalogue: ElementDef[] = [{ id: 'desk', type: 'Furniture', category: 'Office', labelFr: 'Bureau', labelEn: 'Desk', defaults: { width: 2, depth: 1, height: 0.75 } }];
it('places a catalogue model by its centre with a world offset and faces a marker', () => {
  const patch = furniturePlacement({ catalogue_id: 'desk', point: 'A', anchor: 'center', offset: [1, 0], facing_point: 'B' }, items, 's', catalogue);
  expect(patch.geom).toMatchObject({ x: 10, y: 19.5, w: 2, d: 1, h: 0.75, rotation: Math.PI / 2 });
  expect(patch.model).toBe('desk');
});
it('preserves current placement on model change and converts arrays but never world markers or offsets', () => {
  const current = { name: 'Custom', model: 'chair', geom: { x: 3, y: 4, w: 1, d: 1, h: 1, rotation: Math.PI } };
  expect(furniturePlacement({ catalogue_id: 'desk' }, items, 's', catalogue, current).geom).toMatchObject({ x: 3, y: 4, rotation: Math.PI, w: 2 });
  const convert = ([x, y]: [number, number]): [number, number] => [x * 2, y * 2];
  expect(furniturePlacement({ point: [2, 3], offset: [1, 0] }, items, 's', catalogue, undefined, convert).geom).toMatchObject({ x: 5, y: 6 });
  expect(furniturePlacement({ point: 'A' }, items, 's', catalogue, undefined, convert).geom.x).toBe(10);
});
it('rejects invalid or ambiguous references and conflicting orientation before mutation', () => {
  for (const args of [{ point: 'missing' }, { point: [0, NaN] }, { point: [0, 0], width: -1 }, { point: [0, 0], catalogue_id: 'bad' }, { point: [0, 0], rotation: 1, facing_point: 'B' }, { point: [0, 0], anchor: 'center', facing_point: [0, 0] }]) {
    expect(() => furniturePlacement(args, items, 's', catalogue)).toThrow();
  }
  expect(() => furniturePlacement({ point: 'A' }, items, 'other', catalogue)).toThrow();
  const ambiguous = { ...items, c: { ...items.a, id: 'c' } };
  expect(() => furniturePlacement({ point: 'A' }, ambiguous, 's', catalogue)).toThrow();
});

it('places the WC back against a wall and points its bowl into the room', async () => {
  const { BUILTIN_CATALOGUE } = await import('@skaitch/core/data/elementCatalogue');
  const patch = furniturePlacement({ catalogue_id: 'sdb-wc', point: [2, 3], anchor: 'back', facing_point: [2, 0] }, {}, 's', BUILTIN_CATALOGUE);
  expect(patch.geom.rotation).toBeCloseTo(0);
  expect(patch.geom.x + patch.geom.w / 2).toBeCloseTo(2);
  expect(patch.geom.y + patch.geom.d).toBeCloseTo(3);
  const east = furniturePlacement({ catalogue_id: 'sdb-wc', point: [2, 3], anchor: 'back', facing_point: [5, 3] }, {}, 's', BUILTIN_CATALOGUE);
  expect(east.geom.rotation).toBeCloseTo(Math.PI / 2);
  expect(east.geom.x + east.geom.w / 2).toBeCloseTo(2 + east.geom.d / 2);
  expect(east.geom.y + east.geom.d / 2).toBeCloseTo(3);
});

it.each(['chambre-lit-double', 'chambre-lit-simple', 'chambre-lit-king', 'enfant-lit-cabane'])('places %s with the headboard against the wall and feet facing the room', id => {
  for (const [target, rotation] of [[[5, 3], Math.PI / 2], [[2, 0], 0], [[-1, 3], -Math.PI / 2], [[2, 6], Math.PI]] as const) {
    const { geom } = furniturePlacement({ catalogue_id: id, point: [2, 3], anchor: 'back', facing_point: [...target] }, {}, 's', BUILTIN_CATALOGUE);
    expect(Math.cos(geom.rotation)).toBeCloseTo(Math.cos(rotation));
    expect(Math.sin(geom.rotation)).toBeCloseTo(Math.sin(rotation));
    const front = geom.rotation - Math.PI / 2;
    expect(geom.x + geom.w / 2 - Math.cos(front) * geom.d / 2).toBeCloseTo(2);
    expect(geom.y + geom.d / 2 - Math.sin(front) * geom.d / 2).toBeCloseTo(3);
  }
});


it('documents orientation for every built-in furniture model and retains it through library export/import', () => {
  const furniture = BUILTIN_CATALOGUE.filter(d => d.type === 'Furniture');
  const imported = parseCustomLibrary(exportLibraryToJson(furniture));
  expect(imported).toHaveLength(furniture.length);
  for (const [i, def] of furniture.entries()) {
    expect(Number.isFinite(def.frontAngle), def.id).toBe(true);
    expect(def.frontDescription?.length, def.id).toBeGreaterThan(20);
    expect(imported[i].frontAngle).toBe(def.frontAngle);
    expect(imported[i].frontDescription).toBe(def.frontDescription);
  }
  expect(parseCustomLibrary(exportLibraryToJson([{ ...furniture[0], frontAngle: NaN }]))).toEqual([]);
});

it.each(['cuisine-meuble-bas', 'cuisine-evier', 'dressing-armoire', 'electro-refri', 'sdb-vasque', 'meuble-canape', 'bureau-chair', 'bureau-desk', 'meuble-chaise', 'meuble-tv', 'elec-radiateur'])('orients the useful front of %s toward its target on creation and update', id => {
  const def = BUILTIN_CATALOGUE.find(d => d.id === id)!;
  expect(def.frontAngle).toBe(-Math.PI / 2);
  for (const target of [[5, 3], [2, 0], [-1, 3], [2, 6], [5, 6]]) {
    const args = { catalogue_id: id, point: [2, 3], anchor: 'back', facing_point: target };
    const created = furniturePlacement(args, {}, 's', BUILTIN_CATALOGUE);
    const { geom } = created;
    const front = geom.rotation + def.frontAngle!;
    const cx = geom.x + geom.w / 2, cy = geom.y + geom.d / 2;
    expect(cx - Math.cos(front) * geom.d / 2).toBeCloseTo(2);
    expect(cy - Math.sin(front) * geom.d / 2).toBeCloseTo(3);
    expect((target[0] - cx) * Math.sin(front) - (target[1] - cy) * Math.cos(front)).toBeCloseTo(0);
    const updated = furniturePlacement({ point: [2, 3], anchor: 'back', facing_point: target }, {}, 's', BUILTIN_CATALOGUE, created);
    expect(updated.geom).toEqual(geom);
  }
});

it.each([Math.PI / 2, Math.PI, Math.PI / 4])('anchors a custom front at angle %s on the footprint boundary', frontAngle => {
  const custom = [{ ...catalogue[0], frontAngle }];
  const { geom } = furniturePlacement({ catalogue_id: 'desk', point: [0, 0], anchor: 'back', facing_point: [5, 0] }, {}, 's', custom);
  const cx = geom.x + geom.w / 2, cy = geom.y + geom.d / 2;
  expect(cy).toBeCloseTo(0);
  const localX = -cx * Math.cos(geom.rotation), localY = cx * Math.sin(geom.rotation);
  expect(Math.max(Math.abs(localX) / (geom.w / 2), Math.abs(localY) / (geom.d / 2))).toBeCloseTo(1);
});

it('inherits the orientation of a reused built-in icon for legacy custom models', () => {
  const custom = [{ ...catalogue[0], iconKey: 'meuble-canape' }];
  const { geom } = furniturePlacement({ catalogue_id: 'desk', point: [0, 0], anchor: 'back', facing_point: [0, -5] }, {}, 's', custom);
  expect(geom.rotation).toBeCloseTo(0);
  expect(geom.y + geom.d).toBeCloseTo(0);
});
