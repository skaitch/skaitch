import { TOOLS as MCP_TOOLS } from '../mcp-tools.js';
// Code Mode exposes only project queries that run against an editor snapshot.
export const CODE_MODE_TOOLS = [
  'list_spatial_structure', 'list_ifc_entities', 'get_element_properties',
  'get_background_geometry', 'get_survey', 'measure_distance',
] as const;

export const CHAT_SKILLS = {
  analyze_model: {
    description: 'Compare storeys, inspect quantities and summarize model data.',
    instructions: 'Use execute_script for queries across storeys. List the spatial structure, filter IFC entities by storey and class, then query properties only for matching IDs. Aggregate inside the script and return compact JSON with units and missing values. Do not substitute estimates for unavailable measurements.',
  },
  edit_model: {
    description: 'Create, update or delete BIM elements.',
    instructions: 'Identify the target storey and element IDs before editing. Discover the exact tool schema with search_tools and invoke it with call_tool. Use the calibrated plan and existing geometry for placements. Respect validation decisions and use the actual returned geometry or IDs for dependent edits.',
  },
} as const;

const CHAT_CONTROL_TOOLS = [
  { name: 'search_tools', hint: 'Find input schemas by exact tool name or short English keywords. Returns up to three matches.' },
  { name: 'load_skill', hint: 'Load a workflow: ' + Object.entries(CHAT_SKILLS).map(([id, skill]) => id + ' — ' + skill.description).join(' ') },
  { name: 'call_tool', hint: 'Invoke a discovered BIM tool. Pass its exact name and its arguments as a JSON object encoded as a string.' },
];

const LOCAL_TOOL_HINTS = [
  ...CHAT_CONTROL_TOOLS,
  { name: 'execute_script', hint: `Run a read-only JavaScript async function body against the open project. Prefer this for loops, dependent queries and batching. Use callTool(name, args) with: ${CODE_MODE_TOOLS.join(', ')}. Return a compact JSON value. Use search_tools for argument schemas.` },
  { name: 'get_storey_plan_image',   hint: 'récupère l\'image du plan de l\'étage actuel' },
  { name: 'create_ifc_element',      hint: 'ifc_type/type, geom, properties?, name?, storey_id? — crée un élément IFC rendu en 2D' },
  { name: 'update_ifc_element',      hint: 'id, geom?, properties?, name? — met à jour un élément IFC et resynchronise la 2D' },
  { name: 'delete_ifc_element',      hint: 'id ou ids[] — supprime les éléments IFC et dépendances 2D' },
  { name: 'inject_ifc',               hint: 'ifc_text, filename? — à utiliser seulement si l’utilisateur demande explicitement de remplacer le modèle par un IFC généré complet' },
];

export const TOOL_HINTS = [
  ...MCP_TOOLS.map(tool => ({ name: tool.name, hint: tool.description ?? tool.name })),
  ...LOCAL_TOOL_HINTS.filter(local => !MCP_TOOLS.some(tool => tool.name === local.name)),
];

export const CHAT_TOOL_HINTS = TOOL_HINTS.filter(tool =>
  tool.name === 'execute_script' || CHAT_CONTROL_TOOLS.some(control => control.name === tool.name));

export function searchChatTools(value: unknown, available?: ReadonlySet<string>) {
  const query = typeof value === 'string' ? value.trim().toLowerCase().slice(0, 120) : '';
  const discoverable = TOOL_HINTS.filter(tool => !CHAT_TOOL_HINTS.includes(tool) && (!available || available.has(tool.name)));
  const exact = discoverable.find(tool => tool.name === query);
  if (exact) return { tools: [{ ...exact, inputSchema: getToolSchema(exact.name) }] };
  const words: string[] = query.match(/[a-z0-9]+/g) ?? [];
  const matches = discoverable.map(tool => ({
    tool,
    score: words.reduce((score, word) =>
      score + (tool.name.includes(word) ? 4 : tool.hint.toLowerCase().includes(word) ? 1 : 0), 0),
  }));
  return { tools: matches.filter(match => match.score > 0).sort((a, b) => b.score - a.score).slice(0, 3)
    .map(({ tool }) => ({ ...tool, inputSchema: getToolSchema(tool.name) })) };
}

