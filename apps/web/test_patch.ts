import { readFileSync, writeFileSync } from 'fs';
import { patchIFC } from './server/bim/patchIFC';
import { importIFCBuffer } from './server/bim/importIFC';

const buf = readFileSync('./public/ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

async function run() {
  const result = await importIFCBuffer(ab, () => {});
  const items = result.items;
  
  let winId = Object.keys(items).find(id => items[id].type === 'Window' && !id.includes('cw'));
  let win = items[winId];
  
  console.log("Found window:", winId, win.geom);
  console.log("Found wall:", items['w_1']);
  
  win.geom.t = 0.8;
  win.geom._edited = true;
  
  const patched = await patchIFC(items, ab);
  
  const openingExpId = win.geom.openingExpId;
  const winExpId = winId.split('_').pop();
  console.log("Window expId:", winExpId, "Opening expId:", openingExpId);
  
  const lines = patched.split('\n');
  for (const line of lines) {
    if (line.startsWith(`#${winExpId}=`)) console.log("Patched window:", line);
    if (openingExpId && line.startsWith(`#${openingExpId}=`)) console.log("Patched opening:", line);
    if (line.startsWith(`#1=`)) console.log("Patched wall:", line);
    const m = line.match(/^#(\d+)=/);
    if (m) {
      const id = parseInt(m[1], 10);
      if (id >= 45700 && id <= 45730) {
        console.log("Injected line:", line);
      }
    }
  }
}
run().catch(console.error);
