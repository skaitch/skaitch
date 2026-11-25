import * as THREE from 'three';
import { buildStair, slabOpenings, stairComponents, validateStairOpenings } from '../lib/stairGeometry.js';
import { buildOpeningModel } from '../geometry/opening3d.js';
import { buildFurnitureModel } from '../geometry/furniture3d.js';
import { wallRoofShape } from '../lib/wallRoof.js';
import { structuralParts } from '../lib/structuralElements.js';
import { openingSwing } from '../lib/openingOrientation.js';
import type { ItemsMap } from '../types/ifc.js';
import type {
  IfcWallEntity, IfcDoorEntity, IfcWindowEntity,
  IfcSpaceEntity, IfcFurnitureEntity, IfcGenericEntity,
} from '../types/ifc.js';
import { guid } from '../data/starter.js';
import { annotationAnchor, annotationKind, annotationObjectType, annotationPayload, isAnnotation } from './annotationIfc.js';
import { findWallJunctions } from '../lib/wallContinuity.js';
import { buildRoof, roofFaces, roofPredefinedType } from '../lib/roofGeometry.js';

// IFC entity types whose lifecycle is fully managed by this sync engine.
// Any entity of these types present in the original IFC but absent from ItemsMap
// is considered deleted → its Representation is nulled (invisible in ThatOpen).
const MANAGED_IFC_TYPES = new Set([
  'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCCURTAINWALL',
  'IFCDOOR',
  'IFCWINDOW',
  'IFCOPENINGELEMENT',
  'IFCSPACE',
  'IFCSLAB',
  'IFCFURNISHINGELEMENT', 'IFCFURNITURE', 'IFCSYSTEMFURNITUREELEMENT',
  // Generic structural / architectural elements tracked by importIFC
  'IFCCOLUMN', 'IFCCOLUMNSTANDARDCASE',
  'IFCBEAM',   'IFCBEAMSTANDARDCASE',
  'IFCSTAIR',  'IFCSTAIRFLIGHT',
  'IFCRAILING',
  'IFCROOF',
  'IFCCOVERING',
  'IFCPLATE',  'IFCPLATESTANDARDCASE',
  'IFCMEMBER', 'IFCMEMBERSTANDARDCASE',
  'IFCBUILDINGELEMENTPROXY',
  'IFCFLOWTERMINAL', 'IFCFLOWSEGMENT',
  'IFCDISCRETEACCESSORY',
  'IFCELECTRICALELEMENT',
  'IFCCHIMNEY',
  'IFCPILE', 'IFCFOOTING',
  'IFCRAMP',   'IFCRAMPFLIGHT',
]);

// Split a STEP argument string into top-level tokens,
// respecting nested parentheses and quoted strings.
function splitArgs(str: string): string[] {
  const result: string[] = [];
  let depth = 0, inStr = false, start = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inStr) {
      if (c === "'" && str[i + 1] !== "'") inStr = false;
      else if (c === "'") i++;
    } else if (c === "'") {
      inStr = true;
    } else if (c === '(' || c === '[') {
      depth++;
    } else if (c === ')' || c === ']') {
      depth--;
    } else if (c === ',' && depth === 0) {
      result.push(str.slice(start, i).trim());
      start = i + 1;
    }
  }
  result.push(str.slice(start).trim());
  return result;
}

