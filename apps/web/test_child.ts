import * as WebIFC from 'web-ifc';
import * as fs from 'fs';

const ifcFile = 'ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc';
const fileData = fs.readFileSync(ifcFile);

const api = new WebIFC.IfcAPI();
api.Init().then(() => {
  const mid = api.OpenModel(fileData);
  const childId = 43361;
  const child = api.GetLine(mid, childId, true);
  console.log('Child:', JSON.stringify(child, null, 2));
  
  if (child.ObjectPlacement?.value) {
    const loc = api.GetLine(mid, child.ObjectPlacement.value, true);
    console.log('ObjectPlacement:', JSON.stringify(loc, null, 2));
  }
  
  api.CloseModel(mid);
});
