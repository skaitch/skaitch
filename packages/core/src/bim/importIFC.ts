import { createRequire } from 'node:module';
import * as WebIFC from 'web-ifc';
import type {
  ItemsMap, IfcProjectEntity, IfcBuildingEntity,
  IfcStoreyEntity, IfcSpaceEntity, IfcWallEntity, IfcDoorEntity,
  IfcWindowEntity, IfcFurnitureEntity, IfcGenericEntity, IfcSlabEntity, WallGeom,
} from '../types/ifc.js';
import { guid } from '../data/starter.js';
import { connectWallEndpoints, normalizeWallContinuity, type WallEnd } from '../lib/wallContinuity.js';

import type { ImportProgress, IfcMeshGeometry, ImportResult } from '../types/bim.js';
import { annotationFromIfc, isAnnotation, shiftAnnotationGeom } from './annotationIfc.js';
const require = createRequire(import.meta.url);

function scaleIfcMeshGeometry(mesh: IfcMeshGeometry, scale: number) {
  if (!Number.isFinite(scale) || scale === 1) return;
  const verts = mesh.vertices;
  for (let i = 0; i < verts.length; i += 6) {
    verts[i] *= scale;
    verts[i + 1] *= scale;
    verts[i + 2] *= scale;
  }
  // Column-major translation terms of the 4x4 matrix
  mesh.transform[12] *= scale;
  mesh.transform[13] *= scale;
  mesh.transform[14] *= scale;
}

// ── id / guid helpers ────────────────────────────────────────────────────────
const mkId   = (pfx: string, n: number) => `${pfx}_${n}`;
const mkGuid = (n: number) => guid(`obc_${n}`);

// ── raw attribute extraction ─────────────────────────────────────────────────
function attrVal(line: Record<string, unknown> | undefined, key: string): unknown {
  if (!line) return undefined;
  const v = line[key];
  if (v == null) return undefined;
  return v;
}
function attrStr(line: Record<string, unknown> | undefined, key: string): string {
  const v = attrVal(line, key);
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    // web-ifc wraps IfcLabel / IfcIdentifier as { type:4, _representationValue:"...", _internalValue:"..." }
    const vo = v as Record<string, unknown>;
    if (typeof vo['_representationValue'] === 'string') return vo['_representationValue'];
    if (typeof vo['_internalValue'] === 'string') return vo['_internalValue'];
    if ('value' in vo) return String(vo['value']);
  }
  return '';
}
function attrNum(line: Record<string, unknown> | undefined, key: string): number {
  const v = attrVal(line, key);
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'value' in v) return Number(v.value);
  return 0;
}
function getRef(v: any): number | null {
  if (!v) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 'value' in v) return Number(v.value);
  return null;
}
function vecToArray(vec: any): number[] {
  const arr: number[] = [];
  for (let i = 0; i < vec.size(); i++) arr.push(vec.get(i));
  return arr;
}
function getName(line: Record<string, unknown> | undefined): string {
  return attrStr(line, 'Name') || attrStr(line, 'ElementName') || '';
}

function coordNum(v: any): number {
  return typeof v === 'number' ? v : (v?.value ?? 0);
}

// ── Geometry Helpers ─────────────────────────────────────────────────────────

// ── Read wall axis points (local space) ──────────────────────────────────────
function readWallAxisPts(api: WebIFC.IfcAPI, mid: number, wLine: Record<string, unknown>): [number, number][] | null {
  try {
    const reprId = getRef(wLine['Representation']);
    if (!reprId) return null;
    const reprLine = api.GetLine(mid, reprId, false) as Record<string, unknown>;
    const reprs = reprLine['Representations'];
    if (!Array.isArray(reprs)) return null;

    for (const r of reprs) {
      const srId = getRef(r); if (!srId) continue;
      const sr = api.GetLine(mid, srId, false) as Record<string, unknown>;

      const items = sr['Items'];
      if (!Array.isArray(items) || !items.length) continue;

      // We accept any polyline or trimmed curve we can find
      for (const itemId of items) {
        const polyId = getRef(itemId); if (!polyId) continue;
        const poly = api.GetLine(mid, polyId, false) as Record<string, unknown>;

        let ptRefs = poly['Points'] as unknown[];
        // If it's a TrimmedCurve, it might have a BasisCurve
        if (!Array.isArray(ptRefs)) {
           const basisId = getRef(poly['BasisCurve']);
           if (basisId) {
             const basis = api.GetLine(mid, basisId, false) as Record<string, unknown>;
             ptRefs = basis['Points'] as unknown[];
           }
        }

        if (!Array.isArray(ptRefs)) continue;

        const coords: [number, number][] = [];
        for (const pr of ptRefs) {
          const pid = getRef(pr); if (!pid) continue;
          const pt = api.GetLine(mid, pid, false) as Record<string, unknown>;
          const co = pt['Coordinates'] as unknown[];
          coords.push([coordNum(co[0]), coordNum(co[1])]);
        }
        if (coords.length >= 2) return coords;
      }
    }
  } catch { /* ignore */ }
  return null;
}

// ── Parse "WxDxHmm" or "WxDmm" from Revit family type name ──────────────────
function parseDimsFromName(name: string): { w: number; d: number; h: number } | null {
  // Matches "1370x600x1170mm" or "2000x1000x750mm" (may have other text before/after)
  const m3 = name.match(/(\d+)[xX×](\d+)[xX×](\d+)\s*mm/);
  if (m3) return { w: +m3[1] / 1000, d: +m3[2] / 1000, h: +m3[3] / 1000 };
  const m2 = name.match(/(\d+)[xX×](\d+)\s*mm/);
  if (m2) return { w: +m2[1] / 1000, d: +m2[2] / 1000, h: 0 };
  return null;
}

function multiplyMatrices(a: number[], b: number[]): number[] {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      r[i + j * 4] = a[i + 0 * 4] * b[0 + j * 4] +
                    a[i + 1 * 4] * b[1 + j * 4] +
                    a[i + 2 * 4] * b[2 + j * 4] +
                    a[i + 3 * 4] * b[3 + j * 4];
    }
  }
  return r;
}

function rotationFromMatrixXY(m: number[]): number {
  const xLen = Math.hypot(m[0], m[1]);
  if (xLen > 1e-9) return Math.atan2(m[1] / xLen, m[0] / xLen);
  const yLen = Math.hypot(m[4], m[5]);
  if (yLen > 1e-9) return Math.atan2(m[5] / yLen, m[4] / yLen) - Math.PI / 2;
  return 0;
}

// ── Extract 4×4 transformation matrix from IfcMappedItem.MappingTarget ────────
// Revit IFC4 exports furniture via IfcMappedItem where the actual position
// and rotation is in MappingTarget (not in ObjectPlacement).
function getMappingTargetMatrix(
  api: WebIFC.IfcAPI, mid: number, line: Record<string, unknown>
): number[] | null {
  try {
    const reprId = getRef(line['Representation']); if (!reprId) return null;
    const reprLine = api.GetLine(mid, reprId, false) as Record<string, unknown>;
    const reprs = (reprLine['Representations'] ?? []) as unknown[];
    for (const rRef of reprs) {
      const rId = getRef(rRef); if (!rId) continue;
      const rep = api.GetLine(mid, rId, false) as Record<string, unknown>;
      const ident = attrStr(rep, 'RepresentationIdentifier').toLowerCase();
      if (ident === 'footprint' || ident === 'plan' || ident === 'axis') continue;
      const rItems = (rep['Items'] ?? []) as unknown[];
      for (const iRef of rItems) {
        const iId = getRef(iRef); if (!iId) continue;
        const item = api.GetLine(mid, iId, false) as Record<string, unknown>;
        const targetRef = getRef((item as any)['MappingTarget']); if (!targetRef) continue;
        const target = api.GetLine(mid, targetRef, false) as Record<string, unknown>;

        // 1. LocalOrigin (Translation)
        const locRef = getRef((target as any)['LocalOrigin'] ?? (target as any)['Origin']);
        if (!locRef) continue;
        const pt = api.GetLine(mid, locRef, false) as Record<string, unknown>;
        const coords = (pt['Coordinates'] ?? []) as unknown[];
        if (coords.length < 2) continue;
        const tx = coordNum(coords[0]);
        const ty = coordNum(coords[1]);
        const tz = coords.length >= 3 ? coordNum(coords[2]) : 0;

        // 2. Scale
        const S = coordNum((target as any)['Scale'] ?? 1) || 1;

        // 3. Axes (DirectionRatios)
        let ax = [1, 0, 0];
        let ay = [0, 1, 0];
        let az = [0, 0, 1];

        const ax1Ref = getRef((target as any)['Axis1']);
        if (ax1Ref) {
          const ax1 = api.GetLine(mid, ax1Ref, false) as Record<string, unknown>;
          const dc = ((ax1 as any)['DirectionRatios'] ?? []) as unknown[];
          if (dc.length >= 3) ax = [coordNum(dc[0]), coordNum(dc[1]), coordNum(dc[2])];
        }

        const ax2Ref = getRef((target as any)['Axis2']);
        if (ax2Ref) {
          const ax2 = api.GetLine(mid, ax2Ref, false) as Record<string, unknown>;
          const dc = ((ax2 as any)['DirectionRatios'] ?? []) as unknown[];
          if (dc.length >= 3) ay = [coordNum(dc[0]), coordNum(dc[1]), coordNum(dc[2])];
        }

        const ax3Ref = getRef((target as any)['Axis3']);
        if (ax3Ref) {
          const ax3 = api.GetLine(mid, ax3Ref, false) as Record<string, unknown>;
          const dc = ((ax3 as any)['DirectionRatios'] ?? []) as unknown[];
          if (dc.length >= 3) az = [coordNum(dc[0]), coordNum(dc[1]), coordNum(dc[2])];
        }

        // Return a column-major 4x4 matrix (unscaled by world scale)
        return [
          ax[0] * S, ax[1] * S, ax[2] * S, 0,
          ay[0] * S, ay[1] * S, ay[2] * S, 0,
          az[0] * S, az[1] * S, az[2] * S, 0,
          tx, ty, tz, 1
        ];
      }
    }
  } catch { /* ignore */ }
  return null;
}

// ── Get world-space 4×4 matrix for an element's ObjectPlacement ──────────────
function getPlacementMatrix(api: WebIFC.IfcAPI, mid: number, line: Record<string, unknown>): number[] | null {
  const placId = getRef(line['ObjectPlacement']);
  if (!placId) return null;
  try {
    let m = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    let curr = placId;
    while (curr) {
      const p = api.GetLine(mid, curr, false) as Record<string, unknown>;
      const p2d3dId = getRef(p['RelativePlacement']);
      if (p2d3dId) {
        const localMat = axisPlacement3D(api, mid, p2d3dId);
        const r = new Array(16).fill(0);
        for (let i = 0; i < 4; i++) {
          for (let j = 0; j < 4; j++) {
            r[i + j * 4] = localMat[i + 0 * 4] * m[0 + j * 4] + localMat[i + 1 * 4] * m[1 + j * 4] + localMat[i + 2 * 4] * m[2 + j * 4] + localMat[i + 3 * 4] * m[3 + j * 4];
          }
        }
        m = r;
      }
      curr = getRef(p['PlacementRelTo']) || 0;
    }
    return m;
  } catch {
    return null;
  }
}

// ── Collect world-space vertices from a FlatMesh (for spaces/doors/etc.) ──────
interface MeshVerts { xy: [number, number][]; xz: [number, number][]; minZ: number; maxZ: number; minX: number; maxX: number; minY: number; maxY: number; }

function collectMeshVerts(api: WebIFC.IfcAPI, mid: number, mesh: WebIFC.FlatMesh, scale: number = 1): MeshVerts {
  const xy: [number, number][] = [];
  const xz: [number, number][] = [];
  let minZ = Infinity, maxZ = -Infinity;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  const n = mesh.geometries.size();
  for (let gi = 0; gi < n; gi++) {
    const placed = mesh.geometries.get(gi);
    try {
      const geom = api.GetGeometry(mid, placed.geometryExpressID);
      const dataPtr = geom.GetVertexData();
      const dataSize = geom.GetVertexDataSize();
      if (dataSize > 0) {
        // IMPORTANT: Copy the data out of the WASM heap immediately
        const verts = new Float32Array(api.GetVertexArray(dataPtr, dataSize));
        const m = placed.flatTransformation;
        for (let j = 0; j < verts.length; j += 6) {
          const lx = verts[j], ly = verts[j + 1], lz = verts[j + 2];
          const wx = m[0] * lx + m[4] * ly + m[8]  * lz + m[12];
          const wy = m[1] * lx + m[5] * ly + m[9]  * lz + m[13];
          const wz = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
          const sx = wx * scale;
          const sy = wy * scale;
          const sz = wz * scale;
          xy.push([sx, sy]);
          xz.push([sx, -sz]);
          if (sz < minZ) minZ = sz;
          if (sz > maxZ) maxZ = sz;
          if (sx < minX) minX = sx;
          if (sx > maxX) maxX = sx;
          if (sy < minY) minY = sy;
          if (sy > maxY) maxY = sy;
        }
      }
      geom.delete?.();
    } catch (err) {
      console.warn(`[IFC] Geometry error for ${placed.geometryExpressID}:`, err);
    }
  }
  return { xy, xz, minZ, maxZ, minX, maxX, minY, maxY };
}

/**
 * Robustly resolve a wall segment (x1,y1,x2,y2,thickness,height) from its 3D bounding box.
 * Identifies the orientation by finding the smallest dimension (thickness) and projecting
 * the remaining axes onto the 2D plan.
 */
function resolveWallFromMesh(mv: MeshVerts, forceYup: boolean = false): WallGeom | null {
  const dx = mv.maxX - mv.minX;
  const dy = mv.maxY - mv.minY;
  const dz = mv.maxZ - mv.minZ;
  if (dx < 0.001 && dy < 0.001 && dz < 0.001) return null;

  const dims = [
    { axis: 'x', size: dx, min: mv.minX, max: mv.maxX },
    { axis: 'y', size: dy, min: mv.minY, max: mv.maxY },
    { axis: 'z', size: dz, min: mv.minZ, max: mv.maxZ }
  ];

  // Sort by size ascending: [Thickness, ?, ?]
  dims.sort((a, b) => a.size - b.size);
  const axisT = dims[0];

  let x1, y1, x2, y2, thickness, height;

  // Detect Y-up dynamically if not forced.
  // If thickness is Z, it's definitely Y-up (or X-up).
  // If thickness is X, and dz is much larger than dy, it might be a Y-up wall along Z.
  let isYup = forceYup || axisT.axis === 'z';
  if (!isYup && axisT.axis === 'x' && dz > dy * 1.2 && dy >= 2.0 && dy <= 4.5) {
    isYup = true; // Height is likely Y, length is Z.
  }

  if (isYup) {
    // Element is Y-up. Height is Y. Plan is X and Z.
    // Map world Z to global plan Y (using -Z to align with rooms in this model).
    // Map world X to global plan X.
    if (dx >= dz) {
      // Wall along world X.
      thickness = dz; height = dy;
      thickness = Math.max(thickness, 0.1);
      x1 = mv.minX + thickness / 2; x2 = mv.maxX - thickness / 2;
      y1 = - (mv.minZ + mv.maxZ) / 2; y2 = y1;
    } else {
      // Wall along world Z.
      thickness = dx; height = dy;
      thickness = Math.max(thickness, 0.1);
      x1 = (mv.minX + mv.maxX) / 2; x2 = x1;
      y1 = -mv.maxZ + thickness / 2; y2 = -mv.minZ - thickness / 2;
    }
  } else if (axisT.axis === 'x') {
    // Standard Z-up vertical wall parallel to YZ.
    thickness = dx; height = dz;
    thickness = Math.max(thickness, 0.1);
    x1 = axisT.min + axisT.size / 2; x2 = x1;
    y1 = mv.minY + thickness / 2; y2 = mv.maxY - thickness / 2;
  } else {
    // Standard Z-up vertical wall parallel to XZ.
    thickness = dy; height = dz;
    thickness = Math.max(thickness, 0.1);
    x1 = mv.minX + thickness / 2; x2 = mv.maxX - thickness / 2;
    y1 = axisT.min + axisT.size / 2; y2 = y1;
  }

  if (height < 0.1) height = 2.5;

  return { x1: x1!, y1: y1!, x2: x2!, y2: y2!, thickness: thickness!, height: height! };
}

