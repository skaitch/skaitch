import fs from 'fs';
import { importIFCBuffer } from '@skaitch/core/bim/importIFC';
import { checkRoundTrip } from '@skaitch/core/bim/roundTripCheck';

async function test() {
  const ifcBuffer = fs.readFileSync('public/ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc');
  const buffer = ifcBuffer.buffer.slice(ifcBuffer.byteOffset, ifcBuffer.byteOffset + ifcBuffer.byteLength);
  
  const result = await importIFCBuffer(buffer, () => {});
  
  const ifcText = new TextDecoder().decode(buffer);
  const rtResult = checkRoundTrip(result.items, ifcText);
  console.log(rtResult.report);

  // Summarise counts by type
  const byType: Record<string, number> = {};
  for (const item of Object.values(result.items)) {
    byType[item.type] = (byType[item.type] || 0) + 1;
  }
  console.log('\nItems by type:', byType);

  // Check GlobalId coverage
  let withId = 0, withoutId = 0;
  for (const item of Object.values(result.items)) {
    if ((item as any).GlobalId) withId++;
    else withoutId++;
  }
  console.log(`\nGlobalId coverage: ${withId} with, ${withoutId} without`);
}

test().catch(console.error);