export function getToolSchema(name: string): Record<string, unknown> {
  const shared = MCP_TOOLS.find(tool => tool.name === name);
  if (shared) return shared.inputSchema;
  const schemas: Record<string, Record<string, unknown>> = {
    search_tools: {
      type: 'object', properties: { query: { type: 'string' } }, required: ['query'],
    },
    load_skill: {
      type: 'object', properties: { id: { type: 'string', enum: Object.keys(CHAT_SKILLS) } }, required: ['id'],
    },
    call_tool: {
      type: 'object', properties: { name: { type: 'string' }, arguments_json: { type: 'string' } },
      required: ['name', 'arguments_json'],
    },
    execute_script: {
      type: 'object',
      properties: { code: { type: 'string', description: 'JavaScript function body using callTool(name, args) and return.' } },
      required: ['code'],
    },
    get_storey_plan_image: { type: 'object', properties: {}, required: [] },
    create_ifc_element: {
      type: 'object',
      properties: {
        ifc_type: {
          type: 'string',
          description: 'IFC type. 2D/3D generated geometry is supported for IfcWall, IfcWallStandardCase, IfcDoor, IfcWindow, IfcSpace, IfcSlab, IfcRoof, IfcStair, IfcAnnotation, IfcFurnishingElement. Other IFC classes are stored as generic IFC elements and can carry raw/3D geometry metadata.',
        },
        type: {
          type: 'string',
          description: 'Optional app type: Wall, Door, Window, Room, Slab, Roof, Stair, Dimension, Furniture, or a generic IFC/app type',
        },
        name: { type: 'string' },
        storey_id: { type: 'string' },
        geom: {
          type: 'object',
          description: 'Geometry. Wall: {x1,y1,x2,y2,thickness,height}. Door/Window: {wallId,t,width,height,sillHeight?}. Room/Slab: {polygon:[[x,y],...],height?/thickness?}. Roof: {polygon, roofType: flat|shed|gable|hip|custom, pitch (deg), elevation (eave height, m), overhang, thickness, edges?: [{gable, pitch}] per polygon edge}. Dimension: {x1,y1,x2,y2}. Stair: {x,y,rotation,width,going,targetId,form:straight|quarter|doubleQuarter|half|spiral,count? (omit for automatic),flightLengths?:number[],landings?:[{length,width}],turnRadius? (inner radius of winders),turn:1|-1,landing,radius (spiral inner radius; diameter=2*(radius+width)),railLeft,railRight,railHeight,railStyle:bars|solid}. Furniture/generic 3D proxy: {x,y,w,d,h,rotation}. Generic IFC classes may also store arbitrary geometry metadata.',
        },
        properties: {
          type: 'object',
          description: 'IFC/app properties to merge onto the element, e.g. LoadBearing, IsExternal, PredefinedType, Material, FireRating.',
        },
      },
      required: ['ifc_type'],
    },
    update_ifc_element: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Element ID or GlobalId' },
        name: { type: 'string' },
        geom: { type: 'object', description: 'Partial geometry patch merged with the existing 2D geometry' },
        properties: { type: 'object', description: 'Partial IFC/app properties patch' },
      },
      required: ['id'],
    },
    delete_ifc_element: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Single element ID or GlobalId' },
        ids: { type: 'array', items: { type: 'string' }, description: 'Multiple element IDs or GlobalIds' },
      },
      required: [],
    },
    inject_ifc: {
      type: 'object',
      properties: {
        ifc_text: {
          type: 'string',
          description: 'Complete IFC STEP text starting with ISO-10303-21 and containing a valid IFC project, storey, walls, slabs, spaces, doors, windows, and annotations when applicable.',
        },
        filename: { type: 'string', description: 'Suggested filename for the generated IFC' },
      },
      required: ['ifc_text'],
    },
  };
  return schemas[name] || { type: 'object', properties: {}, required: [] };
}
