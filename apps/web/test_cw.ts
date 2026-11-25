import * as WebIFC from 'web-ifc';
import * as fs from 'fs';

const ifcFile = 'ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc';
const fileData = fs.readFileSync(ifcFile);

const api = new WebIFC.IfcAPI();
api.Init().then(() => {
  const mid = api.OpenModel(fileData);
  const cwId = 848;
  const cwLine = api.GetLine(mid, cwId, true);
  console.log('CurtainWall:', JSON.stringify(cwLine, null, 2));

  // Placement
  const locId = cwLine.ObjectPlacement?.value;
  if(locId) {
    const loc = api.GetLine(mid, locId, true);
    console.log('ObjectPlacement:', JSON.stringify(loc, null, 2));
  }
  
  // Representation
  const repId = cwLine.Representation?.value;
  if (repId) {
    const rep = api.GetLine(mid, repId, true);
    console.log('Representation:', JSON.stringify(rep, null, 2));
  }
  
  api.CloseModel(mid);
});
