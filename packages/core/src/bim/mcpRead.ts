import { vectorGeometryForMcp } from '../cad/vectorPlan.js';
import type { ItemsMap } from '../types/ifc.js';
import type { ElementDef } from '../data/elementCatalogue.js';
import { GENERATION_GUIDE } from '../lib/generationGuide.js';
import { bbox } from '../data/query.js';
import { exportIFC } from './exportIFC.js';
import { elementForAi, getSurveyForAi, getSurveyPhotoForAi } from '../survey/aiRead.js';
import { isSheet, listSheets } from '../drawing/sheet.js';
import { renderSheetSvg, sheetLayout, sheetLayoutIssues } from '../drawing/sheetSvg.js';

export function readMcpModel(name: string, args: Record<string, unknown>, items: ItemsMap, catalogue: ElementDef[]) {
  const resolveId = (id: string) => items[id] ?? Object.values(items).find(i => i.GlobalId === id);
  switch (name) {
      case 'list_object_types': {
        return catalogue.filter(def => def.type === 'Furniture');
      }

      case 'list_opening_types': {
        return catalogue.filter(def => (def.type === 'Door' || def.type === 'Window') && (!args.type || def.type === args.type));
      }

      case 'list_spatial_structure': {
        const project = Object.values(items).find(i => i.type === 'Project');
        const buildings = Object.values(items).filter(i => i.type === 'Building');
        const storeys = Object.values(items).filter(i => i.type === 'Storey');
        return {
          project: project ? {
            id: project.id,
            name: project.name || (project as any).Name,
            siteAddress: (project as any).siteAddress || '',
            latitude: (project as any).lat || null,
            longitude: (project as any).lon || null,
            siteElevation: (project as any).siteElevation || null,
          } : null,
          buildings: buildings.map(b => ({
            id: b.id,
            name: b.name || (b as any).Name,
            address: (b as any).address || '',
            grossArea: (b as any).grossArea || 0,
          })),
          storeys: storeys.map(s => ({
            id: s.id,
            name: s.name || (s as any).Name,
            buildingId: s.parentId,
            level: (s as any).geom?.level ?? 0,
            elevation: (s as any).geom?.elevation ?? 0,
            hasPlan: !!(s as any).geom?.plan?.url,
            hasSurvey: !!(s as any).survey,
          })),
        };
      }

      case 'get_storey_floorplan': {
        const { storey_id } = args as { storey_id: string };
        const storey = items[storey_id] as any;
        if (!storey || storey.type !== 'Storey') {
          return { error: `Storey not found: ${storey_id}` };
        }
        const plan = storey.geom?.plan;
        if (!plan || !plan.url) {
          return {
            storey_id,
            name: storey.name || storey.Name,
            hasPlan: false,
            catalogue: catalogue,
            calibration_help: { generation_guidance: GENERATION_GUIDE },
            message: "No floorplan image has been uploaded or calibrated for this storey."
          };
        }
        return {
          storey_id,
          name: storey.name || storey.Name,
          hasPlan: true,
          catalogue: catalogue,
          plan: {
            ...(plan.kind === 'vector' && plan.vector ? {
              kind: 'vector',
              vector_hint: 'The image is a raster preview of a DXF plan. Call get_background_geometry for exact coordinates in world metres.',
              layers: plan.vector.layers.map((l: any) => ({ name: l.name, visible: l.visible })),
            } : {}),
            url: plan.url,
            w: plan.w,
            h: plan.h,
            scale: plan.scale,
            x: plan.x,
            y: plan.y,
            rotation: plan.rotation || 0,
          },
          markers: Object.values(items)
            .filter(i => i.type === 'Marker' && i.parentId === storey_id)
            .map(m => ({ name: m.Name || m.name, description: m.description || '', x: (m as any).geom.x, y: (m as any).geom.y })),
          calibration_help: {
            formula_pixel_to_world: "x_world = plan.x + u * plan.scale\ny_world = plan.y + (plan.h - v) * plan.scale",
            formula_world_to_pixel: "u = (x_world - plan.x) / plan.scale\nv = plan.h - (y_world - plan.y) / plan.scale",
            coordinate_systems: {
              pixel: "Origin (0,0) is at the top-left corner of the image. u goes right, v goes down.",
              world: "Origin (0,0) is in meters. x goes right, y goes up. The bottom-left corner of the image is at world coordinates (plan.x, plan.y) meters."
            },
            generation_guidance: GENERATION_GUIDE
          }
        };
      }

      case 'get_background_geometry': {
        const { storey_id, layers, bbox, max_points } = args as { storey_id: string; layers?: string[]; bbox?: number[]; max_points?: number };
        const storey = items[storey_id] as any;
        if (!storey || storey.type !== 'Storey') return { error: `Storey not found: ${storey_id}` };
        const plan = storey.geom?.plan;
        if (plan?.kind !== 'vector' || !plan.vector) return { error: 'This storey has no vector background plan; use get_storey_floorplan for image plans.' };
        return { storey_id, ...vectorGeometryForMcp(plan, plan.vector, { layers, bbox, maxPoints: max_points }) };
      }

      case 'get_ifc_scene_overview': {
        const byType: Record<string, number> = {};
        const elements = Object.values(items).map((i) => {
          byType[i.type] = (byType[i.type] ?? 0) + 1;
          return { id: i.id, globalId: i.GlobalId, ifcType: i.ifcType, name: i.Name || i.name, parentId: i.parentId };
        });
        return { total_elements: elements.length, by_type: byType, elements, catalogue: catalogue, generation_guidance: GENERATION_GUIDE };
      }

      case 'list_ifc_entities': {
        const { ifc_type, storey_id } = args as { ifc_type?: string; storey_id?: string };
        let list = Object.values(items);
        if (ifc_type) {
          const t = ifc_type.toLowerCase();
          list = list.filter((i) => i.ifcType.toLowerCase() === t);
        }
        if (storey_id) list = list.filter((i) => i.parentId === storey_id || i.id === storey_id);
        return list.map((i) => ({ id: i.id, globalId: i.GlobalId, ifcType: i.ifcType, name: i.Name || i.name, parentId: i.parentId }));
      }

      case 'get_element_properties': {
        const found = resolveId(String(args.id));
        return found ? elementForAi(items, found) : { error: `Element not found: ${args.id}` };
      }

      case 'get_survey': return getSurveyForAi(items, String(args.storey_id));
      case 'get_survey_photo': return getSurveyPhotoForAi(items, String(args.photo_id));

      case 'export_ifc': {
        const ifc = exportIFC(items);
        return { success: true, size_bytes: ifc.length, content: ifc };
      }

      case 'export_sheet': {
        if (!args.sheet_id) return { sheets: listSheets(items).map(s => ({ id: s.id, number: s.geom.number, name: s.name, format: s.geom.format, orientation: s.geom.orientation, views: s.geom.viewports.length })) };
        const sheet = resolveId(String(args.sheet_id));
        if (!isSheet(sheet)) return { error: `Sheet not found: ${args.sheet_id}` };
        const frames = sheetLayout(items, sheet);
        const svg = renderSheetSvg(items, sheet);
        return {
          id: sheet.id, number: sheet.geom.number, name: sheet.name, format: sheet.geom.format, orientation: sheet.geom.orientation,
          views: frames.map(f => ({ id: f.viewport.id, kind: f.viewport.kind, source_id: f.viewport.sourceId, title: f.title, scale: `1/${f.viewport.scale}`,
            frame_mm: { x: Math.round(f.x * 10) / 10, y: Math.round(f.y * 10) / 10, width: Math.round(f.width * 10) / 10, height: Math.round(f.height * 10) / 10 } })),
          layout_issues: sheetLayoutIssues(sheet, frames),
          size_bytes: svg.length, content: svg,
        };
      }

      case 'measure_distance': {
        const { from, to } = args as { from: any; to: any };
        const getPos = (val: any): [number, number] | null => {
          if (Array.isArray(val)) return val as [number, number];
          if (typeof val === 'string') {
            try {
              const parsed = JSON.parse(val);
              if (Array.isArray(parsed)) return parsed as [number, number];
            } catch {}
            const parts = val.split(',').map(Number);
            if (parts.length >= 2 && !parts.some(isNaN)) return parts.slice(0, 2) as [number, number];

            const found = resolveId(val);
            if (!found) return null;
            if (found.type === 'Wall') {
              const g = (found as any).geom;
              return [(g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2];
            }
            if (found.type === 'Furniture') {
              const g = (found as any).geom;
              return [g.x + g.w / 2, g.y + g.d / 2];
            }
            if (found.type === 'Room') {
              const g = (found as any).geom;
              const bb = bbox(g.polygon);
              return [(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2];
            }
            if (found.type === 'Door' || found.type === 'Window') {
              const g = (found as any).geom;
              const w = items[g.wallId];
              if (!w) return null;
              const dx = (w as any).geom.x2 - (w as any).geom.x1;
              const dy = (w as any).geom.y2 - (w as any).geom.y1;
              return [(w as any).geom.x1 + dx * g.t, (w as any).geom.y1 + dy * g.t];
            }
          }
          return null;
        };
        const p1 = getPos(from);
        const p2 = getPos(to);
        if (!p1 || !p2) return { error: 'Invalid points or IDs' };
        const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        return { distance_m: d, p1, p2 };
      }

    default: throw new Error('Unsupported model query');
  }
}
