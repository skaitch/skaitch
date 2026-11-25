import { expect, it } from 'vitest';
import { buildEmpty, guid } from '@skaitch/core/data/starter';
import { exportIFC } from '@skaitch/core/bim/exportIFC';
import { importIFCBuffer } from '@skaitch/core/bim/importIFC';
import { patchIFC } from '@skaitch/core/bim/patchIFC';
import type { ItemsMap } from '@skaitch/core/types/ifc';

const toBuffer = (text: string) => { const bytes = new TextEncoder().encode(text); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; };

async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const log = console.log, warn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; }
}

/** An 8 m south wall with an existing door at its centre, exported by skAItch. */
function exportedRoom() {
  const base = buildEmpty();
  for (const id of Object.keys(base)) if (['Wall', 'Door', 'Window', 'Furniture'].includes(base[id].type)) delete base[id];
  const storeyId = Object.values(base).find(item => item.type === 'Storey')!.id;
  (base as any).south = { id: 'south', type: 'Wall', ifcType: 'IfcWall', name: 'south', Name: 'south', GlobalId: guid('south'), parentId: storeyId, PredefinedType: 'STANDARD', geom: { x1: 0, y1: 0, x2: 8, y2: 0, thickness: 0.2, height: 2.7 } };
  (base as any).old_door = { id: 'old_door', type: 'Door', ifcType: 'IfcDoor', name: 'Ancienne porte', GlobalId: guid('old_door'), parentId: storeyId, OverallWidth: 0.9, OverallHeight: 2.1, geom: { wallId: 'south', t: 0.5, width: 0.9, height: 2.1, swing: 'left', side: 1 } };
  return exportIFC(base);
}

/** World x of an opening's centre along the south wall (y = 0, x from 0 to 8). */
const centreX = (again: Awaited<ReturnType<typeof importIFCBuffer>>, name: string) => {
  const item = Object.values(again.items).find(i => i.name === name) as any;
  expect(item).toBeDefined();
  expect(again.items[item.geom.wallId]?.name).toBe('south');
  const wall = again.items[item.geom.wallId] as any;
  return wall.geom.x1 + (wall.geom.x2 - wall.geom.x1) * item.geom.t + (again.centerOffset?.[0] ?? 0);
};

it('re-imports doors and windows added by patchIFC at their centre', async () => {
  const original = exportedRoom();
  const imported = await quiet(() => importIFCBuffer(toBuffer(original)));
  const items: ItemsMap = { ...imported.items };
  const south = Object.values(items).find(i => i.name === 'south')!;
  const storey = Object.values(items).find(i => i.type === 'Storey')!.id;
  (items as any).new_door = { id: 'new_door', type: 'Door', ifcType: 'IfcDoor', name: 'Nouvelle porte', GlobalId: guid('new_door'), parentId: storey, OverallWidth: 0.9, OverallHeight: 2.1, geom: { wallId: south.id, t: 0.15, width: 0.9, height: 2.1, swing: 'left', side: 1 } };
  (items as any).new_window = { id: 'new_window', type: 'Window', ifcType: 'IfcWindow', name: 'Nouvelle fenêtre', GlobalId: guid('new_window'), parentId: storey, OverallWidth: 1.2, OverallHeight: 1.2, geom: { wallId: south.id, t: 0.8, width: 1.2, height: 1.2, sillHeight: 0.9 } };
  const patched = await quiet(() => patchIFC(items, toBuffer(original), imported.centerOffset));
  const again = await quiet(() => importIFCBuffer(toBuffer(patched)));
  expect(Math.abs(centreX(again, 'Nouvelle porte') - 1.2)).toBeLessThan(0.15);
  expect(Math.abs(centreX(again, 'Nouvelle fenêtre') - 6.4)).toBeLessThan(0.15);
  expect(Math.abs(centreX(again, 'Ancienne porte') - 4)).toBeLessThan(0.15);
});

it('keeps an existing door where it was moved when patching a file exported by skAItch', async () => {
  const original = exportedRoom();
  const imported = await quiet(() => importIFCBuffer(toBuffer(original)));
  const items: ItemsMap = { ...imported.items };
  const door = Object.values(items).find(i => i.name === 'Ancienne porte') as any;
  expect(Math.abs(centreX(imported, 'Ancienne porte') - 4)).toBeLessThan(0.15);
  items[door.id] = { ...door, geom: { ...door.geom, t: 0.25, _edited: true } };
  const patched = await quiet(() => patchIFC(items, toBuffer(original), imported.centerOffset));
  const again = await quiet(() => importIFCBuffer(toBuffer(patched)));
  expect(Math.abs(centreX(again, 'Ancienne porte') - 2)).toBeLessThan(0.15);
});

