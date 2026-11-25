import * as fs from 'fs';
import * as WebIFC from 'web-ifc';

async function main() {
  const api = new WebIFC.IfcAPI();
  await api.Init();

  const ifcPath = 'ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc';
  const buffer = fs.readFileSync(ifcPath);

  const mid = api.OpenModel(buffer);
  
  const id = 289768;
  const line = api.GetLine(mid, id, false);
  console.log(`Line #${id} constructor:`, line ? line.constructor.name : 'null');
  console.log(`Line #${id} content:`, JSON.stringify(line, null, 2));

  api.CloseModel(mid);
}

main().catch(console.error);
