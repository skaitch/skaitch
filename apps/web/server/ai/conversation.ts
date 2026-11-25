import type { ItemsMap, ViewState2D } from '@skaitch/core/types/ifc';
import type { ConversationContext, ToolUse, AiMessage, AiResult, ConversationResult } from '../../src/types/ai.js';
import { makeT, LANGUAGES, resolveLanguage } from '@skaitch/core/data/i18n';
import { GENERATION_GUIDE } from '@skaitch/core/lib/generationGuide';
import { parsePixelSpace, planCalibrationFor, type PlanCalibration } from '@skaitch/core/lib/planImage';
import { CHAT_TOOL_HINTS, TOOL_HINTS } from '../../src/lib/aiTools.js';
import { InputError, record, validateItems } from '@skaitch/core/bim/validation';
export function conversationContext(value: unknown): ConversationContext {
  const data = record(value);
  validateItems(data.items);
  for (const key of ['focusStorey','lang','finalTxt']) if (typeof data[key] !== 'string') throw new InputError('Contexte de conversation invalide.');
  if (!Array.isArray(data.selection) || data.selection.length > 20000 || data.selection.some((id: unknown) => typeof id !== 'string')) throw new InputError('Sélection invalide.');
  if (data.view2d != null && (typeof data.view2d !== 'object' || !['ox','oy','scale'].every(key => typeof data.view2d[key] === 'number') || data.view2d.scale <= 0)) throw new InputError('Vue invalide.');
  return data as ConversationContext;
}
const PLAN_INTERPRETATION_GUIDE = {
  Wall: {
    ifc: 'IfcWall',
    cues: 'thick continuous strokes, structural/partition boundaries, exterior envelope, room separation lines',
    tool: 'create_wall/update_wall with start_point/end_point on the wall centerline and thickness from the drawn wall width. Measure wall thickness by the perpendicular width of the wall graphic in pixels × scale_m_per_image_px. Walls with diagonal/zigzag hatching contain insulation — include full thickness and note insulation in name.',
  },
  Door: {
    ifc: 'IfcDoor',
    cues: 'opening in a wall with swing arc, hinged leaf, or door gap',
    tool: 'create_door on the host wall; position is normalized from wall start to end between 0 and 1. Always set name to a descriptive label (e.g. "Porte entrée principale", "Porte chambre 1", "Porte service") to enable validation.',
  },
  Window: {
    ifc: 'IfcWindow',
    cues: 'thin segments embedded in an exterior/interior wall, double line in wall, bay/window symbol without swing arc',
    tool: 'create_window on the host wall; use sill_height when visible or default to 0.9 m. Always set name to a descriptive label (e.g. "Fenêtre façade Nord", "Baie vitrée salon", "Fenêtre chambre 2") to enable validation.',
  },
  Room: {
    ifc: 'IfcSpace',
    cues: 'closed usable area bounded by walls, often labelled by room name or area',
    tool: 'create_space with a closed polygon inside the bounding wall centerlines; do not use room polygons for slabs',
  },
  Slab: {
    ifc: 'IfcSlab',
    cues: 'floor plate / dalle contour, terrace/balcony plate, overall storey footprint, structural floor boundary',
    tool: 'create_slab with the slab/floor contour polygon; do not create one slab per room unless requested',
  },
  Roof: {
    ifc: 'IfcRoof',
    cues: 'roof outline / toiture, ridge (faîtage) and hip lines, roof plan',
    tool: 'create_ifc_element with ifc_type IfcRoof and geom {polygon, roofType: flat|shed|gable|hip|custom, pitch (deg), elevation (eave height above storey, default top of walls), overhang, thickness}. Any footprint works (L, T, U): ridges, hips and valleys are computed automatically. For per-edge control use roofType custom with edges: [{gable: boolean, pitch: deg}] — one entry per polygon edge i (polygon[i]→polygon[i+1]); gable=true makes that side a vertical gable end',
  },
  Dimension: {
    ifc: 'IfcAnnotation',
    cues: 'dimension lines, ticks, arrows, numeric distances',
    tool: 'create_dimension or measure_distance; do not model dimension lines as walls. IMPORTANT: You MUST place dimensions exactly at the same geometric location (x1, y1) and (x2, y2) on the plan drawing as they are drawn in the plan image sheet. Ensure they match the actual drawn coordinates of the dimension lines in the floor plan.',
  },
  Marker: {
    ifc: 'IfcAnnotation',
    cues: 'architectural corners, structural columns, wall junctions, grid intersection points',
    tool: 'create_marker to place absolute coordinate markers/jalons on actual physical building corners (e.g. wall-to-wall intersections) and door/window corners. NEVER place markers at the empty four corners of the image file/sheet boundaries. Focus strictly on placing them at high-precision building structural vertices.',
  },
};

