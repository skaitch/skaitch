import * as THREE from 'three';
import { photosForElement, SURVEY_PSET, surveyPsetProps } from '../survey/reconstruct.js';
import { surveyPhotoPath } from '../survey/ifcPhotos.js';
import { buildFurnitureModel } from '../geometry/furniture3d.js';
import { buildOpeningModel } from '../geometry/opening3d.js';
import { buildStair, slabOpenings, stairComponents, validateStairOpenings } from '../lib/stairGeometry.js';
import { wallRoofShape } from '../lib/wallRoof.js';
import { structuralParts, type SolidPart } from '../lib/structuralElements.js';
import type {
  ItemsMap, IfcProjectEntity, IfcBuildingEntity, IfcStoreyEntity,
  IfcSpaceEntity, IfcWallEntity, IfcDoorEntity, IfcWindowEntity,
  IfcFurnitureEntity, IfcEntity,
} from '../types/ifc.js';
import { patchIFC } from './patchIFC.js';
import { annotationAnchor, annotationObjectType, annotationPayload, isAnnotation } from './annotationIfc.js';
import { guid } from '../data/starter.js';
import { findWallJunctions, wallBodyLimits } from '../lib/wallContinuity.js';
import { buildRoof, roofFaces, roofPredefinedType } from '../lib/roofGeometry.js';

// ── STEP line counter ─────────────────────────────────────────────────────────
let _idx = 0;
const reset = () => { _idx = 0; };
const next  = () => ++_idx;

// ── STEP string helpers ───────────────────────────────────────────────────────
const S   = (v: string | null | undefined) => v ? `'${v.replace(/'/g, "''")}'` : '$';
const N   = (v: number, d = 6) => v.toFixed(d);
const B   = (v: boolean) => v ? '.T.' : '.F.';
const REF = (n: number) => `#${n}`;
const LIST = (refs: number[]) => `(${refs.map(REF).join(',')})`;

interface Line { n: number; text: string }

function windowPartitioningType(win: IfcWindowEntity): string {
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
}

// ── Pset helpers ──────────────────────────────────────────────────────────────
function writePset(lines: Line[], elementGuid: string, elementN: number, psetName: string, props: Record<string, string | number | boolean | undefined | null>) {
  const propNs: number[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === '') continue;
    const n = next();
    let valStr = '';
    if (typeof v === 'boolean') valStr = `IFCBOOLEAN(${B(v)})`;
    else if (typeof v === 'number') valStr = `IFCREAL(${N(v, 4)})`;
    else valStr = `IFCLABEL(${S(v)})`;
    lines.push({ n, text: `IFCPROPERTYSINGLEVALUE(${S(k)},$,${valStr},$)` });
    propNs.push(n);
  }
  if (propNs.length === 0) return;
  const psetN = next();
  lines.push({ n: psetN, text: `IFCPROPERTYSET(${S(guid(elementGuid + psetName))},$,${S(psetName)},$,${LIST(propNs)})` });
  const relN = next();
  lines.push({ n: relN, text: `IFCRELDEFINESBYPROPERTIES(${S(guid(elementGuid + 'rel' + psetName))},$,$,$,(${REF(elementN)}),${REF(psetN)})` });
}

/** Pset_skAItchSurvey (ADR 0016): survey reliability and origin of an element from a survey. */
function writeSurveyPset(lines: Line[], items: ItemsMap, item: IfcEntity, elementN: number) {
  const props = surveyPsetProps(items, item);
  if (props) writePset(lines, item.GlobalId, elementN, SURVEY_PSET, props);
}

// ── coord helpers ─────────────────────────────────────────────────────────────
function writePoint2D(lines: Line[], x: number, y: number): number {
  const n = next();
  lines.push({ n, text: `IFCCARTESIANPOINT((${N(x)},${N(y)}))` });
  return n;
}
function writePoint3D(lines: Line[], x: number, y: number, z: number): number {
  const n = next();
  lines.push({ n, text: `IFCCARTESIANPOINT((${N(x)},${N(y)},${N(z)}))` });
  return n;
}
function writeDir(lines: Line[], x: number, y: number, z: number): number {
  const n = next();
  lines.push({ n, text: `IFCDIRECTION((${N(x)},${N(y)},${N(z)}))` });
  return n;
}
function writeDir2D(lines: Line[], x: number, y: number): number {
  const n = next();
  lines.push({ n, text: `IFCDIRECTION((${N(x)},${N(y)}))` });
  return n;
}
function writeAxis2Place3D(lines: Line[], ox: number, oy: number, oz: number,
  axX = 0, axY = 0, axZ = 1, refX = 1, refY = 0, refZ = 0): number {
  const loc = writePoint3D(lines, ox, oy, oz);
  const ax  = writeDir(lines, axX, axY, axZ);
  const ref = writeDir(lines, refX, refY, refZ);
  const n   = next();
  lines.push({ n, text: `IFCAXIS2PLACEMENT3D(${REF(loc)},${REF(ax)},${REF(ref)})` });
  return n;
}
function writeLocalPlacement(lines: Line[], refPlacN: number | null,
  ox: number, oy: number, oz: number, rotation = 0): number {
  const ax = writeAxis2Place3D(lines, ox, oy, oz, 0, 0, 1, Math.cos(rotation), Math.sin(rotation), 0);
  const n  = next();
  lines.push({ n, text: `IFCLOCALPLACEMENT(${refPlacN ? REF(refPlacN) : '$'},${REF(ax)})` });
  return n;
}

// ── Storey world placement ─────────────────────────────────────────────────────
function writePlacement(lines: Line[], parentPlacN: number | null,
  ox: number, oy: number, oz: number): number {
  return writeLocalPlacement(lines, parentPlacN, ox, oy, oz);
}

// ── Geometry: wall as SweptSolid ───────────────────────────────────────────────
function writeWallGeom(lines: Line[], wall: IfcWallEntity, items: ItemsMap): number {
  const { x1, y1, x2, y2, thickness, height } = wall.geom;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  // Extrusion axis (along wall length) in 2D profile plane: X
  // Profile: rectangle centered at 0 on X, -thickness/2..+thickness/2 on Y
  const ht = thickness / 2;
  const [bodyStart, bodyEnd] = wallBodyLimits(wall, items);
  const pts = [
    writePoint2D(lines, bodyStart, -ht),
    writePoint2D(lines, bodyEnd, -ht),
    writePoint2D(lines, bodyEnd,  ht),
    writePoint2D(lines, bodyStart,  ht),
    writePoint2D(lines, bodyStart, -ht), // close
  ];
  const polyN = next();
  lines.push({ n: polyN, text: `IFCPOLYLINE(${LIST(pts)})` });
  const profN = next();
  lines.push({ n: profN, text: `IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${REF(polyN)})` });
  const dirN = writeDir(lines, 0, 0, 1);
  const extN = next();
  lines.push({ n: extN, text: `IFCEXTRUDEDAREASOLID(${REF(profN)},${REF(writeAxis2Place3D(lines, 0, 0, 0))},${REF(dirN)},${N(height)})` });

  // Shape representation
  const ctxN = 1; // geometric context ref (written first in header)
  const repN = next();
  lines.push({ n: repN, text: `IFCSHAPEREPRESENTATION(${REF(ctxN)},'Body','SweptSolid',(${REF(extN)}))` });
  const prodN = next();
  lines.push({ n: prodN, text: `IFCPRODUCTDEFINITIONSHAPE($,$,(${REF(repN)}))` });
  return prodN;
}

