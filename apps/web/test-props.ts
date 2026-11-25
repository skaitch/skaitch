import * as WebIFC from 'web-ifc';
import * as fs from 'fs';

async function test() {
  const api = new WebIFC.IfcAPI();
  api.SetWasmPath('./public/wasm/');
  await api.Init();
  // We don't have the user's IFC file here...
}
test();