export function parseIntent(txt: string, items: ItemsMap, focusStorey: string, lang: string, selection: string[] = []): { name: string; args: Record<string, unknown> } | null {
  const low = txt.toLowerCase();

  if (/(combien|how many|count|nombre|total|overview|résumé|summary)/.test(low)) {
    if (/mur|wall/.test(low))    return { name: 'list_ifc_entities', args: { ifc_type: 'IfcWall' } };
    if (/porte|door/.test(low))  return { name: 'list_ifc_entities', args: { ifc_type: 'IfcDoor' } };
    if (/fenê|window/.test(low)) return { name: 'list_ifc_entities', args: { ifc_type: 'IfcWindow' } };
    if (/pièce|room|space/.test(low)) return { name: 'list_ifc_entities', args: { ifc_type: 'IfcSpace' } };
    if (/dalle|slab|plancher/.test(low)) return { name: 'list_ifc_entities', args: { ifc_type: 'IfcSlab' } };
    return { name: 'get_ifc_scene_overview', args: {} };
  }

  if (/(image|plan|voir|montre|show|analyse|analyze)/.test(low) && /(plan|étage|etage|floor|storey)/.test(low)) {
    return { name: 'get_storey_plan_image', args: {} };
  }

  if (/export|télécharger|download/.test(low)) {
    return { name: 'export_ifc', args: {} };
  }

  if (/(mesure|distance|longueur|measure|dist|length)/.test(low)) {
    if (selection.length === 2) {
      return { name: 'measure_distance', args: { from: selection[0], to: selection[1] } };
    }
  }

  return null;
}

function sanitizeForLlm(val: any, depth = 0): any {
  if (depth > 5) return '(omitted: depth limit)';
  if (typeof val === 'string') {
    if (val.startsWith('data:') || val.length > 500) {
      return `(omitted: ${val.length} chars)`;
    }
    return val;
  }
  if (!val || typeof val !== 'object') return val;
  if (Array.isArray(val)) {
    if (val.length > 100) return `(omitted: array of ${val.length} items)`;
    return val.map(v => sanitizeForLlm(v, depth + 1));
  }
  const next: any = {};
  for (const k in val) {
    next[k] = sanitizeForLlm(val[k], depth + 1);
  }
  return next;
}

const TOOL_NAMES = new Set(TOOL_HINTS.map(h => h.name));
const BIM_TOOL_NAMES = new Set(TOOL_HINTS.filter(tool => !CHAT_TOOL_HINTS.includes(tool)).map(tool => tool.name));

function normalizeToolCall(raw: any, idx = 0): ToolUse | null {
  if (!raw || typeof raw !== 'object') return null;
  const name = raw.name || raw.tool || raw.function?.name;
  if (!name || !TOOL_NAMES.has(String(name))) return null;
  const input = raw.input || raw.args || raw.arguments || raw.function?.arguments || {};
  let parsedInput = input;
  if (typeof parsedInput === 'string') {
    try { parsedInput = JSON.parse(parsedInput); } catch { parsedInput = {}; }
  }
  if (!parsedInput || typeof parsedInput !== 'object' || Array.isArray(parsedInput)) parsedInput = {};
  return { id: String(raw.id || `${name}_${idx}`), name: String(name), input: parsedInput as Record<string, unknown> };
}

export function extractToolUsesFromText(text: string): ToolUse[] {
  const candidates: string[] = [];
  const fenced = text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
  for (const match of fenced) candidates.push(match[1].trim());
  candidates.push(text.trim());

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      const calls = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.tool_calls)
          ? parsed.tool_calls
          : Array.isArray(parsed.tools)
            ? parsed.tools
            : [parsed];
      const normalized = calls
        .map((call: any, idx: number) => normalizeToolCall(call, idx))
        .filter(Boolean) as ToolUse[];
      if (normalized.length) return normalized;
    } catch {}
  }

  const objectMatches = text.matchAll(/\{[\s\S]*?(?:"tool"|"name"|"function")[\s\S]*?\}/g);
  const normalized: ToolUse[] = [];
  for (const match of objectMatches) {
    try {
      const call = normalizeToolCall(JSON.parse(match[0]), normalized.length);
      if (call) normalized.push(call);
    } catch {}
  }
  if (normalized.length) return normalized;
  return callSyntaxToolUses(text);
}

/**
 * Calls written like the conversation's own "[Tool calls]" record, `create_wall({...})`:
 * small models copy that format from the history instead of emitting native calls.
 */