// ── Geometry: room as extruded polygon ────────────────────────────────────────
function writeRoomGeom(lines: Line[], room: IfcSpaceEntity, px: number, py: number): number {
  const { polygon, height } = room.geom;
  const pts = polygon.map(([x, y]) => writePoint2D(lines, x - px, y - py));
  // close
  pts.push(pts[0]);
  const polyN = next();
  lines.push({ n: polyN, text: `IFCPOLYLINE(${LIST(pts)})` });
  const profN = next();
  lines.push({ n: profN, text: `IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${REF(polyN)})` });
  const dirN = writeDir(lines, 0, 0, 1);
  const extN = next();
  lines.push({ n: extN, text: `IFCEXTRUDEDAREASOLID(${REF(profN)},${REF(writeAxis2Place3D(lines, 0, 0, 0))},${REF(dirN)},${N(height)})` });
  const ctxN = 1;
  const repN = next();
  lines.push({ n: repN, text: `IFCSHAPEREPRESENTATION(${REF(ctxN)},'Body','SweptSolid',(${REF(extN)}))` });
  const prodN = next();
  lines.push({ n: prodN, text: `IFCPRODUCTDEFINITIONSHAPE($,$,(${REF(repN)}))` });
  return prodN;
}

// ── Geometry: roof as faceted BREP ────────────────────────────────────────────
function writeRoofGeom(lines: Line[], geom: any, px: number, py: number): number | null {
  const solid = buildRoof(geom);
  if (!solid) return null;
  const faceNs = roofFaces(solid).map((face) => {
    const pts = face.map(([x, y, z]) => writePoint3D(lines, x - px, y - py, z));
    const loopN = next();
    lines.push({ n: loopN, text: `IFCPOLYLOOP(${LIST(pts)})` });
    const boundN = next();
    lines.push({ n: boundN, text: `IFCFACEOUTERBOUND(${REF(loopN)},.T.)` });
    const faceN = next();
    lines.push({ n: faceN, text: `IFCFACE((${REF(boundN)}))` });
    return faceN;
  });
  const shellN = next();
  lines.push({ n: shellN, text: `IFCCLOSEDSHELL(${LIST(faceNs)})` });
  const brepN = next();
  lines.push({ n: brepN, text: `IFCFACETEDBREP(${REF(shellN)})` });
  const repN = next();
  lines.push({ n: repN, text: `IFCSHAPEREPRESENTATION(${REF(1)},'Body','Brep',(${REF(brepN)}))` });
  const prodN = next();
  lines.push({ n: prodN, text: `IFCPRODUCTDEFINITIONSHAPE($,$,(${REF(repN)}))` });
  return prodN;
}

// ── Geometry: slab as extruded polygon (downwards from the storey level) ─────
function writeSlabGeom(lines: Line[], polygon: [number, number][], thickness: number, px: number, py: number, holes: [number,number][][] = []): number {
  const pts = polygon.map(([x, y]) => writePoint2D(lines, x - px, y - py));
  pts.push(pts[0]);
  const polyN = next();
  lines.push({ n: polyN, text: `IFCPOLYLINE(${LIST(pts)})` });
  const holeNs=holes.map(hole=>{
    const vertices=hole.map(([x,y])=>writePoint2D(lines,x-px,y-py));vertices.push(vertices[0]);
    const n=next();lines.push({n,text:`IFCPOLYLINE(${LIST(vertices)})`});return n;
  });
  const profN = next();
  lines.push({ n: profN, text: holeNs.length ? `IFCARBITRARYPROFILEDEFWITHVOIDS(.AREA.,$,${REF(polyN)},${LIST(holeNs)})` : `IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${REF(polyN)})` });
  const dirN = writeDir(lines, 0, 0, -1);
  const extN = next();
  lines.push({ n: extN, text: `IFCEXTRUDEDAREASOLID(${REF(profN)},${REF(writeAxis2Place3D(lines, 0, 0, 0))},${REF(dirN)},${N(thickness)})` });
  const repN = next();
  lines.push({ n: repN, text: `IFCSHAPEREPRESENTATION(${REF(1)},'Body','SweptSolid',(${REF(extN)}))` });
  const prodN = next();
  lines.push({ n: prodN, text: `IFCPRODUCTDEFINITIONSHAPE($,$,(${REF(repN)}))` });
  return prodN;
}

// ── Geometry: door/window as box ──────────────────────────────────────────────
function writeBoxGeom(lines: Line[], w: number, h: number, d: number, centered = true): number {
  const x = centered ? -w / 2 : 0, y = centered ? -d / 2 : 0;
  const pts = [[x, y], [x + w, y], [x + w, y + d], [x, y + d], [x, y]].map(([px, py]) => writePoint2D(lines, px, py));
  const poly = next();
  lines.push({ n: poly, text: `IFCPOLYLINE(${LIST(pts)})` });
  const profile = next();
  lines.push({ n: profile, text: `IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${REF(poly)})` });
  const axis = writeAxis2Place3D(lines, 0, 0, 0);
  const direction = writeDir(lines, 0, 0, 1);
  const solid = next();
  lines.push({ n: solid, text: `IFCEXTRUDEDAREASOLID(${REF(profile)},${REF(axis)},${REF(direction)},${N(h)})` });
  const repN = next();
  lines.push({ n: repN, text: `IFCSHAPEREPRESENTATION(${REF(1)},'Body','SweptSolid',(${REF(solid)}))` });
  const prodN = next();
  lines.push({ n: prodN, text: `IFCPRODUCTDEFINITIONSHAPE($,$,(${REF(repN)}))` });
  return prodN;
}

/**
 * Column/chimney body: one SweptSolid per part. A circular column uses an IfcCircleProfileDef
 * (exact cylinder) instead of the faceted polygon used by the editor.
 */
function writeStructuralGeom(lines: Line[], parts: SolidPart[], circleDiameter?: number): number {
  const solids = parts.map(part => {
    let profile: number;
    if (circleDiameter) {
      const origin = writePoint2D(lines, 0, 0);
      const pos = next(); lines.push({ n: pos, text: `IFCAXIS2PLACEMENT2D(${REF(origin)},$)` });
      profile = next(); lines.push({ n: profile, text: `IFCCIRCLEPROFILEDEF(.AREA.,$,${REF(pos)},${N(circleDiameter / 2)})` });
    } else {
      const pts = [...part.polygon, part.polygon[0]].map(([px, py]) => writePoint2D(lines, px, py));
      const poly = next(); lines.push({ n: poly, text: `IFCPOLYLINE(${LIST(pts)})` });
      profile = next(); lines.push({ n: profile, text: `IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${REF(poly)})` });
    }
    const axis = writeAxis2Place3D(lines, 0, 0, part.z);
    const direction = writeDir(lines, 0, 0, 1);
    const solid = next(); lines.push({ n: solid, text: `IFCEXTRUDEDAREASOLID(${REF(profile)},${REF(axis)},${REF(direction)},${N(part.h)})` });
    return solid;
  });
  const repN = next();
  lines.push({ n: repN, text: `IFCSHAPEREPRESENTATION(${REF(1)},'Body','SweptSolid',${LIST(solids)})` });
  const prodN = next();
  lines.push({ n: prodN, text: `IFCPRODUCTDEFINITIONSHAPE($,$,(${REF(repN)}))` });
  return prodN;
}

/** One extruded box of a multi-part body, in the element's local frame (x, y, z = min corner). */
interface BodyPart { x: number; y: number; z: number; w: number; d: number; h: number; style: PartStyle }
interface PartStyle { name: string; rgb: [number, number, number]; transparency?: number }

const PART_STYLES = {
  // Same palette as skAItch's own 3D view (packages/ui Canvas3D).
  doorFrame: { name: 'door frame', rgb: [0.18, 0.20, 0.22] },
  doorLeaf: { name: 'door leaf', rgb: [0.42, 0.31, 0.23] },
  metal: { name: 'metal', rgb: [0.82, 0.83, 0.85] },
  windowFrame: { name: 'window frame', rgb: [0.23, 0.25, 0.27] },
  woodFrame: { name: 'wood window frame', rgb: [0.71, 0.48, 0.24] },
  darkFrame: { name: 'dark window frame', rgb: [0.18, 0.20, 0.22] },
  glass: { name: 'glass', rgb: [0.62, 0.83, 0.94], transparency: 0.7 },
  sill: { name: 'sill', rgb: [0.78, 0.79, 0.78] },
} satisfies Record<string, PartStyle>;

