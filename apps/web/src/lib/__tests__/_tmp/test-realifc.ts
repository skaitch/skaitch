// Use the real sample IFC to test the bug.
import { readFileSync } from 'fs';
import { patchIFC } from '@skaitch/core/bim/patchIFC';

const ifcText = readFileSync('public/ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc', 'utf-8');
const buf = new TextEncoder().encode(ifcText).buffer;

// Find all IFCWINDOW entities and their expressIDs
const windowRe = /#(\d+)=IFCWINDOW\(([^)]*)\)/g;
let m;
const windows: { id: string; args: string }[] = [];
while ((m = windowRe.exec(ifcText)) !== null) {
  windows.push({ id: m[1], args: m[2] });
}
console.log('Total windows in IFC:', windows.length);
console.log('First 3 windows:', windows.slice(0, 3));

// Find IFCOPENINGELEMENT entities
const openingRe = /#(\d+)=IFCOPENINGELEMENT\(([^)]*)\)/g;
const openings: { id: string; args: string }[] = [];
while ((m = openingRe.exec(ifcText)) !== null) {
  openings.push({ id: m[1], args: m[2] });
}
console.log('Total openings in IFC:', openings.length);
console.log('First 3 openings:', openings.slice(0, 3));

// Check the ObjectPlacement chain for the first 3 windows
console.log('\n--- First 3 windows: ObjectPlacement chain ---');
for (const w of windows.slice(0, 3)) {
  const args = w.args.split(',');
  const objPlacRef = args[5]?.replace(/^#/, '').trim();
  if (!objPlacRef) continue;
  
  // Find the placement entity
  const placRe = new RegExp(`#${objPlacRef}=IFCLOCALPLACEMENT\\(([^)]*)\\)`);
  const placMatch = ifcText.match(placRe);
  if (!placMatch) continue;
  const placArgs = placMatch[1].split(',');
  const parentPlac = placArgs[0]?.replace(/^#/, '').trim();
  const ax2plac = placArgs[1]?.replace(/^#/, '').trim();
  
  let chainInfo = `#${objPlacRef} (window) -> parent_plac=#${parentPlac} ax2=#${ax2plac}`;
  
  if (ax2plac) {
    const axRe = new RegExp(`#${ax2plac}=IFCAXIS2PLACEMENT3D\\(([^)]*)\\)`);
    const axMatch = ifcText.match(axRe);
    if (axMatch) {
      const axArgs = axMatch[1].split(',');
      const ptRef = axArgs[0]?.replace(/^#/, '').trim();
      if (ptRef) {
        const ptRe = new RegExp(`#${ptRef}=IFCCARTESIANPOINT\\(([^)]*)\\)`);
        const ptMatch = ifcText.match(ptRe);
        if (ptMatch) {
          chainInfo += ` -> pt=#${ptRef} (${ptMatch[1]})`;
          
          // Check how many entities reference this point
          const refRe = new RegExp(`#${ptRef}\\b`, 'g');
          const refs = ifcText.match(refRe) || [];
          chainInfo += ` [refs: ${refs.length}]`;
        }
      }
    }
  }
  
  // Check if the parent_plac is shared with any opening
  if (parentPlac) {
    const openingWithSamePlac = openings.find(o => o.args.split(',')[5]?.replace(/^#/, '').trim() === parentPlac);
    if (openingWithSamePlac) {
      chainInfo += ` *** SHARED with opening #${openingWithSamePlac.id} ***`;
    }
  }
  
  console.log(`Window #${w.id}: ${chainInfo}`);
}

console.log('\n--- First 3 openings: ObjectPlacement chain ---');
for (const o of openings.slice(0, 3)) {
  const args = o.args.split(',');
  const objPlacRef = args[5]?.replace(/^#/, '').trim();
  if (!objPlacRef) continue;
  
  const placRe = new RegExp(`#${objPlacRef}=IFCLOCALPLACEMENT\\(([^)]*)\\)`);
  const placMatch = ifcText.match(placRe);
  if (!placMatch) continue;
  const placArgs = placMatch[1].split(',');
  const parentPlac = placArgs[0]?.replace(/^#/, '').trim();
  
  // Check if any window shares this placement
  const windowWithSamePlac = windows.find(w => {
    const wArgs = w.args.split(',');
    const wObjPlac = wArgs[5]?.replace(/^#/, '').trim();
    if (!wObjPlac) return false;
    // The window's PlacementRelTo is the opening's ObjectPlacement
    const wPlacMatch = ifcText.match(new RegExp(`#${wObjPlac}=IFCLOCALPLACEMENT\\(([^)]*)\\)`));
    if (!wPlacMatch) return false;
    const wPlacArgs = wPlacMatch[1].split(',');
    return wPlacArgs[0]?.replace(/^#/, '').trim() === objPlacRef;
  });
  if (windowWithSamePlac) {
    console.log(`Opening #${o.id}: ObjectPlacement=#${objPlacRef} (parent=#${parentPlac}) *** SHARED with window #${windowWithSamePlac.id} ***`);
  } else {
    console.log(`Opening #${o.id}: ObjectPlacement=#${objPlacRef} (parent=#${parentPlac})`);
  }
}
