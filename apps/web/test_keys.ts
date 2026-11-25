import * as WebIFC from 'web-ifc';
import * as fs from 'fs';

const ifcFile = 'ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc';
const fileData = fs.readFileSync(ifcFile);

const api = new WebIFC.IfcAPI();
api.Init().then(() => {
  const mid = api.OpenModel(fileData);
  
  const keys: number[] = [];
  api.StreamAllMeshes(mid, (mesh) => {
    keys.push(mesh.expressID);
    mesh.delete?.();
  });
  console.log('Streamed expressIDs:', keys.join(', '));
  
  api.CloseModel(mid);
});