function callSyntaxToolUses(text: string): ToolUse[] {
  const uses: ToolUse[] = [];
  for (const match of text.matchAll(/\b([a-z_][a-z0-9_]*)\(\s*\{/g)) {
    if (!TOOL_NAMES.has(match[1])) continue;
    const start = match.index! + match[0].length - 1;
    let depth = 0, inString = false, end = -1;
    for (let i = start; i < text.length && end < 0; i++) {
      const char = text[i];
      if (inString) { if (char === '\\') i++; else if (char === '"') inString = false; }
      else if (char === '"') inString = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) end = i;
    }
    if (end < 0) continue;
    try {
      const call = normalizeToolCall({ name: match[1], input: JSON.parse(text.slice(start, end + 1)) }, uses.length);
      if (call) uses.push(call);
    } catch {}
  }
  return uses;
}

export function propagateModifications(
  toolName: string,
  originalArgs: Record<string, unknown>,
  updatedGeom: any,
  remainingUses: { name: string; input: any }[],
  items: ItemsMap,
  focusStorey: string,
) {
  // 1. Get calibration plan for coordinate conversion
  const activeStoreyObj = items[focusStorey] as any;
  const activePlan = activeStoreyObj?.type === 'Storey' ? activeStoreyObj.geom?.plan : undefined;

  // Calibration used by the tools for these args (pixel_space "image" = downscaled MCP copy), or undefined for metres.
  const pixelCalibration = (args: any): PlanCalibration | undefined => {
    if (!args?.coordinates_in_pixels || !activePlan) return undefined;
    try { return planCalibrationFor(activePlan, parsePixelSpace(args.pixel_space)); } catch { return activePlan; }
  };

  const getPointInWorld = (v: any, calib: PlanCalibration | undefined): [number, number] => {
    if (!v) return [0, 0];
    let pt: [number, number] = [0, 0];
    if (Array.isArray(v)) {
      pt = [Number(v[0]) || 0, Number(v[1]) || 0];
    } else if (typeof v === 'string') {
      try {
        const p = JSON.parse(v);
        if (Array.isArray(p)) pt = [Number(p[0]) || 0, Number(p[1]) || 0];
      } catch {}
      const p = v.split(',').map((s: string) => Number(s.trim()));
      if (p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1])) pt = [p[0], p[1]];
    } else if (typeof v === 'object' && v) {
      if ('x' in v && 'y' in v) pt = [Number(v.x) || 0, Number(v.y) || 0];
      else if ('0' in v && '1' in v) pt = [Number(v['0']) || 0, Number(v['1']) || 0];
    }
    if (calib) {
      return [
        calib.x + pt[0] * calib.scale,
        calib.y + (calib.h - pt[1]) * calib.scale
      ];
    }
    return pt;
  };

  const worldToPixel = (pt: [number, number], calib: PlanCalibration): [number, number] => {
    const u = (pt[0] - calib.x) / calib.scale;
    const v = calib.h - (pt[1] - calib.y) / calib.scale;
    return [u, v];
  };

  // 2. Identify coordinate shifts
  const shifts: { from: [number, number]; to: [number, number] }[] = [];
  const addShift = (fromWorld: [number, number], toWorld: [number, number]) => {
    const dist = Math.hypot(toWorld[0] - fromWorld[0], toWorld[1] - fromWorld[1]);
    if (dist > 0.001) { // only track meaningful shifts
      shifts.push({ from: fromWorld, to: toWorld });
    }
  };

  // Extract original and updated points based on tool type
  const isPixels = pixelCalibration(originalArgs);

  if (toolName === 'create_wall' || toolName === 'update_wall') {
    const origStart = getPointInWorld(originalArgs.start_point, isPixels);
    const origEnd = getPointInWorld(originalArgs.end_point, isPixels);
    if (updatedGeom.x1 !== undefined && updatedGeom.y1 !== undefined) {
      addShift(origStart, [updatedGeom.x1, updatedGeom.y1]);
    }
    if (updatedGeom.x2 !== undefined && updatedGeom.y2 !== undefined) {
      addShift(origEnd, [updatedGeom.x2, updatedGeom.y2]);
    }
  } else if (toolName === 'create_space' || toolName === 'create_slab') {
    const origPoly = (originalArgs.polygon ? (Array.isArray(originalArgs.polygon) ? originalArgs.polygon : []) : []) as any[];
    const updatedPoly = (updatedGeom.polygon ? (Array.isArray(updatedGeom.polygon) ? updatedGeom.polygon : []) : []) as [number, number][];
    if (origPoly.length === updatedPoly.length) {
      for (let i = 0; i < origPoly.length; i++) {
        const origPt = getPointInWorld(origPoly[i], isPixels);
        addShift(origPt, updatedPoly[i]);
      }
    }
  } else if (toolName === 'create_dimension') {
    const origP1 = getPointInWorld(originalArgs.p1, isPixels);
    const origP2 = getPointInWorld(originalArgs.p2, isPixels);
    if (updatedGeom.x1 !== undefined && updatedGeom.y1 !== undefined) {
      addShift(origP1, [updatedGeom.x1, updatedGeom.y1]);
    }
    if (updatedGeom.x2 !== undefined && updatedGeom.y2 !== undefined) {
      addShift(origP2, [updatedGeom.x2, updatedGeom.y2]);
    }
  } else if (toolName === 'create_marker' || toolName === 'create_technical' || toolName === 'update_technical' || /^(create|update)_(column|chimney)$/.test(toolName)) {
    const origPt = getPointInWorld(originalArgs.point ?? [originalArgs.x, originalArgs.y], isPixels);
    if (updatedGeom.x !== undefined && updatedGeom.y !== undefined) {
      addShift(origPt, [updatedGeom.x, updatedGeom.y]);
    }
  } else if (toolName === 'create_ifc_element') {
    const type = String(originalArgs.type ?? originalArgs.ifc_type ?? '').toLowerCase();
    if (type === 'wall' || type === 'ifcwallstandardcase' || type === 'ifcwall') {
      const origStart = getPointInWorld(originalArgs.start_point, isPixels);
      const origEnd = getPointInWorld(originalArgs.end_point, isPixels);
      if (updatedGeom.x1 !== undefined && updatedGeom.y1 !== undefined) addShift(origStart, [updatedGeom.x1, updatedGeom.y1]);
      if (updatedGeom.x2 !== undefined && updatedGeom.y2 !== undefined) addShift(origEnd, [updatedGeom.x2, updatedGeom.y2]);
    } else if (type === 'slab' || type === 'room' || type === 'space' || type === 'ifcslab' || type === 'ifcspace') {
      const origPoly = (originalArgs.polygon ? (Array.isArray(originalArgs.polygon) ? originalArgs.polygon : []) : []) as any[];
      const updatedPoly = (updatedGeom.polygon ? (Array.isArray(updatedGeom.polygon) ? updatedGeom.polygon : []) : []) as [number, number][];
      if (origPoly.length === updatedPoly.length) {
        for (let i = 0; i < origPoly.length; i++) {
          const origPt = getPointInWorld(origPoly[i], isPixels);
          addShift(origPt, updatedPoly[i]);
        }
      }
    }
  }

  // Identify property changes (e.g. wall thickness, height)
  let thicknessChange: { from: number; to: number } | null = null;
  let heightChange: { from: number; to: number } | null = null;

  if (toolName === 'create_wall' || toolName === 'update_wall') {
    const origThickness = Number(originalArgs.thickness ?? 0.2);
    const updatedThickness = Number(updatedGeom.thickness);
    if (!isNaN(updatedThickness) && Math.abs(updatedThickness - origThickness) > 0.001) {
      thicknessChange = { from: origThickness, to: updatedThickness };
    }
    const origHeight = Number(originalArgs.height ?? 2.8);
    const updatedHeight = Number(updatedGeom.height);
    if (!isNaN(updatedHeight) && Math.abs(updatedHeight - origHeight) > 0.001) {
      heightChange = { from: origHeight, to: updatedHeight };
    }
  } else if (toolName === 'create_space') {
    const origHeight = Number(originalArgs.height ?? 2.5);
    const updatedHeight = Number(updatedGeom.height);
    if (!isNaN(updatedHeight) && Math.abs(updatedHeight - origHeight) > 0.001) {
      heightChange = { from: origHeight, to: updatedHeight };
    }
  } else if (toolName === 'create_slab') {
    const origThickness = Number(originalArgs.thickness ?? 0.2);
    const updatedThickness = Number(updatedGeom.thickness);
    if (!isNaN(updatedThickness) && Math.abs(updatedThickness - origThickness) > 0.001) {
      thicknessChange = { from: origThickness, to: updatedThickness };
    }
  }

  if (shifts.length === 0 && !thicknessChange && !heightChange) {
    return; // nothing changed
  }

  // Helper to map a world point to shift, returning shifted world point if matched
  const shiftWorldPoint = (ptWorld: [number, number]): [number, number] => {
    for (const shift of shifts) {
      if (Math.hypot(ptWorld[0] - shift.from[0], ptWorld[1] - shift.from[1]) < 0.05) {
        return shift.to;
      }
    }
    return ptWorld;
  };

  // Helper to shift a point inside tool args
  const applyPointShift = (inputVal: any, usePixels: PlanCalibration | undefined): any => {
    const origPt = getPointInWorld(inputVal, usePixels);
    const shiftedPt = shiftWorldPoint(origPt);
    if (shiftedPt === origPt) return inputVal; // no shift

    const finalPt = usePixels ? worldToPixel(shiftedPt, usePixels) : shiftedPt;
    // Format back to original type (either array or object or string)
    if (Array.isArray(inputVal)) {
      return [finalPt[0], finalPt[1]];
    } else if (typeof inputVal === 'string') {
      return `${finalPt[0].toFixed(3)},${finalPt[1].toFixed(3)}`;
    } else if (typeof inputVal === 'object' && inputVal) {
      if ('x' in inputVal && 'y' in inputVal) {
        return { ...inputVal, x: finalPt[0], y: finalPt[1] };
      }
      if ('0' in inputVal && '1' in inputVal) {
        return { ...inputVal, '0': finalPt[0], '1': finalPt[1] };
      }
    }
    return [finalPt[0], finalPt[1]];
  };

  // 3. Propagate to remaining tool uses
  for (const use of remainingUses) {
    const input = use.input;
    if (!input || typeof input !== 'object') continue;

    const usePixels = pixelCalibration(input);

    // Apply coordinate shifts
    if (use.name === 'create_wall' || use.name === 'update_wall') {
      if (input.start_point) input.start_point = applyPointShift(input.start_point, usePixels);
      if (input.end_point) input.end_point = applyPointShift(input.end_point, usePixels);

      // Propagate thickness/height changes for walls
      if (thicknessChange && (input.thickness === undefined || Number(input.thickness) === thicknessChange.from)) {
        input.thickness = thicknessChange.to;
      }
      if (heightChange && (input.height === undefined || Number(input.height) === heightChange.from)) {
        input.height = heightChange.to;
      }
    } else if (use.name === 'create_space' || use.name === 'create_slab') {
      if (Array.isArray(input.polygon)) {
        input.polygon = input.polygon.map((pt: any) => applyPointShift(pt, usePixels));
      }
      if (use.name === 'create_space' && heightChange && (input.height === undefined || Number(input.height) === heightChange.from)) {
        input.height = heightChange.to;
      }
      if (use.name === 'create_slab' && thicknessChange && (input.thickness === undefined || Number(input.thickness) === thicknessChange.from)) {
        input.thickness = thicknessChange.to;
      }
    } else if (use.name === 'create_dimension') {
      if (input.p1) input.p1 = applyPointShift(input.p1, usePixels);
      if (input.p2) input.p2 = applyPointShift(input.p2, usePixels);
    } else if (use.name === 'create_marker' || use.name === 'create_technical' || use.name === 'update_technical' || /^(create|update)_(column|chimney)$/.test(use.name)) {
      if (input.point) {
        input.point = applyPointShift(input.point, usePixels);
      } else {
        if (input.x !== undefined && input.y !== undefined) {
          const pt = applyPointShift([input.x, input.y], usePixels);
          input.x = pt[0];
          input.y = pt[1];
        }
      }
    } else if (use.name === 'create_ifc_element' || use.name === 'update_ifc_element') {
      const type = String(input.type ?? input.ifc_type ?? '').toLowerCase();

      if (input.start_point) input.start_point = applyPointShift(input.start_point, usePixels);
      if (input.end_point) input.end_point = applyPointShift(input.end_point, usePixels);
      if (input.p1) input.p1 = applyPointShift(input.p1, usePixels);
      if (input.p2) input.p2 = applyPointShift(input.p2, usePixels);
      if (input.point) {
        input.point = applyPointShift(input.point, usePixels);
      } else if (input.x !== undefined && input.y !== undefined) {
        const pt = applyPointShift([input.x, input.y], usePixels);
        input.x = pt[0];
        input.y = pt[1];
      }
      if (Array.isArray(input.polygon)) {
        input.polygon = input.polygon.map((pt: any) => applyPointShift(pt, usePixels));
      }

      // Properties
      if (input.geom && typeof input.geom === 'object') {
        const geom = input.geom as any;
        if (geom.x1 !== undefined && geom.y1 !== undefined) {
          const pt = applyPointShift([geom.x1, geom.y1], usePixels);
          geom.x1 = pt[0];
          geom.y1 = pt[1];
        }
        if (geom.x2 !== undefined && geom.y2 !== undefined) {
          const pt = applyPointShift([geom.x2, geom.y2], usePixels);
          geom.x2 = pt[0];
          geom.y2 = pt[1];
        }
        if (geom.x !== undefined && geom.y !== undefined) {
          const pt = applyPointShift([geom.x, geom.y], usePixels);
          geom.x = pt[0];
          geom.y = pt[1];
        }
        if (Array.isArray(geom.polygon)) {
          geom.polygon = geom.polygon.map((pt: any) => applyPointShift(pt, usePixels));
        }

        if (thicknessChange && (geom.thickness === undefined || Number(geom.thickness) === thicknessChange.from)) {
          geom.thickness = thicknessChange.to;
        }
        if (heightChange && (geom.height === undefined || Number(geom.height) === heightChange.from)) {
          geom.height = heightChange.to;
        }
      }

      if (thicknessChange && (input.thickness === undefined || Number(input.thickness) === thicknessChange.from)) {
        input.thickness = thicknessChange.to;
      }
      if (heightChange && (input.height === undefined || Number(input.height) === heightChange.from)) {
        input.height = heightChange.to;
      }
    }
  }
}

