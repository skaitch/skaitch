import { computeGenericIfc } from './genericIfc.js';
import type { ItemsMap, IfcWallEntity, IfcDoorEntity, IfcWindowEntity, IfcSpaceEntity, IfcSlabEntity, IfcAnnotationEntity } from '../types/ifc.js';
import type { ElementDef } from '../data/elementCatalogue.js';
import { guid } from '../data/starter.js';
import { wallRoofProfile } from '../lib/wallRoof.js';
import { ROOF_DEFAULTS } from '../lib/roofGeometry.js';
import { STAIR_DEFAULTS, validateStair } from '../lib/stairGeometry.js';
import { connectedWallEndpoints, wallGeomWithEndpoint, type WallEnd } from '../lib/wallContinuity.js';
import { openingOrientation } from '../lib/openingOrientation.js';
import { furniturePlacement } from '../lib/furniturePlacement.js';
import { defaultName, storeyName, type DefaultNameKind } from '../lib/defaultNames.js';
import { buildElementPatch } from '../lib/mcpElementUpdate.js';
import { chimneyGeom, chimneyHeightThroughRoof, columnGeom, storeyHeight, type StructuralInput } from '../lib/structuralElements.js';
import type { McpModelChange, McpModelResponse } from '../types/bim.js';
import { PAPER_FORMATS, addSheetViewport, createSheet, isSheet, listSheets, sheetPaperSize, validateSheet, type Orientation, type PaperFormat, type SheetScale } from '../drawing/sheet.js';
import { sheetLayout, sheetLayoutIssues } from '../drawing/sheetSvg.js';
import { parsePixelSpace, planCalibrationFor, type PlanCalibration } from '../lib/planImage.js';
type IfcEntity = ItemsMap[string];
export function computeMcpModel(name: string, args: Record<string, unknown>, items: ItemsMap, focusStorey: string, catalogue: ElementDef[], lang: unknown = 'fr'): McpModelResponse {
  if (['create_ifc_element', 'update_ifc_element', 'delete_ifc_element'].includes(name)) return computeGenericIfc(name, args, items, focusStorey);
  const changes: McpModelChange[] = [];
  const newId = (prefix: string) => {
    const base = prefix + Date.now();
    let id = base;
    for (let suffix = 1; items[id]; suffix++) id = base + '_' + suffix;
    return id;
  };
  const nameOr = (kind: DefaultNameKind) => String(args.name ?? defaultName(kind, lang));
  const addItem = (item: IfcEntity) => { changes.push({ kind: 'add', item }); };
  const updateItem = (id: string, patch: Partial<IfcEntity>) => { changes.push({ kind: 'update', id, patch }); };
  const deleteItems = (ids: string[]) => { changes.push({ kind: 'delete', ids }); };
  const setFocusStorey = (id: string) => { changes.push({ kind: 'focus', id }); };
  const resolveId = (qid: string): IfcEntity | undefined => items[qid] ?? Object.values(items).find(i => i.GlobalId === qid);
  const attachWalls = (roof: IfcEntity) => {
    const attached: string[] = [];
    if (args.attach_walls !== true) return attached;
    const next = { ...items, [roof.id]: roof };
    const roofIds = Object.values(next).filter(item => item.type === 'Roof' && item.parentId === roof.parentId).map(item => item.id);
    for (const wall of Object.values(items)) {
      if (wall.type !== 'Wall' || wall.parentId !== roof.parentId) continue;
      const geom = { ...wall.geom, roofId: roof.id, roofIds, _edited: true, _shapeEdited: true };
      if (!wallRoofProfile({ ...wall, geom }, next)) continue;
      updateItem(wall.id, { geom });
      attached.push(wall.id);
    }
    return attached;
  };
  const run = () => {
    if (args.attach_walls !== undefined && typeof args.attach_walls !== 'boolean') return { error: 'attach_walls must be a boolean.' };
    try { parsePixelSpace(args.pixel_space); } catch (error) { return { error: (error as Error).message }; }
    const pixelToWorld = (u: number, v: number, plan: PlanCalibration): [number, number] => [
      plan.x + u * plan.scale,
      plan.y + (plan.h - v) * plan.scale,
    ];

    const maybeConvert = (pt: [number, number], plan: PlanCalibration | undefined): [number, number] =>
      plan ? pixelToWorld(pt[0], pt[1], plan) : pt;

    const maybeConvertPoly = (pts: [number, number][], plan: PlanCalibration | undefined): [number, number][] =>
      plan ? pts.map(p => pixelToWorld(p[0], p[1], plan)) : pts;

    // pixel_space "image": pixels measured on the downscaled copy attached by get_storey_floorplan.
    const getPlan = (args: Record<string, unknown>): PlanCalibration | undefined => {
      if (!args.coordinates_in_pixels) return undefined;
      const sid = String(args.storey_id ?? focusStorey);
      const plan = (items[sid] as any)?.geom?.plan as PlanCalibration | undefined;
      return plan ? planCalibrationFor(plan, parsePixelSpace(args.pixel_space)) : undefined;
    };

    const parseNum = (v: any, def: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : def;
    };

    const getPoint = (v: any): [number, number] => {
      if (!v) return [0, 0];
      if (Array.isArray(v)) return [parseNum(v[0], 0), parseNum(v[1], 0)];
      if (typeof v === 'string') {
        try {
          const p = JSON.parse(v);
          if (Array.isArray(p)) return [parseNum(p[0], 0), parseNum(p[1], 0)];
        } catch {}
        const p = v.split(',').map(s => Number(s.trim()));
        if (p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1])) return [p[0], p[1]];

        // Try to resolve as a Marker ID or name!
        const found = resolveId(v) || Object.values(items).find(i => i.type === 'Marker' && (i.Name === v || i.name === v));
        if (found && found.type === 'Marker' && (found as any).geom) {
          return [(found as any).geom.x, (found as any).geom.y];
        }
      }
      if (typeof v === 'object') {
        if ('x' in v && 'y' in v) return [parseNum(v.x, 0), parseNum(v.y, 0)];
        if ('0' in v && '1' in v) return [parseNum(v['0'], 0), parseNum(v['1'], 0)];
      }
      return [0, 0];
    };

    const getWallConnection = (v: any): { wall: IfcWallEntity; end: WallEnd; point: [number, number] } | null => {
      if (!v || typeof v !== 'object') return null;
      const wall = resolveId(String(v.wall_id ?? ''));
      const end = String(v.end ?? '').toLowerCase();
      if (!wall || wall.type !== 'Wall' || (end !== 'start' && end !== 'end')) return null;
      const geom = (wall as IfcWallEntity).geom;
      return { wall: wall as IfcWallEntity, end, point: end === 'start' ? [geom.x1, geom.y1] : [geom.x2, geom.y2] };
    };

    const updateHostedOpenings = (wallId: string, geom: IfcWallEntity['geom']) => {
      for (const opening of Object.values(items)) {
        if ((opening.type !== 'Door' && opening.type !== 'Window') || (opening as any).geom?.wallId !== wallId) continue;
        const g = (opening as any).geom;
        const t = Math.max(0.05, Math.min(0.95, Number(g.t ?? 0.5)));
        updateItem(opening.id, { geom: { ...g, t, _placementWorld: [geom.x1 + t * (geom.x2 - geom.x1), geom.y1 + t * (geom.y2 - geom.y1)], _edited: true } } as any);
      }
    };

    const moveWallJunction = (wallId: string, end: WallEnd, point: [number, number]) => {
      const wall = items[wallId] as IfcWallEntity | undefined;
      if (!wall || wall.type !== 'Wall') return [];
      const endpoints = connectedWallEndpoints(items, wallId, end);
      const targets = endpoints.length ? endpoints : [{ wallId, end, point, parentId: wall.parentId }];
      const updated: string[] = [];
      for (const endpoint of targets) {
        const target = items[endpoint.wallId] as IfcWallEntity | undefined;
        if (!target || target.type !== 'Wall') continue;
        const geom = { ...wallGeomWithEndpoint(target.geom, endpoint.end, point), _edited: true };
        updateItem(target.id, { geom } as any);
        updateHostedOpenings(target.id, geom);
        updated.push(target.id);
      }
      return updated;
    };

    const getPositionOnWall = (v: any, wall: IfcWallEntity): number => {
      if (v === undefined || v === null) return 0.5;
      const num = Number(v);
      if (Number.isFinite(num)) {
        return Math.max(0, Math.min(1, num));
      }
      if (typeof v === 'string') {
        const found = resolveId(v) || Object.values(items).find(i => i.type === 'Marker' && (i.Name === v || i.name === v));
        if (found && found.type === 'Marker' && (found as any).geom) {
          const mx = (found as any).geom.x;
          const my = (found as any).geom.y;
          const { x1, y1, x2, y2 } = wall.geom;
          const dx = x2 - x1;
          const dy = y2 - y1;
          const lenSq = dx * dx + dy * dy;
          if (lenSq === 0) return 0.5;
          const t = ((mx - x1) * dx + (my - y1) * dy) / lenSq;
          return Math.max(0, Math.min(1, t));
        }
      }
      return 0.5;
    };

    const getPoly = (v: any): [number, number][] => {
      if (typeof v === 'string') {
        try { v = JSON.parse(v); } catch {}
      }
      if (Array.isArray(v)) {
        if (v.length > 0 && typeof v[0] === 'number') {
           const res: [number, number][] = [];
           for(let i=0; i<v.length; i+=2) res.push([parseNum(v[i], 0), parseNum(v[i+1], 0)]);
           return res;
        }
        return v.map(getPoint);
      }
      return [];
    };

    switch (name) {
      case 'create_storey':
      case 'update_storey':
      case 'delete_storey': {
        const creating = name === 'create_storey';
        const found = resolveId(String(creating ? args.building_id : args.storey_id));
        if (!found || found.type !== (creating ? 'Building' : 'Storey')) {
          return { error: creating ? 'Building not found' : 'Storey not found' };
        }
        if (name === 'delete_storey') {
          const ids = new Set([found.id]);
          let count = 0;
          while (count !== ids.size) {
            count = ids.size;
            for (const item of Object.values(items)) {
              if (item.parentId && ids.has(item.parentId)) ids.add(item.id);
            }
          }
          if (ids.size > 1 && args.recursive !== true) return { error: 'Storey is not empty. Set recursive=true to delete its contents.' };
          deleteItems([...ids]);
          if (ids.has(focusStorey)) {
            const next = Object.values(items).find(i => i.type === 'Storey' && !ids.has(i.id));
            setFocusStorey(next?.id ?? '');
          }
          return { success: true, deleted_ids: [...ids] };
        }
        const siblings = Object.values(items).filter(i => i.type === 'Storey' && i.parentId === found.id);
        const current = creating ? { level: siblings.length, elevation: siblings.length * 3, thickness: 0.3 } : (found as any).geom;
        const geom = { ...current };
        for (const field of ['level', 'elevation', 'thickness']) {
          if (args[field] !== undefined) {
            if (typeof args[field] !== 'number' || !Number.isFinite(args[field]) || (field === 'thickness' && Number(args[field]) < 0)) return { error: `Invalid ${field}` };
            geom[field] = args[field];
          }
        }
        if (args.name !== undefined && (typeof args.name !== 'string' || !args.name.trim())) return { error: 'Name must be a nonempty string' };
        const label = args.name === undefined ? (creating ? storeyName(geom.level, lang) : found.name) : String(args.name).trim();
        if (creating) {
          const id = `lvl_${crypto.randomUUID()}`;
          addItem({ id, type: 'Storey', ifcType: 'IfcBuildingStorey', name: label, Name: label, GlobalId: guid(id), parentId: found.id, geom, grossArea: 0 } as any);
          return { success: true, storey_id: id, name: label, geometry: geom };
        }
        updateItem(found.id, { name: label, Name: label, geom } as any);
        return { success: true, storey_id: found.id, name: label, geometry: geom };
      }

      case 'get_wall_connections': {
        const found = resolveId(String(args.id));
        if (!found || found.type !== 'Wall') return { error: 'Wall not found: ' + String(args.id) };
        const serialize = (end: WallEnd) => connectedWallEndpoints(items, found.id, end)
          .filter((endpoint) => endpoint.wallId !== found.id)
          .map((endpoint) => ({ wall_id: endpoint.wallId, end: endpoint.end, point: endpoint.point }));
        return { wall_id: found.id, start: serialize('start'), end: serialize('end') };
      }

      case 'create_wall': {
        const startConnection = getWallConnection(args.start_connection);
        const endConnection = getWallConnection(args.end_connection);
        let [x1, y1] = startConnection?.point ?? getPoint(args.start_point);
        let [x2, y2] = endConnection?.point ?? getPoint(args.end_point);
        const plan = getPlan(args);
        if (!startConnection) [x1, y1] = maybeConvert([x1, y1], plan);
        if (!endConnection) [x2, y2] = maybeConvert([x2, y2], plan);
        if (Math.hypot(x2 - x1, y2 - y1) < 0.01) return { error: 'Wall start and end must be different.' };
        if (args.interior_side !== undefined && args.interior_side !== 'left' && args.interior_side !== 'right') return { error: 'interior_side must be left or right.' };
        const reversed = args.interior_side === 'right';
        if (reversed) { [x1, x2] = [x2, x1]; [y1, y2] = [y2, y1]; }
        const height = parseNum(args.height, 2.8);
        const thickness = parseNum(args.thickness, 0.2);
        const wId = newId('w_mcp_');
        const wall: IfcWallEntity = {
          id: wId, type: 'Wall', ifcType: 'IfcWall',
          name: nameOr('mcpWall'), Name: nameOr('mcpWall'), GlobalId: guid(wId),
          parentId: String(args.storey_id ?? startConnection?.wall.parentId ?? endConnection?.wall.parentId ?? focusStorey),
          PredefinedType: 'STANDARD', IsExternal: Boolean(args.is_external ?? false), LoadBearing: Boolean(args.load_bearing ?? false),
          FireRating: '', ThermalTransmittance: 0.4, Material: '', geom: { x1, y1, x2, y2, thickness, height },
          material: '', fireRating: '', loadBearing: Boolean(args.load_bearing ?? false), isExternal: Boolean(args.is_external ?? false),
        };
        if ((startConnection && startConnection.wall.parentId !== wall.parentId) || (endConnection && endConnection.wall.parentId !== wall.parentId)) {
          return { error: 'Connected walls must belong to the same storey.' };
        }
        addItem(wall);
        return { success: true, id: wId, global_id: wall.GlobalId, ifc_type: 'IfcWall', interior_side_of_input: reversed ? 'right' : 'left', start_point: [x1, y1], end_point: [x2, y2], connections: { start: (reversed ? endConnection : startConnection) ? { wall_id: (reversed ? endConnection : startConnection)!.wall.id, end: (reversed ? endConnection : startConnection)!.end } : null, end: (reversed ? startConnection : endConnection) ? { wall_id: (reversed ? startConnection : endConnection)!.wall.id, end: (reversed ? startConnection : endConnection)!.end } : null } };
      }

      case 'update_wall': {
        const found = resolveId(String(args.id));
        if (!found || found.type !== 'Wall') return { error: 'Wall not found: ' + String(args.id) };
        const cur = found as IfcWallEntity;
        const patch: Partial<IfcWallEntity> = {};
        if (args.name !== undefined) { patch.name = patch.Name = String(args.name); }
        if (args.is_external !== undefined) patch.IsExternal = patch.isExternal = Boolean(args.is_external);
        if (args.load_bearing !== undefined) patch.LoadBearing = patch.loadBearing = Boolean(args.load_bearing);
        const startConnection = getWallConnection(args.start_connection);
        const endConnection = getWallConnection(args.end_connection);
        const plan = getPlan(args);
        let [x1, y1] = startConnection?.point ?? (args.start_point !== undefined ? getPoint(args.start_point) : [cur.geom.x1, cur.geom.y1]);
        let [x2, y2] = endConnection?.point ?? (args.end_point !== undefined ? getPoint(args.end_point) : [cur.geom.x2, cur.geom.y2]);
        if (args.start_point !== undefined && !startConnection) [x1, y1] = maybeConvert([x1, y1], plan);
        if (args.end_point !== undefined && !endConnection) [x2, y2] = maybeConvert([x2, y2], plan);
        if (Math.hypot(x2 - x1, y2 - y1) < 0.01) return { error: 'Wall start and end must be different.' };
        const geom = { ...cur.geom, x1, y1, x2, y2, thickness: args.thickness !== undefined ? parseNum(args.thickness, cur.geom.thickness) : cur.geom.thickness, height: args.height !== undefined ? parseNum(args.height, cur.geom.height) : cur.geom.height, _edited: true };
        patch.geom = geom;
        const connectedWalls = new Set<string>();
        if (args.preserve_connections !== false && (args.start_point !== undefined || startConnection)) moveWallJunction(found.id, 'start', [x1, y1]).forEach(id => connectedWalls.add(id));
        if (args.preserve_connections !== false && (args.end_point !== undefined || endConnection)) moveWallJunction(found.id, 'end', [x2, y2]).forEach(id => connectedWalls.add(id));
        updateItem(found.id, patch);
        updateHostedOpenings(found.id, geom);
        return { success: true, id: found.id, connected_wall_ids: [...connectedWalls] };
      }

      case 'connect_walls': {
        const first = getWallConnection(args.first);
        const second = getWallConnection(args.second);
        if (!first || !second) return { error: 'Both first and second must reference a valid wall_id and end.' };
        if (first.wall.id === second.wall.id) return { error: 'Cannot connect a wall to itself.' };
        if (first.wall.parentId !== second.wall.parentId) return { error: 'Connected walls must belong to the same storey.' };
        const point: [number, number] = args.point !== undefined ? getPoint(args.point) : [(first.point[0] + second.point[0]) / 2, (first.point[1] + second.point[1]) / 2];
        const updated = new Set([...moveWallJunction(first.wall.id, first.end, point), ...moveWallJunction(second.wall.id, second.end, point)]);
        return { success: true, point, connected_wall_ids: [...updated] };
      }

      case 'create_door': {
        const def = args.catalogue_id === undefined ? undefined : catalogue.find(d => d.id === args.catalogue_id && d.type === 'Door');
        if (args.catalogue_id !== undefined && !def) return { error: 'Unknown door catalogue_id.' };
        if (args.swing !== undefined && args.swing !== 'left' && args.swing !== 'right') return { error: 'swing must be left or right.' };
        if (args.side !== undefined && args.side !== 1 && args.side !== -1) return { error: 'side must be 1 or -1.' };
        const wall = resolveId(String(args.wall_id));
        if (!wall || wall.type !== 'Wall') return { error: `Wall not found: ${args.wall_id}` };
        const dId   = newId('d_mcp_');
        const width  = (args.width  as number) ?? def?.defaults.width ?? 0.9;
        const height = (args.height as number) ?? def?.defaults.height ?? 2.1;
        let t      = getPositionOnWall(args.position, wall as IfcWallEntity);
        let opType = args.operation_type ? String(args.operation_type) : def?.defaults.OperationType ?? '';
        if (!opType) opType = 'SINGLE_SWING_LEFT';
        let orientation;
        try { orientation = openingOrientation(args, wall as IfcWallEntity, t, opType, items, { ...def?.defaults, width }); }
        catch (error) { return { error: (error as Error).message }; }
        t = orientation.t;
        const { swing, side, operation } = orientation;
        const door: IfcDoorEntity = {
          id: dId, type: 'Door', ifcType: 'IfcDoor',
          name: nameOr('mcpDoor'), Name: nameOr('mcpDoor'),
          GlobalId: guid(dId), parentId: wall.parentId,
          PredefinedType: 'DOOR', OperationType: operation as any,
          OverallHeight: height, OverallWidth: width,
          FireRating: '', Material: '',
          geom: { wallId: wall.id, t, width, height, swing: swing as 'left' | 'right', side, ...(def ? { catalogueId: def.id } : {}) },
          material: '', fireRating: '',
        };
        addItem(door);
        return { success: true, id: dId, global_id: door.GlobalId, ifc_type: 'IfcDoor', updated_geom: door.geom, operation_type: door.OperationType };
      }

      case 'create_window': {
        const def = args.catalogue_id === undefined ? undefined : catalogue.find(d => d.id === args.catalogue_id && d.type === 'Window');
        if (args.catalogue_id !== undefined && !def) return { error: 'Unknown window catalogue_id.' };
        if (args.swing !== undefined && args.swing !== 'left' && args.swing !== 'right') return { error: 'swing must be left or right.' };
        if (args.side !== undefined && args.side !== 1 && args.side !== -1) return { error: 'side must be 1 or -1.' };
        const wall = resolveId(String(args.wall_id));
        if (!wall || wall.type !== 'Wall') return { error: `Wall not found: ${args.wall_id}` };
        const wnId  = newId('wn_mcp_');
        const width  = (args.width       as number) ?? def?.defaults.width ?? 1.2;
        const height = (args.height      as number) ?? def?.defaults.height ?? 1.2;
        const sill   = (args.sill_height as number) ?? def?.defaults.sillHeight ?? 0.9;
        let t      = getPositionOnWall(args.position, wall as IfcWallEntity);
        let opType = args.operation_type ? String(args.operation_type) : def?.defaults.OperationType ?? '';
        if (!opType) {
          if (width >= 1.5) {
            opType = 'SLIDING_BAY';
          } else if (width >= 1.0) {
            opType = 'DOUBLE_PANEL';
          } else {
            opType = 'WINDOW_PANEL';
          }
        }
        let orientation;
        try { orientation = openingOrientation(args, wall as IfcWallEntity, t, opType, items, { ...def?.defaults, width }); }
        catch (error) { return { error: (error as Error).message }; }
        t = orientation.t;
        const win: IfcWindowEntity = {
          id: wnId, type: 'Window', ifcType: 'IfcWindow',
          name: nameOr('mcpWindow'), Name: nameOr('mcpWindow'),
          GlobalId: guid(wnId), parentId: wall.parentId,
          PredefinedType: 'WINDOW',
          OperationType: opType,
          OverallHeight: height, OverallWidth: width,
          ThermalTransmittance: 1.4, Material: '',
          geom: { wallId: wall.id, t, width, height, sillHeight: sill, swing: orientation.swing, side: orientation.side, ...(def ? { catalogueId: def.id } : {}) },
          ...(def?.defaults.isBayWindow ? { isBayWindow: true } : {}),
          material: '', uValue: 1.4,
        };
        addItem(win);
        return { success: true, id: wnId, global_id: win.GlobalId, ifc_type: 'IfcWindow' };
      }

      case 'create_section': {
        const parentId = String(args.storey_id ?? focusStorey);
        if (items[parentId]?.type !== 'Storey') return { error: 'Invalid storey_id.' };
        const raw = args.geometry;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'geometry must be an object.' };
        const geometry = raw as Record<string, unknown>;
        const hasLine = ['x1', 'y1', 'x2', 'y2'].every(key => key in geometry);
        if (!hasLine && !('origin' in geometry && 'normal' in geometry)) return { error: 'Provide x1,y1,x2,y2 or origin and normal.' };
        const id = 'sec_' + crypto.randomUUID(), name = nameOr('section');
        const section: IfcAnnotationEntity = { id, GlobalId: guid(id), type: 'Section', ifcType: 'IfcAnnotation', name, Name: name, parentId,
          geom: { x1: 0, y1: 0, x2: 1, y2: 0 } };
        try {
          const patch = buildElementPatch(section, undefined, geometry);
          addItem({ ...section, ...patch } as IfcAnnotationEntity);
          return { success: true, id, global_id: section.GlobalId, ifc_type: section.ifcType };
        } catch (error) { return { error: (error as Error).message }; }
      }

      case 'create_roof': {
        const parentId = String(args.storey_id ?? focusStorey);
        if (items[parentId]?.type !== 'Storey') return { error: 'Invalid storey_id.' };
        const id = 'rf_' + Math.random().toString(36).slice(2, 10), name = nameOr('roof');
        const roof = { id, GlobalId: guid(id), type: 'Roof', ifcType: 'IfcRoof', name, Name: name, parentId, geom: { ...ROOF_DEFAULTS } } as any;
        try {
          if (!args.geometry || typeof args.geometry !== 'object' || Array.isArray(args.geometry)) throw new Error('geometry must be an object.');
          const patch = buildElementPatch(roof, undefined, args.geometry);
          if (!patch.geom) throw new Error('Roof polygon is required.');
          const next = { ...roof, ...patch };
          addItem(next);
          const attached = attachWalls(next);
          return { success: true, id, global_id: roof.GlobalId, ifc_type: 'IfcRoof', ...(args.attach_walls === true ? { attached_wall_ids: attached } : {}) };
        } catch (error) { return { error: (error as Error).message }; }
      }
      case 'create_stair': {
        const parentId=String(args.storey_id ?? focusStorey);
        const raw=args.geometry;
        if(!raw||typeof raw!=='object'||Array.isArray(raw)) return {error:'geometry must be an object'};
        const geom={...STAIR_DEFAULTS,...raw};
        try {validateStair(geom,parentId,items);} catch(e) {return {error:(e as Error).message};}
        const id='st_'+Math.random().toString(36).slice(2,10),name=nameOr('stair');
        addItem({id,GlobalId:guid(id),type:'Stair',ifcType:'IfcStair',name,Name:name,parentId,geom});
        return {success:true,id,global_id:guid(id),ifc_type:'IfcStair'};
      }
      case 'update_element': {
        const found = resolveId(String(args.id));
        if (!found) return { error: `Element not found: ${args.id}` };
        if (args.attach_walls !== undefined && found.type !== 'Roof') return { error: 'attach_walls applies only to roofs.' };
        try {
          const patch = buildElementPatch(found, args.properties, args.geometry);
          if(found.type==='Stair' && patch.geom) validateStair(patch.geom as any,found.parentId,items,found.id);
          updateItem(found.id, patch as any);
          const attached = found.type === 'Roof' ? attachWalls({ ...found, ...patch } as IfcEntity) : [];
          return { success: true, id: found.id, global_id: found.GlobalId, ifc_type: found.ifcType, ...(args.attach_walls === true ? { attached_wall_ids: attached } : {}) };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      }

      case 'update_opening': {
        const found = resolveId(String(args.id));
        if (!found || (found.type !== 'Door' && found.type !== 'Window')) return { error: `Opening not found: ${args.id}` };
        if (args.swing !== undefined && args.swing !== 'left' && args.swing !== 'right') return { error: 'swing must be left or right.' };
        if (args.side !== undefined && args.side !== 1 && args.side !== -1) return { error: 'side must be 1 or -1.' };
        for (const key of ['width', 'height', 'sill_height', 'position']) {
          if (args[key] !== undefined && (typeof args[key] !== 'number' || !Number.isFinite(args[key]) || (key === 'position' ? (args[key] as number) < 0 || (args[key] as number) > 1 : key === 'sill_height' ? (args[key] as number) < 0 : (args[key] as number) <= 0))) return { error: `Invalid ${key}.` };
        }
        if (args.sill_height !== undefined && found.type !== 'Window') return { error: 'sill_height applies only to windows.' };
        const def = args.catalogue_id === undefined ? undefined : catalogue.find(d => d.id === args.catalogue_id && d.type === found.type);
        if (args.catalogue_id !== undefined && !def) return { error: 'Unknown opening catalogue_id.' };
        const geom: any = { ...found.geom };
        const patch: any = { geom };
        if (def) {
          geom.catalogueId = def.id;
          patch.OverallWidth = geom.width = def.defaults.width;
          patch.OverallHeight = geom.height = def.defaults.height;
          if (def.defaults.sillHeight !== undefined) geom.sillHeight = def.defaults.sillHeight;
          if (def.defaults.swing !== undefined) geom.swing = def.defaults.swing;
          if (found.type === 'Window') patch.isBayWindow = !!def.defaults.isBayWindow;
        }
        if (args.name !== undefined) patch.name = patch.Name = String(args.name);
        if (args.position !== undefined) geom.t = args.position;
        if (args.width !== undefined) patch.OverallWidth = geom.width = args.width;
        if (args.height !== undefined) patch.OverallHeight = geom.height = args.height;
        if (args.sill_height !== undefined) geom.sillHeight = args.sill_height;
        if (args.swing !== undefined) geom.swing = args.swing;
        if (args.side !== undefined) geom.side = args.side;
        let operation = args.operation_type !== undefined ? String(args.operation_type) : def?.defaults.OperationType ?? (found as any).OperationType;
        const wall = resolveId(String(geom.wallId));
        if (!wall || wall.type !== 'Wall') return { error: 'Host wall not found.' };
        try {
          const orientation = openingOrientation(args, wall as IfcWallEntity, geom.t, operation ?? '', items, geom);
          geom.t = orientation.t; geom.swing = orientation.swing; geom.side = orientation.side; geom._edited = true;
          patch.OperationType = orientation.operation;
        } catch (error) { return { error: (error as Error).message }; }
        updateItem(found.id, patch);
        return { success: true, id: found.id, global_id: found.GlobalId, ifc_type: found.ifcType, updated_geom: geom, operation_type: patch.OperationType };
      }

      case 'create_furniture':
      case 'update_furniture': {
        const current = name === 'update_furniture' ? resolveId(String(args.id)) : undefined;
        if (name === 'update_furniture' && current?.type !== 'Furniture') return { error: `Furniture not found: ${args.id}` };
        const storeyId = current?.parentId ?? String(args.storey_id ?? focusStorey);
        if (args.coordinates_in_pixels && !getPlan({ ...args, storey_id: storeyId })) return { error: 'Floorplan calibration not found for this storey. Call get_storey_floorplan first.' };
        try {
          const patch = furniturePlacement(args, items, storeyId, catalogue, current,
            p => maybeConvert(p, getPlan({ ...args, storey_id: storeyId })), lang);
          if (current) {
            updateItem(current.id, patch as any);
            return { success: true, id: current.id, global_id: current.GlobalId, updated_geom: patch.geom };
          }
          const id = `fur_mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const item = { ...patch, id, type: 'Furniture', ifcType: 'IfcFurnishingElement', GlobalId: guid(id), parentId: storeyId };
          addItem(item as any);
          return { success: true, id, global_id: item.GlobalId, ifc_type: item.ifcType, updated_geom: patch.geom };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      }

      case 'create_column':
      case 'update_column':
      case 'create_chimney':
      case 'update_chimney': {
        const isColumn = name.endsWith('_column');
        const type = isColumn ? 'Column' : 'Chimney';
        const current = name.startsWith('update_') ? resolveId(String(args.id)) : undefined;
        if (name.startsWith('update_') && current?.type !== type) return { error: `${type} not found: ${args.id}` };
        const storeyId = current?.parentId ?? String(args.storey_id ?? focusStorey);
        const input: StructuralInput = { ...args };
        const point = args.point ?? (args.x !== undefined && args.y !== undefined ? [args.x, args.y] : undefined);
        if (point !== undefined) {
          const plan = getPlan({ ...args, storey_id: storeyId });
          if (args.coordinates_in_pixels && !plan) return { error: 'Floorplan calibration not found for this storey. Call get_storey_floorplan first.' };
          [input.x, input.y] = maybeConvert(getPoint(point), plan);
        } else if (!current) return { error: 'point [x, y] is required.' };
        try {
          const patch: Record<string, unknown> = isColumn
            ? { geom: columnGeom(input, current?.type === 'Column' ? current.geom : undefined, storeyHeight(items, storeyId)) }
            : chimneyGeom(input, current?.type === 'Chimney' ? current : undefined, storeyHeight(items, storeyId));
          // Chimneys rise through the roof: new ones by default, updates when asked (through_roof: true).
          if (!isColumn && args.height === undefined && (current ? args.through_roof === true : args.through_roof !== false)) {
            const g = patch.geom as { x: number; y: number; h: number };
            const h = chimneyHeightThroughRoof(items, storeyId, g.x, g.y);
            if (h !== null && h > g.h) g.h = h;
          }
          (patch.geom as Record<string, unknown>)._edited = true;
          if (args.name !== undefined) patch.name = patch.Name = String(args.name);
          if (args.material !== undefined) patch.Material = String(args.material);
          if (current) {
            updateItem(current.id, patch as any);
            return { success: true, id: current.id, global_id: current.GlobalId, updated_geom: patch.geom };
          }
          // Non-numeric suffix: patchIFC treats a trailing numeric id segment as an original IFC line id.
          let id = `${isColumn ? 'col' : 'chm'}_mcp_${Date.now()}_n`;
          for (let k = 1; items[id]; k++) id = `${isColumn ? 'col' : 'chm'}_mcp_${Date.now()}_${k}n`;
          const label = String(args.name ?? defaultName(isColumn ? 'column' : 'chimney', lang));
          const item = { ...patch, id, type, ifcType: isColumn ? 'IfcColumn' : 'IfcChimney', name: label, Name: label, GlobalId: guid(id), parentId: storeyId };
          addItem(item as any);
          return { success: true, id, global_id: item.GlobalId, ifc_type: item.ifcType, updated_geom: patch.geom };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      }

      case 'create_space': {
        const spId = newId('rm_mcp_');
        const plan = getPlan(args);
        const polygon = maybeConvertPoly(getPoly(args.polygon), plan);
        const space: IfcSpaceEntity = {
          id: spId, type: 'Room', ifcType: 'IfcSpace',
          name: nameOr('mcpRoom'), Name: nameOr('mcpRoom'),
          GlobalId: guid(spId),
          parentId: String(args.storey_id ?? focusStorey),
          geom: {
            polygon,
            height:  parseNum(args.height, 2.5),
          },
          function: String(args.function ?? ''),
          occupancy: 0,
        };
        addItem(space);
        return { success: true, id: spId, global_id: space.GlobalId, ifc_type: 'IfcSpace' };
      }

      case 'create_slab': {
        const slId = newId('sl_mcp_');
        const plan = getPlan(args);
        const polygon = maybeConvertPoly(getPoly(args.polygon), plan);
        const slab: IfcSlabEntity = {
          id: slId, type: 'Slab', ifcType: 'IfcSlab',
          name: nameOr('mcpSlab'), Name: nameOr('mcpSlab'),
          GlobalId: guid(slId),
          parentId: String(args.storey_id ?? focusStorey),
          geom: {
            polygon,
            thickness: parseNum(args.thickness, 0.2),
          },
        };
        addItem(slab);
        return { success: true, id: slId, global_id: slab.GlobalId, ifc_type: 'IfcSlab' };
      }

      case 'create_dimension': {
        const dId = newId('dim_mcp_');
        const plan = getPlan(args);
        let [x1, y1] = getPoint(args.p1);
        let [x2, y2] = getPoint(args.p2);
        [x1, y1] = maybeConvert([x1, y1], plan);
        [x2, y2] = maybeConvert([x2, y2], plan);
        const dimension: IfcAnnotationEntity = {
          id: dId, type: 'Dimension', ifcType: 'IfcAnnotation',
          name: nameOr('mcpDimension'), Name: nameOr('mcpDimension'),
          GlobalId: guid(dId),
          parentId: String(args.storey_id ?? focusStorey),
          geom: { x1, y1, x2, y2 },
        };
        addItem(dimension);
        return { success: true, id: dId, global_id: dimension.GlobalId, ifc_type: 'IfcAnnotation' };
      }

      case 'create_marker': {
        let [x, y] = getPoint(args.point ?? [args.x, args.y]);
        const plan = getPlan(args);
        [x, y] = maybeConvert([x, y], plan);
        const mId = newId('m_mcp_');
        const marker = {
          id: mId, type: 'Marker', ifcType: 'IfcAnnotation',
          name: nameOr('mcpMarker'), Name: nameOr('mcpMarker'),
          GlobalId: guid(mId),
          parentId: String(args.storey_id ?? focusStorey),
          geom: { x, y },
          description: String(args.description ?? ''),
        };
        addItem(marker as any);
        return { success: true, id: mId, global_id: marker.GlobalId, ifc_type: 'IfcAnnotation' };
      }

      case 'create_technical': {
        let [x, y] = getPoint(args.point ?? [args.x, args.y]);
        const plan = getPlan(args);
        [x, y] = maybeConvert([x, y], plan);
        const tId = newId('tech_mcp_');
        const discipline = String(args.discipline ?? 'electrical');
        const category = String(args.category ?? 'AI');
        const model = String(args.model ?? 'generic');
        const name = String(args.name ?? `${discipline.toUpperCase()} Technical Element`);

        const techElement = {
          id: tId,
          type: 'Technical',
          ifcType: 'IfcDistributionElement',
          name, Name: name,
          GlobalId: guid(tId),
          parentId: String(args.storey_id ?? focusStorey),
          geom: {
            x, y,
            rotation: Number(args.rotation ?? 0),
            mountHeight: Number(args.mount_height ?? args.mountHeight ?? 0.5),
          },
          discipline,
          category,
          model,
          circuitRef: String(args.circuit_ref ?? args.circuitRef ?? ''),
          amperage: String(args.amperage ?? ''),
          fluidType: String(args.fluid_type ?? args.fluidType ?? ''),
          diameter: Number(args.diameter ?? 0),
          hvacType: String(args.hvac_type ?? args.hvacType ?? ''),
        };

        addItem(techElement as any);
        return { success: true, id: tId, global_id: techElement.GlobalId, ifc_type: 'IfcDistributionElement' };
      }

      case 'update_technical': {
        const found = resolveId(String(args.id));
        if (!found || found.type !== 'Technical') return { error: `Technical element not found: ${args.id}` };
        const cur = found as any;
        const patch: any = {};
        if (args.name !== undefined) { patch.name = patch.Name = String(args.name); }
        if (args.discipline !== undefined) patch.discipline = String(args.discipline);
        if (args.category !== undefined) patch.category = String(args.category);
        if (args.model !== undefined) patch.model = String(args.model);

        let x = cur.geom.x;
        let y = cur.geom.y;
        if (args.point !== undefined) {
          const pt = getPoint(args.point);
          const plan = getPlan(args);
          [x, y] = maybeConvert(pt, plan);
        } else if (args.x !== undefined && args.y !== undefined) {
          const pt = getPoint([args.x, args.y]);
          const plan = getPlan(args);
          [x, y] = maybeConvert(pt, plan);
        }

        patch.geom = {
          x, y,
          rotation: args.rotation !== undefined ? Number(args.rotation) : cur.geom.rotation,
          mountHeight: (args.mount_height !== undefined || args.mountHeight !== undefined)
            ? Number(args.mount_height ?? args.mountHeight)
            : cur.geom.mountHeight,
        };

        if (args.circuit_ref !== undefined || args.circuitRef !== undefined) patch.circuitRef = String(args.circuit_ref ?? args.circuitRef);
        if (args.amperage !== undefined) patch.amperage = String(args.amperage);
        if (args.fluid_type !== undefined || args.fluidType !== undefined) patch.fluidType = String(args.fluid_type ?? args.fluidType);
        if (args.diameter !== undefined) patch.diameter = Number(args.diameter);
        if (args.hvac_type !== undefined || args.hvacType !== undefined) patch.hvacType = String(args.hvac_type ?? args.hvacType);

        updateItem(found.id, patch);
        return { success: true, id: found.id };
      }

      // ── Sheets ─────────────────────────────────────────────────────────────
      case 'create_sheet': {
        const format = args.format as PaperFormat | undefined, orientation = args.orientation as Orientation | undefined;
        if (format !== undefined && !(format in PAPER_FORMATS)) return { error: 'format must be A4, A3, A2, A1 or A0.' };
        if (orientation !== undefined && orientation !== 'landscape' && orientation !== 'portrait') return { error: 'orientation must be landscape or portrait.' };
        const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
        const sheet = createSheet(items, { name: text(args.name), number: text(args.number), format, orientation,
          titleBlock: Object.fromEntries(Object.entries({ project: text(args.project), author: text(args.author), date: text(args.date), revision: text(args.revision) }).filter(([, v]) => v !== undefined)) });
        if (listSheets(items).some(s => s.geom.number === sheet.geom.number)) return { error: `Sheet number already used: ${sheet.geom.number}` };
        try { validateSheet(sheet, items); } catch (error) { return { error: (error as Error).message }; }
        addItem(sheet as unknown as IfcEntity);
        return { success: true, id: sheet.id, number: sheet.geom.number, paper_mm: sheetPaperSize(sheet.geom) };
      }

      case 'add_sheet_view': {
        const sheet = resolveId(String(args.sheet_id ?? ''));
        if (!isSheet(sheet)) return { error: 'Invalid sheet_id.' };
        const source = resolveId(String(args.source_id ?? ''));
        const kind = args.kind ?? (source?.type === 'Section' ? 'section' : 'plan');
        const crop = args.crop as { min?: unknown; max?: unknown } | undefined;
        const next = addSheetViewport(sheet, {
          kind: kind as 'plan' | 'section', sourceId: source?.id ?? String(args.source_id ?? ''), scale: Number(args.scale ?? 100) as SheetScale,
          ...(Array.isArray(args.position) ? { position: args.position as [number, number] } : {}),
          ...(crop ? { crop: crop as { min: [number, number]; max: [number, number] } } : {}),
          ...(typeof args.title === 'string' && args.title.trim() ? { title: args.title } : {}),
        });
        try { validateSheet(next, items); } catch (error) { return { error: (error as Error).message }; }
        updateItem(sheet.id, { geom: next.geom } as Partial<IfcEntity>);
        const frames = sheetLayout(items, next);
        const view = frames[frames.length - 1];
        return { success: true, sheet_id: sheet.id, view_id: next.geom.viewports[next.geom.viewports.length - 1].id,
          frame_mm: view && { x: Math.round(view.x * 10) / 10, y: Math.round(view.y * 10) / 10, width: Math.round(view.width * 10) / 10, height: Math.round(view.height * 10) / 10 },
          layout_issues: sheetLayoutIssues(next, frames) };
      }

      case 'update_sheet_view': {
        const sheet = resolveId(String(args.sheet_id ?? ''));
        if (!isSheet(sheet)) return { error: 'Invalid sheet_id.' };
        const current = sheet.geom.viewports.find(v => v.id === args.view_id);
        if (!current) return { error: `View not found on this sheet: ${args.view_id}` };
        let viewports = sheet.geom.viewports;
        if (args.remove === true) viewports = viewports.filter(v => v.id !== current.id);
        else {
          const view = { ...current };
          if (args.position !== undefined) view.position = args.position as [number, number];
          if (args.scale !== undefined) view.scale = Number(args.scale) as SheetScale;
          if (args.crop === null) delete view.crop; else if (args.crop !== undefined) view.crop = args.crop as { min: [number, number]; max: [number, number] };
          if (typeof args.title === 'string') { if (args.title.trim()) view.title = args.title; else delete view.title; }
          viewports = viewports.map(v => (v.id === view.id ? view : v));
        }
        const next = { ...sheet, geom: { ...sheet.geom, viewports } };
        try { validateSheet(next, items); } catch (error) { return { error: (error as Error).message }; }
        updateItem(sheet.id, { geom: next.geom } as Partial<IfcEntity>);
        const frames = sheetLayout(items, next);
        const frame = frames.find(f => f.viewport.id === current.id);
        return { success: true, sheet_id: sheet.id, view_id: current.id, removed: args.remove === true,
          ...(frame ? { frame_mm: { x: Math.round(frame.x * 10) / 10, y: Math.round(frame.y * 10) / 10, width: Math.round(frame.width * 10) / 10, height: Math.round(frame.height * 10) / 10 } } : {}),
          layout_issues: sheetLayoutIssues(next, frames) };
      }

      // ── Deletion ───────────────────────────────────────────────────────────
      case 'delete_element': {
        const ids = (args.ids as string[]).map((qid) => resolveId(qid)?.id).filter(Boolean) as string[];
        if (ids.length) deleteItems(ids);
        return { success: true, deleted_count: ids.length, ids };
      }

      default: throw new Error('Unsupported model tool');
    }
  };
  const result = run();
  return { result, changes: (result as any)?.error ? [] : changes };
}
