import { readFileSync } from 'fs';
import { importIFCBuffer } from './server/bim/importIFC';

const buf = readFileSync('./public/ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

async function run() {
  const result = await importIFCBuffer(ab, () => {});
  const items = result.items;
  
  for (const id in items) {
    const item = items[id];
    if (item.type === 'Window' || item.type === 'Door') {
      const expId = id.split('_').pop();
      console.log(`Item ${id}, expId: ${expId}, geom.openingExpId: ${(item as any).geom?.openingExpId}`);
    }
  }
}
run();
