import * as WebIFC from 'web-ifc';
import * as fs from 'fs';

const ifcFile = 'ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc';
const fileData = fs.readFileSync(ifcFile);

const api = new WebIFC.IfcAPI();
api.Init().then(() => {
  const mid = api.OpenModel(fileData);
  
  api.StreamAllMeshes(mid, (mesh) => {
    if (mesh.expressID === 43361 || mesh.expressID === 43395) {
      console.log(`\nMesh for ${mesh.expressID}:`);
      const geom = api.GetGeometry(mid, mesh.geometries.get(0).geometryExpressID);
      const vPtr = geom.GetVertexData();
      const vSize = geom.GetVertexDataSize();
      const vertices = new Float32Array(api.GetVertexArray(vPtr, vSize));
      const m = mesh.geometries.get(0).flatTransformation;
      console.log('Transformation:', m);
      
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      for(let i=0; i<vertices.length; i+=6) {
        const lx = vertices[i], ly = vertices[i+1], lz = vertices[i+2];
        const wx = m[0]*lx + m[4]*ly + m[8]*lz + m[12];
        const wy = m[1]*lx + m[5]*ly + m[9]*lz + m[13];
        if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
        if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
      }
      console.log(`Bounds: X:[${minX}, ${maxX}] Y:[${minY}, ${maxY}]`);
    }
  });
  
  api.CloseModel(mid);
});