// ── Build 4×4 column-major matrix from IfcAxis2Placement3D ───────────────────
function axisPlacement3D(api: WebIFC.IfcAPI, mid: number, id: number): number[] {
  try {
    const pl = api.GetLine(mid, id, false) as Record<string, unknown>;
    const locId = getRef(pl['Location']);
    let ox = 0, oy = 0, oz = 0;
    if (locId) {
      const pt = api.GetLine(mid, locId, false) as Record<string, unknown>;
      const co = pt['Coordinates'] as unknown[];
      ox = coordNum(co[0]); oy = coordNum(co[1]); oz = co.length > 2 ? coordNum(co[2]) : 0;
    }
    let zx = 0, zy = 0, zz = 1;
    let rx = 1, ry = 0, rz = 0;
    const axId = getRef(pl['Axis']);
    if (axId) {
      const ax = api.GetLine(mid, axId, false) as Record<string, unknown>;
      const co = ax['DirectionRatios'] as unknown[];
      zx = coordNum(co[0]); zy = coordNum(co[1]); zz = coordNum(co[2]);
    }
    const rdId = getRef(pl['RefDirection']);
    if (rdId) {
      const rd = api.GetLine(mid, rdId, false) as Record<string, unknown>;
      const co = rd['DirectionRatios'] as unknown[];
      rx = coordNum(co[0]); ry = coordNum(co[1]); rz = co.length > 2 ? coordNum(co[2]) : 0;
    }
    const zLen = Math.hypot(zx, zy, zz) || 1;
    zx /= zLen; zy /= zLen; zz /= zLen;
    const dot = rx * zx + ry * zy + rz * zz;
    let xx = rx - dot * zx, xy = ry - dot * zy, xz = rz - dot * zz;
    const xLen = Math.hypot(xx, xy, xz) || 1;
    xx /= xLen; xy /= xLen; xz /= xLen;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return [xx, xy, xz, 0, yx, yy, yz, 0, zx, zy, zz, 0, ox, oy, oz, 1];
  } catch {
    return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  }
}

