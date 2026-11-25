import { describe, expect, it } from 'vitest';
import { computeMcpModel } from '@skaitch/core/bim/mcpModel';
import { runBimOperation } from '@skaitch/core/bim/dispatch';
import { exportIFC } from '@skaitch/core/bim/exportIFC';
import { importIFCBuffer } from '@skaitch/core/bim/importIFC';
import { patchIFC } from '@skaitch/core/bim/patchIFC';
import { buildEmpty } from '@skaitch/core/data/starter';
import { BUILTIN_CATALOGUE } from '@skaitch/core/data/elementCatalogue';
import { chimneyParts, roofTopAt, storeyHeight, structuralOutlines } from '@skaitch/core/lib/structuralElements';
import { renderPlan } from '@skaitch/core/drawing/plan';
import type { IfcChimneyEntity, IfcColumnEntity, ItemsMap } from '@skaitch/core/types/ifc';
import type { McpModelResponse } from '@skaitch/core/types/bim';

const apply = (items: ItemsMap, response: McpModelResponse): ItemsMap => {
  const next = { ...items };
  for (const change of response.changes) {
    if (change.kind === 'add') next[change.item.id] = change.item;
    else if (change.kind === 'update') next[change.id] = { ...next[change.id], ...change.patch } as ItemsMap[string];
    else if (change.kind === 'delete') for (const id of change.ids) delete next[id];
  }
  return next;
};

function setup() {
  let items = buildEmpty();
  const storey = Object.values(items).find(i => i.type === 'Storey')!;
  const run = (name: string, args: Record<string, unknown>, lang = 'en') => {
    const response = computeMcpModel(name, args, items, storey.id, BUILTIN_CATALOGUE, lang);
    items = apply(items, response);
    return response.result as any;
  };
  return { storey, run, items: () => items };
}

