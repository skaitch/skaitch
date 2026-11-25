import * as WebIFC from 'web-ifc';
import * as fs from 'fs';

const ifcFile = 'ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc';
const fileData = fs.readFileSync(ifcFile);

const api = new WebIFC.IfcAPI();
api.Init().then(() => {
  const mid = api.OpenModel(fileData);
  
  api.StreamAllMeshes(mid, (mesh) => {
    if (mesh.expressID === 854) {
      console.log(`\nMesh for ${mesh.expressID}:`);
      const m = mesh.geometries.get(0).flatTransformation;
      console.log('Transformation:', m);
    }
  });
  
  api.CloseModel(mid);
});
