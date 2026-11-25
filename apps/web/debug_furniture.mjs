import * as WebIFC from 'web-ifc';
import * as fs from 'fs';

const api = new WebIFC.IfcAPI();
await api.Init();
const data = fs.readFileSync('ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc');
const mid = api.OpenModel(data);
const scale = 0.001;

function getRef(v) {
  if (!v) return null;
  if (typeof v === 'object' && v.value !== undefined) return typeof v.value === 'number' ? v.value : null;
  if (typeof v === 'number') return v;
  return null;
}
function coordNum(v) {
  if (!v) return 0;
  if (typeof v === 'object' && v.value !== undefined) return Number(v.value) || 0;
  return Number(v) || 0;
}

// Check a few key furniture items
const checkIds = [39938, 39651, 19218, 40695]; // desk, piano, couch, bed

for (const id of checkIds) {
  console.log(`\n=== #${id} ===`);
  const line = api.GetLine(mid, id, false);
  console.log('Name:', line?.Name?.value || line?.Name || '?');
  
  // ObjectPlacement
  const placId = getRef(line?.ObjectPlacement);
  if (placId) {
    const plac = api.GetLine(mid, placId, false);
    const relId = getRef(plac?.RelativePlacement);
    if (relId) {
      const rel = api.GetLine(mid, relId, false);
      const locId = getRef(rel?.Location);
      if (locId) {
        const pt = api.GetLine(mid, locId, false);
        const coords = pt?.Coordinates || [];
        const x = coordNum(coords[0]) * scale;
        const y = coordNum(coords[1]) * scale;
        console.log(`ObjectPlacement origin: (${x.toFixed(4)}, ${y.toFixed(4)})`);
      }
      // RefDirection
      const rdId = getRef(rel?.RefDirection);
      if (rdId) {
        const rd = api.GetLine(mid, rdId, false);
        const dr = rd?.DirectionRatios || [];
        console.log(`RefDirection: [${coordNum(dr[0]).toFixed(4)}, ${coordNum(dr[1]).toFixed(4)}]`);
      } else {
        console.log('RefDirection: none (identity)');
      }
    }
  }
  
  // Representation -> find MappedItem -> MappingTarget
  const reprId = getRef(line?.Representation);
  if (reprId) {
    const repr = api.GetLine(mid, reprId, false);
    const reprs = repr?.Representations || [];
    for (const rRef of reprs) {
      const rId = getRef(rRef);
      if (!rId) continue;
      const rep = api.GetLine(mid, rId, false);
      const ident = (rep?.RepresentationIdentifier?.value || '').toLowerCase();
      const items = rep?.Items || [];
      for (const iRef of items) {
        const iId = getRef(iRef);
        if (!iId) continue;
        const item = api.GetLine(mid, iId, false);
        const targetRef = getRef(item?.MappingTarget);
        if (targetRef) {
          console.log(`Repr '${ident}': MappedItem found, MappingTarget=#${targetRef}`);
          const target = api.GetLine(mid, targetRef, false);
          const locRef = getRef(target?.LocalOrigin || target?.Origin);
          if (locRef) {
            const pt = api.GetLine(mid, locRef, false);
            const c = pt?.Coordinates || [];
            console.log(`  MappingTarget LocalOrigin: (${coordNum(c[0])*scale}, ${coordNum(c[1])*scale}, ${coordNum(c[2])*scale})`);
          }
          const ax1Ref = getRef(target?.Axis1);
          if (ax1Ref) {
            const ax1 = api.GetLine(mid, ax1Ref, false);
            const dr = ax1?.DirectionRatios || [];
            console.log(`  Axis1: [${coordNum(dr[0]).toFixed(4)}, ${coordNum(dr[1]).toFixed(4)}, ${coordNum(dr[2]).toFixed(4)}]`);
          }
          const ax2Ref = getRef(target?.Axis2);
          if (ax2Ref) {
            const ax2 = api.GetLine(mid, ax2Ref, false);
            const dr = ax2?.DirectionRatios || [];
            console.log(`  Axis2: [${coordNum(dr[0]).toFixed(4)}, ${coordNum(dr[1]).toFixed(4)}, ${coordNum(dr[2]).toFixed(4)}]`);
          }
        }
        // BoundingBox
        const xDim = coordNum(item?.XDim);
        if (xDim > 0) {
          const cornerRef = getRef(item?.Corner);
          let cx=0, cy=0;
          if (cornerRef) {
            const cp = api.GetLine(mid, cornerRef, false);
            const c = cp?.Coordinates || [];
            cx = coordNum(c[0]) * scale;
            cy = coordNum(c[1]) * scale;
          }
          console.log(`BBox repr '${ident}': dims=(${(xDim*scale).toFixed(4)}, ${(coordNum(item?.YDim)*scale).toFixed(4)}), corner=(${cx.toFixed(4)}, ${cy.toFixed(4)})`);
        }
      }
    }
  }
  
  // StreamAllMeshes - check flatTransformation for this element
  let found = false;
  api.StreamAllMeshes(mid, (mesh) => {
    if (mesh.expressID !== id || found) return;
    found = true;
    const geom = mesh.geometries;
    for (let i = 0; i < geom.size(); i++) {
      const placed = geom.get(i);
      const m = placed.flatTransformation;
      console.log(`flatTransformation[12,13,14]: (${m[12].toFixed(4)}, ${m[13].toFixed(4)}, ${m[14].toFixed(4)})`);
      console.log(`flatTransformation rot row0: [${m[0].toFixed(4)}, ${m[4].toFixed(4)}, ${m[8].toFixed(4)}]`);
      console.log(`flatTransformation rot row1: [${m[1].toFixed(4)}, ${m[5].toFixed(4)}, ${m[9].toFixed(4)}]`);
    }
  });
}

api.CloseModel(mid);