/**
 * Writes a body made of several styled boxes (one SweptSolid representation) so viewers show
 * frames, leaves, glazing and hardware with their own materials instead of a single block.
 */
function writePartsGeom(lines: Line[], parts: BodyPart[], styles: Map<string, number>): number {
  const styleFor = (style: PartStyle) => {
    const existing = styles.get(style.name);
    if (existing) return existing;
    const colour = next(); lines.push({ n: colour, text: `IFCCOLOURRGB($,${N(style.rgb[0])},${N(style.rgb[1])},${N(style.rgb[2])})` });
    const rendering = next(); lines.push({ n: rendering, text: `IFCSURFACESTYLERENDERING(${REF(colour)},${N(style.transparency ?? 0)},$,$,$,$,IFCNORMALISEDRATIOMEASURE(0.5),IFCSPECULAREXPONENT(16.),.NOTDEFINED.)` });
    const surface = next(); lines.push({ n: surface, text: `IFCSURFACESTYLE('${style.name}',.BOTH.,(${REF(rendering)}))` });
    styles.set(style.name, surface);
    return surface;
  };
  const solids = parts.filter(p => p.w > 0.001 && p.d > 0.001 && p.h > 0.001).map(p => {
    const pts = [[0, 0], [p.w, 0], [p.w, p.d], [0, p.d], [0, 0]].map(([px, py]) => writePoint2D(lines, px, py));
    const poly = next(); lines.push({ n: poly, text: `IFCPOLYLINE(${LIST(pts)})` });
    const profile = next(); lines.push({ n: profile, text: `IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${REF(poly)})` });
    const axis = writeAxis2Place3D(lines, p.x, p.y, p.z);
    const direction = writeDir(lines, 0, 0, 1);
    const solid = next(); lines.push({ n: solid, text: `IFCEXTRUDEDAREASOLID(${REF(profile)},${REF(axis)},${REF(direction)},${N(p.h)})` });
    const styled = next(); lines.push({ n: styled, text: `IFCSTYLEDITEM(${REF(solid)},(${REF(styleFor(p.style))}),$)` });
    return solid;
  });
  const repN = next();
  lines.push({ n: repN, text: `IFCSHAPEREPRESENTATION(${REF(1)},'Body','SweptSolid',${LIST(solids)})` });
  const prodN = next();
  lines.push({ n: prodN, text: `IFCPRODUCTDEFINITIONSHAPE($,$,(${REF(repN)}))` });
  return prodN;
}

/**
 * Door body in its placement frame: X along the wall (centred), Y across it towards the side the
 * leaf opens to, Z up from the floor. Frame on three sides, oak leaf on the opening face, and a
 * lever handle on the edge away from the hinge.
 */
function doorParts(width: number, height: number, wallThickness: number, hinge: 'left' | 'right'): BodyPart[] {
  const t = Math.max(wallThickness, 0.08), fw = 0.06, leafT = 0.04, gap = 0.003;
  const leafW = Math.max(width - 2 * fw - 2 * gap, 0.1), leafH = Math.max(height - fw - 0.013, 0.1);
  const leafY = t / 2 - leafT;
  const handleSide = hinge === 'left' ? 1 : -1;
  const handleX = handleSide * (leafW / 2 - 0.09) - 0.06;
  const handleZ = Math.min(1.0, leafH - 0.2);
  return [
    { x: -width / 2, y: -t / 2, z: 0, w: fw, d: t, h: height, style: PART_STYLES.doorFrame },
    { x: width / 2 - fw, y: -t / 2, z: 0, w: fw, d: t, h: height, style: PART_STYLES.doorFrame },
    { x: -width / 2 + fw, y: -t / 2, z: height - fw, w: width - 2 * fw, d: t, h: fw, style: PART_STYLES.doorFrame },
    { x: -leafW / 2, y: leafY, z: 0.01, w: leafW, d: leafT, h: leafH, style: PART_STYLES.doorLeaf },
    { x: handleX, y: leafY - 0.06, z: handleZ, w: 0.12, d: leafT + 0.12, h: 0.025, style: PART_STYLES.metal },
  ];
}

/**
 * Window body in its placement frame (Z from the sill): frame, glazing, and a stone sill on the
 * −Y face of the wall.
 */
function windowParts(width: number, height: number, wallThickness: number, material = ''): BodyPart[] {
  const t = Math.max(wallThickness, 0.08), fw = 0.06, fd = Math.min(0.08, t);
  const m = material.toUpperCase();
  const frame = m.includes('BOIS') || m.includes('WOOD') ? PART_STYLES.woodFrame
    : m.includes('ANTHR') || m.includes('NOIR') || m.includes('BLACK') ? PART_STYLES.darkFrame : PART_STYLES.windowFrame;
  const glassW = Math.max(width - 2 * fw, 0.05), glassH = Math.max(height - 2 * fw, 0.05);
  return [
    { x: -width / 2, y: -fd / 2, z: 0, w: fw, d: fd, h: height, style: frame },
    { x: width / 2 - fw, y: -fd / 2, z: 0, w: fw, d: fd, h: height, style: frame },
    { x: -width / 2 + fw, y: -fd / 2, z: 0, w: width - 2 * fw, d: fd, h: fw, style: frame },
    { x: -width / 2 + fw, y: -fd / 2, z: height - fw, w: width - 2 * fw, d: fd, h: fw, style: frame },
    { x: -glassW / 2, y: -0.006, z: fw, w: glassW, d: 0.012, h: glassH, style: PART_STYLES.glass },
    { x: -width / 2 - 0.03, y: -t / 2 - 0.04, z: -0.04, w: width + 0.06, d: t / 2 + 0.04 - fd / 2, h: 0.04, style: PART_STYLES.sill },
  ];
}

/**
 * Writes a three.js model (as built for the editor's 3D view) as one IFC body: each mesh becomes an
 * IfcTriangulatedFaceSet styled with its material's colour, so the exported element looks like the
 * editor's. three.js is Y up; IFC is Z up, so (x, y, z) maps to (x, −z, y).
 */
function writeModelGeom(lines: Line[], model: THREE.Object3D, styles: Map<string, number>): number {
  model.updateMatrixWorld(true);
  const styleFor = (rgb: [number, number, number], transparency: number) => {
    const key = `${rgb.map(c => c.toFixed(3)).join(',')}|${transparency.toFixed(2)}`;
    const existing = styles.get(key);
    if (existing) return existing;
    const colour = next(); lines.push({ n: colour, text: `IFCCOLOURRGB($,${N(rgb[0])},${N(rgb[1])},${N(rgb[2])})` });
    const rendering = next(); lines.push({ n: rendering, text: `IFCSURFACESTYLERENDERING(${REF(colour)},${N(transparency)},$,$,$,$,IFCNORMALISEDRATIOMEASURE(0.5),IFCSPECULAREXPONENT(16.),.NOTDEFINED.)` });
    const surface = next(); lines.push({ n: surface, text: `IFCSURFACESTYLE($,.BOTH.,(${REF(rendering)}))` });
    styles.set(key, surface);
    return surface;
  };
  const point = new THREE.Vector3();
  const faceSets: number[] = [];
  model.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const position = mesh.geometry.getAttribute('position');
    if (!position || position.count < 3) return;
    const coords: string[] = [];
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      coords.push(`(${N(point.x)},${N(-point.z)},${N(point.y)})`);
    }
    const index = mesh.geometry.getIndex();
    const triangles: string[] = [];
    const count = index ? index.count : position.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const [a, b, c] = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
      if (a !== b && b !== c && a !== c) triangles.push(`(${a + 1},${b + 1},${c + 1})`);
    }
    if (!triangles.length) return;
    const pointList = next(); lines.push({ n: pointList, text: `IFCCARTESIANPOINTLIST3D((${coords.join(',')}),$)` });
    const faceSet = next(); lines.push({ n: faceSet, text: `IFCTRIANGULATEDFACESET(${REF(pointList)},$,$,(${triangles.join(',')}),$)` });
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial & { transmission?: number };
    const colour = new THREE.Color(material?.color ?? 0x9e9e9e).getHex();
    const rgb: [number, number, number] = [((colour >> 16) & 255) / 255, ((colour >> 8) & 255) / 255, (colour & 255) / 255];
    const transparency = Math.min(0.95, Math.max(material?.transparent ? 1 - (material.opacity ?? 1) : 0, (material?.transmission ?? 0) * 0.8));
    const styled = next(); lines.push({ n: styled, text: `IFCSTYLEDITEM(${REF(faceSet)},(${REF(styleFor(rgb, transparency))}),$)` });
    faceSets.push(faceSet);
  });
  const repN = next();
  lines.push({ n: repN, text: `IFCSHAPEREPRESENTATION(${REF(1)},'Body','Tessellation',${LIST(faceSets)})` });
  const prodN = next();
  lines.push({ n: prodN, text: `IFCPRODUCTDEFINITIONSHAPE($,$,(${REF(repN)}))` });
  return prodN;
}

