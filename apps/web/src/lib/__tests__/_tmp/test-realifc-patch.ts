// Patch the real sample IFC and check the result.
import { readFileSync, writeFileSync } from 'fs';
import { patchIFC } from '@skaitch/core/bim/patchIFC';

const ifcText = readFileSync('public/ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc', 'utf-8');
const buf = new TextEncoder().encode(ifcText).buffer;

// Get all IFCWINDOW entities
const windowRe = /#(\d+)=IFCWINDOW\(/g;
let m;
const windows: string[] = [];
while ((m = windowRe.exec(ifcText)) !== null) {
  windows.push(m[1]);
}
console.log('Windows in IFC:', windows);

// Build minimal items map: walls + the 4 windows
// First, get all IFCWALL entities and find walls
const wallRe = /#(\d+)=IFCWALL\w*\(/g;
const walls: string[] = [];
while ((m = wallRe.exec(ifcText)) !== null) {
  walls.push(m[1]);
}
console.log('Walls in IFC:', walls.length);

// Pick a wall that has windows (look at first window's parent wall)
const firstWindow = ifcText.match(/#(\d+)=IFCWINDOW\([^)]*\)/);
if (!firstWindow) { console.error('No window found'); process.exit(1); }

const items: any = {
  s_1: { id: 's_1', type: 'Storey', name: 'S1', GlobalId: 'g1', parentId: '', geom: { level: 0 } },
};

// Add all walls (with arbitrary geometry)
for (const wid of walls) {
  items[`w_${wid}`] = {
    id: `w_${wid}`,
    type: 'Wall',
    name: `W${wid}`,
    GlobalId: `wall-${wid}`,
    parentId: 's_1',
    geom: { x1: 0, y1: 0, x2: 5, y2: 0, thickness: 0.2, height: 3 },
  };
}

// Add all windows
for (let i = 0; i < windows.length; i++) {
  const wid = windows[i];
  items[`wn_${wid}`] = {
    id: `wn_${wid}`,
    type: 'Window',
    name: `Win${i}`,
    GlobalId: `win-${wid}`,
    parentId: 's_1',
    OverallWidth: 1,
    OverallHeight: 1.2,
    OperationType: 'SINGLE_PANEL',
    geom: { wallId: `w_${walls[0]}`, t: 0.1 + 0.2 * i, width: 1.0, height: 1.2, sillHeight: 0.9, openingExpId: null },
  };
}

// Mark only the FIRST window as edited (simulate moving it)
items[`wn_${windows[0]}`].geom.t = 0.5; // move to t=0.5
items[`wn_${windows[0]}`].geom._edited = true;

console.log('Items count:', Object.keys(items).length);
console.log('Edited window:', `wn_${windows[0]}`);

(async () => {
  const patched = await patchIFC(items, buf);
  
  // Find all window positions in the patched IFC
  console.log('\n--- After patching ---');
  for (let i = 0; i < windows.length; i++) {
    const wid = windows[i];
    // Find the window line
    const wRe = new RegExp(`#${wid}=IFCWINDOW\\(([^)]*)\\)`);
    const wMatch = patched.match(wRe);
    if (!wMatch) { console.log(`Window #${wid}: NOT FOUND`); continue; }
    
    // Find its ObjectPlacement
    const args = wMatch[1].split(',');
    const objPlacRef = args[5]?.replace(/^#/, '').trim();
    if (!objPlacRef) { console.log(`Window #${wid}: NO ObjectPlacement`); continue; }
    
    // Follow the chain to get the position
    const placRe = new RegExp(`#${objPlacRef}=IFCLOCALPLACEMENT\\(([^)]+)\\)`);
    const placMatch = patched.match(placRe);
    if (!placMatch) { console.log(`Window #${wid}: NO placement #${objPlacRef}`); continue; }
    
    const placArgs = placMatch[1].split(',');
    const parentPlac = placArgs[0]?.replace(/^#/, '').trim();
    const ax2plac = placArgs[1]?.replace(/^#/, '').trim();
    
    if (ax2plac) {
      const axRe = new RegExp(`#${ax2plac}=IFCAXIS2PLACEMENT3D\\(([^)]+)\\)`);
      const axMatch = patched.match(axRe);
      if (axMatch) {
        const axArgs = axMatch[1].split(',');
        const ptRef = axArgs[0]?.replace(/^#/, '').trim();
        if (ptRef) {
          const ptRe = new RegExp(`#${ptRef}=IFCCARTESIANPOINT\\(([^)]+)\\)`);
          const ptMatch = patched.match(ptRe);
          if (ptMatch) {
            console.log(`Window #${wid}: ObjectPlacement=#${objPlacRef} parent=#${parentPlac} -> pt=#${ptRef} (${ptMatch[1]})`);
          }
        }
      }
    }
  }
  
  // Also check the openings
  console.log('\n--- Openings after patching ---');
  const openingRe = /#(\d+)=IFCOPENINGELEMENT\(/g;
  const openings: string[] = [];
  while ((m = openingRe.exec(patched)) !== null) {
    openings.push(m[1]);
  }
  for (const oid of openings) {
    const oRe = new RegExp(`#${oid}=IFCOPENINGELEMENT\\(([^)]*)\\)`);
    const oMatch = patched.match(oRe);
    if (!oMatch) continue;
    const args = oMatch[1].split(',');
    const objPlacRef = args[5]?.replace(/^#/, '').trim();
    if (!objPlacRef) continue;
    
    const placRe = new RegExp(`#${objPlacRef}=IFCLOCALPLACEMENT\\(([^)]+)\\)`);
    const placMatch = patched.match(placRe);
    if (!placMatch) continue;
    
    const placArgs = placMatch[1].split(',');
    const ax2plac = placArgs[1]?.replace(/^#/, '').trim();
    if (ax2plac) {
      const axRe = new RegExp(`#${ax2plac}=IFCAXIS2PLACEMENT3D\\(([^)]+)\\)`);
      const axMatch = patched.match(axRe);
      if (axMatch) {
        const axArgs = axMatch[1].split(',');
        const ptRef = axArgs[0]?.replace(/^#/, '').trim();
        if (ptRef) {
          const ptRe = new RegExp(`#${ptRef}=IFCCARTESIANPOINT\\(([^)]+)\\)`);
          const ptMatch = patched.match(ptRe);
          if (ptMatch) {
            console.log(`Opening #${oid}: ObjectPlacement=#${objPlacRef} -> pt=#${ptRef} (${ptMatch[1]})`);
          }
        }
      }
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