export function buildConversationPrompt({ items, focusStorey, lang, selection, finalTxt, view2d }: ConversationContext): string {
    const stats: Record<string, number> = {};
    Object.values(items).forEach(i => { stats[i.type] = (stats[i.type] || 0) + 1; });

    const activeStorey = items[focusStorey] as any;
    const activePlan = activeStorey?.type === 'Storey' ? activeStorey.geom?.plan : undefined;
    const planContext = activePlan
      ? {
          has_image: true,
          image_size_px: [activePlan.w, activePlan.h],
          // origin_m = world coords of the TOP-LEFT pixel (px=0, py=0)
          // plan.y is the world Y of the image bottom; top = plan.y + h * scale
          origin_m: [activePlan.x, activePlan.y + activePlan.h * activePlan.scale],
          scale_m_per_image_px: activePlan.scale,
          rotation_deg: activePlan.rotation ?? 0,
          opacity: activePlan.opacity,
        }
      : { has_image: false };

    const activeStoreyItems = Object.values(items)
      .filter(i => i.parentId === focusStorey && !i.type.startsWith('_'))
      .slice(0, 1000)
      .map((i) => ({
        id: i.id,
        type: i.type,
        ifcType: i.ifcType,
        name: i.Name || i.name,
        geom: sanitizeForLlm((i as any).geom),
      }));

    const selectionDetails = selection.map(id => {
      const it = items[id];
      if (!it) return `ID: ${id}`;
      const { id: _, type: __, ifcType: ___, geom, ...props } = it as any;
      return `- ID: ${id}, Type: ${it.type}, IFC: ${it.ifcType}, Geom: ${JSON.stringify(sanitizeForLlm(geom))}, Props: ${JSON.stringify(sanitizeForLlm(props))}`;
    }).join('\n');

    // Build geometry anchors: polygon vertices from slabs/rooms + wall endpoints
    // These give the AI concrete snap targets for wall placement
    const storeyElems = Object.values(items).filter(i => i.parentId === focusStorey);
    const round2 = (v: number) => Math.round(v * 50) / 50; // round to 2cm
    const vertexKey = (x: number, y: number) => `${round2(x)},${round2(y)}`;
    const seenVerts = new Set<string>();
    const allVertices: [number, number][] = [];
    const addVert = (x: number, y: number) => {
      const k = vertexKey(x, y);
      if (!seenVerts.has(k)) { seenVerts.add(k); allVertices.push([round2(x), round2(y)]); }
    };

    const slabAnchors = storeyElems.filter(i => i.type === 'Slab').map(i => {
      const poly = (i as any).geom?.polygon as [number,number][] ?? [];
      poly.forEach(([x,y]) => addVert(x, y));
      const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
      return { id: i.id, name: i.name || (i as any).Name, polygon: poly.map(([x,y]) => [round2(x), round2(y)]),
        bbox: { minX: round2(Math.min(...xs)), minY: round2(Math.min(...ys)), maxX: round2(Math.max(...xs)), maxY: round2(Math.max(...ys)) } };
    });

    const roomAnchors = storeyElems.filter(i => i.type === 'Room').map(i => {
      const poly = (i as any).geom?.polygon as [number,number][] ?? [];
      poly.forEach(([x,y]) => addVert(x, y));
      const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
      return { id: i.id, name: i.name || (i as any).Name, polygon: poly.map(([x,y]) => [round2(x), round2(y)]),
        bbox: { minX: round2(Math.min(...xs)), minY: round2(Math.min(...ys)), maxX: round2(Math.max(...xs)), maxY: round2(Math.max(...ys)) } };
    });

    const wallAnchors = storeyElems.filter(i => i.type === 'Wall').map(i => {
      const g = (i as any).geom;
      addVert(g.x1, g.y1); addVert(g.x2, g.y2);
      return { id: i.id, name: i.name || (i as any).Name, start: [round2(g.x1), round2(g.y1)], end: [round2(g.x2), round2(g.y2)] };
    });

    const markerAnchors = storeyElems.filter(i => i.type === 'Marker').map(i => {
      const g = (i as any).geom;
      addVert(g.x, g.y);
      return { id: i.id, name: i.name || (i as any).Name, point: [round2(g.x), round2(g.y)] };
    });

    const dimensionAnchors = storeyElems.filter(i => i.type === 'Dimension').map(i => {
      const g = (i as any).geom;
      addVert(g.x1, g.y1); addVert(g.x2, g.y2);
      return { id: i.id, name: i.name || (i as any).Name, start: [round2(g.x1), round2(g.y1)], end: [round2(g.x2), round2(g.y2)] };
    });

    const geometryAnchors = {
      slabs: slabAnchors,
      rooms: roomAnchors,
      walls: wallAnchors,
      markers: markerAnchors,
      dimensions: dimensionAnchors,
      all_vertices: allVertices,
    };

    // Detect if user asked for detailed explanation
    const requestsDetail = /(décri|descri|expliqu|detail|détail|complet|full|extensive)/i.test(finalTxt);
    const conciseness = requestsDetail
      ? ''
      : `${makeT(lang)("Be concise (1-3 sentences).")}`;

    // Viewport origin in world coords: top-left pixel = (-ox/scale, -oy/scale)
    const viewOrigin = view2d
      ? `View top-left: [${(-view2d.ox / view2d.scale).toFixed(2)}, ${(-view2d.oy / view2d.scale).toFixed(2)}] m, scale: ${view2d.scale} px/m.`
      : '';

    const hasAnchors = slabAnchors.length > 0 || roomAnchors.length > 0 || wallAnchors.length > 0 || markerAnchors.length > 0 || dimensionAnchors.length > 0;
    return `You are an expert BIM assistant for SkAItch.
Project: ${JSON.stringify(stats)}. Active storey: ${focusStorey}. Language: ${lang}. ${viewOrigin}
Storey plan image context: ${JSON.stringify(planContext)}.
Active storey elements sample: ${JSON.stringify(activeStoreyItems)}.
Selected: ${selectionDetails || 'none'}.
${hasAnchors ? `
GEOMETRY ANCHORS — existing elements to use as spatial references for placement:
${JSON.stringify(geometryAnchors, null, 0)}
PLACEMENT RULES (mandatory):
- Wall start/end points MUST snap to coordinates from all_vertices above, OR be derived from the plan image pixel conversion. Never invent isolated coordinates.
- Slabs and rooms define the floor footprint — walls should follow their polygon edges or interior divisions.
- If all_vertices is non-empty, prefer those exact coordinates over approximate image-derived values.
` : ''}

Plan-image interpretation guide: ${JSON.stringify(PLAN_INTERPRETATION_GUIDE)}.

${GENERATION_GUIDE}

If a plan image is attached or returned by get_storey_plan_image, use it as the visual reference for the active storey. Infer BIM items from visible architectural conventions:
- Model walls as centerline segments with thickness; keep them straight and aligned with existing wall axes when possible.
- For doors, read the catalogue returned with get_storey_floorplan or get_ifc_scene_overview (including garage); list_opening_types is an optional filtered view. Always use hinge_point at the hinge jamb and opening_towards inside the destination room when visible. Left/right and side are wall-relative; never guess from screen left/right. Do not infer a sliding door from width. For WC use catalogue_id=sdb-wc, anchor=back with point at its wall attachment and facing_point toward the room; facing_point follows the bowl direction. If references are unclear, report the uncertainty.
- Model doors and windows only when they are hosted by a wall; choose the nearest matching wall_id and normalized position along that wall.
- Model rooms as IfcSpace polygons inside enclosing walls; use visible labels/closed areas when present.
- Model slabs/dalles as the floor plate or structural contour; a slab is not a room and should usually cover a footprint or balcony/terrace area.
- Furniture and sanitary symbols are objects to create when fixtures or all elements are requested. Use text labels to identify them. Dimension strings, hatch patterns, grids, north arrows and drawing borders are references; create annotations only when requested.
- IMPORTANT: When creating dimensions (cotations) using \`create_dimension\`, you MUST place them exactly at the same geometric location (x1, y1) and (x2, y2) on the plan drawing as they are drawn in the plan image sheet. Do not arbitrarily place or simplify them; ensure they align with the physical dimension lines shown in the image.

COORDINATE SYSTEM:
- origin_m is the world coordinate [x, y] of the image's TOP-LEFT pixel (px=0, py=0).
- X axis: left→right in image = left→right in world (same direction). ✓
- Y axis: in the IMAGE py increases downward; in WORLD Y increases upward — they are OPPOSITE.
- Conversion formula (mandatory):
    world_x = origin_m[0] + px * scale_m_per_image_px
    world_y = origin_m[1] - py * scale_m_per_image_px   ← SUBTRACT py (Y is inverted)
- scale_m_per_image_px gives meters per pixel. Multiply pixel distances by this to get real-world meters.
- IMPORTANT: Read ALL wall/room/slab endpoints directly from the plan image using pixel coordinates, then convert to world meters using the formula above. Do NOT guess or approximate coordinates.
- CALIBRATION & ANCHORS (JALONS): You can (and should) create your own markers (Jalons) using \`create_marker\` to establish precise references on key structural points (such as actual physical wall corners, wall intersections, structural columns, or openings). Do NOT place markers at the empty outer corners of the image/sheet unless explicitly asked for document grid calibration; instead, always target the real structural junctions of the building. For subsequent walls, doors, windows, slabs, spaces, or dimensions, you can reference these markers by name/ID directly (e.g. \`start_point: "Jalon A"\`, \`position: "Jalon B"\`, or \`polygon: ["Jalon A", "Jalon B"]\`).

WALL THICKNESS (MANDATORY):
- In the plan image, walls appear as thick lines or filled rectangles. The visible width of a wall line IS the real wall thickness (after applying scale).
- When creating walls using \`create_wall\`, you MUST calculate the exact thickness of the wall by measuring the perpendicular graphic width on the image and passing it as the \`thickness\` argument. Do NOT leave this to default!
- Common thicknesses: exterior walls 20-30cm (0.20 to 0.30), interior walls 10-15cm (0.10 to 0.15), partition walls 7-10cm (0.07 to 0.10).
- If a wall has a hatched pattern inside (diagonal lines, zigzag), that wall contains insulation. The hatching fills the full wall thickness.
- For walls with insulation, set the wall thickness to the full visible width including insulation. Note the insulation in the wall name (e.g. "Mur isolé 30cm").

Use calibrated plan coordinates. Always derive polygon/point coordinates from the plan image using the conversion formula above. When exact coordinates are ambiguous, first call list_ifc_entities/get_ifc_scene_overview and align new items to nearby existing geometry instead of inventing isolated geometry.
When creating walls, doors, windows, spaces, or slabs, place them at coordinates visible in the current view or aligned to existing elements. Do NOT place at [0,0] unless the view or plan origin makes that location relevant.
For direct IFC element edits, prefer create_ifc_element, update_ifc_element, and delete_ifc_element when the user names IFC classes or asks to edit "elements IFC" generically. These tools accept any IFC class. Classes with known 2D geometry immediately synchronize the 2D canvas; other IFC classes are stored as generic IFC elements and remain available in the IFC tree/properties and for IFC/3D workflows. For doors/windows, always provide a valid host wallId. For rooms/slabs, always provide a polygon. For walls, provide centerline geometry.
For a request to create all possible items from the storey plan in one pass, use the plan image and proceed in structured batches with creation tools: create_slab for floor plates, create_wall for walls, create_space for rooms, create_door/create_window after host walls exist (including garage openings without swing arcs), create_furniture for visible fixtures including sinks and water heaters, and create_dimension for visible cotations. Do not use inject_ifc for the "create every possible item" quick action; use inject_ifc only when the user explicitly asks to generate/replace the model by IFC.
When doing full extraction, create the largest reliable items first, then continue in later tool rounds using the IDs returned by earlier tools. Record uncertain inventory entries with their reasons; never silently omit them or declare complete extraction until every entry has been accounted for.
Prefer asking one short clarification only when the requested item cannot be located from the text, selection, existing elements, or image.
When creating multiple elements, emit ALL tool calls in a single response (parallel calls) instead of one per round. Always use tools when appropriate - do NOT return JSON or text representations of tool calls.
- USER OVERRIDES & ADJUSTMENTS: If the user validates a creation or update tool with manual adjustments, the tool result contains the 'updated_geom' property. You MUST analyze this 'updated_geom' property in the tool results, and ensure that any subsequent elements you create/update align perfectly with the user's modifications (e.g. snapping to the adjusted end points, using the adjusted wall thickness or wall height, etc.).
For substantial analysis or modelling, use load_skill with {id: "analyze_model"} or {id: "edit_model"} once per task. Discover BIM tool schemas with search_tools({query}), then invoke them via call_tool({name, arguments_json}), where arguments_json is a JSON-encoded object. Request the skill and any known schemas in the same round when both are needed. For repeated reads use execute_script({code}) with an async JavaScript function body that calls await callTool(name, args) and returns compact JSON.
If your current API mode cannot emit native tool calls, output JSON such as {"tool_calls":[{"name":"search_tools","args":{"query":"create_wall"}}]} with no prose. The app will execute it.
Answer in ${LANGUAGES.find(({ code }) => code === resolveLanguage(lang))!.name}. ${conciseness}

${currentContextBlock(items, focusStorey, selection)}`;

}