// ── Main export ───────────────────────────────────────────────────────────────
/** Surface colour (RGB 0–1) and transparency per exported product type. */
const PRODUCT_STYLES: Record<string, { rgb: [number, number, number]; transparency: number }> = {
  IFCWALL: { rgb: [0.85, 0.77, 0.64], transparency: 0 },
  IFCWALLSTANDARDCASE: { rgb: [0.85, 0.77, 0.64], transparency: 0 },
  // Same colours as the editor's 3D view (packages/ui Canvas3D) where it has one.
  IFCSLAB: { rgb: [0.66, 0.52, 0.37], transparency: 0 },
  IFCROOF: { rgb: [0.63, 0.27, 0.17], transparency: 0 },
  IFCCOVERING: { rgb: [0.92, 0.92, 0.90], transparency: 0 },
  IFCDOOR: { rgb: [0.72, 0.53, 0.34], transparency: 0 },
  IFCWINDOW: { rgb: [0.62, 0.80, 0.90], transparency: 0.6 },
  IFCSTAIR: { rgb: [0.72, 0.60, 0.44], transparency: 0 },
  IFCSTAIRFLIGHT: { rgb: [0.72, 0.60, 0.44], transparency: 0 },
  STAIR_LANDING: { rgb: [0.72, 0.60, 0.44], transparency: 0 },
  IFCRAILING: { rgb: [0.40, 0.40, 0.40], transparency: 0 },
  IFCFURNISHINGELEMENT: { rgb: [0.68, 0.68, 0.74], transparency: 0 },
  IFCFLOWTERMINAL: { rgb: [0.95, 0.95, 0.95], transparency: 0 },
  IFCBUILDINGELEMENTPROXY: { rgb: [0.65, 0.70, 0.78], transparency: 0 },
  IFCSPACE: { rgb: [0.55, 0.80, 0.55], transparency: 0.85 },
};

/**
 * Gives every product body a surface style so IFC viewers (and skAItch's own 3D view of an
 * imported file) show materials instead of plain white. One style per product type.
 */
