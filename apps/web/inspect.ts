import * as WebIFC from 'web-ifc';
import * as fs from 'fs';

const ifcFile = 'ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc';
const fileData = fs.readFileSync(ifcFile);

const api = new WebIFC.IfcAPI();
api.Init().then(() => {
  const mid = api.OpenModel(fileData);
  console.log('--- IFC STUDY ---');
  
  function vecToArray(vec: any): number[] {
    const arr: number[] = [];
    for (let i = 0; i < vec.size(); i++) arr.push(vec.get(i));
    return arr;
  }

  const furIds = vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCFURNISHINGELEMENT, true));
  console.log('Furniture IDs:', furIds);

  const worldVertsMap = new Map<number, any>();
  try {
    api.StreamAllMeshes(mid, (flatMesh) => {
      const eid = flatMesh.expressID;
      const n = flatMesh.geometries.size();
      let hasGeom = false;
      for (let gi = 0; gi < n; gi++) {
        const placed = flatMesh.geometries.get(gi);
        try {
          const geom = api.GetGeometry(mid, placed.geometryExpressID);
          const vSize = geom.GetVertexDataSize();
          if (vSize > 0) {
            hasGeom = true;
          }
          geom.delete?.();
        } catch {}
      }
      if (hasGeom) {
        worldVertsMap.set(eid, true);
      }
      flatMesh.delete?.();
    });
  } catch (e) {
    console.warn('StreamAllMeshes error:', e);
  }

  console.log('Total meshed elements:', worldVertsMap.size);
  const furWithGeom = furIds.filter(id => worldVertsMap.has(id));
  console.log('Furniture with meshes:', furWithGeom.length);

  api.CloseModel(mid);
});
