const fs = require('fs');
const code = fs.readFileSync('src/lib/importIFC.ts', 'utf8');

// The block to move starts with `report('Propriétés…', 63);`
const propIndex = code.indexOf("  report('Propriétés…', 63);");
// The block ends right before `report('Portes…', 70);`
const doorsIndex = code.indexOf("  report('Portes…', 70);");

if (propIndex === -1 || doorsIndex === -1) {
  console.log("Could not find boundaries");
  process.exit(1);
}

const blockToMove = code.substring(propIndex, doorsIndex);

// We want to insert it right before `report('Murs et Façades…', 40);`
// Wait, we should probably insert it right after `const fallbackStoreyId = ...`
const wallsIndex = code.indexOf("  // ── Helper: stream world-space vertex cloud");

if (wallsIndex === -1) {
  console.log("Could not find walls index");
  process.exit(1);
}

let newCode = code.substring(0, wallsIndex) + blockToMove + code.substring(wallsIndex, propIndex) + code.substring(doorsIndex);

// Also, replace `wallVerts.get(localId)` with `worldVertsMap.get(localId)`
newCode = newCode.replace(/wallVerts\.get/g, 'worldVertsMap.get');

fs.writeFileSync('src/lib/importIFC.ts', newCode);
console.log("Rewrite successful");