function styleProductBodies(out: Line[]) {
  const byN = new Map(out.map(line => [line.n, line.text]));
  const refs = (text: string | undefined) => [...(text ?? '').matchAll(/#(\d+)/g)].map(m => Number(m[1]));
  const styleIds = new Map<string, number>();
  const styleFor = (type: string) => {
    const existing = styleIds.get(type);
    if (existing) return existing;
    const { rgb, transparency } = PRODUCT_STYLES[type];
    const colour = next(); out.push({ n: colour, text: `IFCCOLOURRGB($,${N(rgb[0])},${N(rgb[1])},${N(rgb[2])})` });
    const rendering = next(); out.push({ n: rendering, text: `IFCSURFACESTYLERENDERING(${REF(colour)},${N(transparency)},$,$,$,$,IFCNORMALISEDRATIOMEASURE(0.5),IFCSPECULAREXPONENT(16.),.NOTDEFINED.)` });
    const style = next(); out.push({ n: style, text: `IFCSURFACESTYLE('${type.replace(/^IFC/, '').toLowerCase().replace('_', ' ')}',.BOTH.,(${REF(rendering)}))` });
    styleIds.set(type, style);
    return style;
  };
  // Bodies that already carry their own styles (multi-part doors and windows) keep them.
  const styled = new Set<number>(out.flatMap(line => line.text.startsWith('IFCSTYLEDITEM(') ? refs(line.text).slice(0, 1) : []));
  for (const line of [...out]) {
    const ifcType = /^(IFC[A-Z]+)\(/.exec(line.text)?.[1];
    // Stair landings are slabs but share the stair's colour, like in the editor.
    const type = ifcType === 'IFCSLAB' && line.text.includes('.LANDING.') ? 'STAIR_LANDING' : ifcType;
    if (!type || !PRODUCT_STYLES[type]) continue;
    // IfcProduct: the 7th attribute is the Representation (an IfcProductDefinitionShape).
    const shape = /^IFC[A-Z]+\('[^']*',(?:[^,]*,){5}(#\d+)/.exec(line.text)?.[1];
    if (!shape) continue;
    for (const rep of refs(byN.get(Number(shape.slice(1))))) {
      const repText = byN.get(rep);
      if (!repText?.startsWith('IFCSHAPEREPRESENTATION(') || !repText.includes("'Body'")) continue;
      const items = refs(repText.slice(repText.indexOf("'Body'")));
      for (const item of items) {
        if (styled.has(item)) continue;
        styled.add(item);
        const n = next(); out.push({ n, text: `IFCSTYLEDITEM(${REF(item)},(${REF(styleFor(type))}),$)` });
      }
    }
  }
}

export function exportIFC(items: ItemsMap): string {
  validateStairOpenings(items);
  reset();
  const lines: Line[] = [];

  // #1 = geometric representation context (reserved slot)
  const ctxN = next(); // = 1
  lines.push({ n: ctxN, text: `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${REF(next())},${REF(next())})` });
  // #2 = world coord system axis placement
  const wcsAx = _idx - 1; // already written as next() above — fix: write explicitly
  // Re-do properly:
  reset();
  const ctxRef = next(); // #1 — placeholder, overwritten below with full line

  // ── Collect typed entities ─────────────────────────────────────────────────
  const vals = Object.values(items);
  const proj    = vals.find((i) => i.type === 'Project')   as IfcProjectEntity   | undefined;
  const buildings = vals.filter((i) => i.type === 'Building') as IfcBuildingEntity[];
  const storeys   = vals.filter((i) => i.type === 'Storey')   as IfcStoreyEntity[];
  const spaces    = vals.filter((i) => i.type === 'Room')      as IfcSpaceEntity[];
  const walls     = vals.filter((i) => i.type === 'Wall')      as IfcWallEntity[];
  const doors     = vals.filter((i) => i.type === 'Door')      as IfcDoorEntity[];
  const windows   = vals.filter((i) => i.type === 'Window')    as IfcWindowEntity[];
  const furniture = vals.filter((i) => i.type === 'Furniture') as IfcFurnitureEntity[];

  // Restart clean — use a Map so we can insert #1 after
  reset();
  const out: Line[] = [];

  // ── #1 Geometric context ───────────────────────────────────────────────────
  const nCtx  = next(); // 1
  const nWpt  = next(); // 2  world origin
  const nWax  = next(); // 3  world axis
  const nWref = next(); // 4  world ref dir
  const nWcs  = next(); // 5  world coord system
  const nTrueN = next(); // 6 true north
  out.push({ n: nWpt,  text: `IFCCARTESIANPOINT((0.,0.,0.))` });
  out.push({ n: nWax,  text: `IFCDIRECTION((0.,0.,1.))` });
  out.push({ n: nWref, text: `IFCDIRECTION((1.,0.,0.))` });
  out.push({ n: nWcs,  text: `IFCAXIS2PLACEMENT3D(${REF(nWpt)},${REF(nWax)},${REF(nWref)})` });
  out.push({ n: nTrueN, text: `IFCDIRECTION((0.,1.))` });
  out.push({ n: nCtx,  text: `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${REF(nWcs)},${REF(nTrueN)})` });

  // ── Units ─────────────────────────────────────────────────────────────────
  const nUnitM  = next();
  const nUnitM2 = next();
  const nUnitM3 = next();
  const nUnitAss = next();
  out.push({ n: nUnitM,   text: `IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)` });
  out.push({ n: nUnitM2,  text: `IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)` });
  out.push({ n: nUnitM3,  text: `IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)` });
  out.push({ n: nUnitAss, text: `IFCUNITASSIGNMENT((${REF(nUnitM)},${REF(nUnitM2)},${REF(nUnitM3)}))` });

  // ── Project ───────────────────────────────────────────────────────────────
  const projName = proj?.Name || proj?.name || 'Projet';
  const projGuid = proj?.GlobalId || '0000000000000000000000';
  const nProjPlac = next();
  out.push({ n: nProjPlac, text: `IFCLOCALPLACEMENT($,${REF(nWcs)})` });
  const nProj = next();
  out.push({ n: nProj, text: `IFCPROJECT(${S(projGuid)},$,${S(projName)},$,$,$,$,(${REF(nCtx)}),${REF(nUnitAss)})` });

  // ── Site (with geographic reference if available) ─────────────────────────
  const toCompound = (deg: number): string => {
    const sign = deg < 0 ? -1 : 1;
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const m = Math.floor((abs - d) * 60);
    const s = Math.floor(((abs - d) * 60 - m) * 60);
    const ms = Math.round((((abs - d) * 60 - m) * 60 - s) * 1_000_000);
    return `(${sign * d},${m},${s},${ms})`;
  };
  const nSitePlac = next();
  const nSite = next();
  out.push({ n: nSitePlac, text: `IFCLOCALPLACEMENT(${REF(nProjPlac)},${REF(nWcs)})` });
  const latStr = proj?.lat != null ? toCompound(proj.lat) : '$';
  const lonStr = proj?.lon != null ? toCompound(proj.lon) : '$';
  const elevStr = proj?.siteElevation != null ? N(proj.siteElevation) : '$';
  out.push({ n: nSite, text: `IFCSITE(${S(guid('site_' + projGuid))},$,'Site',$,$,${REF(nSitePlac)},$,$,.ELEMENT.,${latStr},${lonStr},${elevStr},$,$)` });
  out.push({ n: next(), text: `IFCRELAGGREGATES(${S(guid('ragg_site_' + projGuid))},$,$,$,${REF(nProj)},(${REF(nSite)}))` });

  // ── Buildings ─────────────────────────────────────────────────────────────
  const bldNMap: Record<string, number> = {};
  const bldPlacNMap: Record<string, number> = {};
  for (const bld of buildings) {
    const nBldPlac = next();
    const nBld     = next();
    out.push({ n: nBldPlac, text: `IFCLOCALPLACEMENT(${REF(nSitePlac)},${REF(nWcs)})` });
    out.push({ n: nBld, text: `IFCBUILDING(${S(bld.GlobalId)},$,${S(bld.Name || bld.name)},$,$,${REF(nBldPlac)},$,$,.ELEMENT.,$,$)` });
    bldNMap[bld.id]     = nBld;
    bldPlacNMap[bld.id] = nBldPlac;
  }

  // Fallback building if none
  let defaultBldN = Object.values(bldNMap)[0] ?? 0;
  let defaultBldPlacN = Object.values(bldPlacNMap)[0] ?? nSitePlac;
  if (buildings.length === 0) {
    const nBldPlac = next();
    const nBld     = next();
    out.push({ n: nBldPlac, text: `IFCLOCALPLACEMENT(${REF(nSitePlac)},${REF(nWcs)})` });
    out.push({ n: nBld, text: `IFCBUILDING('0FALLBACK000000000000000',$,'Bâtiment',$,$,${REF(nBldPlac)},$,$,.ELEMENT.,$,$)` });
    defaultBldN     = nBld;
    defaultBldPlacN = nBldPlac;
  }

  // ── Storeys ───────────────────────────────────────────────────────────────
  const storeyNMap:     Record<string, number> = {};
  const storeyPlacNMap: Record<string, number> = {};
  for (const sty of storeys) {
    const parentBldPlacN = bldPlacNMap[sty.parentId!] ?? defaultBldPlacN;
    const elev = sty.geom.elevation;
    const nStyAx = writeAxis2Place3D(out, 0, 0, elev);
    const nStyPlac = next();
    out.push({ n: nStyPlac, text: `IFCLOCALPLACEMENT(${REF(parentBldPlacN)},${REF(nStyAx)})` });
    const nSty = next();
    out.push({ n: nSty, text: `IFCBUILDINGSTOREY(${S(sty.GlobalId)},$,${S(sty.Name || sty.name)},$,$,${REF(nStyPlac)},$,$,.ELEMENT.,${N(elev)})` });
    storeyNMap[sty.id]     = nSty;
    storeyPlacNMap[sty.id] = nStyPlac;
  }

  // Fallback storey
  let defaultStoreyN = Object.values(storeyNMap)[0] ?? 0;
  let defaultStoreyPlacN = Object.values(storeyPlacNMap)[0] ?? nProjPlac;
  if (storeys.length === 0) {
    const nStyAx   = writeAxis2Place3D(out, 0, 0, 0);
    const nStyPlac = next();
    const nSty     = next();
    out.push({ n: nStyPlac, text: `IFCLOCALPLACEMENT(${REF(defaultBldPlacN)},${REF(nStyAx)})` });
    out.push({ n: nSty, text: `IFCBUILDINGSTOREY('0FALLBACKSTY000000000000',$,'Niveau 0',$,$,${REF(nStyPlac)},$,$,.ELEMENT.,0.)` });
    defaultStoreyN     = nSty;
    defaultStoreyPlacN = nStyPlac;
  }

  // ── Spaces ────────────────────────────────────────────────────────────────
  const spaceNs: number[] = [];
  const spaceNMap: Record<string, number> = {};
  const spaceByStorey: Record<string, number[]> = {};
  for (const sp of spaces) {
    const styPlacN = storeyPlacNMap[sp.parentId!] ?? defaultStoreyPlacN;
    const [px, py] = sp.geom.polygon[0] ?? [0, 0];
    const nSpPlac = writeLocalPlacement(out, styPlacN, px, py, 0);
    const nSpShape = writeRoomGeom(out, sp, px, py);
    const nSp = next();
    out.push({ n: nSp, text: `IFCSPACE(${S(sp.GlobalId)},$,${S(sp.Name || sp.name)},$,$,${REF(nSpPlac)},${REF(nSpShape)},$,.ELEMENT.,.INTERNAL.,$)` });
    writePset(out, sp.GlobalId, nSp, 'Pset_SpaceCommon', {
      Category: sp.function,
      OccupancyNumber: sp.occupancy,
    });
    writeSurveyPset(out, items, sp, nSp);
    spaceNs.push(nSp);
    spaceNMap[sp.id] = nSp;
    const key = sp.parentId!;
    (spaceByStorey[key] ??= []).push(nSp);
  }

  // ── Walls ─────────────────────────────────────────────────────────────────
  const wallNs: number[] = [];
  const wallByStorey: Record<string, number[]> = {};
  const wallNMap: Record<string, number> = {};
  const wallPlacMap: Record<string, number> = {};
  for (const wall of walls) {
    const { x1, y1, x2, y2 } = wall.geom;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const angle = Math.atan2(dy, dx);
    const styPlacN = storeyPlacNMap[wall.parentId!] ?? defaultStoreyPlacN;
    // Local placement at wall start, rotated
    const nWOrigin = writePoint3D(out, x1, y1, 0);
    const nWAxis   = writeDir(out, 0, 0, 1);
    const nWRef    = writeDir(out, Math.cos(angle), Math.sin(angle), 0);
    const nWAx3D   = next();
    out.push({ n: nWAx3D, text: `IFCAXIS2PLACEMENT3D(${REF(nWOrigin)},${REF(nWAxis)},${REF(nWRef)})` });
    const nWPlac   = next();
    out.push({ n: nWPlac, text: `IFCLOCALPLACEMENT(${REF(styPlacN)},${REF(nWAx3D)})` });
    const nWShape = wallRoofShape(wall, items, text => { const n = next(); out.push({ n, text }); return n; }, nCtx) ?? writeWallGeom(out, wall, items);
    const isExt    = B(wall.IsExternal ?? wall.isExternal ?? false);
    const nW       = next();
    out.push({ n: nW, text: `IFCWALL(${S(wall.GlobalId)},$,${S(wall.Name || wall.name)},$,$,${REF(nWPlac)},${REF(nWShape)},$)` });
    writePset(out, wall.GlobalId, nW, 'Pset_WallCommon', {
      Reference: wall.Material || wall.material,
      LoadBearing: wall.LoadBearing ?? wall.loadBearing,
      IsExternal: wall.IsExternal ?? wall.isExternal,
      FireRating: wall.FireRating || wall.fireRating,
      ThermalTransmittance: wall.ThermalTransmittance ?? (wall as any).uValue,
    });
    writeSurveyPset(out, items, wall, nW);
    // Axis curve (2D centre line)
    const nP1 = writePoint2D(out, 0, 0);
    const nP2 = writePoint2D(out, len, 0);
    const nLine = next();
    out.push({ n: nLine, text: `IFCPOLYLINE((${REF(nP1)},${REF(nP2)}))` });
    const nAxisRep = next();
    out.push({ n: nAxisRep, text: `IFCSHAPEREPRESENTATION(${REF(nCtx)},'Axis','Curve2D',(${REF(nLine)}))` });
    wallNs.push(nW);
    wallNMap[wall.id] = nW;
    wallPlacMap[wall.id] = nWPlac;
    (wallByStorey[wall.parentId!] ??= []).push(nW);
  }

  const addOpening = (id: string, wallId: string, placement: number, width: number, height: number, filler: number) => {
    const wall = items[wallId] as IfcWallEntity | undefined;
    if (!wall || !wallNMap[wallId]) return;
    const shape = writeBoxGeom(out, width, height, wall.geom.thickness + 0.02);
    const opening = next();
    out.push({ n: opening, text: `IFCOPENINGELEMENT(${S(guid(id + 'opening'))},$,$,$,$,${REF(placement)},${REF(shape)},$,.OPENING.)` });
    const voidRel = next();
    out.push({ n: voidRel, text: `IFCRELVOIDSELEMENT(${S(guid(id + 'void'))},$,$,$,${REF(wallNMap[wallId])},${REF(opening)})` });
    const fillRel = next();
    out.push({ n: fillRel, text: `IFCRELFILLSELEMENT(${S(guid(id + 'fill'))},$,$,$,${REF(opening)},${REF(filler)})` });
  };

  // Shared surface styles for multi-part door and window bodies.
  const partStyles = new Map<string, number>();
  /**
   * Door or window body from the editor's own 3D model. The model is centred at mid-height and
   * drawn in the wall's frame; the IFC placement starts at the floor (or sill) and is turned half
   * a turn for doors opening to the wall's right, so the model is lifted and turned back to match.
   */
  const openingBody = (opening: IfcDoorEntity | IfcWindowEntity, wallThickness: number, placementTurned: boolean): number | null => {
    const model = buildOpeningModel(opening, wallThickness);
    if (!model) return null;
    model.position.y = opening.geom.height / 2;
    const holder = new THREE.Group();
    holder.add(model);
    if (placementTurned) holder.rotation.y = Math.PI;
    return writeModelGeom(out, holder, partStyles);
  };

  // ── Doors ─────────────────────────────────────────────────────────────────
  const doorNs: number[] = [];
  const doorByStorey: Record<string, number[]> = {};
  for (const door of doors) {
    const { wallId, t, width, height } = door.geom;
    const hostWall = items[wallId] as IfcWallEntity | undefined;
    let ox = 0, oy = 0;
    if (hostWall) {
      const { x1, y1, x2, y2 } = hostWall.geom;
      ox = x1 + (x2 - x1) * t;
      oy = y1 + (y2 - y1) * t;
    }
    const styPlacN = storeyPlacNMap[door.parentId!] ?? defaultStoreyPlacN;
    // The door's local Y axis points to the side its leaf opens to (the wall placement's Y is
    // the wall's left normal, so side −1 turns the door half a turn). Its OperationType is
    // relative to its own X axis, so the hinge side flips with that turn.
    const opensLeftOfWall = (door.geom.side ?? 1) >= 0;
    const localSwing = opensLeftOfWall ? door.geom.swing : door.geom.swing === 'left' ? 'right' : 'left';
    const declared = String(door.OperationType ?? '').toUpperCase();
    // A passage without a leaf: IFC4's IfcDoorTypeOperationEnum has no NONE, so it is written as
    // USERDEFINED / 'NONE' (read back as NONE by the importer), with no body: only the wall void.
    const leafless = declared === 'NONE';
    const operationType = leafless ? 'USERDEFINED' : declared && !declared.startsWith('SINGLE_SWING') ? declared : `SINGLE_SWING_${(localSwing ?? 'left').toUpperCase()}`;
    const nDPlac   = hostWall
      ? writeLocalPlacement(out, wallPlacMap[wallId], Math.hypot(hostWall.geom.x2 - hostWall.geom.x1, hostWall.geom.y2 - hostWall.geom.y1) * t, 0, 0, opensLeftOfWall ? 0 : Math.PI)
      : writeLocalPlacement(out, styPlacN, ox, oy, 0);
    const nDShape  = leafless ? null : openingBody(door, hostWall?.geom.thickness ?? 0.2, !opensLeftOfWall)
      ?? writePartsGeom(out, doorParts(width, height, hostWall?.geom.thickness ?? 0.2, localSwing === 'right' ? 'right' : 'left'), partStyles);
    const nD       = next();
    out.push({ n: nD, text: `IFCDOOR(${S(door.GlobalId)},$,${S(door.Name || door.name)},$,$,${REF(nDPlac)},${nDShape === null ? '$' : REF(nDShape)},$,${N(height)},${N(width)},.DOOR.,.${operationType}.,${leafless ? S('NONE') : '$'})` });
    addOpening(door.GlobalId, wallId, nDPlac, width, height, nD);
    writePset(out, door.GlobalId, nD, 'Pset_DoorCommon', {
      Reference: door.Material || door.material,
      FireRating: door.FireRating || door.fireRating,
      OperationType: leafless ? 'NONE' : operationType,
    });
    writeSurveyPset(out, items, door, nD);
    doorNs.push(nD);
    (doorByStorey[door.parentId!] ??= []).push(nD);
  }

  // ── Windows ───────────────────────────────────────────────────────────────
  const winNs: number[] = [];
  const winByStorey: Record<string, number[]> = {};
  for (const win of windows) {
    const { wallId, t, width, height, sillHeight } = win.geom;
    const hostWall = items[wallId] as IfcWallEntity | undefined;
    let ox = 0, oy = 0;
    if (hostWall) {
      const { x1, y1, x2, y2 } = hostWall.geom;
      ox = x1 + (x2 - x1) * t;
      oy = y1 + (y2 - y1) * t;
    }
    const styPlacN = storeyPlacNMap[win.parentId!] ?? defaultStoreyPlacN;
    const nWinPlac  = hostWall ? writeLocalPlacement(out, wallPlacMap[wallId], Math.hypot(hostWall.geom.x2 - hostWall.geom.x1, hostWall.geom.y2 - hostWall.geom.y1) * t, 0, sillHeight ?? 0.9) : writeLocalPlacement(out, styPlacN, ox, oy, sillHeight ?? 0.9);
    const nWinShape = openingBody(win, hostWall?.geom.thickness ?? 0.2, false)
      ?? writePartsGeom(out, windowParts(width, height, hostWall?.geom.thickness ?? 0.2, String(win.Material || win.material || '')), partStyles);
    const nWin      = next();
    const winPartitioning = windowPartitioningType(win);
    out.push({ n: nWin, text: `IFCWINDOW(${S(win.GlobalId)},$,${S(win.Name || win.name)},$,$,${REF(nWinPlac)},${REF(nWinShape)},$,${N(height)},${N(width)},.WINDOW.,.${winPartitioning}.,$)` });
    addOpening(win.GlobalId, wallId, nWinPlac, width, height, nWin);
    writePset(out, win.GlobalId, nWin, 'Pset_WindowCommon', {
      Reference: win.Material || win.material,
      ThermalTransmittance: win.ThermalTransmittance ?? win.uValue,
    });
    writeSurveyPset(out, items, win, nWin);
    winNs.push(nWin);
    (winByStorey[win.parentId!] ??= []).push(nWin);
  }

  // ── Furniture ─────────────────────────────────────────────────────────────
  const furNs: number[] = [];
  const furByStorey: Record<string, number[]> = {};
  for (const fur of furniture) {
    const { x, y, w, d, h, rotation = 0 } = fur.geom;
    const styPlacN = storeyPlacNMap[fur.parentId!] ?? defaultStoreyPlacN;
    const nFPlac   = writeLocalPlacement(out, styPlacN, x + w / 2, y + d / 2, 0, rotation);
    // Same geometry as the editor's 3D view; empty models (unknown data) fall back to a box.
    const model = buildFurnitureModel(fur);
    let meshCount = 0; model.traverse(o => { if ((o as THREE.Mesh).isMesh) meshCount++; });
    const nFShape  = meshCount ? writeModelGeom(out, model, partStyles) : writeBoxGeom(out, w, h, d);
    const nF       = next();
    out.push({ n: nF, text: `IFCFURNISHINGELEMENT(${S(fur.GlobalId)},$,${S(fur.Name || fur.name)},$,$,${REF(nFPlac)},${REF(nFShape)},$)` });
    writePset(out, fur.GlobalId, nF, 'Pset_Common', {
      Category: fur.category,
      Reference: fur.model,
    });
    furNs.push(nF);
    (furByStorey[fur.parentId!] ??= []).push(nF);
  }

  const technicalByStorey: Record<string, number[]> = {};
  for (const item of vals) {
    if (item.type !== 'Technical') continue;
    const { x, y, rotation = 0, mountHeight = 0.3 } = item.geom;
    const placement = writeLocalPlacement(out, storeyPlacNMap[item.parentId!] ?? defaultStoreyPlacN, x, y, mountHeight - 0.04, rotation);
    const shape = writeBoxGeom(out, 0.08, 0.08, 0.08);
    const element = next();
    out.push({ n: element, text: `${item.ifcType.toUpperCase()}(${S(item.GlobalId)},$,${S(item.name)},$,$,${REF(placement)},${REF(shape)},$)` });
    (technicalByStorey[item.parentId!] ??= []).push(element);
  }

  // ── Columns (IfcColumn) and chimneys (IfcChimney, IFC4) ──────────────────
  const structuralByStorey: Record<string, number[]> = {};
  for (const item of vals) {
    if (item.type !== 'Column' && item.type !== 'Chimney') continue;
    const { x, y, rotation = 0 } = item.geom;
    const placement = writeLocalPlacement(out, storeyPlacNMap[item.parentId!] ?? defaultStoreyPlacN, x, y, 0, rotation);
    const isColumn = item.type === 'Column';
    const shape = writeStructuralGeom(out, structuralParts(item), isColumn && item.geom.shape === 'circle' ? item.geom.w : undefined);
    const element = next();
    const entity = isColumn ? 'IFCCOLUMN' : 'IFCCHIMNEY';
    const predefined = isColumn ? 'COLUMN' : 'NOTDEFINED';
    const objectType = isColumn ? '$' : S(({ fireplace: 'Fireplace', stove: 'Stove', flue: 'Flue' } as const)[item.kind]);
    out.push({ n: element, text: `${entity}(${S(item.GlobalId)},$,${S(item.Name || item.name)},$,${objectType},${REF(placement)},${REF(shape)},$,.${predefined}.)` });
    if (isColumn) writePset(out, item.GlobalId, element, 'Pset_ColumnCommon', { Reference: item.geom.shape === 'circle' ? `Ø${Math.round(item.geom.w * 1000)}` : `${Math.round(item.geom.w * 1000)}x${Math.round(item.geom.d * 1000)}`, LoadBearing: true });
    else writePset(out, item.GlobalId, element, 'Pset_ChimneyCommon', { Reference: ({ fireplace: 'Fireplace', stove: 'Stove', flue: 'Flue' } as const)[item.kind] });
    if (item.Material) writePset(out, item.GlobalId, element, 'Pset_skAItch', { Material: item.Material });
    (structuralByStorey[item.parentId!] ??= []).push(element);
  }

  // ── Annotations: dimensions, markers, saved sections ─────────────────────
  const annotationByStorey: Record<string, number[]> = {};
  for (const item of vals) {
    if (!isAnnotation(item)) continue;
    const [ax, ay] = annotationAnchor(item);
    const placement = writeLocalPlacement(out, storeyPlacNMap[item.parentId!] ?? defaultStoreyPlacN, ax, ay, 0, 0);
    const element = next();
    out.push({ n: element, text: `IFCANNOTATION(${S(item.GlobalId)},$,${S(item.Name || item.name)},${S(annotationPayload(item))},${S(annotationObjectType(item.type))},${REF(placement)},$)` });
    (annotationByStorey[item.parentId!] ??= []).push(element);
  }

  // ── Slabs & roofs ─────────────────────────────────────────────────────────
  const shellByStorey: Record<string, number[]> = {};
  for (const it of vals) {
    if (it.type !== 'Slab' && it.type !== 'Roof') continue;
    const g = (it as any).geom ?? {};
    const polygon = (g.polygon ?? []) as [number, number][];
    if (polygon.length < 3) continue;
    const [px, py] = polygon[0];
    const styPlacN = storeyPlacNMap[it.parentId!] ?? defaultStoreyPlacN;
    const nPlac = writeLocalPlacement(out, styPlacN, px, py, 0);
    const name = S((it as any).Name || it.name);
    let nEl: number;
    if (it.type === 'Slab') {
      const nShape = writeSlabGeom(out, polygon, Number(g.thickness) || 0.2, px, py, slabOpenings(it.id,items));
      nEl = next();
      out.push({ n: nEl, text: `IFCSLAB(${S(it.GlobalId)},$,${name},$,$,${REF(nPlac)},${REF(nShape)},$,.FLOOR.)` });
    } else {
      const nShape = writeRoofGeom(out, g, px, py);
      if (nShape === null) continue;
      const predef = roofPredefinedType(g.roofType);
      nEl = next();
      out.push({ n: nEl, text: `IFCROOF(${S(it.GlobalId)},$,${name},$,$,${REF(nPlac)},${REF(nShape)},$,.${predef}.)` });
      writePset(out, it.GlobalId, nEl, 'Pset_RoofCommon', {
        ProjectedArea: undefined,
        Reference: g.roofType,
      });
    }
    (shellByStorey[it.parentId!] ??= []).push(nEl);
  }

  for (const it of vals) {
    if (it.type !== 'Stair') continue;
    const result = buildStair(it.geom,it.parentId,items);
    if (!result.parts.length) continue;
    const parent = writeLocalPlacement(out,storeyPlacNMap[it.parentId!] ?? defaultStoreyPlacN,0,0,0);
    const stairN=next();
    out.push({n:stairN,text:`IFCSTAIR(${S(it.GlobalId)},$,${S(it.name)},$,$,${REF(parent)},$,$,.NOTDEFINED.)`});
    const children:number[]=[];
    stairComponents(result.parts).forEach((parts,k)=>{
      const kind=parts[0].kind;
      const solids:number[]=[];
      for(const part of parts) {
        const before=out.length;
        writeSlabGeom(out,part.polygon,part.thickness,0,0);
        const solid=out.slice(before).find(l=>l.text.startsWith('IFCEXTRUDEDAREASOLID'))!;
        // Each solid is positioned at the tread top; extrusion runs downwards.
        const axis=writeAxis2Place3D(out,0,0,part.z);
        solid.text=solid.text.replace(/IFCEXTRUDEDAREASOLID\((#[0-9]+),#[0-9]+,/,`IFCEXTRUDEDAREASOLID($1,${REF(axis)},`);
        solids.push(solid.n);
      }
      const rep=next();out.push({n:rep,text:`IFCSHAPEREPRESENTATION(#1,'Body','SweptSolid',${LIST(solids)})`});
      const shape=next();out.push({n:shape,text:`IFCPRODUCTDEFINITIONSHAPE($,$,(${REF(rep)}))`});
      const n=next(); const id=S(guid(it.id+'_'+k));
      const common=`${id},$,${S(kind)},$,$,${REF(parent)},${REF(shape)},$`;
      const text=kind==='rail'?`IFCRAILING(${common},.GUARDRAIL.)`:kind==='landing'?`IFCSLAB(${common},.LANDING.)`:`IFCSTAIRFLIGHT(${common},${parts.length},${parts.length},${N(result.rise)},${N(parts[0].going ?? it.geom.going)},.NOTDEFINED.)`;
      out.push({n,text});children.push(n);
    });
    const relation=next();out.push({n:relation,text:`IFCRELAGGREGATES(${S(guid(it.id+'_parts'))},$,$,$,${REF(stairN)},${LIST(children)})`});
    (shellByStorey[it.parentId!] ??= []).push(stairN);
  }

  // ── Relationships ─────────────────────────────────────────────────────────
  const relLines: Line[] = [];
  let relIdx = _idx;

  function relAgg(guid: string, name: string, relatingN: number, relatedNs: number[]) {
    if (relatedNs.length === 0) return;
    relIdx++;
    relLines.push({ n: relIdx, text: `IFCRELAGGREGATES(${S(guid)},$,${S(name)},$,${REF(relatingN)},${LIST(relatedNs)})` });
  }
  function relContained(guid: string, relStructN: number, relatedNs: number[]) {
    if (relatedNs.length === 0) return;
    relIdx++;
    relLines.push({ n: relIdx, text: `IFCRELCONTAINEDINSPATIALSTRUCTURE(${S(guid)},$,$,$,${LIST(relatedNs)},${REF(relStructN)})` });
  }

  function relConnect(a: { wallId: string; end: 'start' | 'end' }, b: { wallId: string; end: 'start' | 'end' }) {
    if (!wallNMap[a.wallId] || !wallNMap[b.wallId]) return;
    relIdx++;
    const connectionId = guid('wall_join_' + a.wallId + '_' + a.end + '_' + b.wallId + '_' + b.end);
    relLines.push({ n: relIdx, text: 'IFCRELCONNECTSPATHELEMENTS(' + S(connectionId) + ',$,$,$,$,' + REF(wallNMap[a.wallId]) + ',' + REF(wallNMap[b.wallId]) + ',$,$,.AT' + b.end.toUpperCase() + '.,.AT' + a.end.toUpperCase() + '.)' });
  }

  // Project → Buildings
  relAgg('Rel_Proj_Bld_000000000000', 'Project→Buildings', nProj,
    buildings.length ? buildings.map((b) => bldNMap[b.id]) : [defaultBldN]);

  // Buildings → Storeys
  for (const bld of (buildings.length ? buildings : [{ id: '__fb' }])) {
    const bldN = bldNMap[bld.id] ?? defaultBldN;
    const childStoreys = storeys.filter((s) => s.parentId === bld.id).map((s) => storeyNMap[s.id]);
    const allStoreyNs = childStoreys.length
      ? childStoreys
      : Object.values(storeyNMap).length ? Object.values(storeyNMap) : [defaultStoreyN];
    relAgg(`Rel_Bld_Sty_${bld.id.slice(-8).padStart(8, '0')}`, 'Building→Storeys', bldN, allStoreyNs);
  }

  // Storeys → Spaces + Elements
  const allStoreyIds = storeys.length ? storeys.map((s) => s.id) : ['__fb'];
  for (const styId of allStoreyIds) {
    const styN = storeyNMap[styId] ?? defaultStoreyN;
    // Spaces via IfcRelAggregates
    if (spaceByStorey[styId]?.length) {
      relAgg(`Rel_Sty_Sp_${styId.slice(-8).padStart(8, '0')}`, 'Storey→Spaces', styN, spaceByStorey[styId]);
    }
    // Elements via IfcRelContainedInSpatialStructure
    const contained = [
      ...(wallByStorey[styId] ?? []),
      ...(doorByStorey[styId] ?? []),
      ...(winByStorey[styId]  ?? []),
      ...(furByStorey[styId]  ?? []),
      ...(technicalByStorey[styId] ?? []),
      ...(structuralByStorey[styId] ?? []),
      ...(shellByStorey[styId] ?? []),
      ...(annotationByStorey[styId] ?? []),
    ];
    relContained(`Rel_Sty_El_${styId.slice(-8).padStart(8, '0')}`, styN, contained);
  }

  for (const junction of findWallJunctions(items)) {
    for (let i = 0; i < junction.endpoints.length; i++) {
      for (let j = i + 1; j < junction.endpoints.length; j++) {
        if (junction.endpoints[i].wallId !== junction.endpoints[j].wallId) relConnect(junction.endpoints[i], junction.endpoints[j]);
      }
    }
  }

  // Survey photos (spec F-30, ADR 0010): one IfcDocumentReference per photo, located next to
  // the IFC file (photos/<id>.jpg), associated with the wall or space it documents.
  for (const [elementId, nElement] of [...Object.entries(wallNMap), ...Object.entries(spaceNMap)]) {
    for (const photo of photosForElement(items, elementId)) {
      relIdx++;
      const nDoc = relIdx;
      const where = photo.surface === 'floor' ? 'Sol' : photo.surface === 'ceiling' ? 'Plafond' : 'Mur';
      relLines.push({ n: nDoc, text: `IFCDOCUMENTREFERENCE(${S(surveyPhotoPath(photo.id))},${S(photo.id)},${S(`Photo du relevé — ${photo.roomName}, ${where}`)},${S(`${photo.annotations} annotation(s)`)},$)` });
      relIdx++;
      relLines.push({ n: relIdx, text: `IFCRELASSOCIATESDOCUMENT(${S(guid('photo_' + elementId + '_' + photo.id))},$,${S('Photo du relevé')},$,(${REF(nElement)}),${REF(nDoc)})` });
    }
  }

  // Flush rel lines with correct indices
  _idx = relIdx;
  out.push(...relLines);
  styleProductBodies(out);

  // ── Assemble STEP file ────────────────────────────────────────────────────
  const now = new Date()
    .toISOString()
    .replace(/-/g, '')
    .replace(/:/g, '')
    .replace('T', '')
    .slice(0, 15);
  const header = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');`,
    `FILE_NAME('export.ifc','${now}',(''),(''),'SkAItch','SkAItch 1.0','');`,
    `FILE_SCHEMA(('IFC4'));`,
    'ENDSEC;',
    'DATA;',
  ].join('\n');

  const body = out.map((l) => `#${l.n}=${l.text};`).join('\n');
  const footer = '\nENDSEC;\nEND-ISO-10303-21;';

  return `${header}\n${body}${footer}`;
}

