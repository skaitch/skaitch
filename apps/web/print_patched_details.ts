import * as fs from 'fs';
import { patchIFC } from './server/bim/patchIFC';
import * as WebIFC from 'web-ifc';

async function main() {
  const api = new WebIFC.IfcAPI();
  await api.Init();

  const ifcPath = 'ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc';
  const buffer = fs.readFileSync(ifcPath);

  const mid = api.OpenModel(buffer);
  
  function vecToArray(vec: any): number[] {
    const arr: number[] = [];
    for (let i = 0; i < vec.size(); i++) arr.push(vec.get(i));
    return arr;
  }

  const items: any = {};
  items['proj_1'] = { id: 'proj_1', type: 'Project', ifcType: 'IfcProject', name: 'Project' };
  items['bld_1'] = { id: 'bld_1', type: 'Building', ifcType: 'IfcBuilding', name: 'Building', parentId: 'proj_1' };
  items['sty_lvl_0'] = { id: 'sty_lvl_0', type: 'Storey', ifcType: 'IfcBuildingStorey', name: 'Niveau 0', parentId: 'bld_1', geom: { level: 0 } };

  // Just one furniture item to see what is patched!
  const furIds = vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCFURNISHINGELEMENT, true));
  const fid = furIds[0];
  console.log('Original furniture line:', api.GetLine(mid, fid, true));
  
  items[`fur_${fid}`] = { 
    id: `fur_${fid}`, 
    type: 'Furniture', 
    ifcType: 'IfcFurniture', 
    name: 'Test Furniture', 
    parentId: 'sty_lvl_0', 
    geom: { x: 2, y: 3, w: 1, d: 1, h: 1, rotation: 0.5, _placementWorld: [2, 3] } 
  };

  api.CloseModel(mid);

  const patchedText = await patchIFC(items, buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  
  // Find the lines containing the patched furniture ID and show them
  const lines = patchedText.split('\n');
  const patchedLine = lines.find(l => l.startsWith(`#${fid}=`));
  console.log('Patched furniture line:', patchedLine);

  // Let's also print the last 15 lines of the patched text (where new placements are written)
  console.log('Last 15 lines of patched IFC:');
  console.log(lines.slice(-15).join('\n'));
}

main().catch(console.error);
