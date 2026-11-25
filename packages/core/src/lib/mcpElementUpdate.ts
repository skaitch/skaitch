import { sectionGeom, sectionPlane } from './freeSection.js';
import { ROOF_TYPES, buildRoof, roofPredefinedType } from './roofGeometry.js';
import { validateStair } from './stairGeometry.js';
import { markGeomEdit } from './geomEdit.js';
import { TECHNICAL_DISCIPLINES, type IfcEntity } from '../types/ifc.js';

const fields: Record<string, string[]> = {
  Project: ['description', 'longName', 'phase', 'northAngle', 'lat', 'lon', 'siteElevation', 'siteAddress'],
  Building: ['description', 'address', 'grossArea'], Storey: ['description', 'grossArea'],
  Room: ['description', 'function', 'occupancy'], Slab: ['description'], Roof: ['description'],
  Furniture: ['description', 'category', 'model'], GenericElement: ['description', 'category'],
  Marker: ['description'], Dimension: ['description'],
  Wall: ['description', 'Material', 'FireRating', 'ThermalTransmittance'],
  Door: ['description', 'Material', 'FireRating'], Window: ['description', 'Material', 'ThermalTransmittance'],
  Technical: ['description', 'category', 'model', 'discipline', 'circuitRef', 'amperage', 'fluidType', 'diameter', 'hvacType'],
  Opening: ['description'], Stair: ['description'], Section: ['description'],
};
const geometry: Record<string, string[]> = {
  Stair: ['x','y','rotation','width','going','form','targetId','count','turn','landing','radius','railLeft','railRight','railHeight','railStyle','landingLength','opening','flightLengths','landings','turnRadius','startWinders'],
  Section: ['x1','y1','x2','y2','origin','normal','depth'],
  Storey: ['level', 'elevation', 'thickness'], Room: ['polygon', 'height'], Slab: ['polygon', 'thickness'],
  Roof: ['polygon', 'thickness', 'elevation', 'roofType', 'pitch', 'overhang', 'ridgeSwap', 'edges'],
  Furniture: ['x', 'y', 'w', 'd', 'h', 'rotation'], GenericElement: ['x', 'y', 'w', 'd', 'h', 'rotation'],
  Marker: ['x', 'y'], Dimension: ['x1', 'y1', 'x2', 'y2'], Technical: ['x', 'y', 'rotation', 'mountHeight'],
};
const numeric = new Set(['northAngle', 'lat', 'lon', 'siteElevation', 'grossArea', 'occupancy', 'ThermalTransmittance', 'diameter']);
const positive = new Set(['height', 'thickness', 'w', 'd', 'h']);

/** Validate a partial update before making any changes to the editor. */
export function buildElementPatch(item: IfcEntity, properties: unknown, geom: unknown): Record<string, unknown> {
  if (!fields[item.type]) throw new Error(`Element type ${item.type} is not editable with update_element.`);
  const patch: Record<string, any> = {};
  const readObject = (value: unknown, label: string): Record<string, unknown> => {
    if (value === undefined) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    return value as Record<string, unknown>;
  };
  for (const [key, value] of Object.entries(readObject(properties, 'properties'))) {
    if (key === 'name') {
      if (typeof value !== 'string') throw new Error('name must be a string.');
      patch.name = patch.Name = value;
    } else {
      if (!fields[item.type].includes(key)) throw new Error(`Property ${key} is not editable for ${item.type}.`);
      if (numeric.has(key) ? typeof value !== 'number' || !Number.isFinite(value) : typeof value !== 'string') throw new Error(`Invalid value for ${key}.`);
      if (key === 'discipline' && !TECHNICAL_DISCIPLINES.some(discipline => discipline === value)) throw new Error('Invalid discipline.');
      patch[key] = value;
      if (key === 'Material') patch.material = value;
      if (key === 'FireRating') patch.fireRating = value;
      if (key === 'ThermalTransmittance' && item.type === 'Window') patch.uValue = value;
    }
  }
  const changes = readObject(geom, 'geometry');
  if (Object.keys(changes).length) {
    const updated = { ...(item as any).geom };
    for (const [key, value] of Object.entries(changes)) {
      if (!geometry[item.type]?.includes(key)) throw new Error(`Geometry ${key} is not editable for ${item.type}; use update_wall or update_opening for those elements.`);
      if (item.type === 'Stair') {
        // Validate the complete merged stair below, including enum and boolean fields.
      } else if (item.type === 'Section' && (key === 'origin' || key === 'normal')) {
        if (!Array.isArray(value) || value.length !== 3 || !value.every(n => typeof n === 'number' && Number.isFinite(n))) throw new Error(`${key} must contain three finite numbers.`);
      } else if (item.type === 'Roof' && key === 'roofType') {
        if (!ROOF_TYPES.includes(value as any)) throw new Error('Invalid roofType.');
      } else if (item.type === 'Roof' && key === 'ridgeSwap') {
        if (typeof value !== 'boolean') throw new Error('ridgeSwap must be boolean.');
      } else if (item.type === 'Roof' && key === 'edges') {
        if (!Array.isArray(value) || !value.every(e => e && typeof e.gable === 'boolean' && typeof e.pitch === 'number' && Number.isFinite(e.pitch) && e.pitch > 0 && e.pitch <= 80)) throw new Error('Invalid roof edges.');
      } else if (key === 'polygon') {
        if (!Array.isArray(value) || value.length < 3 || !value.every(p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && Number.isFinite(n)))) throw new Error('polygon must contain at least three finite [x,y] points.');
      } else if (typeof value !== 'number' || !Number.isFinite(value) || (positive.has(key) && value <= 0)) throw new Error(`Invalid geometry value for ${key}.`);
      updated[key] = item.type==='Stair' && (key==='count'||key==='opening'||key==='landingLength'||key==='flightLengths'||key==='landings'||key==='turnRadius') && value===null ? undefined : value;
    }
    if (item.type === 'Section') {
      const lineChanged = ['x1','y1','x2','y2'].some(key => key in changes);
      if (lineChanged && ('origin' in changes || 'normal' in changes)) throw new Error('Use either line coordinates or origin/normal, not both.');
      if (lineChanged) {
        if (Math.hypot(updated.x2 - updated.x1, updated.y2 - updated.y1) < 1e-6) throw new Error('Section endpoints must be different.');
        updated.origin = [updated.x1, updated.origin?.[1] ?? 0, -updated.y1];
        updated.normal = [updated.y2 - updated.y1, 0, updated.x2 - updated.x1];
      }
      const plane = sectionPlane(updated);
      if (!plane || !Number.isFinite(updated.depth ?? 10) || (updated.depth ?? 10) <= 0) throw new Error('Invalid section plane or depth.');
      if ('origin' in changes || 'normal' in changes) Object.assign(updated, sectionGeom(plane.origin, plane.normal, updated.depth ?? 10));
      else Object.assign(updated, { origin: plane.origin.toArray(), normal: plane.normal.toArray(), depth: updated.depth ?? 10 });
    }
    if (item.type === 'Stair') validateStair(updated,item.parentId);
    if (item.type === 'Roof') {
      if (updated.pitch < 0 || updated.pitch > 80 || updated.overhang < 0 || (updated.edges && updated.edges.length !== updated.polygon.length) || !buildRoof(updated)) throw new Error('Invalid roof geometry.');
      patch.PredefinedType = roofPredefinedType(updated.roofType);
    }
    patch.geom = markGeomEdit(updated, Object.keys(changes));
  }
  if (!Object.keys(patch).length) throw new Error('Provide at least one property or geometry change.');
  return patch;
}
