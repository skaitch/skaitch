import { expect, it } from 'vitest';
import { buildEmpty, guid } from '@skaitch/core/data/starter';
import { exportIFC } from '@skaitch/core/bim/exportIFC';
import { importIFCBuffer } from '@skaitch/core/bim/importIFC';
import type { IfcFurnitureEntity, ItemsMap } from '@skaitch/core/types/ifc';

function project(): ItemsMap {
  const items = buildEmpty();
  for (const id of Object.keys(items)) if (items[id].type === 'Furniture') delete items[id];
  const storeyId = Object.values(items).find(item => item.type === 'Storey')!.id;
  const furniture = (id: string, category: string, model: string, x: number, y: number, w: number, d: number, h: number, rotation = 0) => ({
    id, type: 'Furniture', ifcType: 'IfcFurnishingElement', name: id, Name: id, GlobalId: guid(id), parentId: storeyId,
    category, model, geom: { x, y, w, d, h, rotation },
  }) as unknown as IfcFurnitureEntity;
  items.fridge = furniture('fridge', 'Cuisine', 'electro-refri-americain', 1, 1, 0.9, 0.7, 1.8);
  items.bed = furniture('bed', 'Chambre', 'chambre-lit-double', 4, 2, 1.6, 2.0, 0.5);
  items.desk = furniture('desk', 'Bureau', 'bureau-droit', 7, 1, 1.4, 0.7, 0.75, Math.PI / 2);
  return items;
}

it('exports furniture with the editor\'s 3D model: tessellated, coloured parts', () => {
  const text = exportIFC(project());
  expect(text.match(/IFCFURNISHINGELEMENT\(/g)).toHaveLength(3);
  expect(text.match(/IFCTRIANGULATEDFACESET\(/g)!.length).toBeGreaterThanOrEqual(3 * 2);
  expect(text).toContain("'Body','Tessellation'");
  // Several distinct colours, not one flat box colour.
  expect(new Set(text.match(/IFCCOLOURRGB\(\$,[^)]*\)/g)).size).toBeGreaterThanOrEqual(4);
  const ids = text.match(/^#\d+=/gm)!;
  expect(new Set(ids).size).toBe(ids.length);
});

it('re-imports exported furniture at the same place and size', async () => {
  const original = project();
  const bytes = new TextEncoder().encode(exportIFC(original));
  const silent = console.log;
  console.log = () => {};
  let imported: Awaited<ReturnType<typeof importIFCBuffer>>;
  try { imported = await importIFCBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer); }
  finally { console.log = silent; }
  const [ox, oy] = imported.centerOffset ?? [0, 0];
  for (const name of ['fridge', 'bed', 'desk']) {
    const want = (original[name] as IfcFurnitureEntity).geom;
    const got = (Object.values(imported.items).find(item => item.name === name) as IfcFurnitureEntity | undefined)?.geom;
    expect(got, name).toBeDefined();
    const centre = (g: typeof want, dx = 0, dy = 0) => [g.x + g.w / 2 + dx, g.y + g.d / 2 + dy];
    const [wx, wy] = centre(want), [gx, gy] = centre(got!, ox, oy);
    expect(Math.hypot(gx - wx, gy - wy), `${name} centre`).toBeLessThan(0.15);
    // Footprint within 15 cm on each side (details such as handles may stick out slightly).
    const span = (g: typeof want) => [g.w, g.d].sort((a, b) => a - b);
    const [ws, wl] = span(want), [gs, gl] = span(got!);
    expect(Math.abs(gs - ws), `${name} width`).toBeLessThan(0.15);
    expect(Math.abs(gl - wl), `${name} depth`).toBeLessThan(0.15);
  }
});
