import type { ItemsMap } from './ifc.js';

export interface ImportProgress { phase: string; pct: number }

export interface IfcMeshGeometry {
  expressID: number;
  vertices: Float32Array;   // x,y,z,nx,ny,nz per vertex (stride 6)
  indices: Uint32Array;
  color: [number, number, number, number]; // RGBA 0-1
  transform: number[];      // 4x4 column-major matrix
}

export interface ImportResult {
  items: ItemsMap;
  rawStructure: unknown;
  rawIfcBuffer?: ArrayBuffer;
  meshes?: IfcMeshGeometry[];
  centerOffset?: [number, number];
}


export interface RoundTripResult {
  ok: boolean;
  totalEntities: number;
  exportedEntities: number;
  matched: number;
  missing: string[];        // ids present in ItemsMap but not in export
  nameMismatch: string[];   // "id: expected X got Y"
  guidMismatch: string[];
  report: string;
}


// shortcut: bounded compressed requests fit Vercel; use object storage and jobs for larger models.
export const BIM_WIRE_LIMIT = 4_000_000;
export const BIM_BODY_LIMIT = 64 * 1024 * 1024;
export type BimOperation = 'export-json' | 'export-dxf' | 'import-ifc' | 'export-ifc' | 'patch-ifc' | 'check-ifc' | 'fix-ifc' | 'mcp-model' | 'mcp-batch' | 'project-read' | 'project-list' | 'project-write' | 'project-delete' | 'mcp-read' | 'mcp-settings';

export const MCP_MODEL_TOOLS: readonly string[] = ['create_ifc_element', 'update_ifc_element', 'delete_ifc_element', 'create_storey', 'update_storey', 'delete_storey', 'get_wall_connections', 'create_wall', 'update_wall', 'connect_walls', 'create_door', 'create_window', 'create_section', 'create_roof', 'create_stair', 'update_element', 'update_opening', 'create_furniture', 'update_furniture', 'create_space', 'create_slab', 'create_dimension', 'create_marker', 'create_technical', 'update_technical', 'create_column', 'update_column', 'create_chimney', 'update_chimney', 'delete_element', 'create_sheet', 'add_sheet_view', 'update_sheet_view'];
export type McpModelChange =
  | { kind: 'add'; item: ItemsMap[string] }
  | { kind: 'update'; id: string; patch: Partial<ItemsMap[string]> }
  | { kind: 'delete'; ids: string[] }
  | { kind: 'focus'; id: string };
export interface McpModelResponse { result: unknown; changes: McpModelChange[] }

export const MCP_READ_TOOLS: readonly string[] = ['list_object_types', 'list_opening_types', 'list_spatial_structure', 'get_storey_floorplan', 'get_background_geometry', 'get_ifc_scene_overview', 'list_ifc_entities', 'get_element_properties', 'get_survey', 'get_survey_photo', 'export_ifc', 'measure_distance', 'export_sheet'];
