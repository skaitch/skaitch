import * as fs from 'fs';
import * as WebIFC from 'web-ifc';

async function main() {
  const api = new WebIFC.IfcAPI();
  await api.Init();
  
  const ifcPath = 'ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc';
  const buffer = fs.readFileSync(ifcPath);
  
  const mid = api.OpenModel(new Uint8Array(buffer));
  
  // Let's count elements of different types
  const plateIds = api.GetLineIDsWithType(mid, WebIFC.IFCPLATE, false);
  const memberIds = api.GetLineIDsWithType(mid, WebIFC.IFCMEMBER, false);
  const furIds = api.GetLineIDsWithType(mid, WebIFC.IFCFURNITURE, false);
  
  console.log('IFCPLATE count:', plateIds.size());
  console.log('IFCMEMBER count:', memberIds.size());
  console.log('IFCFURNITURE count:', furIds.size());
  
  api.CloseModel(mid);
}

main().catch(console.error);