export const CONTEXT_MARKER = 'CURRENT CONTEXT:';

/**
 * The working context restated in a few plain lines at the very end of the prompt, where models
 * (small local ones above all) follow it best: open project, active storey and the selected
 * objects, each with its parent chain.
 */
export function currentContextBlock(items: ItemsMap, focusStorey: string, selection: string[]): string {
  const label = (id: string) => {
    const item = items[id] as any;
    return item ? `${item.type} "${item.name ?? item.Name ?? id}" (id ${id})` : `id ${id}`;
  };
  const parents = (id: string) => {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current = items[id]?.parentId;
    while (current && items[current] && !seen.has(current) && chain.length < 8) {
      seen.add(current);
      chain.push(label(current));
      current = items[current].parentId;
    }
    return chain.length ? ` in ${chain.join(' < ')}` : '';
  };
  const project = Object.values(items).find(item => item.type === 'Project');
  const shown = selection.slice(0, 20);
  return [
    CONTEXT_MARKER,
    `- Open project: ${project ? label(project.id) : 'the current project'}. It is already open: do not list or select projects.`,
    items[focusStorey]
      ? `- Active storey: ${label(focusStorey)}${parents(focusStorey)}. Work on it: pass storey_id "${focusStorey}" whenever a tool asks for one, never another invented ID.`
      : '- No active storey.',
    shown.length
      ? `- Selected (${selection.length}): ${shown.map(id => label(id) + parents(id)).join('; ')}${selection.length > shown.length ? '; …' : ''}. "This", "it" or "the selection" mean these objects.`
      : '- Nothing is selected.',
  ].join('\n');
}

