import type { ItemsMap, IfcEntity, IfcWallEntity, IfcDoorEntity, IfcWindowEntity, IfcSpaceEntity, IfcSlabEntity, IfcRoofEntity, IfcAnnotationEntity } from '../types/ifc.js';
import { STAIR_DEFAULTS, buildStair, validateStair } from '../lib/stairGeometry.js';
import { normalizeRoofGeom, roofPredefinedType } from '../lib/roofGeometry.js';
import { openingOrientation } from '../lib/openingOrientation.js';
import { guid } from '../data/starter.js';
import type { McpModelChange, McpModelResponse } from '../types/bim.js';
import { InputError } from './validation.js';
const DUP_TOL = 0.05; // 5cm tolerance for coordinate matching

function ptsEq(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < DUP_TOL && Math.abs(a[1] - b[1]) < DUP_TOL;
}

function wallMatches(g: any, x1: number, y1: number, x2: number, y2: number): boolean {
  return (ptsEq([g.x1, g.y1], [x1, y1]) && ptsEq([g.x2, g.y2], [x2, y2]))
      || (ptsEq([g.x1, g.y1], [x2, y2]) && ptsEq([g.x2, g.y2], [x1, y1]));
}

function polyMatches(existing: [number, number][], incoming: [number, number][]): boolean {
  if (existing.length !== incoming.length) return false;
  const n = existing.length;
  // Check all cyclic shifts in forward direction
  for (let shift = 0; shift < n; shift++) {
    let match = true;
    for (let i = 0; i < n; i++) {
      if (!ptsEq(existing[i], incoming[(i + shift) % n])) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  // Check all cyclic shifts in reversed direction
  for (let shift = 0; shift < n; shift++) {
    let match = true;
    for (let i = 0; i < n; i++) {
      const revIdx = (n - 1 - i + shift) % n;
      if (!ptsEq(existing[i], incoming[revIdx])) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

function findDuplicate(items: ItemsMap, focusStorey: string, type: string, geom: any): string | null {
  for (const it of Object.values(items)) {
    if (it.type !== type || it.parentId !== focusStorey) continue;
    const g = (it as any).geom;
    if (!g) continue;
    if (type === 'Wall' && geom.x1 != null && g.x1 != null && wallMatches(g, geom.x1, geom.y1, geom.x2, geom.y2)) return it.id;
    if ((type === 'Room' || type === 'Slab' || type === 'Roof') && geom.polygon && g.polygon && polyMatches(g.polygon, geom.polygon)) return it.id;
    if ((type === 'Door' || type === 'Window') && geom.wallId === g.wallId && g.wallId && Math.abs((geom.t ?? 0) - (g.t ?? 0)) < DUP_TOL) return it.id;
    if ((type === 'Furniture' || type === 'Technical' || type === 'Marker') && geom.x !== undefined && g.x !== undefined && ptsEq([geom.x, geom.y], [g.x, g.y])) return it.id;
    if (type === 'Dimension' && geom.x1 !== undefined && g.x1 !== undefined && wallMatches(g, geom.x1, geom.y1, geom.x2, geom.y2)) return it.id;
  }
  return null;
}

export function computeGenericIfc(name: string, args: Record<string, unknown>, items: ItemsMap, focusStorey: string): McpModelResponse {
  const changes: McpModelChange[] = [];
  const addItem = (item: IfcEntity) => { changes.push({ kind: 'add', item }); };
  const updateItem = (id: string, patch: Partial<IfcEntity>) => { changes.push({ kind: 'update', id, patch }); };
  const deleteItems = (ids: string[]) => { changes.push({ kind: 'delete', ids }); };
  const result = (() => {
  const resolveId = (qid: string): IfcEntity | undefined =>
    items[qid] ?? Object.values(items).find((i) => i.GlobalId === qid);

  const resolveWallId = (qid: unknown): string | null => {
    const wall = resolveId(String(qid));
    return wall?.type === 'Wall' ? wall.id : null;
  };

  const inferElementType = (ifcTypeRaw: unknown, typeRaw?: unknown): string => {
    const ifcType = String(ifcTypeRaw ?? '').toLowerCase();
    const type = String(typeRaw ?? '').toLowerCase();
    if (type === 'wall' || /^ifc(wall|curtainwall|wallstandardcase)/.test(ifcType)) return 'Wall';
    if (type === 'door' || ifcType === 'ifcdoor') return 'Door';
    if (type === 'window' || ifcType === 'ifcwindow') return 'Window';
    if (type === 'room' || type === 'space' || ifcType === 'ifcspace') return 'Room';
    if (type === 'slab' || ifcType === 'ifcslab') return 'Slab';
    if (type === 'stair' || ifcType === 'ifcstair') return 'Stair';
    if (type === 'roof' || ifcType === 'ifcroof') return 'Roof';
    if (type === 'dimension' || type === 'annotation' || ifcType === 'ifcannotation') return 'Dimension';
    if (type === 'furniture' || ifcType === 'ifcfurnishingelement') return 'Furniture';
    if (type === 'technical' || ifcType === 'ifcdistributionelement') return 'Technical';
    return typeRaw ? String(typeRaw) : 'IfcElement';
  };

  const createRenderableIfcElement = (raw: Record<string, unknown>): IfcEntity | { error: string } => {
    const renderType = inferElementType(raw.ifc_type ?? raw.ifcType, raw.type);

    const props = (raw.properties && typeof raw.properties === 'object' ? raw.properties : {}) as Record<string, unknown>;
    const geom = (raw.geom && typeof raw.geom === 'object' ? raw.geom : {}) as Record<string, unknown>;
    const baseId = String(raw.id ?? `${renderType.toLowerCase()}_ifc_${Date.now()}_${Math.floor(Math.random() * 1000)}`);
    const name = String(raw.name ?? raw.Name ?? props.Name ?? props.name ?? `${renderType} IA`);
    const parentId = String(raw.storey_id ?? raw.parentId ?? focusStorey);
    const base = {
      id: baseId,
      type: renderType,
      ifcType: String(raw.ifc_type ?? raw.ifcType ?? (
        renderType === 'Room' ? 'IfcSpace' :
        renderType === 'Dimension' ? 'IfcAnnotation' :
        renderType === 'Furniture' ? 'IfcFurnishingElement' :
        renderType === 'Technical' ? 'IfcDistributionElement' :
        renderType === 'IfcElement' ? String(raw.ifc_type ?? raw.ifcType ?? 'IfcBuildingElementProxy') : `Ifc${renderType}`
      )),
      name,
      Name: name,
      GlobalId: String(raw.global_id ?? raw.GlobalId ?? guid(baseId)),
      parentId,
      ...props,
    } as any;

    if (renderType === 'Wall') {
      const start = raw.start_point as number[] | undefined;
      const end = raw.end_point as number[] | undefined;
      const wallGeom = {
        x1: Number(geom.x1 ?? start?.[0] ?? 0),
        y1: Number(geom.y1 ?? start?.[1] ?? 0),
        x2: Number(geom.x2 ?? end?.[0] ?? 4),
        y2: Number(geom.y2 ?? end?.[1] ?? 0),
        thickness: Number(geom.thickness ?? raw.thickness ?? 0.2),
        height: Number(geom.height ?? raw.height ?? 2.8),
      };
      return { ...base, PredefinedType: base.PredefinedType ?? 'STANDARD', geom: wallGeom } as IfcWallEntity;
    }

    if (renderType === 'Door' || renderType === 'Window') {
      const wallId = resolveWallId(geom.wallId ?? raw.wall_id ?? raw.HostWall);
      if (!wallId) return { error: `${renderType} requires a valid host wall_id/geom.wallId for 2D synchronization` };
      const width = Number(geom.width ?? raw.width ?? (renderType === 'Door' ? 0.9 : 1.2));
      const height = Number(geom.height ?? raw.height ?? (renderType === 'Door' ? 2.1 : 1.2));
      if (renderType === 'Door') {
        let orientation;
        try { orientation = openingOrientation({ ...raw, ...geom, position: geom.t ?? raw.position }, items[wallId] as IfcWallEntity, Number(geom.t ?? raw.position ?? 0.5), String(raw.operation_type ?? base.OperationType ?? 'SINGLE_SWING_LEFT'), items); }
        catch (error) { return { error: (error as Error).message }; }
        return {
          ...base,
          ifcType: 'IfcDoor',
          PredefinedType: 'DOOR',
          OperationType: orientation.operation as IfcDoorEntity['OperationType'],
          OverallHeight: height,
          OverallWidth: width,
          FireRating: String(base.FireRating ?? ''),
          Material: String(base.Material ?? ''),
          geom: { wallId, t: orientation.t, width, height, swing: orientation.swing, side: orientation.side },
          material: String(base.material ?? ''),
          fireRating: String(base.fireRating ?? ''),
        } as IfcDoorEntity;
      }
      return {
        ...base,
        ifcType: 'IfcWindow',
        PredefinedType: 'WINDOW',
        OverallHeight: height,
        OverallWidth: width,
        ThermalTransmittance: Number(base.ThermalTransmittance ?? 1.4),
        Material: String(base.Material ?? ''),
        geom: { wallId, t: Number(geom.t ?? raw.position ?? 0.5), width, height, sillHeight: Number(geom.sillHeight ?? raw.sill_height ?? 0.9) },
        material: String(base.material ?? ''),
        uValue: Number(base.uValue ?? 1.4),
      } as IfcWindowEntity;
    }

    if (renderType === 'Room') {
      const polygon = (geom.polygon ?? raw.polygon) as [number, number][] | undefined;
      if (!Array.isArray(polygon) || polygon.length < 3) return { error: 'IfcSpace/Room requires geom.polygon with at least 3 [x,y] points' };
      return { ...base, ifcType: 'IfcSpace', geom: { polygon, height: Number(geom.height ?? raw.height ?? 2.5) }, function: String(base.function ?? ''), occupancy: Number(base.occupancy ?? 0) } as IfcSpaceEntity;
    }

    if (renderType === 'Slab') {
      const polygon = (geom.polygon ?? raw.polygon) as [number, number][] | undefined;
      if (!Array.isArray(polygon) || polygon.length < 3) return { error: 'IfcSlab requires geom.polygon with at least 3 [x,y] points' };
      return { ...base, ifcType: 'IfcSlab', geom: { polygon, thickness: Number(geom.thickness ?? raw.thickness ?? 0.2) } } as IfcSlabEntity;
    }

    if (renderType === 'Stair') {
      const stair = { ...STAIR_DEFAULTS, ...geom };
      try { validateStair(stair,base.parentId,items); } catch(e) { return { error: (e as Error).message }; }
      const result = buildStair(stair, base.parentId, items);
      if (!result.parts.length) return { error: result.warnings.join(' ') };
      return { ...base, ifcType: 'IfcStair', geom: stair } as any;
    }
    if (renderType === 'Roof') {
      const polygon = (geom.polygon ?? raw.polygon) as [number, number][] | undefined;
      if (!Array.isArray(polygon) || polygon.length < 3) return { error: 'IfcRoof requires geom.polygon with at least 3 [x,y] points' };
      const roofGeom = normalizeRoofGeom({ ...geom, polygon });
      const predef = roofPredefinedType(roofGeom.roofType) as IfcRoofEntity['PredefinedType'];
      return { ...base, ifcType: 'IfcRoof', PredefinedType: predef, geom: roofGeom } as IfcRoofEntity;
    }

    if (renderType === 'Dimension') {
      const p1 = raw.p1 as number[] | undefined;
      const p2 = raw.p2 as number[] | undefined;
      return {
        ...base,
        ifcType: 'IfcAnnotation',
        geom: {
          x1: Number(geom.x1 ?? p1?.[0] ?? 0),
          y1: Number(geom.y1 ?? p1?.[1] ?? 0),
          x2: Number(geom.x2 ?? p2?.[0] ?? 1),
          y2: Number(geom.y2 ?? p2?.[1] ?? 0),
        },
      } as IfcAnnotationEntity;
    }

    if (renderType === 'Furniture') return {
      ...base,
      ifcType: 'IfcFurnishingElement',
      geom: {
        x: Number(geom.x ?? raw.x ?? 0),
        y: Number(geom.y ?? raw.y ?? 0),
        w: Number(geom.w ?? raw.w ?? 1),
        d: Number(geom.d ?? raw.d ?? 1),
        h: Number(geom.h ?? raw.h ?? 0.8),
        rotation: Number(geom.rotation ?? raw.rotation ?? 0),
      },
      category: String(base.category ?? 'AI'),
      model: String(base.model ?? 'generic'),
    } as IfcEntity;

    if (renderType === 'Technical') return {
      ...base,
      ifcType: 'IfcDistributionElement',
      geom: {
        x: Number(geom.x ?? raw.x ?? 0),
        y: Number(geom.y ?? raw.y ?? 0),
        rotation: Number(geom.rotation ?? raw.rotation ?? 0),
        mountHeight: Number(geom.mountHeight ?? raw.mountHeight ?? raw.mount_height ?? 0.5),
      },
      discipline: String(base.discipline ?? raw.discipline ?? 'electrical'),
      category: String(base.category ?? raw.category ?? 'AI'),
      model: String(base.model ?? raw.model ?? 'generic'),
      circuitRef: String(base.circuitRef ?? raw.circuitRef ?? raw.circuit_ref ?? ''),
      amperage: String(base.amperage ?? raw.amperage ?? ''),
      fluidType: String(base.fluidType ?? raw.fluidType ?? raw.fluid_type ?? ''),
      diameter: Number(base.diameter ?? raw.diameter ?? 0),
      hvacType: String(base.hvacType ?? raw.hvacType ?? raw.hvac_type ?? ''),
    } as any;

    return {
      ...base,
      type: renderType,
      ifcType: String(raw.ifc_type ?? raw.ifcType ?? 'IfcBuildingElementProxy'),
      geom,
      rawIfc: raw.rawIfc,
      isGenericIfcElement: true,
    } as any;
  };


  switch (name) {
    case 'create_ifc_element': {
      const created = createRenderableIfcElement(args);
      if ('error' in created) return created;
      // Duplicate check for elements
      const dup = findDuplicate(items, String(created.parentId), created.type, (created as any).geom);
      if (dup) return { success: true, id: dup, duplicate: true, message: `${created.type} already exists` };
      if (items[created.id]) throw new InputError('Identifiant déjà utilisé.');
      if (items[created.parentId]?.type !== 'Storey') throw new InputError('Étage introuvable.');
      addItem(created);
      return {
        success: true,
        id: created.id,
        global_id: created.GlobalId,
        ifc_type: created.ifcType,
        type: created.type,
        synced_2d: true,
      };
    }

    case 'update_ifc_element': {
      const found = resolveId(String(args.id));
      if (!found) return { error: `Element not found: ${args.id}` };
      if (found.type === 'Project' || found.type === 'Building' || found.type === 'Storey' || found.type === '_Rel') {
        return { error: `${found.type} updates are not supported by update_ifc_element` };
      }
      const patch = {
        ...((args.properties && typeof args.properties === 'object') ? args.properties as Record<string, unknown> : {}),
      } as any;
      if (args.name !== undefined || args.Name !== undefined) {
        patch.name = patch.Name = String(args.name ?? args.Name);
      }
      if (args.geom && typeof args.geom === 'object') patch.geom = { ...(found as any).geom, ...(args.geom as Record<string, unknown>) };
      if ((found.type === 'Door' || found.type === 'Window') && patch.geom?.wallId) {
        const wallId = resolveWallId(patch.geom.wallId);
        if (!wallId) return { error: `${found.type} update requires a valid geom.wallId` };
        patch.geom.wallId = wallId;
      }
      if(found.type==='Stair') {
        try { validateStair(patch.geom ?? found.geom,found.parentId,items,found.id); } catch(e) { return {error:(e as Error).message}; }
      }
      for (const key of ['id', 'type', 'ifcType', 'GlobalId', 'parentId']) if (key in patch && patch[key] !== (found as any)[key]) throw new InputError('Identité IFC non modifiable.');
      updateItem(found.id, patch);
      return { success: true, id: found.id, ifc_type: found.ifcType, type: found.type, synced_2d: true };
    }

    case 'delete_ifc_element': {
      const ids = (args.ids as string[] ?? [String(args.id)])
        .map((qid) => resolveId(String(qid))?.id)
        .filter((id) => id && !['Project','Building','Storey','_Rel'].includes(items[id].type)) as string[];
      if (ids.length) deleteItems(ids);
      return { success: true, deleted_count: ids.length, ids, synced_2d: true };
    }

    default: return { error: `Unknown IFC tool: ${name}` };
  }
  })();
  return { result, changes: (result as any)?.error ? [] : changes };
}