const quiet = async <T>(fn: () => Promise<T>) => {
  const log = console.log, warn = console.warn;
  console.log = console.warn = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; }
};
const toBuffer = (text: string) => { const b = new TextEncoder().encode(text); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

describe('columns', () => {
  it('creates rectangular and circular columns with the storey height by default', () => {
    const { run, items, storey } = setup();
    const rect = run('create_column', { point: [2, 3], width: 0.4, depth: 0.25 });
    const round = run('create_column', { point: [5, 3], shape: 'circle', diameter: 0.35, height: 3.1 });
    expect(rect.success && round.success).toBe(true);
    const a = items()[rect.id] as IfcColumnEntity, b = items()[round.id] as IfcColumnEntity;
    expect(a).toMatchObject({ type: 'Column', ifcType: 'IfcColumn', name: 'Column', parentId: storey.id });
    expect(a.id.startsWith('col_')).toBe(true);
    expect(a.geom).toMatchObject({ x: 2, y: 3, shape: 'rect', w: 0.4, d: 0.25, h: storeyHeight(items(), storey.id) });
    expect(b.geom).toMatchObject({ shape: 'circle', w: 0.35, d: 0.35, h: 3.1 });
  });

  it('updates, rejects invalid values and deletes', () => {
    const { run, items } = setup();
    const { id } = run('create_column', { point: [1, 1] });
    expect(run('update_column', { id, shape: 'circle', diameter: 0.5, point: [2, 2], name: 'P1' }).success).toBe(true);
    expect((items()[id] as IfcColumnEntity)).toMatchObject({ name: 'P1', geom: { x: 2, y: 2, shape: 'circle', w: 0.5, d: 0.5 } });
    expect(run('update_column', { id, width: -1 }).error).toMatch(/width/);
    expect(run('update_column', { id: 'nope' }).error).toMatch(/not found/);
    run('delete_element', { ids: [id] });
    expect(items()[id]).toBeUndefined();
  });

  it('defaults to the floor-to-floor height when a storey exists above', () => {
    const { run, items, storey } = setup();
    const building = Object.values(items()).find(i => i.type === 'Building')!;
    run('create_storey', { building_id: building.id, elevation: (storey as any).geom.elevation + 3.2 });
    const { id } = run('create_column', { point: [0, 0] });
    expect((items()[id] as IfcColumnEntity).geom.h).toBeCloseTo(3.2);
  });
});

describe('chimneys', () => {
  it('creates a flue and a fireplace whose flue sits on the hearth', () => {
    const { run, items } = setup();
    const flueId = run('create_chimney', { point: [1, 1] }).id;
    const flue = items()[flueId] as IfcChimneyEntity;
    expect(flue).toMatchObject({ type: 'Chimney', ifcType: 'IfcChimney', kind: 'flue', name: 'Chimney', geom: { w: 0.5, d: 0.5 } });
    expect(flue.id.startsWith('chm_')).toBe(true);
    const fireId = run('create_chimney', { point: [4, 1], kind: 'fireplace', height: 5 }).id;
    const fire = items()[fireId] as IfcChimneyEntity;
    const parts = chimneyParts(fire.kind, fire.geom);
    expect(parts.map(p => p.role)).toEqual(['hearth', 'flue']);
    expect(parts[1]).toMatchObject({ z: 1, h: 4 });
    expect(structuralOutlines(fire)).toHaveLength(2);
  });

  it('updates the kind and deletes', () => {
    const { run, items } = setup();
    const { id } = run('create_chimney', { point: [1, 1] }, 'fr');
    expect(items()[id].name).toBe('Cheminée');
    run('update_chimney', { id, kind: 'fireplace', hearth_height: 0.9 });
    expect(items()[id]).toMatchObject({ kind: 'fireplace', geom: { w: 1.2, d: 0.6, hearthH: 0.9 } });
    expect(run('update_chimney', { id, kind: 'oven' }).error).toMatch(/kind/);
    run('delete_element', { ids: [id] });
    expect(items()[id]).toBeUndefined();
  });
});

describe('IFC export', () => {
  const model = () => {
    const { run, items, storey } = setup();
    run('create_column', { point: [1, 1], name: 'Col rect' });
    run('create_column', { point: [3, 1], shape: 'circle', diameter: 0.3, name: 'Col round' });
    run('create_chimney', { point: [6, 1], kind: 'fireplace', name: 'Fire' });
    return { items: items(), storey };
  };

  it('writes IfcColumn and IfcChimney contained in their storey', () => {
    const text = exportIFC(model().items);
    expect(text.match(/IFCCOLUMN\(/g)).toHaveLength(2);
    expect(text).toMatch(/IFCCOLUMN\('[^']+',\$,'Col rect',\$,\$,#\d+,#\d+,\$,\.COLUMN\.\)/);
    expect(text).toMatch(/IFCCIRCLEPROFILEDEF\(\.AREA\.,\$,#\d+,0\.150*\)/);
    const chimney = text.match(/^#(\d+)=IFCCHIMNEY\('[^']+',\$,'Fire',\$,'Fireplace',#\d+,#\d+,\$,\.NOTDEFINED\.\);/m);
    expect(chimney).not.toBeNull();
    const contained = text.match(/IFCRELCONTAINEDINSPATIALSTRUCTURE\([^;]*\);/g)!.join('\n');
    expect(contained).toContain(`#${chimney![1]}`);
    for (const [, n] of text.matchAll(/^#(\d+)=IFCCOLUMN\(/gm)) expect(contained).toMatch(new RegExp(`#${n}[,)]`));
  });

  it('passes the engine validation and re-imports both elements', async () => {
    const { items } = model();
    const text = await runBimOperation('export-ifc', { items }) as string;
    const imported = await quiet(() => importIFCBuffer(toBuffer(text)));
    const names = Object.values(imported.items).map(i => i.name);
    expect(names).toEqual(expect.arrayContaining(['Col rect', 'Col round', 'Fire']));
    const fire = Object.values(imported.items).find(i => i.name === 'Fire') as any;
    expect(fire.ifcType ?? fire.category).toBe('IfcChimney');
  });

  it('adds new columns and chimneys when patching an imported IFC', async () => {
    const base = exportIFC(buildEmpty());
    const imported = await quiet(() => importIFCBuffer(toBuffer(base)));
    const storey = Object.values(imported.items).find(i => i.type === 'Storey')!;
    let items = imported.items;
    for (const [name, args] of [['create_column', { point: [1, 1], name: 'Patched col' }], ['create_chimney', { point: [3, 1], name: 'Patched flue' }]] as const) {
      items = apply(items, computeMcpModel(name, args, items, storey.id, BUILTIN_CATALOGUE, 'en'));
    }
    const patched = await quiet(() => patchIFC(items, toBuffer(base), imported.centerOffset));
    expect(patched).toMatch(/IFCCOLUMN\('[^']+',\$,'Patched col'/);
    expect(patched).toMatch(/IFCCHIMNEY\('[^']+',\$,'Patched flue'/);
    const again = await quiet(() => importIFCBuffer(toBuffer(patched)));
    expect(Object.values(again.items).map(i => i.name)).toEqual(expect.arrayContaining(['Patched col', 'Patched flue']));
  });
});

describe('chimney through the roof', () => {
  it('rises 0.50 m above the roof covering it, and stays at storey height elsewhere', () => {
    const { run, items, storey } = setup();
    expect(run('create_roof', { geometry: { polygon: [[0, 0], [6, 0], [6, 4], [0, 4]], roofType: 'gable', pitch: 30 } }).success).toBe(true);
    const top = roofTopAt(items(), storey.id, 3, 2)!;
    expect(top).toBeGreaterThan(2.5);
    const inside = run('create_chimney', { point: [3, 2] }).id;
    expect((items()[inside] as IfcChimneyEntity).geom.h).toBeCloseTo(top + 0.5, 2);
    const outside = run('create_chimney', { point: [10, 10] }).id;
    expect((items()[outside] as IfcChimneyEntity).geom.h).toBe(storeyHeight(items(), storey.id));
    const fixed = run('create_chimney', { point: [3, 2], height: 2 }).id;
    expect((items()[fixed] as IfcChimneyEntity).geom.h).toBe(2);
    run('update_chimney', { id: fixed, through_roof: true });
    expect((items()[fixed] as IfcChimneyEntity).geom.h).toBeCloseTo(top + 0.5, 2);
  });
});

describe('2D plan', () => {
  it('draws a column as poché and a fireplace as two outlines with a crossed flue', () => {
    const { run, items, storey } = setup();
    const col = run('create_column', { point: [1, 1] }).id;
    const fire = run('create_chimney', { point: [4, 1], kind: 'fireplace' }).id;
    const prims = renderPlan(items(), storey.id).primitives;
    const of = (id: string) => prims.filter(p => p.id === id);
    expect(of(col)).toEqual([expect.objectContaining({ kind: 'polygon', layer: 'wall' })]);
    expect(of(fire).filter(p => p.kind === 'polygon')).toHaveLength(2);
    expect(of(fire).filter(p => p.kind === 'polyline')).toHaveLength(2);
    expect(renderPlan(items(), storey.id, { hiddenTypes: new Set(['Column']) }).primitives.some(p => p.id === col)).toBe(false);
  });
});

describe('stoves', () => {
  it('creates a stove with a round flue pipe and exports it as an IfcChimney "Stove"', () => {
    const { run, items } = setup();
    const id = run('create_chimney', { point: [2, 2], kind: 'stove', name: 'Poêle', through_roof: false, height: 2.5 }).id;
    const stove = items()[id] as IfcChimneyEntity;
    expect(stove).toMatchObject({ kind: 'stove', geom: { w: 0.5, d: 0.45, hearthH: 0.9, flueW: 0.15, h: 2.5 } });
    const parts = chimneyParts(stove.kind, stove.geom);
    expect(parts.map(p => [p.role, p.z])).toEqual([['hearth', 0], ['flue', 0.9]]);
    expect(parts[1].polygon.length).toBeGreaterThan(4);
    const text = exportIFC(items());
    expect(text).toMatch(/IFCCHIMNEY\('[^']+',\$,'Poêle'|IFCCHIMNEY\('[^']+',\$,'Po\\X2\\00EA\\X0\\le'/);
    expect(text).toContain("'Stove'");
    expect(renderPlan(items(), (items()[id] as any).parentId).primitives.filter(p => p.id === id && p.kind === 'polyline')).toHaveLength(2);
  });
});
