import * as fs from 'fs';
import * as WebIFC from 'web-ifc';
import { patchIFC } from './server/bim/patchIFC';

async function main() {
  const api = new WebIFC.IfcAPI();
  await api.Init();

  const ifcPath = 'ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc';
  const buffer = fs.readFileSync(ifcPath);

  const mid1 = api.OpenModel(buffer);
  
  function vecToArray(vec: any): number[] {
    const arr: number[] = [];
    for (let i = 0; i < vec.size(); i++) arr.push(vec.get(i));
    return arr;
  }

  const items: any = {};
  items['proj_1'] = { id: 'proj_1', type: 'Project', ifcType: 'IfcProject', name: 'Project' };
  items['bld_1'] = { id: 'bld_1', type: 'Building', ifcType: 'IfcBuilding', name: 'Building', parentId: 'proj_1' };
  items['sty_lvl_0'] = { id: 'sty_lvl_0', type: 'Storey', ifcType: 'IfcBuildingStorey', name: 'Niveau 0', parentId: 'bld_1', geom: { level: 0 } };

  // Walls
  const wallIds = vecToArray(api.GetLineIDsWithType(mid1, WebIFC.IFCWALL, true));
  for (const id of wallIds) {
    const line = api.GetLine(mid1, id, false);
    items[`w_${id}`] = { id: `w_${id}`, type: 'Wall', ifcType: line.__type__, name: line.Name?.value || 'Wall', parentId: 'sty_lvl_0', geom: { x1: 0, y1: 0, x2: 10, y2: 0, thickness: 0.2, height: 3 } };
  }

  // Furniture
  const furIds = vecToArray(api.GetLineIDsWithType(mid1, WebIFC.IFCFURNISHINGELEMENT, true));
  for (const id of furIds) {
    const line = api.GetLine(mid1, id, false);
    items[`fur_${id}`] = { id: `fur_${id}`, type: 'Furniture', ifcType: line.__type__, name: line.Name?.value || 'Furniture', parentId: 'sty_lvl_0', geom: { x: 0, y: 0, w: 1, d: 1, h: 1 } };
  }

  // Plates and Members
  const plateIds = vecToArray(api.GetLineIDsWithType(mid1, WebIFC.IFCPLATE, true));
  for (const id of plateIds) {
    const line = api.GetLine(mid1, id, false);
    items[`gen_${id}`] = { id: `gen_${id}`, type: 'GenericElement', ifcType: line.__type__, name: line.Name?.value || 'Plate', parentId: 'sty_lvl_0', geom: { x: 0, y: 0, w: 1, d: 1, h: 1 } };
  }

  const memberIds = vecToArray(api.GetLineIDsWithType(mid1, WebIFC.IFCMEMBER, true));
  for (const id of memberIds) {
    const line = api.GetLine(mid1, id, false);
    items[`gen_${id}`] = { id: `gen_${id}`, type: 'GenericElement', ifcType: line.__type__, name: line.Name?.value || 'Member', parentId: 'sty_lvl_0', geom: { x: 0, y: 0, w: 1, d: 1, h: 1 } };
  }

  api.CloseModel(mid1);

  // 2. Patch
  const patchedText = await patchIFC(items, buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  const patchedBytes = new TextEncoder().encode(patchedText);

  // 3. Load Patched
  const mid = api.OpenModel(patchedBytes);

  try {
    let count = 0;
    api.StreamAllMeshes(mid, (flatMesh) => {
      if (count++ < 5) {
        const expressID = flatMesh.expressID;
        const line = api.GetLine(mid, expressID, false);
        console.log(`Mesh ${count}: expressID=${expressID}, typeName=${line ? line.constructor.name : 'null'}, line=`, line);
      }
      flatMesh.delete?.();
    });
  } catch (e) {
    console.error('StreamAllMeshes error:', e);
  }

  api.CloseModel(mid);
}

main().catch(console.error);