// Rebuild the original IFC buffer from the current ItemsMap state.
//
// Three cases handled per element:
//   1. Element in original IFC AND in ItemsMap  → geometry fully regenerated in place
//   2. Element only in ItemsMap (new)            → injected as new STEP entities
//   3. Element in original IFC, NOT in ItemsMap  → Representation set to $ (invisible)
export async function patchIFC(items: ItemsMap, originalBuffer: ArrayBuffer, centerOffset?: [number, number]): Promise<string> {
  validateStairOpenings(items);
  const decoder = new TextDecoder('utf-8');
  let stepText = decoder.decode(originalBuffer);

  // ── Index all STEP entities ──────────────────────────────────────────────────
  interface Entity { type: string; args: string; start: number; end: number }
  const lineIndex = new Map<string, Entity>();
  const re = /#(\d+)\s*=\s*([A-Z0-9_]+)\((.*)\)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stepText)) !== null)
    lineIndex.set(m[1], { type: m[2], args: m[3], start: m.index, end: m.index + m[0].length });

  let maxId = 0;
  for (const id of lineIndex.keys()) {
    const n = parseInt(id, 10);
    if (!isNaN(n) && n > maxId) maxId = n;
  }

  // Geometric context ID — required for IFCSHAPEREPRESENTATION
  let ctxId = -1;
  // Try to find the 'Body' subcontext first (which most 3D viewers require for 3D solid geometry)
  for (const [id, ent] of lineIndex) {
    if (ent.type === 'IFCGEOMETRICREPRESENTATIONSUBCONTEXT') {
      const args = splitArgs(ent.args);
      if (args[0] && args[0].replace(/['"]/g, '').toLowerCase() === 'body') {
        ctxId = parseInt(id, 10);
        break;
      }
    }
  }
  // Fallback to the main context if 'Body' subcontext is not found
  if (ctxId < 0) {
    for (const [id, ent] of lineIndex) {
      if (ent.type === 'IFCGEOMETRICREPRESENTATIONCONTEXT') {
        ctxId = parseInt(id, 10);
        break;
      }
    }
  }
  if (ctxId < 0) return stepText;

  // ── IFC length unit factor ────────────────────────────────────────────────
  // importIFC stores all coords in metres. IFC files may use mm or cm natively.
  // uf converts metres back to IFC native units for STEP output.
  let uf = 1.0;
  {
    const um = /IFCSIUNIT\s*\([^)]*LENGTHUNIT[^)]*\)/i.exec(stepText);
    if (um) {
      const u = um[0].toUpperCase();
      if (u.includes('MILLI')) uf = 1000;
      else if (u.includes('CENTI')) uf = 100;
    }
  }

  // ── STEP emitter ─────────────────────��──────────────────────────��────────────
  const S   = (v: string | null | undefined) => v ? `'${v.replace(/'/g, "''")}'` : '$';
  const N   = (v: number, d = 6) => v.toFixed(d);
  const REF = (n: number) => `#${n}`;

  let nextId = maxId;
  const newLines: string[] = [];
  const emit = (text: string): number => { const id = ++nextId; newLines.push(`#${id}=${text};`); return id; };

  const pt2 = (x: number, y: number) =>
    emit(`IFCCARTESIANPOINT((${N(x * uf)},${N(y * uf)}))`);
  const pt3 = (x: number, y: number, z: number) =>
    emit(`IFCCARTESIANPOINT((${N(x * uf)},${N(y * uf)},${N(z * uf)}))`);
  const dir = (x: number, y: number, z: number) =>
    emit(`IFCDIRECTION((${N(x)},${N(y)},${N(z)}))`);

  // IFCAXIS2PLACEMENT3D at (ox,oy,oz), Axis=Z, RefDir=(rx,ry,0)
  const ax3 = (ox: number, oy: number, oz: number, rx = 1, ry = 0): number => {
    const o = pt3(ox, oy, oz), az = dir(0, 0, 1), r = dir(rx, ry, 0);
    return emit(`IFCAXIS2PLACEMENT3D(${REF(o)},${REF(az)},${REF(r)})`);
  };

  // IFCLOCALPLACEMENT relative to parentId (null → absolute)
  const plac = (parentId: number | null, ox: number, oy: number, oz: number, rx = 1, ry = 0): number => {
    const a = ax3(ox, oy, oz, rx, ry);
    return emit(`IFCLOCALPLACEMENT(${parentId !== null ? REF(parentId) : '$'},${REF(a)})`);
  };

  const styledSweptSolid = (profN: number, height: number, z = 0, transmission = 0.0, color?: [number, number, number]): number => {
    const d = dir(0, 0, 1), o = pt3(0, 0, z);
    const a = emit(`IFCAXIS2PLACEMENT3D(${REF(o)},$,$)`);
    const e = emit(`IFCEXTRUDEDAREASOLID(${REF(profN)},${REF(a)},${REF(d)},${N(height * uf)})`);
    const [r, g, b] = color ?? [0.72, 0.72, 0.72];
    const c = emit(`IFCCOLOURRGB($,${N(r)},${N(g)},${N(b)})`);
    const sr = emit(`IFCSURFACESTYLERENDERING(${REF(c)},${N(transmission)},$,$,$,$,IFCNORMALISEDRATIOMEASURE(0.5),IFCSPECULAREXPONENT(16.),.NOTDEFINED.)`);
    const ss = emit(`IFCSURFACESTYLE($,.BOTH.,(${REF(sr)}))`);
    const psa = emit(`IFCPRESENTATIONSTYLEASSIGNMENT((${REF(ss)}))`);
    emit(`IFCSTYLEDITEM(${REF(e)},(${REF(psa)}),$)`);
    return e;
  };

  // IFCEXTRUDEDAREASOLID(prof) -> IFCSHAPEREPRESENTATION -> IFCPRODUCTDEFINITIONSHAPE
  const swept = (profN: number, height: number, color?: [number, number, number]): number => {
    const e = styledSweptSolid(profN, height, 0, 0.0, color);
    const r = emit(`IFCSHAPEREPRESENTATION(${REF(ctxId)},\x27Body\x27,\x27SweptSolid\x27,(${REF(e)}))`);
    return emit(`IFCPRODUCTDEFINITIONSHAPE($,$,(${REF(r)}))`);
  };

  // Closed polygon (points in local space) → IFCPRODUCTDEFINITIONSHAPE
  const polyShape = (localPoly: [number, number][], height: number, color?: [number, number, number], holes: [number,number][][] = []): number => {
    const pts = localPoly.map(([x, y]) => pt2(x, y));
    pts.push(pts[0]);
    const poly = emit(`IFCPOLYLINE((${pts.map(REF).join(',')}))`);
    const holeNs=holes.map(hole=>{const vertices=hole.map(([x,y])=>pt2(x,y));vertices.push(vertices[0]);return emit(`IFCPOLYLINE((${vertices.map(REF).join(',')}))`);});
    const prof = emit(holeNs.length ? `IFCARBITRARYPROFILEDEFWITHVOIDS(.AREA.,$,${REF(poly)},(${holeNs.map(REF).join(',')}))` : `IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${REF(poly)})`);
    return swept(prof, height, color);
  };

  // Roof solid as IFCFACETEDBREP (pitched faces can't be a vertical extrusion).
  // Points are relative to (ox, oy); z is relative to the storey placement.
  const roofShape = (geom: any, ox: number, oy: number, color: [number, number, number] = [0.63, 0.27, 0.17]): number | null => {
    const solid = buildRoof(geom);
    if (!solid) return null;
    const faceIds = roofFaces(solid).map((face) => {
      const ptIds = face.map(([x, y, z]) => pt3(x - ox, y - oy, z));
      const loop = emit(`IFCPOLYLOOP((${ptIds.map(REF).join(',')}))`);
      const bound = emit(`IFCFACEOUTERBOUND(${REF(loop)},.T.)`);
      return emit(`IFCFACE((${REF(bound)}))`);
    });
    const shell = emit(`IFCCLOSEDSHELL((${faceIds.map(REF).join(',')}))`);
    const brep = emit(`IFCFACETEDBREP(${REF(shell)})`);
    const c = emit(`IFCCOLOURRGB($,${N(color[0])},${N(color[1])},${N(color[2])})`);
    const sr = emit(`IFCSURFACESTYLERENDERING(${REF(c)},0.,$,$,$,$,IFCNORMALISEDRATIOMEASURE(0.5),IFCSPECULAREXPONENT(16.),.NOTDEFINED.)`);
    const ss = emit(`IFCSURFACESTYLE($,.BOTH.,(${REF(sr)}))`);
    const psa = emit(`IFCPRESENTATIONSTYLEASSIGNMENT((${REF(ss)}))`);
    emit(`IFCSTYLEDITEM(${REF(brep)},(${REF(psa)}),$)`);
    const r = emit(`IFCSHAPEREPRESENTATION(${REF(ctxId)},\x27Body\x27,\x27Brep\x27,(${REF(brep)}))`);
    return emit(`IFCPRODUCTDEFINITIONSHAPE($,$,(${REF(r)}))`);
  };

  // Rectangular prism (w × d footprint, h tall) as SweptSolid → IFCPRODUCTDEFINITIONSHAPE
  // Triangulated face sets only exist in IFC4: older files keep the swept-solid proxies below.
  const isIfc4 = /FILE_SCHEMA\s*\(\s*\(\s*'IFC4/i.test(stepText);

  /**
   * Body from one of the editor's three.js models (Y up, metres) in the element's placement frame
   * (Z up, file units): each mesh becomes a styled IfcTriangulatedFaceSet. IFC4 files only.
   */
  const modelShape = (model: THREE.Object3D): number | null => {
    if (!isIfc4) return null;
    model.updateMatrixWorld(true);
    const point = new THREE.Vector3();
    const styles = new Map<string, number>();
    const sets: number[] = [];
    model.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      const position = mesh.geometry.getAttribute('position');
      if (!position || position.count < 3) return;
      const coords: string[] = [];
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        coords.push(`(${N(point.x * uf)},${N(-point.z * uf)},${N(point.y * uf)})`);
      }
      const index = mesh.geometry.getIndex();
      const count = index ? index.count : position.count;
      const triangles: string[] = [];
      for (let i = 0; i + 2 < count; i += 3) {
        const [a, b, c] = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
        if (a !== b && b !== c && a !== c) triangles.push(`(${a + 1},${b + 1},${c + 1})`);
      }
      if (!triangles.length) return;
      const list = emit(`IFCCARTESIANPOINTLIST3D((${coords.join(',')}),$)`);
      const set = emit(`IFCTRIANGULATEDFACESET(${REF(list)},$,$,(${triangles.join(',')}),$)`);
      const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial & { transmission?: number };
      const hex = new THREE.Color(material?.color ?? 0x9e9e9e).getHex();
      const transparency = Math.min(0.95, Math.max(material?.transparent ? 1 - (material.opacity ?? 1) : 0, (material?.transmission ?? 0) * 0.8));
      const key = `${hex}|${transparency.toFixed(2)}`;
      let style = styles.get(key);
      if (!style) {
        const c = emit(`IFCCOLOURRGB($,${N(((hex >> 16) & 255) / 255)},${N(((hex >> 8) & 255) / 255)},${N((hex & 255) / 255)})`);
        const sr = emit(`IFCSURFACESTYLERENDERING(${REF(c)},${N(transparency)},$,$,$,$,IFCNORMALISEDRATIOMEASURE(0.5),IFCSPECULAREXPONENT(16.),.NOTDEFINED.)`);
        style = emit(`IFCSURFACESTYLE($,.BOTH.,(${REF(sr)}))`);
        styles.set(key, style);
      }
      emit(`IFCSTYLEDITEM(${REF(set)},(${REF(style)}),$)`);
      sets.push(set);
    });
    if (!sets.length) return null;
    const r = emit(`IFCSHAPEREPRESENTATION(${REF(ctxId)},\x27Body\x27,\x27Tessellation\x27,(${sets.map(REF).join(',')}))`);
    return emit(`IFCPRODUCTDEFINITIONSHAPE($,$,(${REF(r)}))`);
  };

  /** A door or window model moved from its centre to the placement origin (start of the opening, floor or sill). */
  const openingModel = (opening: any, wallThickness: number, width: number, height: number): number | null => {
    const model = buildOpeningModel(opening, wallThickness);
    if (!model) return null;
    model.position.set(width / 2, height / 2, 0);
    const holder = new THREE.Group();
    holder.add(model);
    return modelShape(holder);
  };

  const boxShape = (w: number, h: number, d: number, color?: [number, number, number]): number =>
    polyShape([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]], h, color);
  const frameProxyShape = (
    width: number,
    height: number,
    depth: number,
    includeBottom: boolean,
    leaf?: { hinge?: 'left' | 'right' | 'none'; side?: number; angle?: number; x0?: number; x1?: number; yOffset?: number } | Array<{ hinge?: 'left' | 'right' | 'none'; side?: number; angle?: number; x0?: number; x1?: number; yOffset?: number }>,
    frameColor: [number, number, number] = [0.22, 0.24, 0.26], // Modern anthracite dark frame
    leafColor: [number, number, number] = [0.25, 0.27, 0.29],   // Opaque leaf panels/frame
    isDoor = false
  ): number => {
    const solids: number[] = [];
    const rail = Math.max(0.035, Math.min(0.08, Math.min(width, height) * 0.08));
    const addRect = (x0: number, x1: number, z0: number, z1: number) => {
      const w = Math.max(0, x1 - x0);
      const h = Math.max(0, z1 - z0);
      if (w < 0.01 || h < 0.01) return;
      const pts = [[x0, -depth / 2], [x1, -depth / 2], [x1, depth / 2], [x0, depth / 2], [x0, -depth / 2]] as [number, number][];
      const pids = pts.map(([x, y]) => pt2(x, y));
      const poly = emit(`IFCPOLYLINE((${pids.map(REF).join(',')}))`);
      const prof = emit(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${REF(poly)})`);
      solids.push(styledSweptSolid(prof, h, z0, 0.0, frameColor));
    };

    addRect(0, width, Math.max(0, height - rail), height);
    if (includeBottom) addRect(0, width, 0, Math.min(height, rail));
    addRect(0, Math.min(width, rail), 0, height);
    addRect(Math.max(0, width - rail), width, 0, height);

    const leaves = leaf ? (Array.isArray(leaf) ? leaf : [leaf]) : [];
    if (leaves.length > 0) {
      for (const leafSpec of leaves) {
        const leafInset = rail * 1.1;
        const leafDepth = Math.min(0.025, Math.max(0.012, depth * 0.35));
        const x0 = leafSpec.x0 ?? leafInset;
        const x1 = leafSpec.x1 ?? Math.max(leafInset + 0.01, width - leafInset);
        const hinge = leafSpec.hinge ?? 'left';
        const hingeX = hinge === 'right' ? x1 : x0;
        const side = (leafSpec.side ?? 1) >= 0 ? 1 : -1;
        const baseAngle = leafSpec.angle ?? Math.PI / 9;
        const angle = (hinge === 'right' ? -1 : 1) * side * baseAngle;
        const yOffset = leafSpec.yOffset ?? 0;

        const rot = (x: number, y: number): [number, number] => {
          const dx = x - hingeX;
          const dy = y + yOffset;
          return [hingeX + dx * Math.cos(angle) - dy * Math.sin(angle), dx * Math.sin(angle) + dy * Math.cos(angle)];
        };

        const addPanelRect = (px0: number, px1: number, pz0: number, pz1: number, trans = 0.0, color?: [number, number, number]) => {
          const h = Math.max(0, pz1 - pz0);
          if (h < 0.005) return;
          const thickness = trans > 0 ? leafDepth * 0.4 : leafDepth;
          const y0 = -thickness / 2;
          const y1 = thickness / 2;
          const pts = [rot(px0, y0), rot(px1, y0), rot(px1, y1), rot(px0, y1), rot(px0, y0)] as [number, number][];
          const pids = pts.map(([x, y]) => pt2(x, y));
          const poly = emit(`IFCPOLYLINE((${pids.map(REF).join(',')}))`);
          const prof = emit(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${REF(poly)})`);
          solids.push(styledSweptSolid(prof, h, pz0, trans, trans > 0 ? color : leafColor));
        };

        if (isDoor) {
          // Full opaque door leaf panel
          addPanelRect(x0, x1, rail, height - rail);
        } else {
          const leafRail = Math.min(0.05, (x1 - x0) * 0.15);
          const glassX0 = x0 + leafRail;
          const glassX1 = x1 - leafRail;
          const glassZ0 = rail + leafRail;
          const glassZ1 = height - rail - leafRail;

          // Opaque Leaf Frame rails
          addPanelRect(x0, x1, glassZ1, height - rail); // Top
          addPanelRect(x0, x1, rail, glassZ0); // Bottom
          addPanelRect(x0, glassX0, rail, height - rail); // Left
          addPanelRect(glassX1, x1, rail, height - rail); // Right

          // Semi-transparent glass pane (transmission = 0.8, light blue color)
          addPanelRect(glassX0, glassX1, glassZ0, glassZ1, 0.8, [0.65, 0.88, 0.96]);
        }
      }
    } else {
      // Draw a glass panel inside the main outer frame (rail inset) for FIXED windows
      const glassX0 = rail;
      const glassX1 = width - rail;
      const glassZ0 = includeBottom ? rail : 0;
      const glassZ1 = height - rail;

      const glassDepth = depth * 0.15;
      const y0 = -glassDepth / 2;
      const y1 = glassDepth / 2;
      const pts = [[glassX0, y0], [glassX1, y0], [glassX1, y1], [glassX0, y1], [glassX0, y0]] as [number, number][];
      const pids = pts.map(([x, y]) => pt2(x, y));
      const poly = emit(`IFCPOLYLINE((${pids.map(REF).join(',')}))`);
      const prof = emit(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${REF(poly)})`);
      solids.push(styledSweptSolid(prof, glassZ1 - glassZ0, glassZ0, 0.8, [0.65, 0.88, 0.96]));
    }

    const r = emit(`IFCSHAPEREPRESENTATION(${REF(ctxId)},'Body','SweptSolid',(${solids.map(REF).join(',')}))`);
    return emit(`IFCPRODUCTDEFINITIONSHAPE($,$,(${REF(r)}))`);
  };

  const openingHasBody = (openingExpId: string | number): boolean => {
    const ent = lineIndex.get(String(openingExpId));
    if (!ent) return false;
    const a = splitArgs(ent.args);
    return a.length >= 7 && a[6].startsWith('#');
  };

  const wallShapeWithOpenings = (wallId: string, len: number, thickness: number, height: number): number => {
    const attached = wallRoofShape(items[wallId] as IfcWallEntity, items, emit, ctxId);
    if (attached !== null) return attached;
    const ht = thickness / 2;
    const solids: number[] = [];
    const addPiece = (a: number, b: number, z0: number, z1: number) => {
      const segLen = Math.max(0, b - a);
      const h = Math.max(0, z1 - z0);
      if (segLen < 0.01 || h < 0.01) return;
      const pts = [[a, -ht], [b, -ht], [b, ht], [a, ht], [a, -ht]] as [number, number][];
      const pids = pts.map(([x, y]) => pt2(x, y));
      const poly = emit(`IFCPOLYLINE((${pids.map(REF).join(",")}))`);
      const prof = emit(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${REF(poly)})`);
      solids.push(styledSweptSolid(prof, h, z0, 0.0, [0.93, 0.92, 0.88]));
    };

    const openings = Object.values(items)
      .filter((o) => (o.type === "Door" || o.type === "Window") && (o as any).geom?.wallId === wallId)
      .map((o) => {
        const g = (o as any).geom ?? {};
        const width = Math.max(0, Number(g.width ?? 0));
        const center = Math.max(0, Math.min(len, Number(g.t ?? 0) * len));
        const a = Math.max(0, center - width / 2);
        const b = Math.min(len, center + width / 2);
        const sill = o.type === "Window" ? Math.max(0, Number(g.sillHeight ?? 0.9)) : 0;
        const top = Math.min(height, sill + Math.max(0, Number(g.height ?? (o.type === "Door" ? 2.1 : 1.2))));
        return { a, b, sill, top };
      })
      .filter((o) => o.b - o.a > 0.01 && o.top - o.sill > 0.01)
      .sort((a, b) => a.a - b.a);

    let cursor = 0;
    for (const op of openings) {
      if (op.a > cursor) addPiece(cursor, op.a, 0, height);
      addPiece(op.a, op.b, 0, op.sill);
      addPiece(op.a, op.b, op.top, height);
      cursor = Math.max(cursor, op.b);
    }
    if (cursor < len) addPiece(cursor, len, 0, height);
    if (solids.length === 0) addPiece(0, len, 0, height);

    const r = emit(`IFCSHAPEREPRESENTATION(${REF(ctxId)},\x27Body\x27,\x27SweptSolid\x27,(${solids.map(REF).join(",")}))`);
    return emit(`IFCPRODUCTDEFINITIONSHAPE($,$,(${REF(r)}))`);
  };

  // ── Storey placement IDs ───────────────────��──────────────────────���──────────
  const storeyExpIds: Record<string, string> = {};  // appId → IFC expressID string
  for (const item of Object.values(items)) {
    if (item.type !== 'Storey') continue;
    const expId = item.id.split('_').pop();
    if (!expId || !lineIndex.has(expId)) continue;
    storeyExpIds[item.id] = expId;
  }
  const defaultStoreyExpId = Object.values(storeyExpIds)[0] ?? null;

  const storeyPlacIds: Record<string, number> = {};
  for (const [appId, expId] of Object.entries(storeyExpIds)) {
    const ent = lineIndex.get(expId);
    if (ent) {
      const a = splitArgs(ent.args);
      if (a.length >= 6 && a[5].startsWith('#')) {
        storeyPlacIds[appId] = parseInt(a[5].slice(1), 10);
      }
    }
  }
  const defaultStoreyPlacId = Object.values(storeyPlacIds)[0] ?? null;

  // ── Patches collector ────────────────────────��───────────────────────────��───
  const patches: { start: number; end: number; replacement: string }[] = [];
  // Track patched expressIDs to avoid double-patching (e.g. curtain wall + bay window)
  const patchedExpIds = new Set<string>();
  // Track directly-patched STEP line IDs (placement sub-entities, not managed elements)
  const patchedStepIds = new Set<string>();

  const patchLine = (expId: string, newArgs: string[]) => {
    if (patchedExpIds.has(expId)) return;
    patchedExpIds.add(expId);
    const ent = lineIndex.get(expId);
    if (!ent) return;
    patches.push({ start: ent.start, end: ent.end, replacement: `#${expId}=${ent.type}(${newArgs.join(',')});` });
  };

  // Update ObjectPlacement only (arg[5]) — creates a new placement entity.
  // Used as fallback for in-place patching and for new (AI-generated) elements.
  const patchPlacement = (expId: string, newPlacId: number) => {
    if (patchedExpIds.has(expId)) return;
    const ent = lineIndex.get(expId);
    if (!ent) return;
    const a = splitArgs(ent.args);
    if (a.length < 6) return;
    a[5] = REF(newPlacId);
    patchLine(expId, a);
  };

  // Patch an existing element's placement IN-PLACE by updating only the underlying
  // IFCCARTESIANPOINT coordinates. Preserves PlacementRelTo hierarchy exactly as
  // defined in the IFC — sub-elements automatically follow because their
  // PlacementRelTo references remain valid.
  // Falls back to patchPlacement if the chain can't be navigated, or if the
  // target point is a shared global origin (like #13) to avoid distorting other shapes.
  const patchPlacementInPlace = (
    expId: string,
    newParentPlacId: number | null,
    x: number, y: number, z: number,
  ): void => {
    if (patchedExpIds.has(expId)) return;
    const ent = lineIndex.get(expId);
    if (!ent) return;
    const eArgs = splitArgs(ent.args);
    if (eArgs.length < 6 || !eArgs[5].startsWith('#')) { patchPlacement(expId, plac(newParentPlacId, x, y, z)); return; }
    const placId = eArgs[5].slice(1);
    const placEnt = lineIndex.get(placId);
    if (!placEnt || placEnt.type !== 'IFCLOCALPLACEMENT') { patchPlacement(expId, plac(newParentPlacId, x, y, z)); return; }
    const pArgs = splitArgs(placEnt.args);
    if (pArgs.length < 2 || !pArgs[1].startsWith('#')) { patchPlacement(expId, plac(newParentPlacId, x, y, z)); return; }
    const axId = pArgs[1].slice(1);
    const axEnt = lineIndex.get(axId);
    if (!axEnt || axEnt.type !== 'IFCAXIS2PLACEMENT3D') { patchPlacement(expId, plac(newParentPlacId, x, y, z)); return; }
    const axArgs = splitArgs(axEnt.args);
    if (axArgs.length < 1 || !axArgs[0].startsWith('#')) { patchPlacement(expId, plac(newParentPlacId, x, y, z)); return; }
    const ptId = axArgs[0].slice(1);
    const ptEnt = lineIndex.get(ptId);
    if (!ptEnt || ptEnt.type !== 'IFCCARTESIANPOINT') { patchPlacement(expId, plac(newParentPlacId, x, y, z)); return; }

    // Fallback: If this CartesianPoint is a shared global origin point, or referenced elsewhere,
    // do not modify it in-place to avoid breaking other entities.
    const ptEntArgs = ptEnt.args.replace(/[()]/g, '').split(',');
    const isZeroPoint = ptEntArgs.every(val => {
      const parsed = parseFloat(val);
      return !isNaN(parsed) && parsed === 0;
    });
    if (isZeroPoint) {
      console.log(`[patchIFC] Point #${ptId} is a zero origin. Falling back to patchPlacement.`);
      patchPlacement(expId, plac(newParentPlacId, x, y, z));
      return;
    }

    let refCount = 0;
    const refRegex = new RegExp(`\\b#${ptId}\\b`);
    for (const line of lineIndex.values()) {
      if (refRegex.test(line.args)) {
        refCount++;
        if (refCount > 1) break;
      }
    }
    if (refCount > 1) {
      console.log(`[patchIFC] Point #${ptId} is shared (refs: ${refCount}). Falling back to patchPlacement.`);
      patchPlacement(expId, plac(newParentPlacId, x, y, z));
      return;
    }

    // Patch coordinates only — preserve PlacementRelTo hierarchy as defined in IFC
    if (!patchedStepIds.has(ptId)) {
      patchedStepIds.add(ptId);
      patches.push({ start: ptEnt.start, end: ptEnt.end, replacement: `#${ptId}=IFCCARTESIANPOINT((${N(x * uf)},${N(y * uf)},${N(z * uf)}));` });
    }
    patchedExpIds.add(expId);
  };

  // Move an existing wall by patching ITS OWN placement in-place (origin point +
  // RefDirection), instead of repointing the wall to a brand-new IFCLOCALPLACEMENT.
  //
  // Why this matters: hosted openings (IFCOPENINGELEMENT) and their fillers
  // (windows/doors) are placed relative to the wall's ObjectPlacement
  // (PlacementRelTo → wall placement). If we swap the wall's placement for a new
  // entity, the old placement is orphaned and every hosted opening/window keeps
  // referencing it → the wall moves but its openings stay behind. Patching the
  // wall's existing placement in place keeps the reference valid so the whole
  // hierarchy follows automatically.
  //
  // Returns the wall's (unchanged) placement expressID on success, or null if the
  // placement chain can't be navigated / the origin point is shared (caller then
  // falls back to creating a fresh placement).
  const patchWallPlacementInPlace = (
    wallExpId: string,
    ox: number, oy: number, oz: number, rx: number, ry: number,
  ): number | null => {
    const ent = lineIndex.get(wallExpId);
    if (!ent) return null;
    const eArgs = splitArgs(ent.args);
    if (eArgs.length < 6 || !eArgs[5].startsWith('#')) return null;
    const placId = eArgs[5].slice(1);
    const placEnt = lineIndex.get(placId);
    if (!placEnt || placEnt.type !== 'IFCLOCALPLACEMENT') return null;
    const pArgs = splitArgs(placEnt.args);
    if (pArgs.length < 2 || !pArgs[1].startsWith('#')) return null;
    const axId = pArgs[1].slice(1);
    const axEnt = lineIndex.get(axId);
    if (!axEnt || axEnt.type !== 'IFCAXIS2PLACEMENT3D') return null;
    const axArgs = splitArgs(axEnt.args);
    if (axArgs.length < 1 || !axArgs[0].startsWith('#')) return null;
    const ptId = axArgs[0].slice(1);
    const ptEnt = lineIndex.get(ptId);
    if (!ptEnt || ptEnt.type !== 'IFCCARTESIANPOINT') return null;

    // Bail if the origin point is shared with other entities (avoid distorting them).
    let refCount = 0;
    const ptRegex = new RegExp(`\\b#${ptId}\\b`);
    for (const line of lineIndex.values()) {
      if (ptRegex.test(line.args)) { refCount++; if (refCount > 1) break; }
    }
    if (refCount > 1) return null;

    // Patch the origin point in-place.
    if (!patchedStepIds.has(ptId)) {
      patchedStepIds.add(ptId);
      patches.push({ start: ptEnt.start, end: ptEnt.end, replacement: `#${ptId}=IFCCARTESIANPOINT((${N(ox * uf)},${N(oy * uf)},${N(oz * uf)}));` });
    }
    // Set/replace the RefDirection (arg[2]) so wall rotation is honoured. This
    // mirrors the direction the fresh-placement path used (plac(... rx, ry)).
    const refDirId = emit(`IFCDIRECTION((${N(rx)},${N(ry)},${N(0)}))`);
    while (axArgs.length < 3) axArgs.push('$');
    axArgs[2] = REF(refDirId);
    if (!patchedStepIds.has(axId)) {
      patchedStepIds.add(axId);
      patches.push({ start: axEnt.start, end: axEnt.end, replacement: `#${axId}=IFCAXIS2PLACEMENT3D(${axArgs.join(',')});` });
    }
    return parseInt(placId, 10);
  };

  // Update both ObjectPlacement (arg[5]) and Representation (arg[6]).
  // Used only for new (AI-generated) elements that have no original IFC geometry.
  const patchGeom = (expId: string, newPlacId: number, newShapeId: number) => {
    if (patchedExpIds.has(expId)) return;
    const ent = lineIndex.get(expId);
    if (!ent) return;
    const a = splitArgs(ent.args);
    if (a.length < 7) return;
    a[5] = REF(newPlacId);
    a[6] = REF(newShapeId);
    patchLine(expId, a);
  };

  // Update only the Representation (arg[6]) of an existing element.
  const patchRepresentation = (expId: string, newShapeId: number) => {
    const ent = lineIndex.get(expId);
    if (!ent) return;
    const a = splitArgs(ent.args);
    if (a.length < 7) return;
    a[6] = REF(newShapeId);
    patchLine(expId, a);
  };

  const patchNoGeometry = (expId: string) => {
    const ent = lineIndex.get(expId);
    if (!ent) return;
    const a = splitArgs(ent.args);
    if (a.length < 7) return;
    a[5] = '$';
    a[6] = '$';
    patchLine(expId, a);
  };

  // Walls that host an edited (moved/resized) opening — their body must be
  // regenerated so the old hole doesn't linger at the previous position.
  //
  // Why unconditionally (not just for Brep bodies): many imported walls have a
  // "baked" body (Brep/Tessellation) with openings cut into the geometry, so
  // moving the IfcOpeningElement boolean would leave the original hole baked at
  // the old spot → a ghost duplicate (visible with windows hidden, often at a
  // different height). Regenerating the body as a fresh SweptSolid with the
  // openings at their CURRENT positions removes the stale hole. We also can't
  // safely skip "already SweptSolid" bodies: a previously-regenerated body bakes
  // its gaps into the segments too, so on a re-patch (e.g. after AutoFix persists
  // the patched buffer as the new base) it would re-introduce the ghost.
  const wallsWithMovedOpenings = new Set<string>();
  for (const o of Object.values(items)) {
    if ((o.type === 'Door' || o.type === 'Window') && (o as any)?.geom?._edited === true) {
      const wid = (o as any).geom?.wallId;
      if (wid) wallsWithMovedOpenings.add(wid);
    }
  }

  // Returns the IFC expressID string if the item originates from the original IFC
  const existingExpId = (item: { id: string }): string | null => {
    const expId = item.id.split('_').pop();
    return (expId && /^\d+$/.test(expId) && lineIndex.has(expId)) ? expId : null;
  };

  // Restore the centering offset applied by importIFC so exported positions
  // match the original IFC geographic coordinate system.
  const [cox, coy] = centerOffset ?? [0, 0];

  // ── Helpers for wall geometry ────────────────────────────────────────────────
  const getWallDir = (wallId: string): [number, number] => {
    const wall = items[wallId] as IfcWallEntity | undefined;
    if (!wall) return [1, 0];
    const dx = wall.geom.x2 - wall.geom.x1;
    const dy = wall.geom.y2 - wall.geom.y1;
    const len = Math.hypot(dx, dy) || 1;
    return [dx / len, dy / len];
  };
  const getWallThickness = (wallId: string): number =>
    (items[wallId] as IfcWallEntity | undefined)?.geom?.thickness ?? 0.2;
  const getHostedPoint = (wallId: string, t: number, fallback?: [number, number]): [number, number] => {
    const wall = items[wallId] as IfcWallEntity | undefined;
    if (wall) {
      const { x1, y1, x2, y2 } = wall.geom;
      return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    }
    return fallback ?? [0, 0];
  };
  const doorOperationType = (door: IfcDoorEntity): string => {
    const op = String((door as any).OperationType || '').toUpperCase();
    if (op === 'ROLLINGUP') return 'ROLLINGUP';
    if (op === 'SECTIONAL' || op === 'TILT_UP') return 'USERDEFINED';
    if (op.includes('DOUBLE')) return 'DOUBLE_DOOR_SINGLE_SWING';
    if (op.includes('SLIDING')) return 'SLIDING_TO_RIGHT';
    const swing = openingSwing(op, door.geom?.swing);
    if (swing === 'right') return 'SINGLE_SWING_RIGHT';
    return 'SINGLE_SWING_LEFT';
  };
  const windowPartitioningType = (win: IfcWindowEntity): string => {
    const op = String((win as any).OperationType || '').toUpperCase();
    const name = String((win as any).name || (win as any).Name || '').toUpperCase();
    const allowed = new Set([
      'SINGLE_PANEL', 'DOUBLE_PANEL_VERTICAL', 'DOUBLE_PANEL_HORIZONTAL',
      'TRIPLE_PANEL_VERTICAL', 'TRIPLE_PANEL_HORIZONTAL', 'SLIDINGHORIZONTAL',
      'SLIDINGVERTICAL', 'FIXEDCASEMENT', 'TILTANDTURNLEFT', 'TILTANDTURNRIGHT',
      'TOPHUNG', 'BOTTOMHUNG', 'SIDEHUNGLEFT', 'SIDEHUNGRIGHT', 'PIVOTHORIZONTAL',
      'PIVOTVERTICAL', 'OTHEROPERATION', 'NOTDEFINED',
    ]);
    if (allowed.has(op)) return op;
    if (op.includes('SLIDING') || name.includes('COULISS') || name.includes('BAIE')) return 'SLIDINGHORIZONTAL';
    if (op.includes('FIXED') || name.includes('FIXE')) return 'FIXEDCASEMENT';
    if (op.includes('DOUBLE') || name.includes('DOUBLE') || name.includes('2V')) return 'DOUBLE_PANEL_VERTICAL';
    return 'SINGLE_PANEL';
  };
  const wasEdited = (item: unknown): boolean => (item as any)?.geom?._edited === true;
  const wasShapeEdited = (item: unknown): boolean => (item as any)?.geom?._shapeEdited === true;

  // ── Case 3: null out representation of deleted elements ─────────────────────
  const activeExpIds = new Set<string>();
  for (const item of Object.values(items)) {
    const expId = existingExpId(item);
    if (expId) activeExpIds.add(expId);
    // Also protect via stored openingExpId (set during import when link was captured)
    const oeId = (item as any).geom?.openingExpId;
    if (oeId != null) activeExpIds.add(String(oeId));
  }

  // Parse IFCRELFILLSELEMENT: protect openings whose filler is still active.
  // Only openings with explicitly deleted fillers become nullable.
  const nullableOpenings = new Set<string>();
  const openingByFillerExpId = new Map<string, string>();
  for (const [, ent] of lineIndex) {
    if (ent.type !== 'IFCRELFILLSELEMENT') continue;
    const a = splitArgs(ent.args);
    if (a.length < 6) continue;
    const openingId = a[4].replace(/^#/, '').trim();
    const fillerId  = a[5].replace(/^#/, '').trim();
    if (!openingId || !fillerId) continue;
    openingByFillerExpId.set(fillerId, openingId);
    if (activeExpIds.has(fillerId)) {
      activeExpIds.add(openingId);
    } else {
      nullableOpenings.add(openingId);
    }
  }

  // Fallback for IFC files without IFCRELFILLSELEMENT (e.g. IFC4 SampleHouse):
  // the window/door's PlacementRelTo IS the opening's ObjectPlacement.
  // Build a reverse map: objectPlacementId → openingExpId.
  const openingByObjPlacId = new Map<string, string>();
  for (const [id, ent] of lineIndex) {
    if (ent.type !== 'IFCOPENINGELEMENT') continue;
    const a = splitArgs(ent.args);
    if (a.length >= 6 && a[5].startsWith('#')) {
      openingByObjPlacId.set(a[5].slice(1), id);
    }
  }
  // Given a door/window expId, find its opening via:
  // 1. Direct check: do they share the same ObjectPlacement?
  // 2. Hierarchy check: door.ObjectPlacement.PlacementRelTo → opening
  const findOpeningViaPlacement = (elemExpId: string): string | null => {
    const ent = lineIndex.get(elemExpId);
    if (!ent) return null;
    const ea = splitArgs(ent.args);
    if (ea.length < 6 || !ea[5].startsWith('#')) return null;
    const placId = ea[5].slice(1);
    const directOpening = openingByObjPlacId.get(placId);
    if (directOpening) return directOpening;
    const placEnt = lineIndex.get(placId);
    if (!placEnt || placEnt.type !== 'IFCLOCALPLACEMENT') return null;
    const pa = splitArgs(placEnt.args);
    if (pa[0] && pa[0].startsWith('#')) {
      const parentPlacId = pa[0].slice(1);
      const parentOpening = openingByObjPlacId.get(parentPlacId);
      if (parentOpening) return parentOpening;
    }
    return null;
  };

  // Parse IFCRELAGGREGATES: protect sub-elements (e.g. curtain wall members/plates)
  // whose parent aggregate is active. This prevents armatures from being nulled when
  // the curtain wall item is in ItemsMap but its sub-elements weren't separately imported.
  for (const [, ent] of lineIndex) {
    if (ent.type !== 'IFCRELAGGREGATES') continue;
    const a = splitArgs(ent.args);
    if (a.length < 6) continue;
    const parentId = a[4].replace(/^#/, '').trim();
    if (!activeExpIds.has(parentId)) continue;
    // RelatedObjects is a parenthesised list: (#id1,#id2,...)
    const listStr = a[5].replace(/[()]/g, '');
    for (const ref of listStr.split(',')) {
      const childId = ref.replace(/^#/, '').trim();
      if (childId) activeExpIds.add(childId);
    }
  }

  let nulledCount = 0;
  for (const [id, ent] of lineIndex) {
    if (!MANAGED_IFC_TYPES.has(ent.type)) continue;
    if (activeExpIds.has(id)) continue;
    // Only null openings that are explicitly linked to a deleted managed filler.
    // Pure openings (no IFCRELFILLSELEMENT) and openings with untracked fillers are preserved.
    if (ent.type === 'IFCOPENINGELEMENT' && !nullableOpenings.has(id)) continue;
    const a = splitArgs(ent.args);
    if (a.length >= 7) {
      a[5] = '$'; a[6] = '$'; patchLine(id, a);
      nulledCount++;
    }
  }
  if (nulledCount > 0) console.log(`[patchIFC] Nulled ${nulledCount} elements`);

  // ── Cases 1 & 2: update existing / inject new elements ─────────────��─────────
  interface Bucket { contained: number[]; spaces: number[] }
  const buckets: Record<string, Bucket> = {};
  const getBucket = (id: string): Bucket => (buckets[id] ??= { contained: [], spaces: [] });

  // Track expressIDs of newly emitted entities so doors/windows can reference new walls
  const newExpIds = new Map<string, string>();
  const resolveExpId = (itemOrId: { id: string } | string): string | null => {
    const id = typeof itemOrId === 'string' ? itemOrId : itemOrId.id;
    return existingExpId({ id }) ?? newExpIds.get(id) ?? null;
  };

  const patchedWallPlacements = new Map<string, number>();

  const getObjectPlacementId = (expId: string): number | null => {
    const ent = lineIndex.get(expId);
    if (!ent) return null;
    const a = splitArgs(ent.args);
    if (a.length >= 6 && a[5].startsWith('#')) {
      return parseInt(a[5].slice(1), 10);
    }
    return null;
  };

  const getWallPlacementId = (wallId: string): number | null => {
    if (patchedWallPlacements.has(wallId)) {
      return patchedWallPlacements.get(wallId)!;
    }
    const wallExpId = resolveExpId(wallId);
    if (wallExpId) {
      const plc = getObjectPlacementId(wallExpId);
      if (plc !== null) return plc;
    }
    return null;
  };

  for (const item of Object.values(items)) {
    // Curtain wall bay windows (wn_cw_N) share their expressID with the wall.
    // The wall item already handles patching that STEP entity.
    if (item.id.startsWith('wn_cw_')) continue;

    const expId    = existingExpId(item);
    const storeyId = item.parentId ?? '';
    const parentPlacId = storeyPlacIds[storeyId] ?? defaultStoreyPlacId;

    switch (item.type) {

      // ── Wall (IFCWALL / IFCWALLSTANDARDCASE / IFCCURTAINWALL) ────────────���─
      case 'Wall': {
        const w = item as IfcWallEntity;
        if (wasEdited(w)) {
          console.log('[patchIFC] Wall (Edited):', { id: w.id, name: w.name, expId, geom: `${w.geom.x1.toFixed(2)},${w.geom.y1.toFixed(2)} → ${w.geom.x2.toFixed(2)},${w.geom.y2.toFixed(2)}` });
        }
        const { x1, y1, x2, y2 } = w.geom;
        const thickness = Number.isFinite(w.geom.thickness) && w.geom.thickness > 0 ? w.geom.thickness : 0.2;
        const height = Number.isFinite(w.geom.height) && w.geom.height > 0 ? w.geom.height : 2.7;
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ang = Math.atan2(dy, dx);
        if (expId) {
          // If a hosted opening moved, regenerate the wall body as a SweptSolid
          // with the openings at their CURRENT positions (see note above the
          // wallsWithMovedOpenings set for why this is unconditional).
          const newShapeId = (w.geom.roofId || wallsWithMovedOpenings.has(w.id))
            ? wallShapeWithOpenings(w.id, len, thickness, height)
            : null;
          if (wasEdited(w)) {
            // Keep the imported wall representation otherwise intact. Replacing an
            // existing IfcWallStandardCase body with a synthetic profile can make
            // some viewers drop the wall; movement only needs a placement patch.
            //
            // Patch the wall's OWN placement in-place first so that hosted
            // openings/windows (placed relative to it) follow automatically.
            // Only if the chain can't be navigated do we fall back to swapping in
            // a fresh placement (which would otherwise orphan the old one and
            // leave openings behind).
            const inPlaceId = patchWallPlacementInPlace(expId, x1 + cox, y1 + coy, 0, Math.cos(ang), Math.sin(ang));
            if (inPlaceId !== null) {
              patchedWallPlacements.set(w.id, inPlaceId);
              if (newShapeId !== null) patchRepresentation(expId, newShapeId);
            } else {
              // Fallback: rewrite the wall line once with both placement and
              // (optionally) the regenerated representation.
              const newPlacId = plac(parentPlacId, x1 + cox, y1 + coy, 0, Math.cos(ang), Math.sin(ang));
              const wa = splitArgs(lineIndex.get(expId)!.args);
              if (wa.length >= 7) {
                wa[5] = REF(newPlacId);
                if (newShapeId !== null) wa[6] = REF(newShapeId);
                patchLine(expId, wa);
              }
              patchedWallPlacements.set(w.id, newPlacId);
            }
          } else if (newShapeId !== null) {
            patchRepresentation(expId, newShapeId);
          }
          break;
        }
        const wallPlac = plac(parentPlacId, x1 + cox, y1 + coy, 0, Math.cos(ang), Math.sin(ang));
        patchedWallPlacements.set(w.id, wallPlac);
        {
          const wallShape = wallShapeWithOpenings(w.id, len, thickness, height);
          const id = emit(`IFCWALL(${S(w.GlobalId)},$,${S(w.name)},$,$,${REF(wallPlac)},${REF(wallShape)},$)`);
          newExpIds.set(w.id, String(id));
          getBucket(storeyId).contained.push(id);
        }
        break;
      }

      // ── Door ───────────────────────��────────────────────────────���──────────
      case 'Door': {
        const d = item as IfcDoorEntity;
        const wallOpeningsWereRegenerated = wallsWithMovedOpenings.has(d.geom.wallId);
        if (expId && !wasEdited(d) && !wallOpeningsWereRegenerated) {
          break;
        }
        const { width, height, _placementWorld } = d.geom;
        const [dpw_x, dpw_y] = getHostedPoint(d.geom.wallId, d.geom.t, _placementWorld);
        const [drx, dry] = getWallDir(d.geom.wallId);
        const wallT = getWallThickness(d.geom.wallId);
        const wallPlacId = getWallPlacementId(d.geom.wallId);
        const hostWall = items[d.geom.wallId] as IfcWallEntity | undefined;

        // Placed in the storey frame from the editor's world point: an existing wall's own
        // placement origin need not sit at the editor's wall start (endpoints are trimmed on import).
        const dPlac = plac(parentPlacId, (dpw_x - drx * width / 2) + cox, (dpw_y - dry * width / 2) + coy, 0, drx, dry);
        const oPlac = plac(parentPlacId, dpw_x + cox, dpw_y + coy, 0, drx, dry);
        if (expId) {
          if (wasEdited(d) || wallOpeningsWereRegenerated) {
            const openingExpId = (d as any).geom?.openingExpId ?? openingByFillerExpId.get(expId) ?? findOpeningViaPlacement(expId);
            console.log(`[patchIFC] Patching Door #${expId} "${d.name}", resolved openingExpId:`, openingExpId);
            let local_y = 0;
            let old_local_x: number | null = null;
            let opParentPlacId: string | null = null;
            if (openingExpId != null) {
              const ent = lineIndex.get(String(openingExpId));
              if (ent) {
                const a = splitArgs(ent.args);
                if (a.length >= 6 && a[5].startsWith('#')) {
                  const placId = a[5].slice(1);
                  const placEnt = lineIndex.get(placId);
                  if (placEnt && placEnt.type === 'IFCLOCALPLACEMENT') {
                    const pa = splitArgs(placEnt.args);
                    if (pa.length >= 2 && pa[1].startsWith('#')) {
                      const ax2Id = pa[1].slice(1);
                      const ax2Ent = lineIndex.get(ax2Id);
                      if (ax2Ent && ax2Ent.type === 'IFCAXIS2PLACEMENT3D') {
                        const aa = splitArgs(ax2Ent.args);
                        if (aa.length >= 1 && aa[0].startsWith('#')) {
                          const ptId = aa[0].slice(1);
                          const ptEnt = lineIndex.get(ptId);
                          if (ptEnt && ptEnt.type === 'IFCCARTESIANPOINT') {
                            const coords = ptEnt.args.replace(/[()]/g, '').split(',');
                            if (coords.length >= 3) {
                              local_y = parseFloat(coords[1]) / uf;
                              old_local_x = parseFloat(coords[0]) / uf;
                              opParentPlacId = pa[0].startsWith('#') ? pa[0].slice(1) : null;
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
            if (openingExpId != null) {
              // Only patch the opening's CartesianPoint — the door's placement is
              // relative to the opening, so it follows automatically via the chain.
              if (wallPlacId !== null && hostWall) {
                const wGeom = hostWall.geom;
                const dx = wGeom.x2 - wGeom.x1, dy = wGeom.y2 - wGeom.y1;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                // Keep the file's own origin convention (start, centre, meshed or not): shift the
                // origin by how far the opening moved along the wall since import.
                const oldT = ((d.geom as any)._openingT);
                const local_x = typeof oldT === 'number' && old_local_x !== null && opParentPlacId === String(wallPlacId)
                  ? old_local_x + (d.geom.t - oldT) * len
                  : d.geom.t * len - (openingHasBody(openingExpId) ? width / 2 : 0);
                patchPlacementInPlace(String(openingExpId), wallPlacId, local_x, local_y, 0);
                console.log(`[patchIFC] Door #${expId}: Opening #${openingExpId} patched in-place, local X: ${local_x.toFixed(3)}, Y: ${local_y}`);
              } else {
                const offsetX = -dry * local_y;
                const offsetY = drx * local_y;
                const local_x = dpw_x + cox + offsetX;
                const local_y_storey = dpw_y + coy + offsetY;
                patchPlacementInPlace(String(openingExpId), parentPlacId, local_x, local_y_storey, 0);
                console.log(`[patchIFC] Door #${expId}: Opening #${openingExpId} patched in-place (storey), X: ${local_x.toFixed(3)}, Y: ${local_y_storey.toFixed(3)}`);
              }
              // Mark the door as handled — its placement follows the opening automatically
              patchedExpIds.add(expId);
            } else {
              // No opening found — patch the door directly
              console.warn(`[patchIFC] Door #${expId} opening placement NOT found, patching door directly`);
              patchPlacementInPlace(expId, parentPlacId, dpw_x + cox, dpw_y + coy, 0);
            }
          }
          break;
        }
        {
          const doorOp = doorOperationType(d);
          const doorHinge = doorOp.includes('RIGHT') ? 'right' : 'left';
          const doorSide = Number(d.geom.side ?? 1) >= 0 ? 1 : -1;
          const dShape = (wallPlacId !== null && hostWall ? openingModel(d, hostWall.geom.thickness ?? 0.2, width, height) : null)
            ?? frameProxyShape(width, height, 0.08, false, { hinge: doorHinge, side: doorSide, angle: doorOp === 'ROLLINGUP' || doorOp === 'USERDEFINED' ? 0 : Math.PI / 7 }, [0.22, 0.24, 0.26], [0.55, 0.38, 0.23], true);
          const id = emit(`IFCDOOR(${S(d.GlobalId)},$,${S(d.name)},$,$,${REF(dPlac)},${REF(dShape)},$,${N(height * uf)},${N(width * uf)},.DOOR.,.${doorOp}.,${doorOp === 'USERDEFINED' ? S(d.OperationType) : '$'})`);
          newExpIds.set(d.id, String(id));
          const oid = emit(`IFCOPENINGELEMENT(${S(guid(`op_${d.id}`))},$,${S(d.name + ' Vide')},$,$,${REF(oPlac)},$,$,.OPENING.)`);
          const hostExpId = resolveExpId(d.geom.wallId);
          if (hostExpId) emit(`IFCRELVOIDSELEMENT(${S(guid(`rvw_${d.id}`))},$,$,$,#${hostExpId},${REF(oid)})`);
          emit(`IFCRELFILLSELEMENT(${S(guid(`rfe_${d.id}`))},$,$,$,${REF(oid)},${REF(id)})`);
          getBucket(storeyId).contained.push(id);
        }
        break;
      }

      // ── Window ───────────────────────��─────────────────────────────────────
      case 'Window': {
        const w = item as IfcWindowEntity;
        const patchWindowPartitioning = () => {
          if (!expId) return;
          const ent = lineIndex.get(expId);
          if (!ent || ent.type !== 'IFCWINDOW') return;
          const a = splitArgs(ent.args);
          while (a.length < 13) a.push('$');
          a[10] = '.WINDOW.';
          a[11] = '.' + windowPartitioningType(w) + '.';
          a[12] = '$';
          patches.push({ start: ent.start, end: ent.end, replacement: '#' + expId + '=' + ent.type + '(' + a.join(',') + ');' });
        };
        const wallOpeningsWereRegenerated = wallsWithMovedOpenings.has(w.geom.wallId);
        if (expId && !wasEdited(w) && !wallOpeningsWereRegenerated) {
          patchWindowPartitioning();
          break;
        }
        const { width, height, sillHeight, _placementWorld } = w.geom;
        const [wpw_x, wpw_y] = getHostedPoint(w.geom.wallId, w.geom.t, _placementWorld);
        const sill = sillHeight ?? 0.9;
        const [wrx, wry] = getWallDir(w.geom.wallId);
        const wallT = getWallThickness(w.geom.wallId);
        const wallPlacId = getWallPlacementId(w.geom.wallId);
        const hostWall = items[w.geom.wallId] as IfcWallEntity | undefined;

        // Placed in the storey frame from the editor's world point: an existing wall's own
        // placement origin need not sit at the editor's wall start (endpoints are trimmed on import).
        const wPlac = plac(parentPlacId, (wpw_x - wrx * width / 2) + cox, (wpw_y - wry * width / 2) + coy, sill, wrx, wry);
        const oPlac = plac(parentPlacId, wpw_x + cox, wpw_y + coy, Math.max(0, sill - 0.05), wrx, wry);
        if (expId) {
          patchWindowPartitioning();
          if (wasEdited(w) || wallOpeningsWereRegenerated) {
            const openingExpId = (w as any).geom?.openingExpId ?? openingByFillerExpId.get(expId) ?? findOpeningViaPlacement(expId);
            console.log(`[patchIFC] Patching Window #${expId} "${w.name}", resolved openingExpId:`, openingExpId);
            let local_y = 0;
            let old_local_x: number | null = null;
            let opParentPlacId: string | null = null;
            if (openingExpId != null) {
              const ent = lineIndex.get(String(openingExpId));
              if (ent) {
                const a = splitArgs(ent.args);
                if (a.length >= 6 && a[5].startsWith('#')) {
                  const placId = a[5].slice(1);
                  const placEnt = lineIndex.get(placId);
                  if (placEnt && placEnt.type === 'IFCLOCALPLACEMENT') {
                    const pa = splitArgs(placEnt.args);
                    if (pa.length >= 2 && pa[1].startsWith('#')) {
                      const ax2Id = pa[1].slice(1);
                      const ax2Ent = lineIndex.get(ax2Id);
                      if (ax2Ent && ax2Ent.type === 'IFCAXIS2PLACEMENT3D') {
                        const aa = splitArgs(ax2Ent.args);
                        if (aa.length >= 1 && aa[0].startsWith('#')) {
                          const ptId = aa[0].slice(1);
                          const ptEnt = lineIndex.get(ptId);
                          if (ptEnt && ptEnt.type === 'IFCCARTESIANPOINT') {
                            const coords = ptEnt.args.replace(/[()]/g, '').split(',');
                            if (coords.length >= 3) {
                              local_y = parseFloat(coords[1]) / uf;
                              old_local_x = parseFloat(coords[0]) / uf;
                              opParentPlacId = pa[0].startsWith('#') ? pa[0].slice(1) : null;
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
            if (openingExpId != null) {
              // Only patch the opening's CartesianPoint — the window's placement is
              // relative to the opening, so it follows automatically via the chain.
              if (wallPlacId !== null && hostWall) {
                const wGeom = hostWall.geom;
                const dx = wGeom.x2 - wGeom.x1, dy = wGeom.y2 - wGeom.y1;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                // Keep the file's own origin convention (start, centre, meshed or not): shift the
                // origin by how far the opening moved along the wall since import.
                const oldT = ((w.geom as any)._openingT);
                const local_x = typeof oldT === 'number' && old_local_x !== null && opParentPlacId === String(wallPlacId)
                  ? old_local_x + (w.geom.t - oldT) * len
                  : w.geom.t * len - (openingHasBody(openingExpId) ? width / 2 : 0);
                patchPlacementInPlace(String(openingExpId), wallPlacId, local_x, local_y, Math.max(0, sill - 0.05));
                console.log(`[patchIFC] Window #${expId}: Opening #${openingExpId} patched in-place, local X: ${local_x.toFixed(3)}, Y: ${local_y}`);
              } else {
                const offsetX = -wry * local_y;
                const offsetY = wrx * local_y;
                const local_x = wpw_x + cox + offsetX;
                const local_y_storey = wpw_y + coy + offsetY;
                patchPlacementInPlace(String(openingExpId), parentPlacId, local_x, local_y_storey, Math.max(0, sill - 0.05));
                console.log(`[patchIFC] Window #${expId}: Opening #${openingExpId} patched in-place (storey), X: ${local_x.toFixed(3)}, Y: ${local_y_storey.toFixed(3)}`);
              }
              // Mark the window as handled — its placement follows the opening automatically
              patchedExpIds.add(expId);
            } else {
              // No opening found — patch the window directly
              console.warn(`[patchIFC] Window #${expId} opening placement NOT found, patching window directly`);
              patchPlacementInPlace(expId, parentPlacId, wpw_x + cox, wpw_y + coy, sill);
            }
          }
          break;
        }
        {
          const winPartitioning = windowPartitioningType(w);
          const winHinge: 'left' | 'right' | 'none' = String((w as any).geom?.swing || '').toLowerCase() === 'right' ? 'right' : 'left';
          const winSide = Number((w.geom as any).side ?? 1) >= 0 ? 1 : -1;
          const rail = Math.max(0.035, Math.min(0.08, Math.min(width, height) * 0.08));
          const isSliding = winPartitioning === 'SLIDINGHORIZONTAL';
          const wLeaves = isSliding
            ? [
                { hinge: 'none' as const, side: winSide, angle: 0, x0: rail, x1: width / 2 + 0.01, yOffset: -0.015 },
                { hinge: 'none' as const, side: winSide, angle: 0, x0: width / 2 - 0.01, x1: width - rail, yOffset: 0.015 },
              ]
            : winPartitioning === 'DOUBLE_PANEL_VERTICAL'
            ? [
                { hinge: 'left' as const, side: winSide, angle: Math.PI / 10, x0: rail + 0.01, x1: width / 2 - 0.01 },
                { hinge: 'right' as const, side: winSide, angle: Math.PI / 10, x0: width / 2 + 0.01, x1: width - rail - 0.01 },
              ]
            : { hinge: winHinge, side: winSide, angle: Math.PI / 10 };
          const wShape = (wallPlacId !== null && hostWall ? openingModel(w, hostWall.geom.thickness ?? 0.2, width, height) : null)
            ?? frameProxyShape(width, height, 0.08, true, wLeaves);
          const id = emit(`IFCWINDOW(${S(w.GlobalId)},$,${S(w.name)},$,$,${REF(wPlac)},${REF(wShape)},$,${N(height * uf)},${N(width * uf)},.WINDOW.,.${winPartitioning}.,$)`);
          newExpIds.set(w.id, String(id));
          const oid = emit(`IFCOPENINGELEMENT(${S(guid(`op_${w.id}`))},$,${S(w.name + ' Vide')},$,$,${REF(oPlac)},$,$,.OPENING.)`);
          const hostExpId = resolveExpId(w.geom.wallId);
          if (hostExpId) emit(`IFCRELVOIDSELEMENT(${S(guid(`rvw_${w.id}`))},$,$,$,#${hostExpId},${REF(oid)})`);
          emit(`IFCRELFILLSELEMENT(${S(guid(`rfe_${w.id}`))},$,$,$,${REF(oid)},${REF(id)})`);
          getBucket(storeyId).contained.push(id);
        }
        break;
      }

      // ── Room (IFCSPACE) ────────────────────────────────────────────────────
      case 'Room': {
        const r = item as IfcSpaceEntity;
        if (wasEdited(r)) {
          console.log('[patchIFC] Room (Edited):', { id: r.id, name: r.name, expId });
        }
        // Use ObjectPlacement world origin (stored by importIFC) so that the original
        // local profile polygon renders at the correct world position.
        // Fallback to polygon[0] for AI-generated rooms (no _placementWorld).
        const pw = r.geom._placementWorld;
        const [px, py] = pw ?? r.geom.polygon[0] ?? [0, 0];
        if (expId) {
          // A rigid move keeps the original space body: only its placement follows.
          // A reshaped space has no regenerated body, so its stale one is dropped.
          if (wasEdited(r)) {
            if (!wasShapeEdited(r) && pw) patchPlacementInPlace(expId, parentPlacId, px + cox, py + coy, 0);
            else patchNoGeometry(expId);
          }
          break;
        }
        {
          const id = emit(`IFCSPACE(${S(r.GlobalId)},$,${S(r.name)},$,$,$,$,$,$,.ELEMENT.,.INTERNAL.)`);
          getBucket(storeyId).spaces.push(id);
        }
        break;
      }

      // ── Slab (IFCSLAB) ─────────────────────���──────────────────────────────��
      case 'Slab': {
        const sl = item as any;
        if (wasEdited(sl)) {
          console.log('[patchIFC] Slab (Edited):', { id: sl.id, name: sl.name, expId });
        }
        const { polygon, thickness = 0.2 } = sl.geom;
        // Mirror IFCSPACE: use the captured ObjectPlacement origin if available so
        // the local profile renders at the original world position on round-trip.
        const spw = sl.geom._placementWorld;
        const [px, py] = spw ?? polygon[0] ?? [0, 0];
        const holes=slabOpenings(item.id,items).map(h=>h.map(([x,y]):[number,number]=>[x-px,y-py]));
        if (expId) {
          if (wasEdited(sl) || holes.length) {
            if (wasShapeEdited(sl) || !spw || holes.length) {
              const sPlac = plac(parentPlacId, px + cox, py + coy, 0);
              const local = (polygon as [number, number][]).map(([x, y]) => [x - px, y - py] as [number, number]);
              patchGeom(expId, sPlac, polyShape(local, thickness, [0.68, 0.52, 0.36], holes));
            } else {
              patchPlacementInPlace(expId, parentPlacId, px + cox, py + coy, 0);
            }
          }
          break;
        }
        const sPlac = plac(parentPlacId, px + cox, py + coy, 0);
        {
          const local = (polygon as [number, number][]).map(([x, y]) => [x - px, y - py] as [number, number]);
          const sShape = polyShape(local, thickness, [0.68, 0.52, 0.36], holes);
          const id = emit(`IFCSLAB(${S(sl.GlobalId)},$,${S(sl.name)},$,$,${REF(sPlac)},${REF(sShape)},$,.FLOOR.)`);
          getBucket(storeyId).contained.push(id);
        }
        break;
      }

      // ── Roof (IFCROOF) ─────────────────────────────────────────────────────
      case 'Stair': {
        if (expId) {
          if (wasEdited(item)) throw new Error('Editing an existing IFC stair is not supported');
          break;
        }
        const result=buildStair(item.geom,item.parentId,items);
        if(!result.parts.length) break;
        const placement=plac(parentPlacId,cox,coy,0);
        const id=emit(`IFCSTAIR(${S(item.GlobalId)},$,${S(item.name)},$,$,${REF(placement)},$,$,.NOTDEFINED.)`);
        const children:number[]=[];
        stairComponents(result.parts).forEach((parts,k)=>{
          const kind=parts[0].kind,solids:number[]=[];
          for(const part of parts) {
            const before=newLines.length;
            polyShape(part.polygon,part.thickness);
            const index=newLines.findIndex((l,i)=>i>=before && l.includes('=IFCEXTRUDEDAREASOLID('));
            const axis=ax3(0,0,part.z-part.thickness);
            newLines[index]=newLines[index].replace(/IFCEXTRUDEDAREASOLID\((#[0-9]+),#[0-9]+,/,`IFCEXTRUDEDAREASOLID($1,${REF(axis)},`);
            solids.push(Number(newLines[index].match(/^#([0-9]+)/)![1]));
          }
          const rep=emit(`IFCSHAPEREPRESENTATION(${REF(ctxId)},'Body','SweptSolid',(${solids.map(REF).join(',')}))`);
          const shape=emit(`IFCPRODUCTDEFINITIONSHAPE($,$,(${REF(rep)}))`);
          const common=`${S(guid(item.id+'_'+k))},$,${S(kind)},$,$,${REF(placement)},${REF(shape)},$`;
          children.push(emit(kind==='rail'?`IFCRAILING(${common},.GUARDRAIL.)`:kind==='landing'?`IFCSLAB(${common},.LANDING.)`:`IFCSTAIRFLIGHT(${common},${parts.length},${parts.length},${N(result.rise*uf)},${N((parts[0].going ?? item.geom.going)*uf)},.NOTDEFINED.)`));
        });
        emit(`IFCRELAGGREGATES(${S(guid(item.id+'_parts'))},$,$,$,${REF(id)},(${children.map(REF).join(',')}))`);
        getBucket(storeyId).contained.push(id);
        break;
      }
      case 'Roof': {
        const rf = item as any;
        const polygon = (rf.geom?.polygon ?? []) as [number, number][];
        const [px, py] = rf.geom._placementWorld ?? polygon[0] ?? [0, 0];
        const predef = roofPredefinedType(rf.geom?.roofType);
        if (expId) {
          if (wasEdited(rf)) {
            const rPlac = plac(parentPlacId, px + cox, py + coy, 0);
            const shape = roofShape(rf.geom, px, py);
            if (shape !== null) patchGeom(expId, rPlac, shape);
          }
          break;
        }
        const rPlac = plac(parentPlacId, px + cox, py + coy, 0);
        const shape = roofShape(rf.geom, px, py);
        if (shape === null) break;
        const id = emit(`IFCROOF(${S(rf.GlobalId)},$,${S(rf.name)},$,$,${REF(rPlac)},${REF(shape)},$,.${predef}.)`);
        newExpIds.set(rf.id, String(id));
        getBucket(storeyId).contained.push(id);
        break;
      }

      // ── Furniture (IFCFURNISHINGELEMENT) ───────────────────────────────────
      case 'Furniture': {
        const f = item as IfcFurnitureEntity;
        if (wasEdited(f)) {
          console.log('[patchIFC] Furniture (Edited):', { id: f.id, name: f.name, expId });
        }
        const { x, y, w, d: depth, h, rotation = 0 } = f.geom;
        // Use ObjectPlacement world origin so original local geometry renders correctly.
        const fpw = f.geom._placementWorld;
        const fpx = fpw ? fpw[0] : (x + w / 2);
        const fpy = fpw ? fpw[1] : (y + depth / 2);
        if (expId) {
          if (wasEdited(f)) {
            const fPlac = plac(parentPlacId, fpx + cox, fpy + coy, 0, Math.cos(rotation), Math.sin(rotation));
            if (!wasShapeEdited(f) && fpw) {
              patchPlacement(expId, fPlac);
            } else {
              patchGeom(expId, fPlac, modelShape(buildFurnitureModel(f)) ?? boxShape(w, h, depth, [0.45, 0.55, 0.45]));
            }
          }
          break;
        }
        const fPlac = plac(parentPlacId, fpx + cox, fpy + coy, 0, Math.cos(rotation), Math.sin(rotation));
        {
          const fShape = modelShape(buildFurnitureModel(f)) ?? boxShape(w, h, depth, [0.45, 0.55, 0.45]);
          const id = emit(`IFCFURNISHINGELEMENT(${S(f.GlobalId)},$,${S(f.name)},$,$,${REF(fPlac)},${REF(fShape)},$)`);
          getBucket(storeyId).contained.push(id);
        }
        break;
      }

      // ── Columns and chimneys (IfcChimney is IFC4; IFC2x3 files get a proxy) ──
      case 'Column':
      case 'Chimney': {
        // Unchanged original elements keep their IFC lines: emit nothing for them.
        if (expId && !wasEdited(item)) break;
        const { x, y, rotation = 0 } = item.geom;
        const placement = plac(parentPlacId, x + cox, y + coy, 0, Math.cos(rotation), Math.sin(rotation));
        const colour: [number, number, number] = item.type === 'Column' ? [0.62, 0.62, 0.60] : [0.55, 0.36, 0.28];
        const solids = structuralParts(item).map(part => {
          const pts = part.polygon.map(([px, py]) => pt2(px, py));
          pts.push(pts[0]);
          const poly = emit(`IFCPOLYLINE((${pts.map(REF).join(',')}))`);
          const prof = emit(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${REF(poly)})`);
          return styledSweptSolid(prof, part.h, part.z, 0, colour);
        });
        const rep = emit(`IFCSHAPEREPRESENTATION(${REF(ctxId)},'Body','SweptSolid',(${solids.map(REF).join(',')}))`);
        const shape = emit(`IFCPRODUCTDEFINITIONSHAPE($,$,(${REF(rep)}))`);
        if (expId) { patchGeom(expId, placement, shape); break; }
        const head = `${S(item.GlobalId)},$,${S(item.name)},$`;
        const id = item.type === 'Column'
          ? emit(isIfc4 ? `IFCCOLUMN(${head},$,${REF(placement)},${REF(shape)},$,.COLUMN.)` : `IFCCOLUMN(${head},$,${REF(placement)},${REF(shape)},$)`)
          : emit(isIfc4 ? `IFCCHIMNEY(${head},${S(({ fireplace: 'Fireplace', stove: 'Stove', flue: 'Flue' } as const)[item.kind])},${REF(placement)},${REF(shape)},$,.NOTDEFINED.)`
            : `IFCBUILDINGELEMENTPROXY(${head},'Chimney',${REF(placement)},${REF(shape)},$,$)`);
        newExpIds.set(item.id, String(id));
        getBucket(storeyId).contained.push(id);
        break;
      }

      case 'Technical': {
        const { x, y, rotation = 0, mountHeight = 0.3 } = item.geom;
        const placement = plac(parentPlacId, x + cox, y + coy, mountHeight - 0.04, Math.cos(rotation), Math.sin(rotation));
        const shape = boxShape(0.08, 0.08, 0.08);
        const id = emit(`${item.ifcType.toUpperCase()}(${S(item.GlobalId)},$,${S(item.name)},$,$,${REF(placement)},${REF(shape)},$)`);
        getBucket(storeyId).contained.push(id);
        break;
      }

      // ── Generic IFC element (column, beam, stair, railing, roof, etc.) ─────
      case 'GenericElement': {
        const g = item as IfcGenericEntity;
        const { x, y, w, d: depth, h, rotation = 0, footprint } = g.geom;
        // Use ObjectPlacement world origin so original local geometry renders correctly.
        const gpw = g.geom._placementWorld;
        const gpx = gpw ? gpw[0] : (x + w / 2);
        const gpy = gpw ? gpw[1] : (y + depth / 2);
        const rx = Math.cos(rotation), ry = Math.sin(rotation);
        if (expId) {
          if (wasEdited(g)) {
            const gPlac = plac(parentPlacId, gpx + cox, gpy + coy, 0, rx, ry);
            if (!wasShapeEdited(g) && gpw) {
              patchPlacement(expId, gPlac);
            } else {
              const gShape = footprint && footprint.length >= 3 && h > 0
                ? polyShape(footprint.map(([fx, fy]) => [fx - gpx, fy - gpy] as [number, number]), h)
                : boxShape(Math.max(w, 0.05), Math.max(h, 0.05), Math.max(depth, 0.05));
              patchGeom(expId, gPlac, gShape);
            }
          }
          break;
        }
        const gPlac = plac(parentPlacId, gpx + cox, gpy + coy, 0, rx, ry);
        {
          let gShape: number;
          if (footprint && footprint.length >= 3 && h > 0) {
            const local = footprint.map(([fx, fy]) => [fx - gpx, fy - gpy] as [number, number]);
            gShape = polyShape(local, h);
          } else {
            gShape = boxShape(Math.max(w, 0.05), Math.max(h, 0.05), Math.max(depth, 0.05));
          }
          const stepType = g.ifcType.toUpperCase();
          const id = emit(`${stepType}(${S(g.GlobalId)},$,${S(g.name)},$,$,${REF(gPlac)},${REF(gShape)},$,$)`);
          getBucket(storeyId).contained.push(id);
        }
        break;
      }

      // Project, Building, Storey, Dimension, _Rel: no 3D geometry to manage
      default:
        break;
    }
  }

  // ── Annotations (dimensions, markers, sections): matched by GlobalId ───────
  {
    const unquote = (v: string | undefined) => (v ?? '').replace(/^'|'$/g, '').replace(/''/g, "'");
    const existing = new Map<string, string>();
    for (const [id, ent] of lineIndex) {
      if (ent.type !== 'IFCANNOTATION') continue;
      const a = splitArgs(ent.args);
      if (annotationKind(unquote(a[4]))) existing.set(unquote(a[0]), id);
    }
    const kept = new Set<string>();
    for (const item of Object.values(items)) {
      if (!isAnnotation(item)) continue;
      const storeyId = item.parentId ?? '';
      const [ax, ay] = annotationAnchor(item);
      const placement = plac(storeyPlacIds[storeyId] ?? defaultStoreyPlacId, ax + cox, ay + coy, 0);
      const name = S(item.Name || item.name), description = S(annotationPayload(item, [cox, coy])), objectType = S(annotationObjectType(item.type));
      const expId = existing.get(item.GlobalId);
      if (expId) {
        kept.add(expId);
        const a = splitArgs(lineIndex.get(expId)!.args);
        a[2] = name; a[3] = description; a[4] = objectType; a[5] = REF(placement);
        patchLine(expId, a);
      } else {
        getBucket(storeyId).contained.push(emit(`IFCANNOTATION(${S(item.GlobalId)},$,${name},${description},${objectType},${REF(placement)},$)`));
      }
    }
    // Deleted in the editor: drop the editor data so the annotation is not read back.
    for (const expId of existing.values()) {
      if (kept.has(expId)) continue;
      const a = splitArgs(lineIndex.get(expId)!.args);
      a[3] = '$'; a[4] = '$';
      patchLine(expId, a);
    }
  }

  const existingWallConnections = new Set<string>();
  for (const ent of lineIndex.values()) {
    if (ent.type !== 'IFCRELCONNECTSPATHELEMENTS') continue;
    const args = splitArgs(ent.args);
    if (args[5]?.startsWith('#') && args[6]?.startsWith('#')) existingWallConnections.add([args[5], args[6]].sort().join(':'));
  }
  const wallRef = (wallId: string): string | null => {
    const injected = newExpIds.get(wallId);
    if (injected) return '#' + injected;
    const wall = items[wallId];
    const expId = wall ? existingExpId(wall) : null;
    return expId ? '#' + expId : null;
  };
  for (const junction of findWallJunctions(items)) {
    for (let i = 0; i < junction.endpoints.length; i++) {
      for (let j = i + 1; j < junction.endpoints.length; j++) {
        const a = junction.endpoints[i], b = junction.endpoints[j];
        if (a.wallId === b.wallId) continue;
        const aRef = wallRef(a.wallId), bRef = wallRef(b.wallId);
        if (!aRef || !bRef || existingWallConnections.has([aRef, bRef].sort().join(':'))) continue;
        emit('IFCRELCONNECTSPATHELEMENTS(' + S(guid('wall_join_' + a.wallId + '_' + a.end + '_' + b.wallId + '_' + b.end)) + ',$,$,$,$,' + aRef + ',' + bRef + ',$,$,.AT' + b.end.toUpperCase() + '.,.AT' + a.end.toUpperCase() + '.)');
        existingWallConnections.add([aRef, bRef].sort().join(':'));
      }
    }
  }

  // ── Relationship lines for new (injected) elements ─────────���─────────────────
  for (const [storeyId, bkt] of Object.entries(buckets)) {
    const expId = storeyExpIds[storeyId] ?? defaultStoreyExpId;
    if (!expId) continue;
    if (bkt.contained.length > 0)
      emit(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${S(guid(`rel_c_${storeyId}`))},$,$,$,(${bkt.contained.map(REF).join(',')}),#${expId})`);
    if (bkt.spaces.length > 0)
      emit(`IFCRELAGGREGATES(${S(guid(`rel_a_${storeyId}`))},$,$,$,#${expId},(${bkt.spaces.map(REF).join(',')}))`);
  }

  // ── Apply patches back-to-front (preserves string offsets) ──────────────────
  patches.sort((a, b) => b.start - a.start);
  for (const p of patches)
    stepText = stepText.slice(0, p.start) + p.replacement + stepText.slice(p.end);

  // ── Append injected STEP lines before ENDSEC ──────────────────��──────────────
  if (newLines.length > 0) {
    const pos = stepText.lastIndexOf('\nENDSEC;');
    const at  = pos >= 0 ? pos : stepText.lastIndexOf('ENDSEC;');
    if (at >= 0)
      stepText = stepText.slice(0, at) + '\n' + newLines.join('\n') + stepText.slice(at);
  }


  return stepText;
}
