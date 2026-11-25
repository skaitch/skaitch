import * as fs from 'fs';
import * as WebIFC from 'web-ifc';

async function main() {
  const api = new WebIFC.IfcAPI();
  await api.Init();

  const ifcPath = 'ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc';
  const buffer = fs.readFileSync(ifcPath);

  const mid = api.OpenModel(buffer);
  console.log('Opened original model successfully, ID:', mid);

  try {
    api.StreamAllMeshes(mid, (flatMesh) => {
      const expressID = flatMesh.expressID;
      const type = api.GetLine(mid, expressID, false);
      const typeName = type ? type.constructor.name : 'Unknown';
      if (typeName.toUpperCase().includes('FURNITURE')) {
        console.log(`Furniture mesh: expressID=${expressID}, typeName=${typeName}, geometries=${flatMesh.geometries.size()}`);
      }
      flatMesh.delete?.();
    });
  } catch (e) {
    console.error('StreamAllMeshes error:', e);
  }

  api.CloseModel(mid);
}

main().catch(console.error);