// ── Read profile points from IfcProfileDef ───────────────────────────────────
function readProfilePts(api: WebIFC.IfcAPI, mid: number, id: number): [number, number][] | null {
  try {
    const sa = api.GetLine(mid, id, false) as Record<string, unknown>;
    let px = 0, py = 0, pdx = 1, pdy = 0;
    const posId = getRef(sa['Position']);
    if (posId) {
      const pp = api.GetLine(mid, posId, false) as Record<string, unknown>;
      const locId = getRef(pp['Location']);
      if (locId) {
        const pt = api.GetLine(mid, locId, false) as Record<string, unknown>;
        const co = pt['Coordinates'] as unknown[];
        px = coordNum(co[0]); py = coordNum(co[1]);
      }
      const rdId = getRef(pp['RefDirection']);
      if (rdId) {
        const rd = api.GetLine(mid, rdId, false) as Record<string, unknown>;
        const co = rd['DirectionRatios'] as unknown[];
        pdx = coordNum(co[0]); pdy = coordNum(co[1]);
      }
    }
    const pex = -pdy, pey = pdx;
    const xd = attrNum(sa, 'XDim'), yd = attrNum(sa, 'YDim');
    if (xd > 0 && yd > 0) {
      const hx = xd / 2, hy = yd / 2;
      return [
        [px + pdx*(-hx) + pex*(-hy), py + pdy*(-hx) + pey*(-hy)],
        [px + pdx*(+hx) + pex*(-hy), py + pdy*(+hx) + pey*(-hy)],
        [px + pdx*(+hx) + pex*(+hy), py + pdy*(+hx) + pey*(+hy)],
        [px + pdx*(-hx) + pex*(+hy), py + pdy*(-hx) + pey*(+hy)],
      ];
    }
    const curveId = getRef(sa['OuterCurve']);
    if (curveId) {
      const curve = api.GetLine(mid, curveId, false) as Record<string, unknown>;
      const ptRefs = curve['Points'] as unknown;

      // Case A: IFCPOLYLINE — Points is an array of IFCCARTESIANPOINT refs
      if (Array.isArray(ptRefs) && ptRefs.length >= 3) {
        const pts: [number, number][] = [];
        for (const r of ptRefs) {
          const pid = getRef(r); if (!pid) continue;
          const pt = api.GetLine(mid, pid, false) as Record<string, unknown>;
          const co = pt['Coordinates'] as unknown[];
          const lx = coordNum(co[0]), ly = coordNum(co[1]);
          pts.push([px + pdx*lx + pex*ly, py + pdy*lx + pey*ly]);
        }
        if (pts.length >= 3) return pts;
      }

      // Case B: IFCPOLYLOOP (IFC4 ADD2) — Points is a single ref to an
      // IFCCOORDINATESLIST entity whose CoordList holds raw [x,y] pairs.
      const coordListRef = getRef(ptRefs as any);
      if (coordListRef) {
        const coordListEnt = api.GetLine(mid, coordListRef, false) as Record<string, unknown>;
        const coordList = coordListEnt['CoordList'] as unknown;
        if (Array.isArray(coordList) && coordList.length >= 3) {
          const pts: [number, number][] = [];
          for (const pair of coordList) {
            if (!Array.isArray(pair) || pair.length < 2) continue;
            const lx = coordNum(pair[0]), ly = coordNum(pair[1]);
            pts.push([px + pdx*lx + pex*ly, py + pdy*lx + pey*ly]);
          }
          if (pts.length >= 3) return pts;
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}

// ── Read space footprint polygon in world space ────────────────────────────────
function readSpaceFootprint(
  api: WebIFC.IfcAPI, mid: number, spLine: Record<string, unknown>, scale: number,
): [number, number][] | null {
  try {
    const worldMat = getPlacementMatrix(api, mid, spLine);
    const reprId = getRef(spLine['Representation']);
    if (!reprId) return null;
    const reprLine = api.GetLine(mid, reprId, false) as Record<string, unknown>;
    const reprs = reprLine['Representations'];
    if (!Array.isArray(reprs)) return null;

    for (const r of reprs) {
      const srId = getRef(r); if (!srId) continue;
      const sr = api.GetLine(mid, srId, false) as Record<string, unknown>;
      const rtype = attrStr(sr, 'RepresentationType');
      // Accept any swept-solid or clipping representation; also allow empty/unknown types
      // because web-ifc sometimes returns complex objects for IfcLabel attributes.
      if (rtype && rtype !== 'SweptSolid' && rtype !== 'Clipping' && rtype !== 'SolidModel') continue;
      const items = sr['Items'];
      if (!Array.isArray(items) || !items.length) continue;
      const solidId = getRef(items[0]); if (!solidId) continue;
      let solid = api.GetLine(mid, solidId, false) as Record<string, unknown>;
      // Walk through IfcBooleanClippingResult to reach the base extrusion
      for (let guard = 0; guard < 5 && solid && !solid['SweptArea']; guard++) {
        const firstOp = getRef(solid['FirstOperand']);
        if (!firstOp) break;
        solid = api.GetLine(mid, firstOp, false) as Record<string, unknown>;
      }
      const sweptAreaId = getRef(solid['SweptArea']); if (!sweptAreaId) continue;
      const localPts = readProfilePts(api, mid, sweptAreaId);
      if (!localPts || localPts.length < 3) continue;
      const extPosId = getRef(solid['Position']);
      const em = extPosId ? axisPlacement3D(api, mid, extPosId) : [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
      const extPts = localPts.map(([lx, ly]) => [
        em[0]*lx + em[4]*ly + em[12],
        em[1]*lx + em[5]*ly + em[13],
      ] as [number, number]);
      if (worldMat) {
        const wm = worldMat;
        return extPts.map(([lx, ly]) => [
          (wm[0]*lx + wm[4]*ly + wm[12]) * scale,
          (wm[1]*lx + wm[5]*ly + wm[13]) * scale,
        ] as [number, number]);
      }
      return extPts.map(([x, y]) => [x * scale, y * scale] as [number, number]);
    }
  } catch { /* ignore */ }
  return null;
}

// ── Read slab/floor footprint polygon + thickness from extruded solid ────────
// IfcSlab typically uses IfcExtrudedAreaSolid with SweptSolid representation —
// same pattern as IfcSpace, with the extrusion Depth providing thickness.
function readSlabFootprint(
  api: WebIFC.IfcAPI, mid: number, slLine: Record<string, unknown>, scale: number,
): { polygon: [number, number][]; thickness: number } | null {
  try {
    const worldMat = getPlacementMatrix(api, mid, slLine);
    const reprId = getRef(slLine['Representation']);
    if (!reprId) return null;
    const reprLine = api.GetLine(mid, reprId, false) as Record<string, unknown>;
    const reprs = reprLine['Representations'];
    if (!Array.isArray(reprs)) return null;

    for (const r of reprs) {
      const srId = getRef(r); if (!srId) continue;
      const sr = api.GetLine(mid, srId, false) as Record<string, unknown>;
      const rtype = attrStr(sr, 'RepresentationType');
      if (rtype && rtype !== 'SweptSolid' && rtype !== 'Clipping' && rtype !== 'SolidModel') continue;
      const items = sr['Items'];
      if (!Array.isArray(items) || !items.length) continue;
      let solidId = getRef(items[0]); if (!solidId) continue;
      let solid = api.GetLine(mid, solidId, false) as Record<string, unknown>;
      // Walk through IfcBooleanClippingResult to reach the base extrusion
      for (let guard = 0; guard < 5 && solid && !attrNum(solid, 'Depth'); guard++) {
        const firstOp = getRef(solid['FirstOperand']);
        if (!firstOp) break;
        solid = api.GetLine(mid, firstOp, false) as Record<string, unknown>;
      }
      const depth = attrNum(solid, 'Depth');
      const sweptAreaId = getRef(solid['SweptArea']);
      if (!sweptAreaId) continue;
      const localPts = readProfilePts(api, mid, sweptAreaId);
      if (!localPts || localPts.length < 3) continue;
      const extPosId = getRef(solid['Position']);
      const em = extPosId ? axisPlacement3D(api, mid, extPosId) : [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
      const extPts = localPts.map(([lx, ly]) => [
        em[0]*lx + em[4]*ly + em[12],
        em[1]*lx + em[5]*ly + em[13],
      ] as [number, number]);
      const worldPts: [number, number][] = worldMat
        ? extPts.map(([lx, ly]) => [
            (worldMat[0]*lx + worldMat[4]*ly + worldMat[12]) * scale,
            (worldMat[1]*lx + worldMat[5]*ly + worldMat[13]) * scale,
          ] as [number, number])
        : extPts.map(([x, y]) => [x * scale, y * scale] as [number, number]);
      return { polygon: worldPts, thickness: depth > 0 ? depth * scale : 0.2 };
    }
  } catch { /* ignore */ }
  return null;
}

// ── Convex hull of 2D points (Graham scan) ───────────────────────────────────
function convexHull(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const cross = (O: [number, number], A: [number, number], B: [number, number]) =>
    (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const hull: [number, number][] = [];
  for (const p of sorted) {
    while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop();
    hull.push(p);
  }
  const lower = hull.length + 1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (hull.length >= lower && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop();
    hull.push(p);
  }
  hull.pop();
  return hull.length >= 3 ? hull : pts.slice(0, 4);
}

function projectedFootprint(pts: [number, number][], nearX: number, nearY: number) {
  if (pts.length < 3) return null;
  const hull = convexHull(pts);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of hull) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const w = maxX - minX, d = maxY - minY;
  if (w < 0.03 || d < 0.03) return null;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { hull, minX, maxX, minY, maxY, w, d, cx, cy, dist: Math.hypot(cx - nearX, cy - nearY) };
}

// ── Read IFCBOUNDINGBOX dimensions from a furniture element ──────────────────
// Revit IFC4 exports a 'Box' representation with exact local XDim/YDim/ZDim.
// Also reads the Corner cartesian point — the offset from the element's insertion
// point to the minimum corner of the bounding box (in local space, pre-rotation).
function readFurnitureBBox(
  api: WebIFC.IfcAPI, mid: number, line: Record<string, unknown>, scale: number
): { fw: number; fd: number; fh: number; cornerX: number; cornerY: number } | null {
  try {
    const reprId = getRef(line['Representation']); if (!reprId) return null;
    const reprLine = api.GetLine(mid, reprId, false) as Record<string, unknown>;
    const reprs = (reprLine['Representations'] ?? []) as unknown[];
    for (const rRef of reprs) {
      const rId = getRef(rRef); if (!rId) continue;
      const rep = api.GetLine(mid, rId, false) as Record<string, unknown>;
      const ident = attrStr(rep, 'RepresentationIdentifier').toLowerCase();
      if (ident !== 'box' && ident !== 'boundingbox') continue;
      for (const iRef of ((rep['Items'] ?? []) as unknown[])) {
        const iId = getRef(iRef); if (!iId) continue;
        const item = api.GetLine(mid, iId, false) as Record<string, unknown>;
        const fw = coordNum((item as any)['XDim'] ?? 0) * scale;
        const fd = coordNum((item as any)['YDim'] ?? 0) * scale;
        const fh = coordNum((item as any)['ZDim'] ?? 0) * scale;
        if (fw > 0.01 && fd > 0.01) {
          // Read Corner — the local-space offset from insertion to bbox min corner
          let cornerX = 0, cornerY = 0;
          const cornerRef = getRef((item as any)['Corner']);
          if (cornerRef) {
            const cornerPt = api.GetLine(mid, cornerRef, false) as Record<string, unknown>;
            const coords = (cornerPt['Coordinates'] ?? []) as unknown[];
            if (coords.length >= 2) {
              cornerX = coordNum(coords[0]) * scale;
              cornerY = coordNum(coords[1]) * scale;
            }
          }
          return { fw, fd, fh: fh || 0.75, cornerX, cornerY };
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}

// ── Read IFC IFCPOLYLINE / IFCINDEXEDPOLYCURVE points ────────────────────────
function readPolylinePts(api: WebIFC.IfcAPI, mid: number, item: Record<string, unknown>, scale: number): [number, number][] | null {
  try {
    const pts = ((item as any)['Points'] ?? []) as unknown[];
    if (pts.length < 3) return null;
    const result: [number, number][] = [];
    for (const pRef of pts) {
      const pId = getRef(pRef); if (!pId) continue;
      const pt = api.GetLine(mid, pId, false) as Record<string, unknown>;
      const coords = (pt['Coordinates'] ?? []) as unknown[];
      if (coords.length >= 2) result.push([coordNum(coords[0]) * scale, coordNum(coords[1]) * scale]);
    }
    return result.length >= 3 ? result : null;
  } catch { return null; }
}

// ── Read 2D FootPrint representation polygon from an IFC furniture element ────
// Returns world-space XY polygon, or null if not available.
function readFurnitureFootprint(
  api: WebIFC.IfcAPI, mid: number,
  line: Record<string, unknown>,
  scale: number,
  fMat: number[] | null,
): [number, number][] | null {
  try {
    const reprId = getRef(line['Representation']); if (!reprId) return null;
    const reprLine = api.GetLine(mid, reprId, false) as Record<string, unknown>;
    const reprs = (reprLine['Representations'] ?? []) as unknown[];

    for (const rRef of reprs) {
      const rId = getRef(rRef); if (!rId) continue;
      const rep = api.GetLine(mid, rId, false) as Record<string, unknown>;
      const ident = attrStr(rep, 'RepresentationIdentifier').toLowerCase();
      if (ident !== 'footprint' && ident !== 'plan') continue;

      const rItems = (rep['Items'] ?? []) as unknown[];
      for (const iRef of rItems) {
        const iId = getRef(iRef); if (!iId) continue;
        const item = api.GetLine(mid, iId, false) as Record<string, unknown>;

        let localPts: [number, number][] | null = null;
        let tx = 0, ty = 0, rcos = 1, rsin = 0, S = 1;

        const mapSourceRef = getRef((item as any)['MappingSource']);
        if (mapSourceRef) {
          // IFCMAPPEDITEM: read local polygon from RepresentationMap
          const mapSource = api.GetLine(mid, mapSourceRef, false) as Record<string, unknown>;
          const mapRepRef = getRef((mapSource as any)['MappedRepresentation']);
          if (mapRepRef) {
            const mapRep = api.GetLine(mid, mapRepRef, false) as Record<string, unknown>;
            for (const miRef of ((mapRep as any)['Items'] ?? []) as unknown[]) {
              const miId = getRef(miRef); if (!miId) continue;
              const mi = api.GetLine(mid, miId, false) as Record<string, unknown>;
              const pts = readPolylinePts(api, mid, mi, scale);
              if (pts) { localPts = pts; break; }
            }
          }
        } else {
          // Direct IFCPOLYLINE — in element local space
          localPts = readPolylinePts(api, mid, item, scale);
        }

        if (!localPts || localPts.length < 3) continue;

        return localPts;
      }
    }
  } catch { /* ignore */ }
  return null;
}

// ── Storey assignment by Z elevation ─────────────────────────────────────────
interface StoreyInfo { id: string; elevation: number }
function storeyForZ(minZMetres: number, storeys: StoreyInfo[]): string {
  if (storeys.length === 0) return '';
  const sorted = [...storeys].sort((a, b) => a.elevation - b.elevation);
  let best = sorted[0].id;
  for (const s of sorted) {
    if (s.elevation <= minZMetres + 0.5) best = s.id;
    else break;
  }
  return best;
}

// ── Nearest wall helper ──────────────────────────────────────────────────────
/**
 * The pair of ends (one per wall) that are closest to each other, when they are close enough
 * to be a real joint: within the thicker wall's width, since axes rebuilt from bodies can stop short.
 */
function nearestWallEnds(items: ItemsMap, aId: string, bId: string): [WallEnd, WallEnd] | null {
  const a = items[aId] as IfcWallEntity | undefined;
  const b = items[bId] as IfcWallEntity | undefined;
  if (a?.type !== 'Wall' || b?.type !== 'Wall') return null;
  const point = (g: IfcWallEntity['geom'], end: WallEnd): [number, number] => end === 'start' ? [g.x1, g.y1] : [g.x2, g.y2];
  let best: [WallEnd, WallEnd] | null = null;
  let bestDistance = Infinity;
  for (const aEnd of ['start', 'end'] as const) {
    for (const bEnd of ['start', 'end'] as const) {
      const [ax, ay] = point(a.geom, aEnd), [bx, by] = point(b.geom, bEnd);
      const distance = Math.hypot(ax - bx, ay - by);
      if (distance < bestDistance) { bestDistance = distance; best = [aEnd, bEnd]; }
    }
  }
  const tolerance = Math.max(a.geom.thickness || 0, b.geom.thickness || 0) + 0.05;
  return bestDistance <= tolerance ? best : null;
}

function nearestWallWithT(items: ItemsMap, cx: number, cy: number): { id: string, t: number } | null {
  let best = '';
  let bestDist = Infinity;
  let bestT = 0.5;
  for (const it of Object.values(items)) {
    if (it.type !== 'Wall') continue;
    const g = (it as IfcWallEntity).geom;
    const dx = g.x2 - g.x1, dy = g.y2 - g.y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((cx - g.x1) * dx + (cy - g.y1) * dy) / len2 : 0.5;
    const clampT = Math.max(0, Math.min(1, t));
    const px = g.x1 + clampT * dx;
    const py = g.y1 + clampT * dy;
    const d = Math.hypot(cx - px, cy - py);
    if (d < bestDist) {
      bestDist = d;
      best = it.id;
      bestT = Math.max(0.01, Math.min(0.99, t));
    }
  }
  return bestDist < 10 ? { id: best, t: bestT } : null;
}

// ── Center all geometry at origin ────────────────────────────────────────────
function centerCoordinates(items: ItemsMap, meshes: IfcMeshGeometry[]): [number, number] | null {
  let sumX = 0, sumY = 0, count = 0;
  for (const it of Object.values(items)) {
    if (it.type === 'Wall') {
      const g = (it as IfcWallEntity).geom;
      if (Number.isFinite(g.x1) && Number.isFinite(g.x2) && Number.isFinite(g.y1) && Number.isFinite(g.y2)) {
        sumX += g.x1 + g.x2; sumY += g.y1 + g.y2; count += 2;
      }
    } else if (it.type === 'Room') {
      for (const [x, y] of (it as IfcSpaceEntity).geom.polygon) {
        if (Number.isFinite(x) && Number.isFinite(y)) {
          sumX += x; sumY += y; count++;
        }
      }
    } else if (it.type === 'Slab') {
      for (const [x, y] of (it as IfcSlabEntity).geom.polygon) {
        if (Number.isFinite(x) && Number.isFinite(y)) {
          sumX += x; sumY += y; count++;
        }
      }
    }
  }
  if (count === 0) return null;
  const ox = sumX / count, oy = sumY / count;
  console.log(`[IFC Center] count=${count} sumX=${sumX} sumY=${sumY} ox=${ox} oy=${oy}`);
  if (!Number.isFinite(ox) || !Number.isFinite(oy)) {
    console.warn('[IFC Center] Invalid center detected! Skipping centering.');
    return null;
  }
  if (Math.abs(ox) < 5 && Math.abs(oy) < 5) return null;
  for (const it of Object.values(items)) {
    if (it.type === 'Wall') {
      const g = (it as IfcWallEntity).geom;
      g.x1 -= ox; g.y1 -= oy; g.x2 -= ox; g.y2 -= oy;
    } else if (it.type === 'Room') {
      const g = (it as IfcSpaceEntity).geom;
      g.polygon = g.polygon.map(([x, y]) => [x - ox, y - oy]);
      if (g._placementWorld) { g._placementWorld[0] -= ox; g._placementWorld[1] -= oy; }
    } else if (it.type === 'Slab') {
      const g = (it as IfcSlabEntity).geom;
      g.polygon = g.polygon.map(([x, y]) => [x - ox, y - oy]);
      if (g._placementWorld) { g._placementWorld[0] -= ox; g._placementWorld[1] -= oy; }
    } else if (it.type === 'Furniture') {
      const g = (it as IfcFurnitureEntity).geom;
      g.x -= ox; g.y -= oy;
      if (g._placementWorld) { g._placementWorld[0] -= ox; g._placementWorld[1] -= oy; }
      // footprint is in local coords relative to g.x,g.y — no offset needed
    } else if (it.type === 'GenericElement') {
      const g = (it as IfcGenericEntity).geom;
      g.x -= ox; g.y -= oy;
      if (g.footprint) g.footprint = g.footprint.map(([x, y]) => [x - ox, y - oy]);
      if (g._placementWorld) { g._placementWorld[0] -= ox; g._placementWorld[1] -= oy; }
    } else if (it.type === 'Door') {
      const g = (it as IfcDoorEntity).geom;
      if (g._placementWorld) { g._placementWorld[0] -= ox; g._placementWorld[1] -= oy; }
    } else if (it.type === 'Window') {
      const g = (it as IfcWindowEntity).geom;
      if (g._placementWorld) { g._placementWorld[0] -= ox; g._placementWorld[1] -= oy; }
    } else if (isAnnotation(it)) {
      it.geom = shiftAnnotationGeom(it.geom as any, -ox, -oy);
    }
  }
  for (const m of meshes) {
    m.transform[12] -= ox;
    m.transform[13] -= oy;
  }
  return [ox, oy];
}


// ── Node WASM lifecycle ───────────────────────────────────────
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getIfcApi() {
  const api = new WebIFC.IfcAPI();
  await withTimeout(api.Init(() => require.resolve('web-ifc/web-ifc-node.wasm'), true), 15000, 'web-ifc Init(server)');
  return api;
}

// ── Main import ───────────────────────────────────────────────────────────────
export async function importIFCBuffer(
  buffer: ArrayBuffer,
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportResult> {
  const report = (phase: string, pct: number) => onProgress?.({ phase, pct });

  if (!buffer || buffer.byteLength === 0) {
    throw new Error('Le fichier est vide ou n\'a pas pu être lu.');
  }

  report('Initialisation web-ifc…', 5);
  const api = await getIfcApi();

  let items: ItemsMap = {};
  /** Pset_skAItchSurvey values by GlobalId (ADR 0016). */
  const surveyPsets = new Map<string, Record<string, string>>();
  let spatialTree: any = null;
  let meshes: IfcMeshGeometry[] = [];
  // Local-space bounding box (raw vertices, no transform) — correct size even when
  // flatTransformation is broken for IFCMAPPEDITEM (Revit IFC4 furniture).
  // Stores global min/max across ALL sub-meshes so the total extent is correct.
  const localBBoxMap = new Map<number, { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }>();
  const flatTranslationMap = new Map<number, [number, number]>();
  // Rotation in 2D world XY plane from flatTransformation (reliable even for IfcMappedItem)
  const flatRotationMap = new Map<number, number>();

  // Hoisted declarations to prevent Temporal Dead Zone errors
  const worldVertsMap = new Map<number, MeshVerts>();
  const aggMap = new Map<number, number[]>();
  const openingToWall = new Map<number, number>();
  const elementToOpening = new Map<number, number>();
  const openingByName = new Map<string, number>();
  const widthMap = new Map<number, number>();
  const opMap = new Map<number, string>();

  let mid = -1;
  let centerOffset: [number, number] | undefined;
  try {
    report('Ouverture du fichier IFC…', 15);
    mid = api.OpenModel(new Uint8Array(buffer));
    console.log(`[IFC] OpenModel returned mid=${mid}`);

  const normEnum = (s: string) => s.replace(/\./g, '').trim().toUpperCase();
  let scale = 1;
  try {
    const uaIds = vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCUNITASSIGNMENT, false));
    outer: for (const uaId of uaIds) {
      const ua = api.GetLine(mid, uaId, false) as Record<string, unknown>;
      const units = ua['Units'];
      if (!Array.isArray(units)) continue;
      for (const uRef of units) {
        const uId = getRef(uRef); if (!uId) continue;
        const u = api.GetLine(mid, uId, false) as Record<string, unknown>;
        const uType = normEnum(attrStr(u, 'UnitType'));
        const prefix = normEnum(attrStr(u, 'Prefix'));
        if (uType !== 'LENGTHUNIT') continue;
        if (prefix === 'MILLI') { scale = 0.001; break outer; }
        if (prefix === 'CENTI') { scale = 0.01;  break outer; }
        break outer;
      }
    }
  } catch (e) { console.warn('[IFC Units] error:', e); }

  if (scale === 1) {
    try {
      const wTestIds = vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCWALL, false));
      for (const wid of wTestIds.slice(0, 5)) {
        const wl = api.GetLine(mid, wid, false) as Record<string, unknown>;
        const axisPts = readWallAxisPts(api, mid, wl);
        if (axisPts && axisPts.length >= 2) {
          const L = Math.hypot(axisPts[axisPts.length-1][0] - axisPts[0][0], axisPts[axisPts.length-1][1] - axisPts[0][1]);
          if (L > 500) { scale = 0.001; break; }
        }
      }
    } catch { /* ignore */ }
  }
  console.log(`[IFC Units] Final scale=${scale}`);

  report('Structure spatiale…', 25);
  spatialTree = await api.properties.getSpatialStructure(mid, false);

  const storeyInfos: StoreyInfo[] = [];
  interface SNode { expressID: number; type: string; children: SNode[] }
  const tree = spatialTree as unknown as SNode;

  const projId = mkId('proj', tree.expressID);
  const projLine = api.GetLine(mid, tree.expressID, false) as Record<string, unknown>;
  const projName = getName(projLine) || 'Projet';
  items[projId] = {
    id: projId, type: 'Project', ifcType: 'IfcProject', name: projName, Name: projName,
    GlobalId: attrStr(projLine, 'GlobalId') || mkGuid(tree.expressID), parentId: null,
    longName: attrStr(projLine, 'LongName'), description: '', phase: '',
    northAngle: 0, units: { length: 'm', area: 'm²', volume: 'm³' },
  } as IfcProjectEntity;

  // Read geographic data from IFCSITE
  try {
    const siteIds = vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCSITE, false));
    if (siteIds.length > 0) {
      const siteLine = api.GetLine(mid, siteIds[0], false) as Record<string, unknown>;
      const fromCompound = (arr: unknown[]): number => {
        const nums = arr.map(coordNum);
        const sign = nums[0] < 0 ? -1 : 1;
        return sign * (Math.abs(nums[0]) + (nums[1] ?? 0) / 60 + (nums[2] ?? 0) / 3600 + (nums[3] ?? 0) / 3_600_000_000);
      };
      const refLat = siteLine['RefLatitude'];
      const refLon = siteLine['RefLongitude'];
      const refElev = siteLine['RefElevation'];
      if (Array.isArray(refLat) && refLat.length >= 2) (items[projId] as IfcProjectEntity).lat = fromCompound(refLat);
      if (Array.isArray(refLon) && refLon.length >= 2) (items[projId] as IfcProjectEntity).lon = fromCompound(refLon);
      if (refElev != null) (items[projId] as IfcProjectEntity).siteElevation = coordNum(refElev) * scale;
      const siteAddr = attrStr(siteLine, 'Description');
      if (siteAddr) (items[projId] as IfcProjectEntity).siteAddress = siteAddr;
    }
  } catch { /* non-critical */ }

  for (const bldNode of tree.children ?? []) {
    const bldId = mkId('bld', bldNode.expressID);
    const bldLine = api.GetLine(mid, bldNode.expressID, false) as Record<string, unknown>;
    items[bldId] = {
      id: bldId, type: 'Building', ifcType: 'IfcBuilding', name: getName(bldLine) || 'Bâtiment',
      GlobalId: attrStr(bldLine, 'GlobalId') || mkGuid(bldNode.expressID), parentId: projId,
    } as IfcBuildingEntity;

    for (const stNode of bldNode.children ?? []) {
      const stId = mkId('sty', stNode.expressID);
      const stLine = api.GetLine(mid, stNode.expressID, false) as Record<string, unknown>;
      const elevation = attrNum(stLine, 'Elevation') * scale;
      items[stId] = {
        id: stId, type: 'Storey', ifcType: 'IfcBuildingStorey', name: getName(stLine) || `Niveau ${storeyInfos.length}`,
        GlobalId: attrStr(stLine, 'GlobalId') || mkGuid(stNode.expressID), parentId: bldId,
        geom: { level: storeyInfos.length, elevation, thickness: 0.25 },
      } as IfcStoreyEntity;
      storeyInfos.push({ id: stId, elevation });
    }
  }
  const fallbackStoreyId = storeyInfos[0]?.id ?? projId;

  report('Propriétés…', 63);
  report('Propriétés…', 63);

  try {
    const rels = vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCRELDEFINESBYPROPERTIES, false));
    for (const relId of rels) {
      const rel = api.GetLine(mid, relId, false) as Record<string, unknown>;
      const psetId = getRef(rel['RelatingPropertyDefinition']);
      if (!psetId) continue;
      const pset = api.GetLine(mid, psetId, false) as Record<string, unknown>;
      const props = pset['HasProperties'];
      if (!Array.isArray(props)) continue;
      // Pset_skAItchSurvey (ADR 0016): kept as flat properties of the element, by GlobalId.
      if (attrStr(pset, 'Name') === 'Pset_skAItchSurvey') {
        const values: Record<string, string> = {};
        for (const propRef of props) {
          const propId = getRef(propRef); if (!propId) continue;
          const prop = api.GetLine(mid, propId, false) as Record<string, unknown>;
          const name = attrStr(prop, 'Name'), value = attrStr(prop, 'NominalValue');
          if (name && value) values[`Survey${name.replace(/^Survey/, '')}`] = value;
        }
        for (const r of Array.isArray(rel['RelatedObjects']) ? rel['RelatedObjects'] : []) {
          const id = getRef(r); if (!id) continue;
          const gid = attrStr(api.GetLine(mid, id, false) as Record<string, unknown>, 'GlobalId');
          if (gid) surveyPsets.set(gid, values);
        }
        continue;
      }
      let pWidth: number | null = null;
      let pOp: string | null = null;
      for (const propRef of props) {
        const propId = getRef(propRef); if (!propId) continue;
        const prop = api.GetLine(mid, propId, false) as Record<string, unknown>;
        const pName = attrStr(prop, 'Name')?.toLowerCase();
        if (pName === 'overallwidth' || pName === 'width' || pName === 'largeur' || pName === 'length' || pName === 'longueur') {
          const val = attrNum(prop, 'NominalValue');
          if (val && val > 0) pWidth = val;
        }
        if (pName === 'operationtype' || pName === 'operation') {
          const val = attrStr(prop, 'NominalValue');
          if (val) pOp = val;
        }
      }
      if (pWidth !== null || pOp !== null) {
        const related = rel['RelatedObjects'];
        if (Array.isArray(related)) {
          for (const r of related) {
            const id = getRef(r);
            if (id) {
              if (pWidth !== null) widthMap.set(id, pWidth);
              if (pOp !== null) opMap.set(id, pOp);
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('[IFC] property parse error', e);
  }

  // ── Collect full 3D mesh geometry for Three.js rendering & world-space coords ──
  report('Génération Géométrie…', 60);
  report('Génération Géométrie…', 60);
  try {
    api.StreamAllMeshes(mid, (flatMesh) => {
      const eid = flatMesh.expressID;
      const n = flatMesh.geometries.size();
      // Accumulate world-space vertices for this element
      let xy: [number, number][] = [];
      let xz: [number, number][] = [];
      let minZ = Infinity, maxZ = -Infinity;
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      for (let gi = 0; gi < n; gi++) {
        const placed = flatMesh.geometries.get(gi);
        try {
          const geom = api.GetGeometry(mid, placed.geometryExpressID);
          const vPtr = geom.GetVertexData();
          const vSize = geom.GetVertexDataSize();
          const iPtr = geom.GetIndexData();
          const iSize = geom.GetIndexDataSize();
          if (vSize > 0 && iSize > 0) {
            const vertices = new Float32Array(api.GetVertexArray(vPtr, vSize));
            const indices = new Uint32Array(api.GetIndexArray(iPtr, iSize));
            const c = placed.color;
            const color: [number, number, number, number] = [c.x, c.y, c.z, c.w];
            const transform = Array.from(placed.flatTransformation);
            meshes.push({ expressID: eid, vertices, indices, color, transform });
            // Capture WebIFC's world-space translation for this element (first sub-mesh wins)
            if (!flatTranslationMap.has(eid)) {
              flatTranslationMap.set(eid, [placed.flatTransformation[12], placed.flatTransformation[13]]);
            }
            // Capture 2D rotation from flatTransformation XY columns.
            // In IFC (Z-up), looking down at the floor plan, local X projects onto world XY as [m[0],m[1]].
            // atan2(m[1], m[0]) gives the correct 2D rotation angle.
            if (!flatRotationMap.has(eid)) {
              const m = placed.flatTransformation;
              // Find the dominant XY direction from either the X or Y axis columns
              const xLen = Math.hypot(m[0], m[1]);
              const yLen = Math.hypot(m[4], m[5]);
              if (xLen > 1e-6) {
                flatRotationMap.set(eid, Math.atan2(m[1] / xLen, m[0] / xLen));
              } else if (yLen > 1e-6) {
                flatRotationMap.set(eid, Math.atan2(m[5] / yLen, m[4] / yLen) - Math.PI / 2);
              } else {
                flatRotationMap.set(eid, 0);
              }
            }
            // Local-space bbox from raw vertices (correct even when flatTransformation is broken)
            {
              let lMinX = Infinity, lMaxX = -Infinity, lMinY = Infinity, lMaxY = -Infinity, lMinZ = Infinity, lMaxZ = -Infinity;
              for (let j = 0; j < vertices.length; j += 6) {
                const lx = vertices[j] * scale, ly = vertices[j + 1] * scale, lz = vertices[j + 2] * scale;
                if (lx < lMinX) lMinX = lx; if (lx > lMaxX) lMaxX = lx;
                if (ly < lMinY) lMinY = ly; if (ly > lMaxY) lMaxY = ly;
                if (lz < lMinZ) lMinZ = lz; if (lz > lMaxZ) lMaxZ = lz;
              }
              const cur = localBBoxMap.get(eid);
              if (!cur) localBBoxMap.set(eid, { minX: lMinX, maxX: lMaxX, minY: lMinY, maxY: lMaxY, minZ: lMinZ, maxZ: lMaxZ });
              else {
                cur.minX = Math.min(cur.minX, lMinX); cur.maxX = Math.max(cur.maxX, lMaxX);
                cur.minY = Math.min(cur.minY, lMinY); cur.maxY = Math.max(cur.maxY, lMaxY);
                cur.minZ = Math.min(cur.minZ, lMinZ); cur.maxZ = Math.max(cur.maxZ, lMaxZ);
              }
            }
            // Compute world-space vertex positions for this sub-geometry
            const m = placed.flatTransformation;
            for (let j = 0; j < vertices.length; j += 6) {
              const lx = vertices[j], ly = vertices[j + 1], lz = vertices[j + 2];
              const wx = m[0] * lx + m[4] * ly + m[8]  * lz + m[12];
              const wy = m[1] * lx + m[5] * ly + m[9]  * lz + m[13];
              const wz = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
              const sx = wx;
              const sy = wy;
              const sz = wz;
              xy.push([sx, sy]);
              xz.push([sx, -sz]);
              if (sz < minZ) minZ = sz;
              if (sz > maxZ) maxZ = sz;
              if (sx < minX) minX = sx;
              if (sx > maxX) maxX = sx;
              if (sy < minY) minY = sy;
              if (sy > maxY) maxY = sy;
            }
          }
          geom.delete?.();
        } catch { /* skip geometry errors */ }
      }
      if (xy.length > 0) {
        // Merge with existing if element has multiple FlatMesh callbacks
        const existing = worldVertsMap.get(eid);
        if (existing) {
          existing.xy.push(...xy);
          existing.xz.push(...xz);
          existing.minZ = Math.min(existing.minZ, minZ);
          existing.maxZ = Math.max(existing.maxZ, maxZ);
          existing.minX = Math.min(existing.minX, minX);
          existing.maxX = Math.max(existing.maxX, maxX);
          existing.minY = Math.min(existing.minY, minY);
          existing.maxY = Math.max(existing.maxY, maxY);
        } else {
          worldVertsMap.set(eid, { xy, xz, minZ, maxZ, minX, maxX, minY, maxY });
          // Log only major elements or sample
          if (eid % 10 === 0) {
            console.log(`[IFC Geom] #${eid}: X:[${minX.toFixed(2)},${maxX.toFixed(2)}] Y:[${minY.toFixed(2)},${maxY.toFixed(2)}] Z:[${minZ.toFixed(2)},${maxZ.toFixed(2)}]`);
          }
        }
      }
      flatMesh.delete?.();
    });
  } catch (e) {
    console.warn('[IFC] StreamAllMeshes failed:', e);
  }
  if (scale !== 1) {
    for (const mesh of meshes) scaleIfcMeshGeometry(mesh, scale);
  }
  console.log(`[IFC] Collected ${meshes.length} mesh geometries for 3D view, worldVertsMap has ${worldVertsMap.size} entries`);

  // Global Y-up detection based on wall bounding boxes
  let globalYup = false;
  try {
    const wallTestIds = [
      ...vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCWALL, false)),
      ...vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCWALLSTANDARDCASE, false))
    ];
    for (const localId of wallTestIds) {
      const mv = worldVertsMap.get(localId);
      if (mv) {
        const dx = mv.maxX - mv.minX;
        const dy = mv.maxY - mv.minY;
        const dz = mv.maxZ - mv.minZ;
        if (dx > 0.01 && dy > 0.01 && dz > 0.01) {
          const minDim = Math.min(dx, dy, dz);
          if (minDim === dz) {
            globalYup = true;
            break;
          }
        }
      }
    }
  } catch { /* ignore */ }
  console.log(`[IFC globalYup Detection] Detected globalYup = ${globalYup}`);

  function planCoordsFromMatrix(mat: number[] | null | undefined): [number, number] | null {
    if (!mat) return null;
    return [
      mat[12] * scale,
      globalYup ? -mat[14] * scale : mat[13] * scale
    ];
  }

  function planRotationFromMatrix(m: number[] | null | undefined): number {
    if (!m) return 0;
    if (globalYup) {
      const xLen = Math.hypot(m[0], m[2]);
      if (xLen > 1e-9) return Math.atan2(-m[2] / xLen, m[0] / xLen);
      const yLen = Math.hypot(m[4], m[6]);
      if (yLen > 1e-9) return Math.atan2(-m[6] / yLen, m[4] / yLen) - Math.PI / 2;
      return 0;
    } else {
      return rotationFromMatrixXY(m);
    }
  }


  // ── Build host-wall map via IFC relationships ──────────────────────────────
  report('Relations…', 66);
  // openingId → wallExpressId
  // openingId → wallExpressId
  // elementId → openingExpressId
  // elementId → openingExpressId

  try {
    const voidRelIds = vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCRELVOIDSELEMENT, false));
    for (const relId of voidRelIds) {
      const rel = api.GetLine(mid, relId, false) as Record<string, unknown>;
      const wallRef = getRef(rel['RelatingBuildingElement']);
      const openingRef = getRef(rel['RelatedOpeningElement']);
      if (wallRef && openingRef) openingToWall.set(openingRef, wallRef);
    }
    const fillRelIds = vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCRELFILLSELEMENT, false));
    for (const relId of fillRelIds) {
      const rel = api.GetLine(mid, relId, false) as Record<string, unknown>;
      const openingRef = getRef(rel['RelatingOpeningElement']);
      const elemRef = getRef(rel['RelatedBuildingElement']);
      if (openingRef && elemRef) elementToOpening.set(elemRef, openingRef);
    }
  } catch (e) {
    console.warn('[IFC] Relationship parse error:', e);
  }
  console.log(`[IFC] Relations: ${openingToWall.size} voids, ${elementToOpening.size} fills`);

  // DEBUG & INDEX OPENINGS
  // Map door/window names to their opening IDs (Revit exports openings with ':1' suffix)
  // Map door/window names to their opening IDs (Revit exports openings with ':1' suffix)
  const curtainLocalIds = vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCCURTAINWALL, false));
  console.log(`[IFC] Found ${curtainLocalIds.length} CurtainWalls in model: ${curtainLocalIds.join(', ')}`);
  for (const cwId of curtainLocalIds) {
    const cwLine = await api.GetLine(mid, cwId) as any;
    const cwName = getName(cwLine);
    const agg = aggMap.get(cwId) || [];
  }
  const openingIds = vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCOPENINGELEMENT, false));
  for (const opId of openingIds) {
    const opLine = api.GetLine(mid, opId, false) as Record<string, unknown>;
    const name = getName(opLine);
    if (name) {
      const baseName = name.replace(/:\d+$/, '');
      openingByName.set(baseName, opId);
    }
  }

  // ── Build aggregation tree ─────────────────────────────────────────────────
  // parent -> children

  try {
    const relTypes = [WebIFC.IFCRELAGGREGATES, WebIFC.IFCRELNESTS];
    for (const relType of relTypes) {
      const aggIds = vecToArray(api.GetLineIDsWithType(mid, relType, false));
      for (const relId of aggIds) {
        const rel = api.GetLine(mid, relId, false) as Record<string, unknown>;
        const parent = getRef(rel['RelatingObject']);
        const childrenRaw = rel['RelatedObjects'];
        if (parent && Array.isArray(childrenRaw)) {
          const children = childrenRaw.map(getRef).filter((id): id is number => id !== null);
          if (!aggMap.has(parent)) aggMap.set(parent, []);
          aggMap.get(parent)!.push(...children);
        }
      }
    }
  } catch (e) {
    console.warn('[IFC] Aggregation parse error:', e);
  }

  // Helper: recursively collect bounding box of an element and all its aggregated children
  function getAggregatedCoords(elemId: number): { cx: number; cy: number; minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let found = false;

    const includePoint = (x: number, y: number, z: number) => {
      if (![x, y, z].every(Number.isFinite)) return;
      found = true;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    };

    function traverse(id: number) {
      // 1. Try worldVertsMap (if meshed successfully by web-ifc)
      const v = worldVertsMap.get(id);
      const meshSpan = v ? Math.max(v.maxX - v.minX, v.maxY - v.minY, v.maxZ - v.minZ) : 0;
      if (v && v.xy.length > 0 && meshSpan > 0.05) {
        found = true;
        if (v.minX < minX) minX = v.minX;
        if (v.maxX > maxX) maxX = v.maxX;
        if (v.minY < minY) minY = v.minY;
        if (v.maxY > maxY) maxY = v.maxY;
        if (v.minZ < minZ) minZ = v.minZ;
        if (v.maxZ > maxZ) maxZ = v.maxZ;
      } else {
        // 2. If not meshed or the mesh stayed in local near-zero coordinates,
        // use ObjectPlacement. Revit curtain wall panels commonly need this.
        try {
          const line = api.GetLine(mid, id, false) as Record<string, unknown>;
          const mat = getPlacementMatrix(api, mid, line);
          if (mat) {
            const wx = mat[12] * scale, wy = mat[13] * scale, wz = mat[14] * scale;
            // Placements are in IFC axes (Z up); meshes, and the plan coordinates read from
            // these bounds, are in web-ifc's Y-up axes when globalYup. Convert so both agree.
            if (Math.abs(wx) > 0.001 || Math.abs(wy) > 0.001 || Math.abs(wz) > 0.001) {
              if (globalYup) includePoint(wx, wz, -wy);
              else includePoint(wx, wy, wz);
            }
          }
        } catch { /* ignore */ }
      }

      const children = aggMap.get(id);
      if (children) {
        for (const child of children) traverse(child);
      }
    }
    traverse(elemId);

    if (found) {
      return {
        cx: (minX + maxX) / 2,
        cy: globalYup ? -(minZ + maxZ) / 2 : (minY + maxY) / 2,
        minX, maxX, minY, maxY, minZ, maxZ
      };
    }
    return null;
  }

  // ── Strategy: resolve curtain wall geometry from their Representation ────────
  // These curtain walls have identity ObjectPlacement → local coords = world coords.
  // Try reading IfcBoundingBox or any shape outline from their Representation.
  try {
    const curtainLocalIds = vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCCURTAINWALL, false));

    // Helper: try to read an IfcBoundingBox from a curtain wall's Representation
    function readCWBoundingBox(cwId: number): { minX: number; maxX: number; minY: number; maxY: number } | null {
      try {
        const cwLine = api.GetLine(mid, cwId, false) as Record<string, unknown>;
        const reprId = getRef(cwLine['Representation']); if (!reprId) return null;
        const reprLine = api.GetLine(mid, reprId, false) as Record<string, unknown>;
        const reprs = reprLine['Representations'];
        if (!Array.isArray(reprs)) return null;

        for (const r of reprs) {
          const srId = getRef(r); if (!srId) continue;
          const sr = api.GetLine(mid, srId, false) as Record<string, unknown>;
          const items = sr['Items'];
          if (!Array.isArray(items)) continue;

          for (const itemRef of items) {
            const itemId = getRef(itemRef); if (!itemId) continue;
            const item = api.GetLine(mid, itemId, false) as Record<string, unknown>;

            // IfcBoundingBox has Corner, XDim, YDim, ZDim
            const cornerId = getRef(item['Corner']);
            const xDim = attrNum(item, 'XDim');
            const yDim = attrNum(item, 'YDim');
            if (cornerId && xDim > 0 && yDim > 0) {
              const corner = api.GetLine(mid, cornerId, false) as Record<string, unknown>;
              const co = corner['Coordinates'] as unknown[];
              if (Array.isArray(co) && co.length >= 2) {
                const cx = coordNum(co[0]) * scale;
                const cy = coordNum(co[1]) * scale;
                // Apply ObjectPlacement (identity for these walls, but to be safe)
                const mat = getPlacementMatrix(api, mid, cwLine);
                const wx = mat ? (mat[0]*cx + mat[4]*cy + mat[12]) : cx;
                const wy = mat ? (mat[1]*cx + mat[5]*cy + mat[13]) : cy;
                return { minX: wx, maxX: wx + xDim * scale, minY: wy, maxY: wy + yDim * scale };
              }
            }

            // Also check: polylines in any representation (not just Axis)
            let ptRefs = item['Points'] as unknown[];
            if (!Array.isArray(ptRefs)) {
              const basisId = getRef(item['BasisCurve']);
              if (basisId) {
                const basis = api.GetLine(mid, basisId, false) as Record<string, unknown>;
                ptRefs = basis['Points'] as unknown[];
              }
            }
            if (Array.isArray(ptRefs) && ptRefs.length >= 2) {
              const mat = getPlacementMatrix(api, mid, cwLine);
              let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
              for (const pr of ptRefs) {
                const pid = getRef(pr); if (!pid) continue;
                const pt = api.GetLine(mid, pid, false) as Record<string, unknown>;
                const co = pt['Coordinates'] as unknown[];
                const lx = coordNum(co[0]) * scale, ly = coordNum(co[1]) * scale;
                const wx = mat ? (mat[0]*lx + mat[4]*ly + mat[12]) : lx;
                const wy = mat ? (mat[1]*lx + mat[5]*ly + mat[13]) : ly;
                if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
                if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
              }
              if (maxX - minX > 0.1 || maxY - minY > 0.1) {
                return { minX, maxX, minY, maxY };
              }
            }
          }
        }
      } catch { /* ignore */ }
      return null;
    }

    // Also: compute the overall building bounding box from worldVertsMap
    // so we can use it as a fallback search range
    let bldMinX = Infinity, bldMaxX = -Infinity, bldMinY = Infinity, bldMaxY = -Infinity;
    for (const v of worldVertsMap.values()) {
      if (v.minX < bldMinX) bldMinX = v.minX; if (v.maxX > bldMaxX) bldMaxX = v.maxX;
      if (v.minY < bldMinY) bldMinY = v.minY; if (v.maxY > bldMaxY) bldMaxY = v.maxY;
    }

    for (const cwId of curtainLocalIds) {
      // Try BoundingBox / polyline from Representation first
      const bb = readCWBoundingBox(cwId);
      if (bb && (bb.maxX - bb.minX > 0.1 || bb.maxY - bb.minY > 0.1)) {
        const synth: [number, number][] = [
          [bb.minX, bb.minY], [bb.maxX, bb.minY],
          [bb.maxX, bb.maxY], [bb.minX, bb.maxY],
        ];
        worldVertsMap.set(cwId, { xy: synth, xz: synth, minZ: 0, maxZ: 3, minX: bb.minX, maxX: bb.maxX, minY: bb.minY, maxY: bb.maxY });
        console.log(`[IFC] CurtainWall #${cwId} from BoundingBox/Polyline: X:[${bb.minX.toFixed(2)},${bb.maxX.toFixed(2)}] Y:[${bb.minY.toFixed(2)},${bb.maxY.toFixed(2)}]`);
        continue;
      }

      // Diagnostic: log aggMap children and worldVertsMap status for this CW
      const cwLine = api.GetLine(mid, cwId, false) as Record<string, unknown>;
      const cwName = getName(cwLine);
      const aggChildren = aggMap.get(cwId) ?? [];
      console.log(`[IFC] CurtainWall #${cwId} "${cwName}" aggMap children: [${aggChildren.join(',')}], worldVertsMap has entry: ${worldVertsMap.has(cwId)}`);

      // Collect ALL children IDs from aggMap (recursively)
      const allChildIds = new Set<number>();
      function collectChildren(parentId: number) {
        const children = aggMap.get(parentId);
        if (children) {
          for (const child of children) {
            allChildIds.add(child);
            collectChildren(child);
          }
        }
      }
      collectChildren(cwId);

      const placementPts: [number, number, number][] = [];
      for (const childId of allChildIds) {
        try {
          const line = api.GetLine(mid, childId, false) as Record<string, unknown>;
          const mat = getPlacementMatrix(api, mid, line);
          if (!mat) continue;
          const wx = mat[12] * scale;
          const wy = mat[13] * scale;
          const wz = mat[14] * scale;
          if (Math.abs(wx) < 0.001 && Math.abs(wy) < 0.001 && Math.abs(wz) < 0.001) continue;
          const typeName = String(line.type || line.ifcType || line.__type__ || '').toUpperCase();
          const name = getName(line).toUpperCase();
          if (typeName.includes('PLATE') || name.includes('GLAZED') || name.includes('MULLION')) {
            placementPts.push([wx, wy, wz]);
          }
        } catch { /* ignore */ }
      }

      if (placementPts.length >= 2) {
        const xs = placementPts.map(([x]) => x);
        const ys = placementPts.map(([, y]) => y);
        const zs = placementPts.map(([, , z]) => z);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const minZp = Math.min(...zs), maxZp = Math.max(...zs);
        const dxp = maxX - minX;
        const dyp = maxY - minY;
        const xSpread = dxp;
        const ySpread = dyp;
        let px1: number, py1: number, px2: number, py2: number;
        if (xSpread <= ySpread) {
          const xAvg = xs.reduce((sum, x) => sum + x, 0) / xs.length;
          px1 = px2 = xAvg;
          py1 = minY;
          py2 = maxY;
        } else {
          const yAvg = ys.reduce((sum, y) => sum + y, 0) / ys.length;
          px1 = minX;
          px2 = maxX;
          py1 = py2 = yAvg;
          const sortedX = [...new Set(xs.map((x) => Math.round(x * 1000) / 1000))].sort((a, b) => a - b);
          if (sortedX.length >= 2) {
            const gaps = sortedX.slice(1).map((x, i) => x - sortedX[i]).filter((gap) => gap > 0.05);
            const step = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0;
            if (step > 0 && px2 - px1 < step * (sortedX.length - 1)) px2 += step;
          }
        }

        const pLen = Math.hypot(px2 - px1, py2 - py1);
        if (pLen > 0.5) {
          const isVertical = xSpread <= ySpread;
          const pThickness = Math.max(Math.min(isVertical ? xSpread : ySpread, 0.18), 0.08);
          const pHeight = Math.max(maxZp - minZp, 2.1);
          const synth: [number, number][] = isVertical
            ? [
              [px1 - pThickness / 2, py1],
              [px1 + pThickness / 2, py1],
              [px2 + pThickness / 2, py2],
              [px2 - pThickness / 2, py2],
            ]
            : [
              [px1, py1 - pThickness / 2],
              [px2, py2 - pThickness / 2],
              [px2, py2 + pThickness / 2],
              [px1, py1 + pThickness / 2],
            ];
          worldVertsMap.set(cwId, {
            xy: synth,
            xz: synth,
            minZ: minZp,
            maxZ: minZp + pHeight,
            minX: Math.min(px1, px2) - pThickness,
            maxX: Math.max(px1, px2) + pThickness,
            minY: Math.min(py1, py2) - pThickness,
            maxY: Math.max(py1, py2) + pThickness,
          });
          console.log(`[IFC] CurtainWall #${cwId} from child placements: geom=[${px1.toFixed(2)},${py1.toFixed(2)}] to [${px2.toFixed(2)},${py2.toFixed(2)}], pts=${placementPts.length}`);
          continue;
        }
      }

      // Also look for components that reference this curtain wall via IFCRELCONTAINEDINSPATIALSTRUCTURE
      // is not correct — try IFCRELDECOMPOSES and scan all relationship types
      // In Revit IFC4, curtain wall panels/mullions are typically linked via IFCRELAGGREGATES
      // but the parent might be an intermediate object. Let's also check inverse: find
      // any element whose ObjectPlacement references this curtain wall.

      let b: MeshVerts = { xy: [], xz: [], minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
      let found = false;

      // Strategy A: use ObjectPlacement of all aggMap children
      for (const childId of allChildIds) {
        const v = worldVertsMap.get(childId);
        const meshSpan = v ? Math.max(v.maxX - v.minX, v.maxY - v.minY, v.maxZ - v.minZ) : 0;
        if (v && v.xy.length > 0 && meshSpan > 0.05) {
          found = true;
          if (v.minX < b.minX) b.minX = v.minX; if (v.maxX > b.maxX) b.maxX = v.maxX;
          if (v.minY < b.minY) b.minY = v.minY; if (v.maxY > b.maxY) b.maxY = v.maxY;
          if (v.minZ < b.minZ) b.minZ = v.minZ; if (v.maxZ > b.maxZ) b.maxZ = v.maxZ;
        } else {
          // Fallback: read ObjectPlacement when mesh data is absent or stuck
          // around the local origin.
          try {
            const line = api.GetLine(mid, childId, false) as Record<string, unknown>;
            const mat = getPlacementMatrix(api, mid, line);
            if (mat) {
              const wx = mat[12] * scale;
              const wy = mat[13] * scale;
              const wz = mat[14] * scale;
              found = true;
              if (wx < b.minX) b.minX = wx; if (wx > b.maxX) b.maxX = wx;
              if (wy < b.minY) b.minY = wy; if (wy > b.maxY) b.maxY = wy;
              if (wz < b.minZ) b.minZ = wz; if (wz > b.maxZ) b.maxZ = wz;
            }
          } catch { /* ignore */ }
        }
      }

      if (found) {
        console.log(`[IFC] CurtainWall #${cwId}: resolved coordinates from ${allChildIds.size} children. dims: dx=${(b.maxX - b.minX).toFixed(3)}, dy=${(b.maxY - b.minY).toFixed(3)}`);

        // SAFE Proximity Expansion: Merge elements that are strictly aligned with this wall's plane.
        const bDx = b.maxX - b.minX;
        const bDy = b.maxY - b.minY;
        const bDz = b.maxZ - b.minZ;

        // Determine the orientation to safely expand only along the length axis
        const isWallAlongX = bDx > Math.max(bDy, bDz);
        const isWallAlongY = bDy > Math.max(bDx, bDz);
        const isWallAlongZ = bDz > Math.max(bDx, bDy);

        let expanded = 0;
        const candidateTypes = [WebIFC.IFCPLATE, WebIFC.IFCMEMBER];
        for (const typeId of candidateTypes) {
          try {
            const ids = vecToArray(api.GetLineIDsWithType(mid, typeId, false));
            for (const elemId of ids) {
              if (allChildIds.has(elemId)) continue;
              const v = worldVertsMap.get(elemId);
              if (!v || v.xy.length === 0) continue;

              let aligned = false;
              if (isWallAlongX) {
                // Must be inside the Y and Z bounds (thickness/height) with small tolerance
                const inY = v.minY >= b.minY - 0.2 && v.maxY <= b.maxY + 0.2;
                const inZ = v.minZ >= b.minZ - 0.2 && v.maxZ <= b.maxZ + 0.2;
                const touchesX = v.minX <= b.maxX + 0.5 && v.maxX >= b.minX - 0.5;
                aligned = inY && inZ && touchesX;
              } else if (isWallAlongY) {
                const inX = v.minX >= b.minX - 0.2 && v.maxX <= b.maxX + 0.2;
                const inZ = v.minZ >= b.minZ - 0.2 && v.maxZ <= b.maxZ + 0.2;
                const touchesY = v.minY <= b.maxY + 0.5 && v.maxY >= b.minY - 0.5;
                aligned = inX && inZ && touchesY;
              } else if (isWallAlongZ) {
                const inX = v.minX >= b.minX - 0.2 && v.maxX <= b.maxX + 0.2;
                const inY = v.minY >= b.minY - 0.2 && v.maxY <= b.maxY + 0.2;
                const touchesZ = v.minZ <= b.maxZ + 0.5 && v.maxZ >= b.minZ - 0.5;
                aligned = inX && inY && touchesZ;
              }

              if (aligned) {
                if (v.minX < b.minX) b.minX = v.minX; if (v.maxX > b.maxX) b.maxX = v.maxX;
                if (v.minY < b.minY) b.minY = v.minY; if (v.maxY > b.maxY) b.maxY = v.maxY;
                if (v.minZ < b.minZ) b.minZ = v.minZ; if (v.maxZ > b.maxZ) b.maxZ = v.maxZ;
                allChildIds.add(elemId);
                expanded++;
              }
            }
          } catch { /* ignore */ }
        }
        if (expanded > 0) {
          console.log(`[IFC] CurtainWall #${cwId}: SAFE proximity expanded with ${expanded} elements. new dims: dx=${(b.maxX - b.minX).toFixed(3)}, dy=${(b.maxY - b.minY).toFixed(3)} dz=${(b.maxZ - b.minZ).toFixed(3)}`);
        }
      }

      // Strategy B: scan IFCMEMBER, IFCPLATE by name prefix matching
      if (!found) {
        const candidateTypes = [WebIFC.IFCMEMBER, WebIFC.IFCPLATE, WebIFC.IFCBUILDINGELEMENTPROXY];
        for (const typeId of candidateTypes) {
          try {
            const ids = vecToArray(api.GetLineIDsWithType(mid, typeId, false));
            for (const elemId of ids) {
              const v = worldVertsMap.get(elemId);
              if (!v || v.xy.length === 0) continue;
              if (v.minX < bldMinX - 1 || v.maxX > bldMaxX + 1 || v.minY < bldMinY - 1 || v.maxY > bldMaxY + 1) continue;
              const elemLine = api.GetLine(mid, elemId, false) as Record<string, unknown>;
              const elemName = getName(elemLine);
              if (cwName && elemName && elemName.startsWith(cwName.split(':')[0])) {
                if (v.minX < b.minX) b.minX = v.minX; if (v.maxX > b.maxX) b.maxX = v.maxX;
                if (v.minY < b.minY) b.minY = v.minY; if (v.maxY > b.maxY) b.maxY = v.maxY;
                if (v.minZ < b.minZ) b.minZ = v.minZ; if (v.maxZ > b.maxZ) b.maxZ = v.maxZ;
                found = true;
              }
            }
          } catch { /* ignore */ }
        }
      }

      // Strategy C: use getAggregatedCoords (walks aggMap + ObjectPlacement fallback)
      if (!found) {
        const agg = getAggregatedCoords(cwId);
        if (agg && Math.max(agg.maxX - agg.minX, agg.maxY - agg.minY) > 0.1) {
          b.minX = agg.minX; b.maxX = agg.maxX; b.minY = agg.minY; b.maxY = agg.maxY;
          b.minZ = 0; b.maxZ = 3;
          found = true;
        }
      }

      // Strategy D: scan ALL worldVertsMap entries for elements that are
      // IFCPLATE or IFCMEMBER and are NOT already claimed by a wall.
      // Cluster them by proximity to find the facade outline.
      if (!found) {
        console.log(`[IFC] CurtainWall #${cwId}: trying proximity scan of all plates/members...`);
        const candidateTypes = [WebIFC.IFCPLATE, WebIFC.IFCMEMBER];
        const unclaimed: Array<{id: number; minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number}> = [];
        for (const typeId of candidateTypes) {
          try {
            const ids = vecToArray(api.GetLineIDsWithType(mid, typeId, false));
            for (const elemId of ids) {
              const v = worldVertsMap.get(elemId);
              if (!v || v.xy.length === 0) continue;
              unclaimed.push({ id: elemId, minX: v.minX, maxX: v.maxX, minY: v.minY, maxY: v.maxY, minZ: v.minZ, maxZ: v.maxZ });
            }
          } catch { /* ignore */ }
        }
        console.log(`[IFC] CurtainWall #${cwId}: found ${unclaimed.length} plate/member elements with geometry`);

        // If there are plate/member elements, split them into clusters per curtain wall
        // For now, if this is the first unresolved CW, take all of them
        if (unclaimed.length > 0) {
          // Group by proximity: elements that form a line (facade)
          // Simple approach: merge all into one bounding box per CW
          // Split by major axis alignment
          for (const elem of unclaimed) {
            if (elem.minX < b.minX) b.minX = elem.minX; if (elem.maxX > b.maxX) b.maxX = elem.maxX;
            if (elem.minY < b.minY) b.minY = elem.minY; if (elem.maxY > b.maxY) b.maxY = elem.maxY;
            if (elem.minZ < b.minZ) b.minZ = elem.minZ; if (elem.maxZ > b.maxZ) b.maxZ = elem.maxZ;
          }
          found = true;
        }
      }

      if (found) {
        const wallGeom = resolveWallFromMesh(b, globalYup);
        if (wallGeom) {
          const synth: [number, number][] = [
            [wallGeom.x1 - wallGeom.thickness/2, wallGeom.y1],
            [wallGeom.x1 + wallGeom.thickness/2, wallGeom.y1],
            [wallGeom.x2 + wallGeom.thickness/2, wallGeom.y2],
            [wallGeom.x2 - wallGeom.thickness/2, wallGeom.y2]
          ];
          worldVertsMap.set(cwId, {
            xy: synth,
            xz: synth, minZ: b.minZ, maxZ: b.maxZ,
            minX: Math.min(wallGeom.x1, wallGeom.x2) - wallGeom.thickness,
            maxX: Math.max(wallGeom.x1, wallGeom.x2) + wallGeom.thickness,
            minY: Math.min(wallGeom.y1, wallGeom.y2) - wallGeom.thickness,
            maxY: Math.max(wallGeom.y1, wallGeom.y2) + wallGeom.thickness
          });
          console.log(`[IFC] CurtainWall #${cwId} resolved via robust mesh projection: dims dx=${(b.maxX-b.minX).toFixed(3)} dy=${(b.maxY-b.minY).toFixed(3)}`);
        } else {
          console.warn(`[IFC] CurtainWall #${cwId} "${cwName}" - resolved coordinates too small`);
        }
      } else {
        console.warn(`[IFC] CurtainWall #${cwId} "${cwName}" - no geometry found via any strategy.`);
      }
    }
  } catch (e) {
    console.warn('[IFC] CurtainWall resolution error:', e);
  }

  // Helper: get the best world coordinates for an element (preferring its opening if the element itself is at origin)
  function getOpeningCoords(elemId: number, elemLine: Record<string, unknown>): { cx: number; cy: number; openingId?: number; aggW?: number } | null {
    // Find associated opening
    let openingId = elementToOpening.get(elemId);
    if (!openingId) {
      const name = getName(elemLine);
      if (name) openingId = openingByName.get(name);
    }

    // If we have an opening, use ITS coordinates
    if (openingId) {
      const opLine = api.GetLine(mid, openingId, false) as Record<string, unknown>;
      const agg = getAggregatedCoords(openingId);
      if (agg) {
        const spanY = globalYup ? (agg.maxZ - agg.minZ) : (agg.maxY - agg.minY);
        return { cx: agg.cx, cy: agg.cy, openingId, aggW: Math.max(agg.maxX - agg.minX, spanY) };
      } else {
        const matrix = getPlacementMatrix(api, mid, opLine);
        if (matrix) return { cx: matrix[12] * scale, cy: globalYup ? -matrix[14] * scale : matrix[13] * scale, openingId };
      }
    }

    // Fallback for Curtain Walls: try to read their Axis representation like a normal wall
    const axisPts = readWallAxisPts(api, mid, elemLine);
    if (axisPts && axisPts.length >= 2) {
      const worldMat = getPlacementMatrix(api, mid, elemLine);
      if (worldMat) {
        const lp1 = axisPts[0], lp2 = axisPts[axisPts.length - 1];
        const wm = worldMat;
        const x1 = (wm[0]*lp1[0] + wm[4]*lp1[1] + wm[12]) * scale;
        const y1 = globalYup
          ? -(wm[2]*lp1[0] + wm[6]*lp1[1] + wm[14]) * scale
          : (wm[1]*lp1[0] + wm[5]*lp1[1] + wm[13]) * scale;
        const x2 = (wm[0]*lp2[0] + wm[4]*lp2[1] + wm[12]) * scale;
        const y2 = globalYup
          ? -(wm[2]*lp2[0] + wm[6]*lp2[1] + wm[14]) * scale
          : (wm[1]*lp2[0] + wm[5]*lp2[1] + wm[13]) * scale;
        const axW = Math.hypot(x2 - x1, y2 - y1);
        if (axW > 0.01) {
          return { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, aggW: axW };
        }
      }
    }

    // Fallback 2: use their aggregated children (glass, mullions)
    const agg = getAggregatedCoords(elemId);
    if (agg && Math.max(agg.maxX - agg.minX, agg.maxY - agg.minY) > 0.1) {
      return { cx: agg.cx, cy: agg.cy, aggW: Math.max(agg.maxX - agg.minX, agg.maxY - agg.minY) };
    }

    return null;
  }

  report('Murs et Façades…', 40);
  const curtainWallIdSet = new Set(vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCCURTAINWALL, false)));
  const wallIds = [
    ...vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCWALL, false)),
    ...vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCWALLSTANDARDCASE, false)),
    ...curtainWallIdSet
  ];

  // Helper: read wall extrusion depth and profile thickness from Body representation
  function readWallBodyInfo(wLine: Record<string, unknown>): { depth: number; thickness: number } | null {
    try {
      const reprId = getRef(wLine['Representation']);
      if (!reprId) return null;
      const reprLine = api.GetLine(mid, reprId, false) as Record<string, unknown>;
      const reprs = reprLine['Representations'];
      if (!Array.isArray(reprs)) return null;
      for (const r of reprs) {
        const srId = getRef(r); if (!srId) continue;
        const sr = api.GetLine(mid, srId, false) as Record<string, unknown>;
        const ident = attrStr(sr, 'RepresentationIdentifier');
        if (ident !== 'Body') continue;
        const sitems = sr['Items'];
        if (!Array.isArray(sitems) || !sitems.length) continue;
        // Might be IfcBooleanClippingResult wrapping an IfcExtrudedAreaSolid
        let solidId = getRef(sitems[0]); if (!solidId) continue;
        let solid = api.GetLine(mid, solidId, false) as Record<string, unknown>;
        // Walk through boolean results to find the base solid
        for (let guard = 0; guard < 5 && solid && !attrNum(solid, 'Depth'); guard++) {
          const firstOp = getRef(solid['FirstOperand']);
          if (!firstOp) break;
          solid = api.GetLine(mid, firstOp, false) as Record<string, unknown>;
        }
        const depth = attrNum(solid, 'Depth');
        let thickness = 0;
        const profId = getRef(solid['SweptArea']);
        if (profId) {
          const prof = api.GetLine(mid, profId, false) as Record<string, unknown>;
          thickness = attrNum(prof, 'YDim') || attrNum(prof, 'XDim') || 0;
        }
        if (depth > 0) return { depth, thickness };
      }
    } catch { /* ignore */ }
    return null;
  }

  const wallsExtracted = new Set<string>();
  const curtainWallWindowIds = new Set<string>();
  const claimedExpressIds = new Set<number>();

  for (const localId of wallIds) {
    claimedExpressIds.add(localId);
    const wId = mkId('w', localId);
    const wLine = api.GetLine(mid, localId, false) as Record<string, unknown>;
    const axisPts = readWallAxisPts(api, mid, wLine);
    const worldMat = getPlacementMatrix(api, mid, wLine);
    const bodyInfo = readWallBodyInfo(wLine);
    const mv = worldVertsMap.get(localId);

    let x1: number, y1: number, x2: number, y2: number;
    let thickness: number, height: number, minZ: number;
    let resolved = false;
    let isYup = globalYup;

    if (axisPts && axisPts.length >= 2 && worldMat) {
      // Transform axis endpoints from local space to world space, apply unit scale
      const lp1 = axisPts[0], lp2 = axisPts[axisPts.length - 1];
      const wm = worldMat;
      x1 = (wm[0]*lp1[0] + wm[4]*lp1[1] + wm[12]) * scale;
      y1 = globalYup
        ? -(wm[2]*lp1[0] + wm[6]*lp1[1] + wm[14]) * scale
        : (wm[1]*lp1[0] + wm[5]*lp1[1] + wm[13]) * scale;
      x2 = (wm[0]*lp2[0] + wm[4]*lp2[1] + wm[12]) * scale;
      y2 = globalYup
        ? -(wm[2]*lp2[0] + wm[6]*lp2[1] + wm[14]) * scale
        : (wm[1]*lp2[0] + wm[5]*lp2[1] + wm[13]) * scale;
      minZ = globalYup ? wm[13] * scale : wm[14] * scale;

      // Determine isYup from global detection or mv bounds if available
      if (!isYup && mv) {
        const dx = mv.maxX - mv.minX;
        const dy = mv.maxY - mv.minY;
        const dz = mv.maxZ - mv.minZ;
        const dims = [
          { axis: 'x', size: dx },
          { axis: 'y', size: dy },
          { axis: 'z', size: dz }
        ].sort((a, b) => a.size - b.size);
        const thicknessAxis = dims[0].axis;
        isYup = (thicknessAxis === 'z') || (thicknessAxis === 'x' && dz > dy * 1.2 && dy >= 1.5 && dy <= 4.5);
      }

      // Height from body info, or from mesh vertical extent, or default
      if (bodyInfo && bodyInfo.depth > 0) {
        height = bodyInfo.depth * scale;
      } else if (mv) {
        const dy = mv.maxY - mv.minY;
        const dz = mv.maxZ - mv.minZ;
        const hVal = isYup ? dy : dz;
        height = hVal > 0.01 ? hVal : 2.5;
      } else {
        height = 2.5;
      }

      // Thickness from body info, or compute from mesh perpendicular to wall axis
      if (bodyInfo && bodyInfo.thickness > 0) {
        thickness = bodyInfo.thickness * scale;
      } else if (mv) {
        const pts2D = isYup ? mv.xz : mv.xy;
        if (pts2D && pts2D.length >= 4) {
          const wLen = Math.hypot(x2 - x1, y2 - y1);
          if (wLen > 0.001) {
            const adx = (x2 - x1) / wLen, ady = (y2 - y1) / wLen;
            const nx = -ady, ny = adx;
            let minPerp = Infinity, maxPerp = -Infinity;
            const step = Math.max(1, Math.floor(pts2D.length / 200));
            for (let i = 0; i < pts2D.length; i += step) {
              const p = pts2D[i][0] * nx + pts2D[i][1] * ny;
              if (p < minPerp) minPerp = p;
              if (p > maxPerp) maxPerp = p;
            }
            thickness = maxPerp - minPerp;
            if (thickness < 0.01 || thickness > 2.0) thickness = 0.2;
          } else {
            thickness = 0.2;
          }
        } else {
          thickness = 0.2;
        }
      } else {
        thickness = 0.2;
      }

      if (height < 0.1) height = 2.5;
      resolved = true;
    }

    if (!resolved) {
      // Strategy 2: Use mesh bounding box
      if (mv && mv.xy.length >= 4) {
        const wallGeom = resolveWallFromMesh(mv, isYup);
        if (wallGeom) {
          x1 = wallGeom.x1; y1 = wallGeom.y1;
          x2 = wallGeom.x2; y2 = wallGeom.y2;
          thickness = wallGeom.thickness;
          height = wallGeom.height;
          minZ = globalYup ? mv.minY : mv.minZ;
          resolved = true;
        } else {
          // Normal walls: farthest-point pair
          const pts2D = globalYup ? mv.xz : mv.xy;
          const step = Math.max(1, Math.floor(pts2D.length / 300));
          let maxD2 = -1, p1t = pts2D[0], p2t = pts2D[0];
          for (let i = 0; i < pts2D.length; i += step) {
            for (let j = i + step; j < pts2D.length; j += step) {
              const d2 = (pts2D[i][0]-pts2D[j][0])**2 + (pts2D[i][1]-pts2D[j][1])**2;
              if (d2 > maxD2) { maxD2 = d2; p1t = pts2D[i]; p2t = pts2D[j]; }
            }
          }
          if (Math.sqrt(maxD2) >= 0.001) {
            x1 = p1t[0]; y1 = p1t[1]; x2 = p2t[0]; y2 = p2t[1];
            thickness = 0.2;
            height = Math.max(globalYup ? (mv.maxY - mv.minY) : (mv.maxZ - mv.minZ), 2.5);
            minZ = globalYup ? mv.minY : mv.minZ;
            resolved = true;
          }
        }
      }
    }

    if (!resolved) {
      // Strategy 3: Aggregated bounds (Curtain Walls without axes)
      const agg = getAggregatedCoords(localId);
      if (agg) {
        const spanY = globalYup ? (agg.maxZ - agg.minZ) : (agg.maxY - agg.minY);
        if (Math.max(agg.maxX - agg.minX, spanY) > 0.1) {
          if (agg.maxX - agg.minX > spanY) {
            x1 = agg.minX; x2 = agg.maxX;
            y1 = agg.cy; y2 = agg.cy;
          } else {
            x1 = agg.cx; x2 = agg.cx;
            y1 = globalYup ? -agg.maxZ : agg.minY;
            y2 = globalYup ? -agg.minZ : agg.maxY;
          }
          thickness = 0.1;
          height = 2.5;
          minZ = globalYup ? agg.minY : agg.minZ;
          resolved = true;
        }
      }
    }

    if (!resolved) {
      // Strategy 4: Fallback to Length property + ObjectPlacement matrix (crucial for ghost Curtain Walls)
      const lengthProp = (attrNum(wLine, 'Length') || attrNum(wLine, 'OverallWidth') || widthMap.get(localId) || 0) * scale;
      if (lengthProp > 0.1) {
        const worldMat2 = getPlacementMatrix(api, mid, wLine);
        if (worldMat2) {
          x1 = worldMat2[12] * scale;
          y1 = globalYup ? -worldMat2[14] * scale : worldMat2[13] * scale;
          // Apply local X axis scaled by length
          x2 = x1 + worldMat2[0] * lengthProp;
          y2 = y1 + (globalYup ? -worldMat2[2] : worldMat2[1]) * lengthProp;
          thickness = 0.1;
          height = 2.5;
          minZ = globalYup ? worldMat2[13] * scale : worldMat2[14] * scale;
          resolved = true;
        }
      }
    }

    const isCurtainWall = String(wLine['type'] || wLine['ifcType'] || wLine['__type__'] || '').toUpperCase().includes('CURTAIN') || getName(wLine).toUpperCase().includes('CURTAIN') || wLine.type === WebIFC.IFCCURTAINWALL;
    if (resolved && isCurtainWall) {
      const agg = getAggregatedCoords(localId);
      if (agg && [agg.minX, agg.maxX, agg.minY, agg.maxY, agg.minZ, agg.maxZ].every(Number.isFinite)) {
        const dxAgg = agg.maxX - agg.minX;
        const dyAgg = agg.maxY - agg.minY;
        const dzAgg = agg.maxZ - agg.minZ;
        const currentLen = Math.hypot(x2! - x1!, y2! - y1!);
        const looksYUp = globalYup || (dyAgg >= 1.6 && dyAgg <= 6 && dzAgg > 0.3 && dzAgg > dxAgg * 0.2);

        let nx1: number;
        let ny1: number;
        let nx2: number;
        let ny2: number;
        let nThickness: number;
        let nHeight: number;
        let nMinZ: number;

        if (looksYUp) {
          if (dxAgg >= dzAgg) {
            // Children spread along X → wall runs along Z (vertical)
            nx1 = nx2 = agg.cx;
            ny1 = -agg.maxZ;
            ny2 = -agg.minZ;
            nThickness = dxAgg;
          } else {
            // Children spread along Z → wall runs along X (horizontal)
            nx1 = agg.minX;
            nx2 = agg.maxX;
            ny1 = ny2 = -(agg.minZ + agg.maxZ) / 2;
            nThickness = dzAgg;
          }
          nHeight = Math.max(dyAgg, 2.1);
          nMinZ = 0;
        } else {
          if (dxAgg >= dyAgg) {
            // Children spread along X → wall runs along Y
            nx1 = nx2 = agg.cx;
            ny1 = agg.minY;
            ny2 = agg.maxY;
            nThickness = dxAgg;
          } else {
            // Children spread along Y → wall runs along X
            nx1 = agg.minX;
            nx2 = agg.maxX;
            ny1 = ny2 = agg.cy;
            nThickness = dyAgg;
          }
          nHeight = Math.max(dzAgg, 2.1);
          nMinZ = agg.minZ;
        }

        const nextLen = Math.hypot(nx2 - nx1, ny2 - ny1);
        if (nextLen > 0.3 && (currentLen < 0.3 || nextLen > currentLen * 0.5)) {
          x1 = nx1;
          y1 = ny1;
          x2 = nx2;
          y2 = ny2;
          thickness = Math.max(Math.min(nThickness, 0.4), 0.08);
          height = nHeight;
          minZ = nMinZ;
        }
      }
    }

    const parentId = storeyForZ(minZ || 0, storeyInfos) || fallbackStoreyId;
    if (resolved && Number.isFinite(x1) && Number.isFinite(y1) && Number.isFinite(x2) && Number.isFinite(y2)) {
      console.log(`[WALL] #${localId} (${x1!.toFixed(2)},${y1!.toFixed(2)})→(${x2!.toFixed(2)},${y2!.toFixed(2)}) t=${thickness!.toFixed(3)}`);
      if (isCurtainWall) {
        console.log(`[IFC] CurtainWall #${localId} "${getName(wLine)}" => resolved=true geom=[${x1.toFixed(2)},${y1.toFixed(2)}] to [${x2.toFixed(2)},${y2.toFixed(2)}]`);
      }

      items[wId] = {
        id: wId, type: 'Wall', ifcType: isCurtainWall ? 'IfcCurtainWall' : 'IfcWall',
        name: getName(wLine) || 'Mur', parentId,
        GlobalId: attrStr(wLine, 'GlobalId') || mkGuid(localId + 10_000_000),
        geom: { x1: x1!, y1: y1!, x2: x2!, y2: y2!, thickness: thickness!, height: height! },
      } as IfcWallEntity;
      wallsExtracted.add(wId);

      if (isCurtainWall) {
        const bayId = mkId('wn_cw', localId);
        const width = Math.max(Math.hypot(x2! - x1!, y2! - y1!), 0.1);
        const bayHeight = Math.max(height!, 2.1);
        items[bayId] = {
          id: bayId,
          type: 'Window',
          ifcType: 'IfcWindow',
          name: getName(wLine) || 'Baie vitrée',
          Name: getName(wLine) || 'Baie vitrée',
          GlobalId: attrStr(wLine, 'GlobalId') || mkGuid(localId + 10_000_000),
          parentId,
          PredefinedType: 'WINDOW',
          OperationType: 'SLIDING_BAY',
          OverallWidth: width,
          OverallHeight: bayHeight,
          Material: 'Verre',
          // Bay window is a synthetic 2D representation of the curtain wall; it does NOT
          // exist as its own IFC entity, so no original placement to preserve.
          geom: { wallId: wId, t: 0.5, width, height: bayHeight, sillHeight: 0 },
          material: 'Verre',
          isBayWindow: true,
        } as IfcWindowEntity;
        curtainWallWindowIds.add(bayId);
      }
    } else if (String(wLine['type'] || wLine['ifcType'] || wLine['__type__'] || '').toUpperCase().includes('CURTAIN') || wLine.type === WebIFC.IFCCURTAINWALL) {
      console.warn(`[IFC] Failed to resolve geometry for CurtainWall #${localId} "${getName(wLine)}"`);
    }
  }

  report('Pièces…', 55);
  const spaceIds = vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCSPACE, false));
  for (const localId of spaceIds) {
    claimedExpressIds.add(localId);
    const spId = mkId('rm', localId);
    const spLine = api.GetLine(mid, localId, false) as Record<string, unknown>;
    let polygon: [number, number][] | null = readSpaceFootprint(api, mid, spLine, scale);
    if (!polygon || polygon.length < 3) {
      const flatMesh = api.GetFlatMesh(mid, localId);
      const mv = collectMeshVerts(api, mid, flatMesh, scale);
      flatMesh.delete?.();
      if (mv.xy.length >= 3) {
        const grid = new Map<string, [number, number]>();
        for (const [x, y] of mv.xy) {
          const k = `${Math.round(x * 20)},${Math.round(y * 20)}`;
          if (!grid.has(k)) grid.set(k, [x, y]);
        }
        const uniq = Array.from(grid.values());
        if (uniq.length >= 3) polygon = convexHull(uniq);
      }
    }
    if (!polygon || polygon.length < 3) polygon = [[0, 0], [4, 0], [4, 3], [0, 3]];

    // Check for invalid numbers
    let hasInvalid = false;
    for (const [px, py] of polygon) {
      if (!Number.isFinite(px) || !Number.isFinite(py)) hasInvalid = true;
    }

    if (!hasInvalid) {
      let height = 2.5;
      const matrix = getPlacementMatrix(api, mid, spLine);
      const parentId = storeyForZ((matrix ? matrix[14] : 0) * scale, storeyInfos) || fallbackStoreyId;

      // Diagnostic: Compute room bounding box
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [px, py] of polygon) {
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
      console.log(`[IFC] Room #${localId} "${getName(spLine)}" bounds: X:[${minX.toFixed(2)},${maxX.toFixed(2)}] Y:[${minY.toFixed(2)},${maxY.toFixed(2)}]`);

      const _placementWorld: [number, number] = [
        (matrix ? matrix[12] : 0) * scale,
        (matrix ? matrix[13] : 0) * scale,
      ];
      items[spId] = {
        id: spId, type: 'Room', ifcType: 'IfcSpace', name: getName(spLine) || 'Pièce', parentId,
        GlobalId: attrStr(spLine, 'GlobalId') || mkGuid(localId),
        geom: { polygon, height, _placementWorld },
      } as IfcSpaceEntity;
    }
  }

  report('Portes…', 70);
  const doorIds = [
    ...vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCDOOR, false)),
    ...vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCDOORSTANDARDCASE, false))
  ];
  for (const localId of doorIds) {
    claimedExpressIds.add(localId);
    const dId = mkId('dr', localId);
    const dLine = api.GetLine(mid, localId, false) as Record<string, unknown>;

    let hostWallId = fallbackStoreyId;
    let t = 0.5;
    let cx = 0, cy = 0;

    // 1. Try to get coordinates from the Opening
    const opInfo = getOpeningCoords(localId, dLine);
    if (opInfo) {
      cx = opInfo.cx; cy = opInfo.cy;
      // If opening coordinates are near origin, fall back to the door's own mesh geometry
      if (Math.abs(cx) < 0.001 && Math.abs(cy) < 0.001) {
        const v = worldVertsMap.get(localId);
        const pts = globalYup && v ? v.xz : (v ? v.xy : null);
        if (pts && pts.length > 0) {
          cx = pts.reduce((s, [x]) => s + x, 0) / pts.length;
          cy = pts.reduce((s, [, y]) => s + y, 0) / pts.length;
        }
      }
      // 2. Try to find the exact wall from relations
      const wallExpressId = openingToWall.get(opInfo.openingId!);
      if (wallExpressId) {
        const exactWallId = mkId('w', wallExpressId);
        const wallItem = items[exactWallId] as IfcWallEntity | undefined;
        if (wallItem && wallItem.type === 'Wall') {
          hostWallId = exactWallId;
          const g = wallItem.geom;
          const wallLen = Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
          if (wallLen > 0.001) {
            // Project (cx,cy) onto the wall segment to find t
            const dx = g.x2 - g.x1, dy = g.y2 - g.y1;
            const px = cx - g.x1, py = cy - g.y1;
            const dot = (px * dx + py * dy) / (wallLen * wallLen);
            t = Math.max(0.01, Math.min(0.99, dot));
          }
        }
      }
    }

    // 3. Fallback: projection to nearest wall if no explicit relation or opening found
    if (hostWallId === fallbackStoreyId) {
      // If we didn't get coords from opening, try the door itself
      if (!opInfo || (Math.abs(cx) < 0.001 && Math.abs(cy) < 0.001)) {
        const v = worldVertsMap.get(localId);
        const pts = globalYup && v ? v.xz : (v ? v.xy : null);
        if (pts && pts.length > 0) {
          cx = pts.reduce((s, [x]) => s + x, 0) / pts.length;
          cy = pts.reduce((s, [, y]) => s + y, 0) / pts.length;
        } else {
          const matrix = getPlacementMatrix(api, mid, dLine);
          if (matrix) {
            cx = matrix[12] * scale;
            cy = globalYup ? -matrix[14] * scale : matrix[13] * scale;
          }
        }
      }
      const wallInfo = nearestWallWithT(items, cx, cy);
      if (wallInfo) { hostWallId = wallInfo.id; t = wallInfo.t; }
    }

    const hostWall = items[hostWallId];
    const parentId = hostWall ? hostWall.parentId : (storeyForZ(0, storeyInfos) || fallbackStoreyId);

    // Get width and height from mesh geometry if available
    const v = worldVertsMap.get(localId);
    let meshW = 0, meshH = 0;
    if (v) {
      const hSpan1 = v.maxX - v.minX;
      const hSpan2 = globalYup ? (v.maxZ - v.minZ) : (v.maxY - v.minY);
      meshW = Math.max(hSpan1, hSpan2);
      meshH = globalYup ? (v.maxY - v.minY) : (v.maxZ - v.minZ);
    }

    let w = (attrNum(dLine, 'OverallWidth') || widthMap.get(localId) || 0) * scale;
    if (w <= 0) w = meshW;
    if (w <= 0 && opInfo && opInfo.aggW) w = opInfo.aggW;
    if (w <= 0) w = 0.9;

    const rawH = attrNum(dLine, 'OverallHeight');
    let h = rawH !== null && rawH > 0 ? rawH * scale : meshH;
    if (h <= 0) h = 2.1;

    // Determine door swing direction from OperationType
    const doorOpType = ((attrStr(dLine, 'OperationType') === 'USERDEFINED' ? attrStr(dLine, 'UserDefinedOperationType') : attrStr(dLine, 'OperationType')) || opMap.get(localId) || '').toUpperCase();
    let doorSwing: 'left' | 'right' = 'left';
    if (doorOpType.includes('RIGHT')) doorSwing = 'right';

    const doorMat = getPlacementMatrix(api, mid, dLine);

    // Door side and hinge, expressed against the wall as this import rebuilt it (possibly in the
    // opposite direction to the IFC axis). Placement matrices are in IFC axes (Z up), the same
    // plan X/Y as the imported model: local Y is the side the leaf opens to, and OperationType
    // LEFT/RIGHT is relative to the door's local X.
    let doorSide = 1;
    if (hostWall && hostWall.type === 'Wall') {
      const wallGeom = (hostWall as IfcWallEntity).geom;
      const wallDx = wallGeom.x2 - wallGeom.x1, wallDy = wallGeom.y2 - wallGeom.y1;
      const wallLen = Math.hypot(wallDx, wallDy);
      if (wallLen > 0.001 && doorMat) {
        const ux = wallDx / wallLen, uy = wallDy / wallLen;
        const nx = -uy, ny = ux;
        const opensX = doorMat[4], opensY = doorMat[5];
        const alongX = doorMat[0], alongY = doorMat[1];
        if (Math.hypot(opensX, opensY) > 0.5) doorSide = opensX * nx + opensY * ny >= 0 ? 1 : -1;
        // The door's X runs against the wall: its left is the wall's right.
        if (Math.hypot(alongX, alongY) > 0.5 && alongX * ux + alongY * uy < 0) doorSwing = doorSwing === 'left' ? 'right' : 'left';
      }
    }

    console.log(`[IFC] Door #${localId} "${getName(dLine)}" => wall=${hostWallId} t=${t.toFixed(3)} w=${w.toFixed(3)} swing=${doorSwing} side=${doorSide} via=${opInfo ? 'OPENING' : 'DOOR_COORD'}`);
    const doorMatHasTranslation = doorMat && (Math.abs(doorMat[12]) > 0.001 || Math.abs(doorMat[13]) > 0.001 || Math.abs(doorMat[14]) > 0.001);
    const dPlacWorld: [number, number] = doorMatHasTranslation
      ? (planCoordsFromMatrix(doorMat) || [cx, cy])
      : [cx, cy];
    let resolvedOpType = doorOpType;
    if (!resolvedOpType) {
      if (w >= 1.5) {
        resolvedOpType = 'SLIDING_BAY';
      } else if (w >= 1.1) {
        resolvedOpType = 'DOUBLE_DOOR_SINGLE_SWING';
      } else {
        resolvedOpType = 'SINGLE_SWING_LEFT';
      }
    }

    items[dId] = {
      id: dId, type: 'Door', ifcType: 'IfcDoor', name: getName(dLine) || 'Porte', parentId,
      GlobalId: attrStr(dLine, 'GlobalId') || mkGuid(localId),
      OperationType: resolvedOpType as any,
      geom: { wallId: hostWallId, t, width: w, height: h, swing: doorSwing, side: doorSide, _placementWorld: dPlacWorld, _openingT: t, openingExpId: opInfo?.openingId ?? elementToOpening.get(localId) },
    } as IfcDoorEntity;
  }

  report('Fenêtres et Baies…', 75);
  const winIds = [
    ...vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCWINDOW, false)),
    ...vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCWINDOWSTANDARDCASE, false))
  ];
  for (const localId of winIds) {
    claimedExpressIds.add(localId);
    const wId = mkId('wn', localId);
    const wLine = api.GetLine(mid, localId, false) as Record<string, unknown>;

    let hostWallId = fallbackStoreyId;
    let t = 0.5;
    let cx = 0, cy = 0;

    // 1. Try to get coordinates from the Opening or Aggregation
    const opInfo = getOpeningCoords(localId, wLine);
    if (opInfo) {
      cx = opInfo.cx; cy = opInfo.cy;
      // If opening coordinates are near origin, fall back to the window's own mesh geometry
      if (Math.abs(cx) < 0.001 && Math.abs(cy) < 0.001) {
        const v = worldVertsMap.get(localId);
        const pts = globalYup && v ? v.xz : (v ? v.xy : null);
        if (pts && pts.length > 0) {
          cx = pts.reduce((s, [x]) => s + x, 0) / pts.length;
          cy = pts.reduce((s, [, y]) => s + y, 0) / pts.length;
        }
      }
      // 2. Try to find the exact wall from relations
      const wallExpressId = opInfo.openingId ? openingToWall.get(opInfo.openingId) : undefined;
      if (wallExpressId) {
        const exactWallId = mkId('w', wallExpressId);
        const wallItem = items[exactWallId] as IfcWallEntity | undefined;
        if (wallItem && wallItem.type === 'Wall') {
          hostWallId = exactWallId;
          const g = wallItem.geom;
          const wallLen = Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
          if (wallLen > 0.001) {
            const dx = g.x2 - g.x1, dy = g.y2 - g.y1;
            const px = cx - g.x1, py = cy - g.y1;
            const dot = (px * dx + py * dy) / (wallLen * wallLen);
            t = Math.max(0.01, Math.min(0.99, dot));
          }
        }
      }
    }

    // 3. Fallback: projection to nearest wall
    if (hostWallId === fallbackStoreyId) {
      if (!opInfo || (Math.abs(cx) < 0.001 && Math.abs(cy) < 0.001)) {
        const v = worldVertsMap.get(localId);
        const pts = globalYup && v ? v.xz : (v ? v.xy : null);
        if (pts && pts.length > 0) {
          cx = pts.reduce((s, [x]) => s + x, 0) / pts.length;
          cy = pts.reduce((s, [, y]) => s + y, 0) / pts.length;
        } else {
          const matrix = getPlacementMatrix(api, mid, wLine);
          if (matrix) {
            cx = matrix[12] * scale;
            cy = globalYup ? -matrix[14] * scale : matrix[13] * scale;
          }
        }
      }
      const wallInfo = nearestWallWithT(items, cx, cy);
      if (wallInfo) { hostWallId = wallInfo.id; t = wallInfo.t; }
    }

    const hostWall = items[hostWallId];
    const parentId = hostWall ? hostWall.parentId : (storeyForZ(0, storeyInfos) || fallbackStoreyId);

    // Get width and height from mesh geometry if available
    const v = worldVertsMap.get(localId);
    let meshW = 0, meshH = 0;
    if (v) {
      const hSpan1 = v.maxX - v.minX;
      const hSpan2 = globalYup ? (v.maxZ - v.minZ) : (v.maxY - v.minY);
      meshW = Math.max(hSpan1, hSpan2);
      meshH = globalYup ? (v.maxY - v.minY) : (v.maxZ - v.minZ);
    }

    let w = (attrNum(wLine, 'OverallWidth') || widthMap.get(localId) || 0) * scale;
    if (w <= 0) w = meshW;
    if (w <= 0 && opInfo && opInfo.aggW) w = opInfo.aggW;
    if (w <= 0) w = 1.2;

    const rawH = attrNum(wLine, 'OverallHeight');
    let h = rawH !== null && rawH > 0 ? rawH * scale : meshH;
    if (h <= 0) h = 1.2;
    const wMat = getPlacementMatrix(api, mid, wLine);
    const winMatHasTranslation = wMat && (Math.abs(wMat[12]) > 0.001 || Math.abs(wMat[13]) > 0.001 || Math.abs(wMat[14]) > 0.001);
    const wPlacWorld: [number, number] = winMatHasTranslation
      ? (planCoordsFromMatrix(wMat) || [cx, cy])
      : [cx, cy];
    console.log(`[IFC] Window #${localId} "${getName(wLine)}" => wall=${hostWallId} t=${t.toFixed(3)} w=${w.toFixed(3)} via=${opInfo ? (opInfo.openingId ? 'OPENING' : 'AGGREGATION') : 'WINDOW_COORD'}`);
    let winOpType = attrStr(wLine, 'OperationType') || opMap.get(localId) || '';
    if (!winOpType) {
      if (w >= 1.5) {
        winOpType = 'SLIDING_BAY';
      } else if (w >= 1.0) {
        winOpType = 'DOUBLE_PANEL';
      } else {
        winOpType = 'WINDOW_PANEL';
      }
    }

    items[wId] = {
      id: wId, type: 'Window', ifcType: 'IfcWindow', name: getName(wLine) || 'Fenêtre', parentId,
      GlobalId: attrStr(wLine, 'GlobalId') || mkGuid(localId),
      OperationType: winOpType,
      geom: { wallId: hostWallId, t, width: w, height: h, sillHeight: 0.9, _placementWorld: wPlacWorld, _openingT: t, openingExpId: opInfo?.openingId ?? elementToOpening.get(localId) },
    } as IfcWindowEntity;
  }

  report('Mobilier…', 85);
  // Query subtypes explicitly: web-ifc includeInherited may miss IFCFURNITURE/IFCSYSTEMFURNITUREELEMENT
  const furIds = [
    ...vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCFURNISHINGELEMENT, false)),
    ...vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCFURNITURE, false)),
    ...vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCSYSTEMFURNITUREELEMENT, false)),
  ].filter((id, i, arr) => arr.indexOf(id) === i); // deduplicate
  for (const localId of furIds) {
    claimedExpressIds.add(localId);
    const fId = mkId('fur', localId);
    const fLine = api.GetLine(mid, localId, false) as Record<string, unknown>;
    const v = worldVertsMap.get(localId);

    // ObjectPlacement = full world position in IFC coordinates (pre-scale)
    const rawFMat = getPlacementMatrix(api, mid, fLine) || [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

    // MappingTarget carries the per-instance transform for IfcMappedItem geometry.
    // The final furniture transform is ObjectPlacement × MappingTarget.
    const tMat = getMappingTargetMatrix(api, mid, fLine);
    const fMat = tMat ? multiplyMatrices(rawFMat, tMat) : rawFMat;

    // Storey: use worldVertsMap Z if meshed, otherwise fall back to ObjectPlacement Z
    const minHeight = globalYup ? (v ? v.minY : fMat[13] * scale) : (v ? v.minZ : fMat[14] * scale);
    const parentId = storeyForZ(minHeight, storeyInfos) || fallbackStoreyId;

    // World insertion point and 2D rotation from the composed matrix. Using only
    // ObjectPlacement drops MappingTarget offsets/rotations and makes 2D furniture
    // drift through walls while the 3D IFC model remains correct.
    const insertionX = fMat[12] * scale;
    const insertionY = globalYup ? -fMat[14] * scale : fMat[13] * scale;
    const fRotation = planRotationFromMatrix(fMat);

    // Dimensions: IFC BoundingBox representation > mesh local bbox > name parsing
    let fw = 0.8, fd = 0.8, fh = 0.75;
    let cornerX = 0, cornerY = 0; // local-space offset from insertion to bbox corner

    const bboxRepr = readFurnitureBBox(api, mid, fLine, scale);
    if (bboxRepr) {
      fw = bboxRepr.fw; fd = bboxRepr.fd; fh = bboxRepr.fh;
      // Corner = local-space offset from insertion to bbox min corner
      // e.g. for center-inserted family: cornerX=-fw/2, cornerY=-fd/2
      cornerX = bboxRepr.cornerX;
      cornerY = bboxRepr.cornerY;
    } else {
      const lbbox = localBBoxMap.get(localId);
      if (lbbox) {
        const wDim = lbbox.maxX - lbbox.minX;
        const hDim = globalYup ? lbbox.maxY - lbbox.minY : lbbox.maxZ - lbbox.minZ;
        const dDim = globalYup ? lbbox.maxZ - lbbox.minZ : lbbox.maxY - lbbox.minY;
        if (wDim >= 0.05) fw = wDim;
        if (dDim >= 0.05) fd = dDim;
        if (hDim >= 0.05) fh = hDim;
        cornerX = lbbox.minX;
        cornerY = globalYup ? lbbox.minZ : lbbox.minY;
      } else {
        const nameDims = parseDimsFromName(getName(fLine));
        if (nameDims && nameDims.w > 0.05 && nameDims.d > 0.05) {
          fw = nameDims.w; fd = nameDims.d;
          if (nameDims.h > 0.05) fh = nameDims.h;
        }
      }
    }

    // Footprint polygon (local space, relative to insertion)
    let fFootprint: [number, number][] | undefined;
    const ifcFootprint = readFurnitureFootprint(api, mid, fLine, scale, rawFMat);
    if (ifcFootprint && ifcFootprint.length >= 3) {
      let fpMinX = Infinity, fpMaxX = -Infinity, fpMinY = Infinity, fpMaxY = -Infinity;
      for (const [x, y] of ifcFootprint) {
        if (x < fpMinX) fpMinX = x; if (x > fpMaxX) fpMaxX = x;
        if (y < fpMinY) fpMinY = y; if (y > fpMaxY) fpMaxY = y;
      }
      if (!bboxRepr) {
        fw = fpMaxX - fpMinX || fw;
        fd = fpMaxY - fpMinY || fd;
        cornerX = fpMinX;
        cornerY = fpMinY;
      }
      // Normalize footprint to [0..fw] × [0..fd] using the authoritative corner origin
      const fpOriginX = bboxRepr ? bboxRepr.cornerX : fpMinX;
      const fpOriginY = bboxRepr ? bboxRepr.cornerY : fpMinY;
      fFootprint = ifcFootprint.map(([x, y]) => [x - fpOriginX, y - fpOriginY]);
    }

    if (v) {
      const xyFoot = projectedFootprint(v.xy, insertionX, insertionY);
      const xzFoot = projectedFootprint(v.xz, insertionX, insertionY);
      const meshFoot = globalYup
        ? (xzFoot ?? xyFoot)
        : ([xyFoot, xzFoot]
            .filter((fp): fp is NonNullable<typeof xyFoot> => fp !== null)
            .sort((a, b) => a.dist - b.dist)[0]);
      if (meshFoot && (globalYup || meshFoot.dist < Math.max(meshFoot.w, meshFoot.d, 2))) {
        const meshH = Math.max(v.maxY - v.minY, v.maxZ - v.minZ, fh);
        const meshFootprint = meshFoot.hull.map(([px, py]) => [px - meshFoot.minX, py - meshFoot.minY] as [number, number]);
        const fPlacWorld: [number, number] = [meshFoot.cx, meshFoot.cy];
        console.log(`[IFC Furniture] #${localId} "${getName(fLine)}" => mesh footprint ${xzFoot && meshFoot === xzFoot ? 'X/-Z' : 'X/Y'} center=(${meshFoot.cx.toFixed(3)},${meshFoot.cy.toFixed(3)}) w=${meshFoot.w.toFixed(3)} d=${meshFoot.d.toFixed(3)}`);
        items[fId] = {
          id: fId, type: 'Furniture', ifcType: 'IfcFurnishingElement', name: getName(fLine) || 'Meuble', parentId,
          GlobalId: attrStr(fLine, 'GlobalId') || mkGuid(localId),
          geom: { x: meshFoot.minX, y: meshFoot.minY, w: meshFoot.w, d: meshFoot.d, h: meshH, rotation: 0, footprint: meshFootprint, _placementWorld: fPlacWorld },
        } as IfcFurnitureEntity;
        continue;
      }
    }

    // The local bbox CENTER relative to insertion is (cornerX + fw/2, cornerY + fd/2).
    // Rotate this center offset by fRotation to get world center offset, add insertion.
    // Canvas2D uses cx = x + fw/2, so we must provide x = worldCX - fw/2 (the unrotated top-left).
    const cosR = Math.cos(fRotation), sinR = Math.sin(fRotation);
    const lcx = cornerX + fw / 2;  // local center X offset from insertion
    const lcy = cornerY + fd / 2;  // local center Y offset from insertion
    const cxWorld = insertionX + lcx * cosR - lcy * sinR;
    const cyWorld = insertionY + lcx * sinR + lcy * cosR;
    const fx = cxWorld - fw / 2;
    const fy = cyWorld - fd / 2;
    const fPlacWorld: [number, number] = [cxWorld, cyWorld];

    console.log(`[IFC Furniture] #${localId} "${getName(fLine)}" => pos=(${insertionX.toFixed(3)},${insertionY.toFixed(3)}) corner=(${cornerX.toFixed(3)},${cornerY.toFixed(3)}) rot=${(fRotation * 180 / Math.PI).toFixed(1)}° w=${fw.toFixed(3)} d=${fd.toFixed(3)} → cx=${cxWorld.toFixed(3)} cy=${cyWorld.toFixed(3)}`);

    items[fId] = {
      id: fId, type: 'Furniture', ifcType: 'IfcFurnishingElement', name: getName(fLine) || 'Meuble', parentId,
      GlobalId: attrStr(fLine, 'GlobalId') || mkGuid(localId),
      geom: { x: fx, y: fy, w: fw, d: fd, h: fh, rotation: fRotation, footprint: fFootprint, _placementWorld: fPlacWorld },
    } as IfcFurnitureEntity;
  }

  // ── Slabs (IFCSLAB) — dedicated entity with polygon + thickness ────────────

  report('Dalles…', 86);
  const slabIds = vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCSLAB, false));
  for (const localId of slabIds) {
    claimedExpressIds.add(localId);
    const slabId = mkId('slab', localId);
    const slLine = api.GetLine(mid, localId, false) as Record<string, unknown>;

    // Try extracting the polygon + thickness from the swept-solid representation
    let polygon: [number, number][] | null = null;
    let thickness = 0.2;
    const fromExtrusion = readSlabFootprint(api, mid, slLine, scale);
    if (fromExtrusion) {
      polygon = fromExtrusion.polygon;
      thickness = fromExtrusion.thickness;
    }

    // Fallback: convex hull of mesh plan projection (handles BREP-only slabs)
    const v = worldVertsMap.get(localId);
    if ((!polygon || polygon.length < 3) && v) {
      const pts2D = globalYup ? v.xz : v.xy;
      if (pts2D.length >= 3) {
        const grid = new Map<string, [number, number]>();
        for (const [x, y] of pts2D) {
          const k = `${Math.round(x * 20)},${Math.round(y * 20)}`;
          if (!grid.has(k)) grid.set(k, [x, y]);
        }
        const uniq = Array.from(grid.values());
        if (uniq.length >= 3) polygon = convexHull(uniq);
      }
      const hSpan = globalYup ? (v.maxY - v.minY) : (v.maxZ - v.minZ);
      if (hSpan > 0.001) thickness = hSpan;
    }
    if (!polygon || polygon.length < 3) {
      console.warn(`[IFC] Slab #${localId} "${getName(slLine)}" has no resolvable footprint — skipped`);
      continue;
    }

    // Validate finite coordinates
    const hasInvalid = polygon.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y));
    if (hasInvalid) {
      console.warn(`[IFC] Slab #${localId} "${getName(slLine)}" has non-finite coordinates — skipped`);
      continue;
    }

    const matrix = getPlacementMatrix(api, mid, slLine);
    const minZ = v ? (globalYup ? v.minY : v.minZ) : (matrix ? (globalYup ? matrix[13] * scale : matrix[14] * scale) : 0);
    const parentId = storeyForZ(minZ, storeyInfos) || fallbackStoreyId;
    const _placementWorld: [number, number] = matrix
      ? (planCoordsFromMatrix(matrix) || [polygon[0][0], polygon[0][1]])
      : [polygon[0][0], polygon[0][1]];
    items[slabId] = {
      id: slabId, type: 'Slab', ifcType: 'IfcSlab',
      name: getName(slLine) || 'Dalle',
      GlobalId: attrStr(slLine, 'GlobalId') || mkGuid(localId),
      parentId,
      geom: { polygon, thickness, _placementWorld },
    } as IfcSlabEntity;
  }

  // ── Annotations written by skAItch: dimensions, markers, saved sections ────
  try {
    const storeyOfElement = new Map<number, string>();
    for (const relId of vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE, false))) {
      const rel = api.GetLine(mid, relId, false) as Record<string, unknown>;
      const structureId = getRef(rel['RelatingStructure']);
      const related = rel['RelatedElements'];
      if (!structureId || !Array.isArray(related) || items[mkId('sty', structureId)]?.type !== 'Storey') continue;
      for (const ref of related) { const id = getRef(ref); if (id) storeyOfElement.set(id, mkId('sty', structureId)); }
    }
    for (const localId of vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCANNOTATION, false))) {
      const line = api.GetLine(mid, localId, false) as Record<string, unknown>;
      const annotation = annotationFromIfc({
        expressId: localId, globalId: attrStr(line, 'GlobalId') || mkGuid(localId), name: getName(line),
        objectType: attrStr(line, 'ObjectType'), description: attrStr(line, 'Description'),
        parentId: storeyOfElement.get(localId) ?? fallbackStoreyId,
      });
      if (!annotation) continue;
      claimedExpressIds.add(localId);
      items[annotation.id] = annotation;
    }
  } catch (e) {
    console.warn('[IFC] annotation parse error', e);
  }

  // ── Generic elements: extract all remaining IFC elements with geometry ─────
  report('Éléments génériques…', 87);
  const GENERIC_IFC_TYPES: [number, string][] = [
    [WebIFC.IFCCOLUMN, 'IfcColumn'], [WebIFC.IFCCOLUMNSTANDARDCASE, 'IfcColumn'],
    [WebIFC.IFCBEAM, 'IfcBeam'], [WebIFC.IFCBEAMSTANDARDCASE, 'IfcBeam'],
    [WebIFC.IFCSTAIR, 'IfcStair'], [WebIFC.IFCSTAIRFLIGHT, 'IfcStairFlight'],
    [WebIFC.IFCRAILING, 'IfcRailing'],
    [WebIFC.IFCROOF, 'IfcRoof'],
    [WebIFC.IFCCOVERING, 'IfcCovering'],
    [WebIFC.IFCPLATE, 'IfcPlate'], [WebIFC.IFCPLATESTANDARDCASE, 'IfcPlate'],
    [WebIFC.IFCMEMBER, 'IfcMember'], [WebIFC.IFCMEMBERSTANDARDCASE, 'IfcMember'],
    [WebIFC.IFCBUILDINGELEMENTPROXY, 'IfcBuildingElementProxy'],
    [WebIFC.IFCFLOWTERMINAL, 'IfcFlowTerminal'], [WebIFC.IFCFLOWSEGMENT, 'IfcFlowSegment'],
    [WebIFC.IFCDISCRETEACCESSORY, 'IfcDiscreteAccessory'],
    [WebIFC.IFCELECTRICALELEMENT, 'IfcElectricalElement'],
    [WebIFC.IFCCHIMNEY, 'IfcChimney'],
    [WebIFC.IFCPILE, 'IfcPile'], [WebIFC.IFCFOOTING, 'IfcFooting'],
    [WebIFC.IFCRAMP, 'IfcRamp'], [WebIFC.IFCRAMPFLIGHT, 'IfcRampFlight'],
  ];
  let genCount = 0;
  for (const [ifcTypeConst, ifcTypeName] of GENERIC_IFC_TYPES) {
    let typeIds: number[];
    try { typeIds = vecToArray(api.GetLineIDsWithType(mid, ifcTypeConst, false)); } catch { continue; }
    for (const eid of typeIds) {
      if (claimedExpressIds.has(eid)) continue;
      claimedExpressIds.add(eid);
      const v = worldVertsMap.get(eid);
      const line = api.GetLine(mid, eid, false) as Record<string, unknown>;
      const gMat = getPlacementMatrix(api, mid, line);

      let minX = 0, maxX = 0.8, minY = 0, maxY = 0.8, minZ = 0, maxZ = 0.75;
      let footprint: [number, number][] | undefined;
      let hasGeometry = false;

      if (v && (v.xy.length >= 2 || v.xz.length >= 2)) {
        const name = getName(line);
        const nearX = gMat ? gMat[12] * scale : (v.minX + v.maxX) / 2;
        const nearY = gMat
          ? (globalYup ? -gMat[14] * scale : gMat[13] * scale)
          : (globalYup ? -(v.minZ + v.maxZ) / 2 : (v.minY + v.maxY) / 2);
        const xyFoot = projectedFootprint(v.xy, nearX, nearY);
        const xzFoot = projectedFootprint(v.xz, nearX, nearY);
        const looksLikeCurtainPart =
          ifcTypeName === 'IfcPlate' || ifcTypeName === 'IfcMember' ||
          /system panel|glazed|curtain|mullion/i.test(name);
        const looksLikeCeiling = ifcTypeName === 'IfcCovering' || /compound ceiling|ceiling|plafond/i.test(name);
        const ySpan = v.maxY - v.minY;
        const zSpan = v.maxZ - v.minZ;
        const preferPlanXZ = globalYup || looksLikeCurtainPart || looksLikeCeiling || (ySpan > 0.5 && zSpan > 0.05 && xzFoot && xyFoot && xzFoot.d > xyFoot.d * 1.2);
        const meshFoot = preferPlanXZ ? (xzFoot ?? xyFoot) : (xyFoot ?? xzFoot);

        if (meshFoot) {
          hasGeometry = true;
          minX = meshFoot.minX; maxX = meshFoot.maxX; minY = meshFoot.minY; maxY = meshFoot.maxY;
          minZ = globalYup ? v.minY : v.minZ; maxZ = globalYup ? v.maxY : v.maxZ;
          footprint = meshFoot.hull;
          if (looksLikeCurtainPart || looksLikeCeiling) {
            console.log(`[IFC Generic] #${eid} "${name || ifcTypeName}" => ${meshFoot === xzFoot ? 'X/-Z' : 'X/Y'} footprint x=[${minX.toFixed(2)},${maxX.toFixed(2)}] y=[${minY.toFixed(2)},${maxY.toFixed(2)}]`);
          }
        }
      }
      // Always add elements to items (even without geometry) so patchIFC Case 3
      // doesn't null their original IFC representation. _keepOriginalPlacement
      // will preserve the original IFC placement and geometry via ThatOpen.

      const w = maxX - minX, d = maxY - minY;
      const h = maxZ - minZ;
      const parentId = hasGeometry ? storeyForZ(minZ, storeyInfos) : fallbackStoreyId;
      const genId = mkId('gen', eid);
      const gPlacWorld: [number, number] = gMat
        ? (planCoordsFromMatrix(gMat) || [minX, minY])
        : [minX, minY];
      items[genId] = {
        id: genId,
        type: 'GenericElement',
        ifcType: ifcTypeName,
        name: getName(line) || ifcTypeName,
        GlobalId: String(line?.['GlobalId'] || ''),
        parentId,
        expressID: eid,
        geom: { x: minX, y: minY, w, d, h, rotation: 0, footprint, _placementWorld: gPlacWorld },
        category: ifcTypeName,
        isGenericIfcElement: true,
      } as IfcGenericEntity;
      genCount++;
    }
  }
  if (genCount > 0) console.log(`[IFC Import] ${genCount} generic elements extracted`);

  report('Topologie des murs…', 90);

  // Topological healing: Snap wall endpoints to their geometric intersections
  // to prevent crosses and gaps when rendered with SVG stroke logic.
  const allWalls = Object.values(items).filter(i => i.type === 'Wall');
  const snaps: { w: any, isP1: boolean, targetX: number, targetY: number }[] = [];
  const maxSnapDist = 0.35;

  const getLineIntersect = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number) => {
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-6) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1)
    };
  };

  for (const w1 of allWalls) {
    const g1 = (w1 as any).geom;
    if (!g1 || !Number.isFinite(g1.x1)) continue;

    const endpoints = [
      { isP1: true, x: g1.x1, y: g1.y1 },
      { isP1: false, x: g1.x2, y: g1.y2 }
    ];

    for (const ep of endpoints) {
      let bestSnap: { x: number, y: number, d: number } | null = null;

      for (const w2 of allWalls) {
        if (w1.id === w2.id) continue;
        const g2 = (w2 as any).geom;
        if (!g2 || !Number.isFinite(g2.x1)) continue;

        const intersect = getLineIntersect(g1.x1, g1.y1, g1.x2, g1.y2, g2.x1, g2.y1, g2.x2, g2.y2);
        if (!intersect) continue;

        const distToE = Math.hypot(intersect.x - ep.x, intersect.y - ep.y);
        if (distToE > maxSnapDist) continue;

        const distToW2Start = Math.hypot(intersect.x - g2.x1, intersect.y - g2.y1);
        const distToW2End = Math.hypot(intersect.x - g2.x2, intersect.y - g2.y2);
        const w2Len = Math.hypot(g2.x2 - g2.x1, g2.y2 - g2.y1);

        if (distToW2Start > w2Len + maxSnapDist && distToW2End > w2Len + maxSnapDist) continue;

        if (!bestSnap || distToE < bestSnap.d) {
          bestSnap = { x: intersect.x, y: intersect.y, d: distToE };
        }
      }

      if (bestSnap) {
        snaps.push({ w: w1, isP1: ep.isP1, targetX: bestSnap.x, targetY: bestSnap.y });
      }
    }
  }

  for (const snap of snaps) {
    if (snap.isP1) {
      snap.w.geom.x1 = snap.targetX;
      snap.w.geom.y1 = snap.targetY;
    } else {
      snap.w.geom.x2 = snap.targetX;
      snap.w.geom.y2 = snap.targetY;
    }
  }

  try {
    const pathEnd = (value: unknown): WallEnd | null => {
      const raw = typeof value === 'string' ? value : String((value as any)?.value ?? '');
      if (raw.toUpperCase().includes('ATSTART')) return 'start';
      if (raw.toUpperCase().includes('ATEND')) return 'end';
      return null;
    };
    for (const relId of vecToArray(api.GetLineIDsWithType(mid, WebIFC.IFCRELCONNECTSPATHELEMENTS))) {
      const rel = api.GetLine(mid, relId, false) as Record<string, unknown>;
      const relatingId = getRef(rel['RelatingElement']);
      const relatedId = getRef(rel['RelatedElement']);
      const relatingEnd = pathEnd(rel['RelatingConnectionType']);
      const relatedEnd = pathEnd(rel['RelatedConnectionType']);
      if (relatingId && relatedId && relatingEnd && relatedEnd) {
        // The declared ATSTART/ATEND refer to the IFC axis direction, but a wall rebuilt from
        // its mesh or bounding box may come out reversed. Join the ends that actually meet.
        const aId = mkId('w', relatingId), bId = mkId('w', relatedId);
        const ends = nearestWallEnds(items, aId, bId);
        if (ends) connectWallEndpoints(items, aId, ends[0], bId, ends[1]);
      }
    }
  } catch { /* malformed or unsupported path relationship */ }

  report('Centrage…', 93);
  centerOffset = centerCoordinates(items, meshes) ?? undefined;
  normalizeWallContinuity(items);

  } catch (err) {
    console.error('[IFC Import] Error:', err);
    throw err;
  } finally {
    if (mid >= 0) {
      try { api.CloseModel(mid); } catch {}
    }
    api.Dispose();
    report('Terminé', 100);
  }

  for (const item of Object.values(items)) {
    const values = surveyPsets.get(item.GlobalId);
    if (values) Object.assign(item, values);
  }
  return { items, rawStructure: spatialTree, rawIfcBuffer: buffer, meshes, centerOffset };
}
