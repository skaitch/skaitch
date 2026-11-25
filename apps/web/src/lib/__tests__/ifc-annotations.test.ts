import { expect, it } from 'vitest';
import { buildEmpty, buildStarter, guid } from '@skaitch/core/data/starter';
import { exportIFC } from '@skaitch/core/bim/exportIFC';
import { importIFCBuffer } from '@skaitch/core/bim/importIFC';
import { patchIFC } from '@skaitch/core/bim/patchIFC';
import type { IfcEntity, ItemsMap } from '@skaitch/core/types/ifc';

function annotate(items: ItemsMap, dx = 0, dy = 0): ItemsMap {
  const storeyId = Object.values(items).find(item => item.type === 'Storey')!.id;
  const add = (item: Record<string, unknown>) => { items[item.id as string] = { ifcType: 'IfcAnnotation', GlobalId: guid(item.id as string), parentId: storeyId, Name: item.name, ...item } as unknown as IfcEntity; };
  add({ id: 'dim_a', type: 'Dimension', name: 'Cote façade', geom: { x1: 1 + dx, y1: 2 + dy, x2: 6.5 + dx, y2: 2 + dy } });
  add({ id: 'm_a', type: 'Marker', name: 'Jalon 1', description: 'Regard EU', geom: { x: 3 + dx, y: 4 + dy } });
  add({ id: 'sec_a', type: 'Section', name: 'Coupe A', geom: { x1: 2 + dx, y1: -1 - dy, x2: 3 + dx, y2: -1 - dy, origin: [2 + dx, 1.2, 1 - dy], normal: [0, 0, 1], depth: 8 } });
  return items;
}

async function load(text: string) {
  const bytes = new TextEncoder().encode(text);
  const silent = [console.log, console.warn];
  console.log = console.warn = () => {};
  try { return await importIFCBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer); }
  finally { [console.log, console.warn] = silent; }
}

const byName = (items: ItemsMap, name: string) => Object.values(items).find(item => item.name === name) as any;

function expectAnnotations(items: ItemsMap, offset: [number, number] = [0, 0], dx = 0, dy = 0) {
  const [ox, oy] = offset;
  const dim = byName(items, 'Cote façade'), marker = byName(items, 'Jalon 1'), section = byName(items, 'Coupe A');
  expect(dim?.type).toBe('Dimension');
  expect(items[dim.parentId]?.type).toBe('Storey');
  expect([dim.geom.x1 + ox, dim.geom.y1 + oy, dim.geom.x2 + ox, dim.geom.y2 + oy]).toEqual([1 + dx, 2 + dy, 6.5 + dx, 2 + dy].map(v => expect.closeTo(v, 6)));
  expect(marker?.type).toBe('Marker');
  expect(marker.description).toBe('Regard EU');
  expect([marker.geom.x + ox, marker.geom.y + oy]).toEqual([3 + dx, 4 + dy].map(v => expect.closeTo(v, 6)));
  expect(section?.type).toBe('Section');
  expect(section.geom.origin[0] + ox).toBeCloseTo(2 + dx, 6);
  expect(section.geom.origin[1]).toBeCloseTo(1.2, 6);
  expect(section.geom.origin[2] - oy).toBeCloseTo(1 - dy, 6);
  expect(section.geom.normal).toEqual([0, 0, 1]);
  expect(section.geom.depth).toBe(8);
}

it('exports dimensions, markers and sections as IfcAnnotation and re-imports them', async () => {
  const text = exportIFC(annotate(buildEmpty()));
  expect(text.match(/IFCANNOTATION\(/g)).toHaveLength(3);
  const imported = await load(text);
  expectAnnotations(imported.items, imported.centerOffset ?? [0, 0]);
  // Not duplicated as generic elements.
  expect(Object.values(imported.items).filter(item => item.ifcType === 'IfcAnnotation')).toHaveLength(3);
});

it('keeps annotations of a centred project through export and import', async () => {
  // Far from the origin: the importer centres the model and must move annotations with it.
  const items = buildStarter();
  for (const item of Object.values(items) as any[]) {
    if (item.type === 'Wall') { item.geom.x1 += 100; item.geom.x2 += 100; item.geom.y1 += 50; item.geom.y2 += 50; }
    if (item.type === 'Room' || item.type === 'Slab') item.geom.polygon = item.geom.polygon.map(([x, y]: number[]) => [x + 100, y + 50]);
    if (item.type === 'Furniture') { item.geom.x += 100; item.geom.y += 50; }
  }
  const imported = await load(exportIFC(annotate(items, 100, 50)));
  expect(imported.centerOffset).toBeDefined();
  expectAnnotations(imported.items, imported.centerOffset!, 100, 50);
});

it('patches annotations into an original IFC: adds, moves and removes them', async () => {
  const first = await load(exportIFC(buildStarter()));
  const offset = first.centerOffset ?? [0, 0];
  // Added in the editor, in centred coordinates.
  const withNew = annotate({ ...first.items }, -offset[0], -offset[1]);
  const patched = await patchIFC(withNew, new TextEncoder().encode(exportIFC(buildStarter())).buffer, first.centerOffset);
  const second = await load(patched);
  expectAnnotations(second.items, second.centerOffset ?? [0, 0]);

  // Patch the patched file: move the dimension, delete the marker.
  const original = new TextEncoder().encode(patched).buffer;
  const items = { ...second.items };
  const dim = byName(items, 'Cote façade'), marker = byName(items, 'Jalon 1');
  items[dim.id] = { ...dim, geom: { ...dim.geom, x2: dim.geom.x2 + 1 } };
  delete items[marker.id];
  const third = await load(await patchIFC(items, original, second.centerOffset));
  const [ox, oy] = third.centerOffset ?? [0, 0];
  const moved = byName(third.items, 'Cote façade');
  expect(moved.geom.x2 + ox).toBeCloseTo(7.5, 6);
  expect(moved.geom.y2 + oy).toBeCloseTo(2, 6);
  expect(byName(third.items, 'Jalon 1')).toBeUndefined();
  expect(Object.values(third.items).filter(item => item.type === 'Dimension')).toHaveLength(1);
  expect(byName(third.items, 'Coupe A')?.type).toBe('Section');
});
