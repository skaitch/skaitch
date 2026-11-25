import { describe, it, expect } from 'vitest';
import * as WebIFC from 'web-ifc';
import { exportIFC } from '@skaitch/core/bim/exportIFC';
import { patchIFC } from '@skaitch/core/bim/patchIFC';
import type { ItemsMap } from '@skaitch/core/types/ifc';

const base: ItemsMap = {
  p: { id: 'p', type: 'Project', ifcType: 'IfcProject', name: 'P', Name: 'P', GlobalId: 'P000000000000000000001', parentId: null } as any,
  b: { id: 'b', type: 'Building', ifcType: 'IfcBuilding', name: 'B', Name: 'B', GlobalId: 'B000000000000000000001', parentId: 'p' } as any,
  s: { id: 's', type: 'Storey', ifcType: 'IfcBuildingStorey', name: 'S', Name: 'S', GlobalId: 'S000000000000000000001', parentId: 'b', geom: { level: 0, elevation: 0, thickness: 0.2 } } as any,
};
const roof = {
  id: 'rf_new', type: 'Roof', ifcType: 'IfcRoof', name: 'Toit', Name: 'Toit', GlobalId: 'R000000000000000000001', parentId: 's',
  geom: { polygon: [[0, 0], [10, 0], [10, 6], [0, 6]], roofType: 'hip', pitch: 45, elevation: 2.7, overhang: 0, thickness: 0.25 },
} as any;

async function roofBounds(text: string, type = WebIFC.IFCROOF) {
  const api = new WebIFC.IfcAPI();
  await api.Init();
  const mid = api.OpenModel(new TextEncoder().encode(text));
  const ids = api.GetLineIDsWithType(mid, type);
  let minZ = Infinity, maxZ = -Infinity, tris = 0;
  api.StreamAllMeshesWithTypes(mid, [type], (mesh) => {
    for (let i = 0; i < mesh.geometries.size(); i++) {
      const pg = mesh.geometries.get(i);
      const g = api.GetGeometry(mid, pg.geometryExpressID);
      const v = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
      tris += g.GetIndexDataSize() / 3;
      const m = pg.flatTransformation;
      for (let k = 0; k < v.length; k += 6) {
        // web-ifc is Y-up: world height = transformed y
        const y = m[1] * v[k] + m[5] * v[k + 1] + m[9] * v[k + 2] + m[13];
        minZ = Math.min(minZ, y); maxZ = Math.max(maxZ, y);
      }
    }
  });
  api.CloseModel(mid);
  return { count: ids.size(), minZ, maxZ, tris };
}

describe('IfcRoof export', () => {
  it('exportIFC writes a hip roof that web-ifc can mesh at the right heights', async () => {
    const text = exportIFC({ ...base, rf_new: roof });
    expect(text).toMatch(/IFCROOF\(.*\.HIP_ROOF\.\)/);
    const b = await roofBounds(text);
    expect(b.count).toBe(1);
    expect(b.tris).toBeGreaterThan(8);
    expect(b.minZ).toBeCloseTo(2.45, 2);  // eave − thickness
    expect(b.maxZ).toBeCloseTo(5.7, 2);   // eave + 3 m ridge
  });

  it('patchIFC injects a new roof into an existing file', async () => {
    const original = exportIFC(base);
    const buf = new TextEncoder().encode(original).buffer as ArrayBuffer;
    const text = await patchIFC({ ...base, rf_new: roof }, buf);
    const b = await roofBounds(text);
    expect(b.count).toBe(1);
    expect(b.maxZ - b.minZ).toBeCloseTo(3.25, 2);
  });
});


describe('attached wall IFC geometry', () => {
  const gable = { ...roof, geom: { ...roof.geom, roofType: 'gable' } };
  const wall: any = { id: 'w_test', type: 'Wall', ifcType: 'IfcWall', GlobalId: 'W000000000000000000001', name: 'Pignon', parentId: 's', geom: { x1: 10, y1: 0, x2: 10, y2: 6, thickness: 0.2, height: 2.7, roofId: 'rf_new' } };
  it('meshes the wall up to the roof underside in both exports', async () => {
    const items = { ...base, rf_new: gable, w_test: wall };
    const fresh = exportIFC(items);
    const patched = await patchIFC(items, new TextEncoder().encode(exportIFC(base)).buffer as ArrayBuffer);
    for (const text of [fresh, patched]) {
      const bounds = await roofBounds(text, WebIFC.IFCWALL);
      expect(bounds.count).toBe(1);
      expect(bounds.tris).toBeGreaterThan(0);
      expect(bounds.minZ).toBeCloseTo(0, 2);
      expect(bounds.maxZ).toBeCloseTo(5.45, 2);
    }
  });
  it('updates an existing IFC wall representation', async () => {
    const original = exportIFC({ ...base, w_test: { ...wall, geom: { ...wall.geom, roofId: undefined } } });
    const id = original.match(/#(\d+)=IFCWALL\(/)![1];
    const imported = { ...wall, id: 'w_ifc_' + id };
    const text = await patchIFC({ ...base, rf_new: gable, [imported.id]: imported }, new TextEncoder().encode(original).buffer as ArrayBuffer);
    const bounds = await roofBounds(text, WebIFC.IFCWALL);
    expect(bounds.count).toBe(1);
    expect(bounds.maxZ).toBeCloseTo(5.45, 2);
  });
});
