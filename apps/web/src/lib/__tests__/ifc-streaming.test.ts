import { expect, it } from 'vitest';
import * as WebIFC from 'web-ifc';
import { buildStarter } from '@skaitch/core/data/starter';
import { exportIFC } from '@skaitch/core/bim/exportIFC';

it('streams selected IFC meshes with the installed JavaScript and WASM', async () => {
  const api = new WebIFC.IfcAPI();
  await api.Init(undefined, true);
  const model = api.OpenModel(new TextEncoder().encode(exportIFC(buildStarter())));
  try {
    const walls = api.GetLineIDsWithType(model, WebIFC.IFCWALL);
    const ids = Array.from({length: walls.size()}, (_, i) => walls.get(i));
    expect(ids.length).toBeGreaterThan(0);
    const streamed: number[] = [];
    api.StreamMeshes(model, ids, mesh => {
      expect(mesh.geometries.size()).toBeGreaterThan(0);
      streamed.push(mesh.expressID);
    });
    expect(streamed.sort((a,b)=>a-b)).toEqual(ids.sort((a,b)=>a-b));
  } finally {
    api.CloseModel(model);
    api.Dispose();
  }
});

it('exports visible doors and windows with openings in their walls', async () => {
  const api = new WebIFC.IfcAPI();
  await api.Init(undefined, true);
  const text = exportIFC(buildStarter());
  const model = api.OpenModel(new TextEncoder().encode(text));
  try {
    for (const type of [WebIFC.IFCDOOR, WebIFC.IFCWINDOW]) {
      const ids = api.GetLineIDsWithType(model, type);
      expect(ids.size()).toBeGreaterThan(0);
      let meshes = 0;
      api.StreamAllMeshesWithTypes(model, [type], mesh => {
        if (mesh.geometries.size()) meshes++;
      });
      expect(meshes).toBe(ids.size());
    }
    expect(api.GetLineIDsWithType(model, WebIFC.IFCRELVOIDSELEMENT).size()).toBeGreaterThan(0);
    expect(api.GetLineIDsWithType(model, WebIFC.IFCRELFILLSELEMENT).size()).toBeGreaterThan(0);
  } finally {
    api.CloseModel(model);
    api.Dispose();
  }
});

it('meshes furniture and technical equipment in new and patched exports', async () => {
  const { patchIFC } = await import('@skaitch/core/bim/patchIFC');
  const base = buildStarter();
  const storey = Object.values(base).find(item => item.type === 'Storey')!;
  const scene = { ...base,
    furniture_test: { id: 'furniture_test', GlobalId: 'F000000000000000000001', type: 'Furniture', ifcType: 'IfcFurnishingElement', name: 'Table', parentId: storey.id, category: 'Table', model: 'table', geom: { x: 2, y: 3, w: 2, d: 1, h: 1, rotation: Math.PI / 2 } },
    technical_test: { id: 'technical_test', GlobalId: 'T000000000000000000001', type: 'Technical', ifcType: 'IfcFlowTerminal', name: 'Prise', parentId: storey.id, category: 'Électricité', discipline: 'electrical', model: 'elec-prise-simple', geom: { x: 1, y: 2, rotation: 0, mountHeight: 1 } },
  } as any;
  const original = exportIFC(base);
  const outputs = [exportIFC(scene), await patchIFC(scene, new TextEncoder().encode(original).buffer)];
  const api = new WebIFC.IfcAPI();
  await api.Init(undefined, true);
  try {
    for (const output of outputs) {
      const model = api.OpenModel(new TextEncoder().encode(output));
      for (const [type, guid] of [[WebIFC.IFCFURNISHINGELEMENT, 'F000000000000000000001'], [WebIFC.IFCFLOWTERMINAL, 'T000000000000000000001']] as const) {
        const ids = api.GetLineIDsWithType(model, type);
        const id = Array.from({ length: ids.size() }, (_, i) => ids.get(i)).find(id => api.GetLine(model, id).GlobalId?.value === guid);
        expect(id).toBeDefined();
        let meshes = 0;
        api.StreamMeshes(model, [id!], mesh => { if (mesh.geometries.size()) meshes++; });
        expect(meshes).toBe(1);
      }
      api.CloseModel(model);
    }
  } finally { api.Dispose(); }
});