export function conversationMessages(messages: AiMessage[], receipts: unknown): AiMessage[] {
  if (!Array.isArray(messages) || messages.length > 1000 || messages.some(message => !message || !['user','assistant','tool'].includes(message.role) || message.content !== undefined && typeof message.content !== 'string')) throw new InputError('Messages IA invalides.');
  if (receipts === undefined) return messages;
  if (messages.length >= 1000) throw new InputError('Historique de conversation trop long.');
  if (!Array.isArray(receipts) || receipts.length > 1000 || receipts.some(part => typeof part !== 'string')) throw new InputError('Résultats d’outils invalides.');
  return [...messages, { role: 'user', content: `[Tool results]\n${receipts.join('\n')}` }];
}
export function finishConversation(answer: AiResult, messages: AiMessage[], round: number): ConversationResult {
  const callsFromModel = answer.toolUses.length ? answer.toolUses : extractToolUsesFromText(answer.text);
  const toolUses = callsFromModel.map(use => {
    if (use.name !== 'call_tool' || !use.input || typeof use.input !== 'object') return use;
    const { name, arguments_json } = use.input as Record<string, unknown>;
    if (typeof name !== 'string' || !BIM_TOOL_NAMES.has(name) || typeof arguments_json !== 'string') return use;
    try {
      const input = JSON.parse(arguments_json);
      if (input && typeof input === 'object' && !Array.isArray(input)) return { ...use, name, input };
    } catch {}
    return use;
  });
  if (toolUses.length > 1000) throw new InputError('Trop d’outils dans un seul tour.');
  // The next round only sees text: record which tools were called, or a model that answered
  // with tool calls alone (Gemini often does) forgets what it did and repeats it.
  const calls = toolUses.map(use => `${use.name}(${JSON.stringify(use.input ?? {}).slice(0, 400)})`).join('\n');
  const content = [answer.text, calls && `[Tool calls]\n${calls}`].filter(Boolean).join('\n\n');
  return { ...answer, toolUses, next: toolUses.length ? { messages: [...messages, { role: 'assistant', content }], round: round + 1 } : null };
}
