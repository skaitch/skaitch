// Shared catalog for local and remote MCP clients.
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { TECHNICAL_DISCIPLINES } from './types/ifc.js';
const PIXEL_SPACE = { type: 'string', enum: ['plan', 'image'], description: 'With coordinates_in_pixels: "image" when pixels were measured on the image attached by get_storey_floorplan (it may be downscaled, see its image calibration); "plan" (default) for full-resolution plan pixels (plan.w × plan.h).' };
const furnitureProperties = {
  catalogue_id: { type: 'string', description: 'Furniture model ID from the catalogue returned by get_storey_floorplan/get_ifc_scene_overview, or list_object_types; applies defaults before overrides.' },
  point: { oneOf: [
    { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
    { type: 'string' },
  ], description: '[x,y] or marker ID/GlobalId/unique name in the target storey. Explicitly choose anchor. A converted image top-left is not a world lower-left. Markers always use world metres.' },
  anchor: { type: 'string', enum: ['origin', 'center', 'back'], description: 'Use center for centre placement; back places the rear midpoint against a wall (especially WC). Default origin means the lower-left corner of the UNROTATED footprint; rotation is around the centre.' },
  offset: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[dx,dy] in world metres, applied after placement (or relative to current position on update).' },
  facing_point: { oneOf: [
    { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
    { type: 'string' },
  ], description: 'Coordinate or marker toward the functional front defined by the catalogue frontAngle and frontDescription: cabinet/appliance doors, sink user side, seating knees, TV screen, bed feet, shower entry. Use anchor=back for the opposite rear attachment. Symmetric models use their documented reference axis; prefer anchor=center. Never infer the front from the width axis. Custom models without metadata use +X. Do not combine with rotation.' },
  width: { type: 'number', exclusiveMinimum: 0 }, depth: { type: 'number', exclusiveMinimum: 0 },
  height: { type: 'number', exclusiveMinimum: 0 },
  rotation: { type: 'number', description: 'Radians counterclockwise, rotation of the model local axes about its centre. This is NOT universally its front bearing: WC rotation=0 faces south, -pi/2 west. Prefer facing_point.' },
  category: { type: 'string' }, model: { type: 'string' }, name: { type: 'string' },
  coordinates_in_pixels: { type: 'boolean', description: 'Only coordinate arrays use calibrated image pixels; offsets remain in world metres.' },
  pixel_space: PIXEL_SPACE,
};
export const TOOLS = [
  {
  "name": "create_storey",
  "description": "Create a storey in an existing building.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "building_id": {
        "type": "string"
      },
      "name": {
        "type": "string"
      },
      "level": {
        "type": "number"
      },
      "elevation": {
        "type": "number",
        "description": "Elevation in metres."
      },
      "thickness": {
        "type": "number",
        "minimum": 0,
        "description": "Slab thickness in metres."
      }
    },
    "required": [
      "building_id"
    ]
  }
},
  {
  "name": "update_storey",
  "description": "Update a storey name, level, elevation or slab thickness.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "storey_id": {
        "type": "string"
      },
      "name": {
        "type": "string"
      },
      "level": {
        "type": "number"
      },
      "elevation": {
        "type": "number",
        "description": "Elevation in metres."
      },
      "thickness": {
        "type": "number",
        "minimum": 0,
        "description": "Slab thickness in metres."
      }
    },
    "required": [
      "storey_id"
    ]
  }
},
  {
  "name": "delete_storey",
  "description": "Delete a storey. Nonempty storeys require recursive=true to delete all descendants.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "storey_id": {
        "type": "string"
      },
      "recursive": {
        "type": "boolean",
        "default": false
      }
    },
    "required": [
      "storey_id"
    ]
  }
},
  {
    name: 'list_projects',
    description: 'List the architectural projects the user has access to with the configured API key. Archived projects are omitted unless includeArchived is true; select_project still opens them by ID.',
    inputSchema: { type: 'object', properties: { includeArchived: { type: 'boolean', description: 'Also list archived projects.' } }, required: [] },
  },
  {
    name: 'select_project',
    description: 'Select a project by ID for subsequent MCP calls. In cloud mode selection belongs to this API key and does not require a browser.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project ID returned by list_projects.' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'list_spatial_structure',
    description: 'Get the spatial hierarchy structure of the currently selected project (Project, Buildings, Storeys).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'select_storey',
    description: 'Select a storey by ID for subsequent MCP calls. In cloud mode this updates the API key context; interactive view tools still need the browser.',
    inputSchema: {
      type: 'object',
      properties: {
        storey_id: { type: 'string', description: 'The storey ID to focus.' },
      },
      required: ['storey_id'],
    },
  },
  {
    name: 'get_storey_floorplan',
    description: 'Get the floor plan image, calibration, generation guidance and the full available element catalogue (models, defaults and orientations). The catalogue is included even if catalogue-list tools are unavailable in the client. The attached image may be downscaled: its calibration is returned as image; for pixels measured on it pass coordinates_in_pixels: true with pixel_space: "image".',
    inputSchema: {
      type: 'object',
      properties: {
        storey_id: { type: 'string', description: 'The storey ID to get the floorplan for.' },
      },
      required: ['storey_id'],
    },
  },
  {
    name: 'get_background_geometry',
    description: 'Exact geometry of a vector (DXF) background plan in world metres: polylines and texts per layer, read from the drawing rather than from pixels. Use it instead of measuring the get_storey_floorplan image when that plan reports kind "vector". Filter by layer names and by a world bounding box; results are capped by max_points.',
    inputSchema: {
      type: 'object',
      properties: {
        storey_id: { type: 'string', description: 'Storey holding the vector background plan.' },
        layers: { type: 'array', items: { type: 'string' }, description: 'Layer names to return; default: the visible layers.' },
        bbox: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4, description: '[minX, minY, maxX, maxY] in world metres; polylines with a vertex inside and texts anchored inside are returned.' },
        max_points: { type: 'number', description: 'Maximum number of vertices returned (default 20000).' },
      },
      required: ['storey_id'],
    },
  },
  {
    name: 'get_ifc_scene_overview',
    description: 'Get the IFC scene summary plus the full available element catalogue and shared generation guidance. Use the returned catalogue if list_opening_types/list_object_types are unavailable in the client.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_view',
    description: 'Read the active editor view, focused storey, all_storeys scope, viewport size, and 2D scale/centre or 3D camera position/target. Does not modify the model.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_view',
    description: 'Control the editor viewport without modifying model data. Choose 2d or 3d, focus storey_id, and show all_storeys or only that storey. In 2D all storeys are superimposed; the background plan remains the focused storey. fit reframes the current selection or model. zoom_factor >1 zooms in, <1 zooms out. For 2D use center [plan x,y] in metres and scale in pixels/metre (0.5–200). For 3D use a preset or position/target in Three.js world metres [plan x,elevation,-plan y]. Returns the applied view. Wait for completion before capture_view.',
    inputSchema: { type: 'object', properties: {
      view: { type: 'string', enum: ['2d', '3d'] }, storey_id: { type: 'string' }, all_storeys: { type: 'boolean' }, fit: { type: 'boolean' },
      zoom_factor: { type: 'number', minimum: 0.05, maximum: 20 },
      center: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, scale: { type: 'number', minimum: 0.5, maximum: 200 },
      position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, target: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
      preset: { type: 'string', enum: ['top', 'front', 'back', 'left', 'right', 'isometric'] },
    }, additionalProperties: false },
  },
  {
    name: 'capture_view',
    description: 'Capture the currently rendered 2D/3D viewport as a JPEG image (longest side up to 1024 pixels) for vision or external processing. Returns a native MCP image block and view metadata including image dimensions and camera/calibration. No upload to a third-party service. Call set_view first to choose storey, scope, zoom or camera. Background images must allow browser CORS access; otherwise capture reports an error.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_ifc_entities',
    description: 'List IFC entities filtered by type and/or storey.',
    inputSchema: {
      type: 'object',
      properties: {
        ifc_type: {
          type: 'string',
          description: 'IfcWall | IfcDoor | IfcWindow | IfcSpace | IfcBuildingStorey | IfcBuilding | IfcProject | IfcFurnishingElement',
        },
        storey_id: { type: 'string', description: 'Filter by storey ID (optional)' },
      },
    },
  },
  {
    name: 'get_element_properties',
    description: 'Get all properties of a specific IFC element by ID or GlobalId (GUID).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Element internal ID (e.g. w_123) or IFC GlobalId (22-char GUID)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_survey',
    description: 'Read-only: the on-site survey of a storey. Rooms, walls (face length, measure source, thickness and whether it was measured), openings, linked faces, diagonals and angles, closure checks, the survey reliability of each produced BIM element (measured, partial, assumed, modified) and its id, and each photo with its notes and photo cotes as text. No image data: call get_survey_photo to see a photo. The survey cannot be edited by the AI.',
    inputSchema: { type: 'object', properties: { storey_id: { type: 'string', description: 'Storey whose survey to read.' } }, required: ['storey_id'] },
  },
  {
    name: 'get_survey_photo',
    description: 'Read-only: one survey photo as an image, with its annotations (notes and photo cotes typed on site, positions relative to the image 0–1, origin top-left). Photo ids come from get_survey or get_element_properties.',
    inputSchema: { type: 'object', properties: { photo_id: { type: 'string' } }, required: ['photo_id'] },
  },
  {
    name: 'get_wall_connections',
    description: 'List walls joined to the start and end endpoints of a wall.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Wall ID or GlobalId' } }, required: ['id'] },
  },
  {
    name: 'create_wall',
    description: 'Create a wall. Respect each wall’s thickness and interior/exterior orientation shown on the plan: read the dimension or measure the full wall width using the calibrated scale, including insulation where shown, and explicitly provide thickness in metres. Do not use a generic thickness when the plan specifies one; if it cannot be determined reliably, ask for clarification. Specify interior_side relative to start_point → end_point so the INT/EXT orientation matches the plan. With right the endpoints are reversed in the resulting wall; opening position and swing then refer to the returned wall direction. Pass coordinates_in_pixels: true for calibrated image coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        start_point: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 3, description: '[x, y] start in metres (or pixels if coordinates_in_pixels is true)' },
        end_point:   { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 3, description: '[x, y] end in metres (or pixels if coordinates_in_pixels is true)' },
        start_connection: { type: "object", description: "Connect the new wall start to an existing wall endpoint.", properties: { wall_id: { type: "string", description: "Existing wall ID or GlobalId" }, end: { type: "string", enum: ["start", "end"] } }, required: ["wall_id", "end"] },
        end_connection: { type: "object", description: "Connect the new wall end to an existing wall endpoint.", properties: { wall_id: { type: "string", description: "Existing wall ID or GlobalId" }, end: { type: "string", enum: ["start", "end"] } }, required: ["wall_id", "end"] },
        height:      { type: 'number', description: 'Wall height in metres. Establish one common height per storey and pass it consistently to every wall unless a documented exception applies. Distinct from room ceiling height; default 2.8 m, not the create_space default of 2.5 m.' },
        thickness:   { type: 'number', description: 'Full wall thickness in metres, derived from the plan including insulation where shown (default 0.2 only when no plan thickness is specified).' },
        name:        { type: 'string' },
        storey_id:   { type: 'string', description: 'Target storey ID (uses focused storey if omitted)' },
        is_external: { type: 'boolean' },
        interior_side: { type: 'string', enum: ['left', 'right'], description: 'Side of the directed input line containing the interior; default left. Explicitly determine this from the plan.' },
        load_bearing:{ type: 'boolean' },
        preserve_connections: { type: 'boolean', description: 'Move existing joined endpoints with the edited endpoint. Default true.' },
        coordinates_in_pixels: { type: 'boolean', description: 'If true, coordinates are in image pixels and will be auto-converted to meters using the storey floorplan calibration.' },
        pixel_space: PIXEL_SPACE,
      },
      allOf: [
        { anyOf: [{ required: ['start_point'] }, { required: ['start_connection'] }] },
        { anyOf: [{ required: ['end_point'] }, { required: ['end_connection'] }] },
      ],
    },
  },
  {
    name: 'update_wall',
    description: 'Update geometry or properties of an existing wall while preserving or creating endpoint connections.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Wall ID or GlobalId' },
        start_point: { type: 'array', items: { type: 'number' }, description: 'Optional new start [x,y]' },
        end_point: { type: 'array', items: { type: 'number' }, description: 'Optional new end [x,y]' },
        start_connection: { type: 'object', properties: { wall_id: { type: 'string' }, end: { type: 'string', enum: ['start', 'end'] } }, required: ['wall_id', 'end'] },
        end_connection: { type: 'object', properties: { wall_id: { type: 'string' }, end: { type: 'string', enum: ['start', 'end'] } }, required: ['wall_id', 'end'] },
        height: { type: 'number' }, thickness: { type: 'number' }, name: { type: 'string' },
        is_external: { type: 'boolean' }, load_bearing: { type: 'boolean' },
        preserve_connections: { type: 'boolean', description: 'Move existing joined endpoints with the edited endpoint. Default true.' },
        coordinates_in_pixels: { type: 'boolean' },
        pixel_space: PIXEL_SPACE,
      },
      required: ['id'],
    },
  },
  {
    name: 'connect_walls',
    description: 'Join two wall endpoints into one continuous wall junction. Existing junction branches move with the selected endpoints.',
    inputSchema: {
      type: 'object',
      properties: {
        first: { type: 'object', properties: { wall_id: { type: 'string' }, end: { type: 'string', enum: ['start', 'end'] } }, required: ['wall_id', 'end'] },
        second: { type: 'object', properties: { wall_id: { type: 'string' }, end: { type: 'string', enum: ['start', 'end'] } }, required: ['wall_id', 'end'] },
        point: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: 'Optional explicit junction [x,y]. Defaults to midpoint.' },
      },
      required: ['first', 'second'],
    },
  },
  {
    name: 'list_opening_types',
    description: 'List available door and window catalogue types. Pass an id as catalogue_id when creating or updating an opening.',
    inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['Door', 'Window'] } } },
  },
  {
    name: 'create_door',
    description: 'Before generation, call get_storey_floorplan and follow calibration_help.generation_guidance. Read the host wall endpoints. Specify measured hinge_point and opening_towards; position, when supplied, is the opening CENTRE fraction, not the hinge. Select the type from the returned floorplan/scene catalogue; list_opening_types is optional. Verify the result against the measured references.',
    inputSchema: {
      type: 'object',
      properties: {
        hinge_point: { oneOf: [{ type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, { type: 'string' }], description: 'World point or marker at the hinge jamb. Prefer this over ambiguous left/right.' },
        opening_towards: { oneOf: [{ type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, { type: 'string' }], description: 'World point or marker on the side the leaf opens toward, independent of wall drawing direction.' },
        catalogue_id: { type: 'string', description: 'Type ID from the floorplan/scene catalogue, or list_opening_types' },
        swing: { type: 'string', enum: ['left', 'right'], description: 'left=hinge toward wall start, right=hinge toward wall end; not viewer-relative' },
        side: { type: 'number', enum: [1, -1], description: '1=left normal (-dy,dx), -1=opposite normal; prefer opening_towards for a physical location' },
        wall_id:        { type: 'string', description: 'Host wall ID or GlobalId' },
        position:       { type: 'number', description: 'CENTRE fraction along the wall [0–1], not hinge position or metres. Measure from wall start. Default 0.5 only means the midpoint, not an inferred position.' },
        width:          { type: 'number', description: 'Width in metres (default 0.9)' },
        height:         { type: 'number', description: 'Height in metres (default 2.1)' },
        name:           { type: 'string' },
        operation_type: { type: 'string', description: 'SINGLE_SWING_LEFT | SINGLE_SWING_RIGHT | DOUBLE_DOOR_SINGLE_SWING | SLIDING | SECTIONAL | ROLLINGUP | TILT_UP (garage basculante). Width alone never selects an operation type.' },
      },
      required: ['wall_id'],
    },
  },
  {
    name: 'create_window',
    description: 'Read get_storey_floorplan generation guidance and the host wall endpoints first. Measure the opening centre, width and sill; select a catalogue_id from the floorplan/scene catalogue. Do not guess its position from the room name.',
    inputSchema: {
      type: 'object',
      properties: {
        hinge_point: { oneOf: [{ type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, { type: 'string' }], description: 'World point or marker at the hinge jamb. Prefer this over ambiguous left/right.' },
        opening_towards: { oneOf: [{ type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, { type: 'string' }], description: 'World point or marker on the side the leaf opens toward, independent of wall drawing direction.' },
        catalogue_id: { type: 'string', description: 'Type ID from the floorplan/scene catalogue, or list_opening_types' },
        operation_type: { type: 'string' },
        swing: { type: 'string', enum: ['left', 'right'], description: 'left=hinge toward wall start, right=hinge toward wall end; not viewer-relative' },
        side: { type: 'number', enum: [1, -1], description: '1=left normal (-dy,dx), -1=opposite normal; prefer opening_towards for a physical location' },
        wall_id:     { type: 'string', description: 'Host wall ID or GlobalId' },
        position:    { type: 'number', description: 'CENTRE fraction along the wall [0–1], not hinge position or metres. Measure from wall start. Default 0.5 only means the midpoint, not an inferred position.' },
        width:       { type: 'number', description: 'Width in metres (default 1.2)' },
        height:      { type: 'number', description: 'Height in metres (default 1.2)' },
        sill_height: { type: 'number', description: 'Sill height in metres (default 0.9)' },
        name:        { type: 'string' },
      },
      required: ['wall_id'],
    },
  },
  {
    name: 'create_section',
    description: 'Create a saved section plane (IfcAnnotation, internal type Section). geometry accepts either x1,y1,x2,y2 in plan metres (vertical cut) or origin and normal as three-number arrays in Three.js world coordinates: [plan x, elevation, -plan y]. normal points toward the retained side; it may be inclined or horizontal. depth is a positive distance in metres (default 10). Edit with update_element; inspect with get_element_properties; delete with delete_element. Find saved cuts in get_ifc_scene_overview or list_ifc_entities with ifc_type IfcAnnotation.',
    inputSchema: { type: 'object', properties: {
      storey_id: { type: 'string' }, name: { type: 'string' },
      geometry: { type: 'object', properties: {
        x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' },
        origin: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        normal: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        depth: { type: 'number', exclusiveMinimum: 0 },
      }, oneOf: [{ required: ['x1', 'y1', 'x2', 'y2'] }, { required: ['origin', 'normal'] }] },
    }, required: ['geometry'] },
  },
  {
    name: 'create_roof',
    description: 'Create a roof on a storey. geometry requires polygon (at least 3 [x,y] world metre points); optional thickness, elevation above storey (metres), roofType (flat, shed, gable, hip, custom), pitch (degrees 0–80), overhang (metres), ridgeSwap (boolean, rotate ridge 90 degrees), edges (one {gable:boolean,pitch:number} per polygon edge for custom roofs). Edit with update_element; remove with delete_element.',
    inputSchema: { type: 'object', properties: { storey_id: { type: 'string' }, name: { type: 'string' }, attach_walls: { type: 'boolean', default: false, description: 'Attach eligible walls on this storey to the roof underside. Excludes curtain walls and walls with openings above the roof. Returns attached_wall_ids. False or omitted leaves attachments unchanged.' }, geometry: { type: 'object', properties: { polygon: { type: 'array', minItems: 3, items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } }, thickness: { type: 'number', exclusiveMinimum: 0 }, elevation: { type: 'number' }, roofType: { type: 'string', enum: ['flat', 'shed', 'gable', 'hip', 'custom'] }, pitch: { type: 'number', minimum: 0, maximum: 80 }, overhang: { type: 'number', minimum: 0 }, ridgeSwap: { type: 'boolean' }, edges: { type: 'array', items: { type: 'object', properties: { gable: { type: 'boolean' }, pitch: { type: 'number', exclusiveMinimum: 0, maximum: 80 } }, required: ['gable', 'pitch'] } } }, required: ['polygon'] } }, required: ['geometry'] },
  },
  {
    name: 'create_stair',
    description: 'Create a parametric staircase between two storeys. Forms: straight, quarter, doubleQuarter (three flights), half (two opposite flights), spiral. geometry accepts x,y,rotation (radians),width,going,form,targetId,count (omit for automatic),turn (1 or -1),landing (false for winders),landingLength (at least width),flightLengths (one length per straight flight; preserves existing flights; startWinders:true moves the first turn to the departure, preserving straight flight lengths),landings (one {length,width} per landing),turnRadius (inner radius for winders),radius (spiral inner radius; outer diameter = 2*(radius+width)),railLeft,railRight,railHeight,railStyle (bars or solid),opening ({slabId,x,y,width,depth}, only after user validation). Dimensions in metres. Edit with update_element.',
    inputSchema: {type:'object',properties:{storey_id:{type:'string'},name:{type:'string'},geometry:{type:'object',properties:{targetId:{type:'string'},form:{type:'string',enum:['straight','quarter','doubleQuarter','half','spiral']},x:{type:'number'},y:{type:'number'},width:{type:'number',exclusiveMinimum:0},going:{type:'number',exclusiveMinimum:0},rotation:{type:'number'},count:{type:'integer',minimum:2,maximum:300},turn:{type:'number',enum:[1,-1]},landing:{type:'boolean'},radius:{type:'number',minimum:0},startWinders:{type:'boolean'},turnRadius:{type:'number',minimum:0},flightLengths:{type:'array',maxItems:3,items:{type:'number',minimum:0}},landings:{type:'array',maxItems:2,items:{type:'object',properties:{length:{type:'number',exclusiveMinimum:0},width:{type:'number',exclusiveMinimum:0}},required:['length','width']}},railLeft:{type:'boolean'},railRight:{type:'boolean'},railHeight:{type:'number',exclusiveMinimum:0},railStyle:{type:'string',enum:['bars','solid']}},required:['targetId']}},required:['geometry']},
  },
  {
    name: 'update_element',
    description: 'Update an element by ID or GlobalId. Use get_element_properties first. properties accepts name and editable type-specific fields (e.g. description, category, model, function, Material). geometry accepts stair parameters as in create_stair (count:null restores automatic calculation); other type-specific fields: furniture/generic x,y,w,d,h,rotation (radians); roof polygon,thickness,elevation,roofType,pitch (degrees),overhang,ridgeSwap,edges (as in create_roof); room polygon,height; slab polygon,thickness; marker x,y; dimension x1,y1,x2,y2; section x1,y1,x2,y2 (vertical cut) OR origin,normal ([plan x,elevation,-plan y] world coordinates), plus positive depth in metres; never mix line coordinates with origin/normal; technical x,y,rotation,mountHeight; storey level,elevation,thickness. Coordinates are in metres. For walls and doors/windows use update_wall and update_opening for geometry.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string', description: 'Element ID or GlobalId' },
      attach_walls: { type: 'boolean', default: false, description: 'Roof only: attach eligible walls on the same storey after applying the roof update, as in create_roof. False or omitted leaves attachments unchanged. Returns attached_wall_ids when true.' },
      properties: { type: 'object', description: 'Partial editable element properties; use name for the display name.' },
      geometry: { type: 'object', description: 'Partial geometry; fields depend on element type.' },
    }, required: ['id'] },
  },
  {
    name: 'update_opening',
    description: 'Update an existing door or window by ID or GlobalId. Swing is the hinge direction along the host wall; side selects which side of the wall it opens toward.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string' }, swing: { type: 'string', enum: ['left', 'right'] },
      side: { type: 'number', enum: [1, -1], description: '1 or -1, relative to the direction of the host wall' },
      position: { type: 'number', minimum: 0, maximum: 1 }, width: { type: 'number', exclusiveMinimum: 0 },
      height: { type: 'number', exclusiveMinimum: 0 }, sill_height: { type: 'number', minimum: 0 },
      hinge_point: { oneOf: [{ type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, { type: 'string' }] },
      opening_towards: { oneOf: [{ type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, { type: 'string' }] },
      catalogue_id: { type: 'string', description: 'Type ID from the floorplan/scene catalogue, or list_opening_types' },
      operation_type: { type: 'string' }, name: { type: 'string' },
    }, required: ['id'] },
  },
  {
    name: 'list_object_types',
    description: 'List available furniture/object models from built-in, personal and project catalogues, including dimensions. Pass id as catalogue_id to create_furniture or update_furniture.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_furniture',
    description: 'Follow get_storey_floorplan calibration_help.generation_guidance BEFORE creation. Use the catalogue included in get_storey_floorplan/get_ifc_scene_overview (list_object_types is optional); use a real catalogue_id and its local width/depth. Place the measured centre with anchor=center, or the rear attachment with anchor=back on the inner wall face. Use facing_point for the visible front, not a guessed rotation. Check all rotated footprint corners fit inside the target room. Dimensions are metres; an image top-left is NOT a world lower-left.',
    inputSchema: { type: 'object', properties: { ...furnitureProperties, storey_id: { type: 'string' } }, required: ['point'] },
  },
  {
    name: 'update_furniture',
    description: 'Update furniture by ID or GlobalId: select a catalogue model, change dimensions, move from a marker, or orient toward a reference. Read get_element_properties first. Omitted fields retain current values; catalogue selection applies model dimensions.',
    inputSchema: { type: 'object', properties: { ...furnitureProperties, id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'create_space',
    description: 'Create a space / room from a polygon outline. Pass coordinates_in_pixels: true when coordinates come from a floorplan image.',
    inputSchema: {
      type: 'object',
      properties: {
        polygon:   { type: 'array', minItems: 3, items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, description: 'Array of [x, y] points (metres or pixels if coordinates_in_pixels is true) defining the room outline. Min 3 points.' },
        height:    { type: 'number', description: 'Ceiling height in metres (default 2.5)' },
        name:      { type: 'string' },
        storey_id: { type: 'string' },
        function:  { type: 'string', description: 'Room function, e.g. OFFICE, BEDROOM, KITCHEN' },
        coordinates_in_pixels: { type: 'boolean', description: 'If true, coordinates are in image pixels and will be auto-converted to meters using the storey floorplan calibration.' },
        pixel_space: PIXEL_SPACE,
      },
      required: ['polygon'],
    },
  },
  {
    name: 'delete_element',
    description: 'Delete one or more IFC elements by ID or GlobalId.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: 'Array of element IDs or GlobalIds' },
      },
      required: ['ids'],
    },
  },
  {
    name: 'export_ifc',
    description: 'Export the current model as IFC4 STEP text. Returns the file content as a string.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Suggested filename (default: export.ifc)' },
      },
    },
  },
  {
    name: 'create_sheet',
    description: 'Create a printable sheet (drawing sheet with frame and title block) in the project. Defaults: A3 landscape, next number in the A101, A102… series, project name in the title block. Then place views with add_sheet_view and check the result with export_sheet. The user exports it to PDF from the app (Sheets view or Export menu).',
    inputSchema: { type: 'object', properties: {
      name: { type: 'string' }, number: { type: 'string', maxLength: 20 },
      format: { type: 'string', enum: ['A4', 'A3', 'A2', 'A1', 'A0'] }, orientation: { type: 'string', enum: ['landscape', 'portrait'] },
      project: { type: 'string', description: 'Title block project name (default: the model project name).' },
      author: { type: 'string' }, date: { type: 'string' }, revision: { type: 'string' },
    }, additionalProperties: false },
  },
  {
    name: 'add_sheet_view',
    description: 'Place a view on a sheet at a drawing scale: kind plan with source_id a storey id, or kind section with source_id a saved section (create_section). position is the view frame centre in millimetres from the sheet top-left corner (default: sheet centre); paper sizes are A4 297×210, A3 420×297, A2 594×420, A1 841×594, A0 1189×841 mm in landscape (swap for portrait). The 10 mm border and the 180×36 mm title block in the bottom-right corner must stay clear. crop limits the model region in metres (plan x/y, or section distance along the cut/elevation). Returns the frame in mm and layout_issues (overlaps, frame overflow): fix them with update_sheet_view (move, rescale, crop), choosing a smaller scale or cropping.',
    inputSchema: { type: 'object', properties: {
      sheet_id: { type: 'string' }, kind: { type: 'string', enum: ['plan', 'section'] }, source_id: { type: 'string' },
      scale: { type: 'number', enum: [20, 50, 100, 200], description: 'Drawing scale denominator: 100 means 1/100 (default).' },
      position: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
      crop: { type: 'object', properties: {
        min: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
        max: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
      }, required: ['min', 'max'] },
      title: { type: 'string', description: 'View title under the frame (default: "Plan <storey>" or the section name).' },
    }, required: ['sheet_id', 'source_id'], additionalProperties: false },
  },
  {
    name: 'update_sheet_view',
    description: 'Change a view already on a sheet: position (frame centre, mm from the sheet top-left), scale, crop (metres; null removes it), title, or remove:true to take it off the sheet. Returns the frame in mm and layout_issues.',
    inputSchema: { type: 'object', properties: {
      sheet_id: { type: 'string' }, view_id: { type: 'string' },
      position: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
      scale: { type: 'number', enum: [20, 50, 100, 200] },
      crop: { oneOf: [{ type: 'null' }, { type: 'object', properties: {
        min: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
        max: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
      }, required: ['min', 'max'] }] },
      title: { type: 'string' }, remove: { type: 'boolean' },
    }, required: ['sheet_id', 'view_id'], additionalProperties: false },
  },
  {
    name: 'export_sheet',
    description: 'Without sheet_id: list the sheets. With sheet_id: return the sheet as a standalone SVG sized in millimetres (content), each view frame position in mm, and layout_issues to check the layout (views overlapping each other or the title block, or overflowing the border). Read-only; PDF export happens in the app.',
    inputSchema: { type: 'object', properties: { sheet_id: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'measure_distance',
    description: 'Measure the distance between two points or two elements.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Element ID, GlobalId, or coordinates as "x,y" or "[x,y]"' },
        to: { type: 'string', description: 'Element ID, GlobalId, or coordinates as "x,y" or "[x,y]"' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'create_slab',
    description: 'Add a persistent slab (dalle) to the plan. Pass coordinates_in_pixels: true when coordinates come from a floorplan image.',
    inputSchema: {
      type: 'object',
      properties: {
        polygon: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: '[[x,y], [x,y], ...] polygon vertices (in metres or pixels if coordinates_in_pixels is true)' },
        thickness: { type: 'number', description: 'Slab thickness in meters' },
        name: { type: 'string' },
        storey_id: { type: 'string' },
        coordinates_in_pixels: { type: 'boolean', description: 'If true, coordinates are in image pixels and will be auto-converted to meters using the storey floorplan calibration.' },
        pixel_space: PIXEL_SPACE,
      },
      required: ['polygon'],
    },
  },
  {
    name: 'create_dimension',
    description: 'Add a persistent dimension line (cotation) to the plan. Pass coordinates_in_pixels: true when coordinates come from a floorplan image.',
    inputSchema: {
      type: 'object',
      properties: {
        p1: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[x, y] start point (in metres or pixels if coordinates_in_pixels is true)' },
        p2: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[x, y] end point (in metres or pixels if coordinates_in_pixels is true)' },
        name: { type: 'string', description: 'Optional name for the dimension' },
        storey_id: { type: 'string', description: 'ID of the storey to place the dimension on' },
        coordinates_in_pixels: { type: 'boolean', description: 'If true, coordinates are in image pixels and will be auto-converted to meters using the storey floorplan calibration.' },
        pixel_space: PIXEL_SPACE,
      },
      required: ['p1', 'p2'],
    },
  },
  {
    name: 'create_marker',
    description: 'Create a reference marker at a structural point in the plan. Its coordinates can be used by the placement tools.',
    inputSchema: { type: 'object', properties: {
      point: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
      name: { type: 'string' }, description: { type: 'string' }, storey_id: { type: 'string' },
      coordinates_in_pixels: { type: 'boolean' },
      pixel_space: PIXEL_SPACE,
    }, required: ['point'] },
  },
  {
    name: 'create_technical',
    description: 'Create a technical MEP element (socket, switch, plumbing connection, water inlet/outlet, radiator, data point) in the current model. Pass coordinates_in_pixels: true when coordinates come from a floorplan image.',
    inputSchema: {
      type: 'object',
      properties: {
        point: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: '[x, y] coordinates in metres (or pixels if coordinates_in_pixels is true) for the element placement' },
        discipline: { type: 'string', enum: [...TECHNICAL_DISCIPLINES], description: 'Technical discipline' },
        category: { type: 'string', description: 'Category label (e.g. "Prises de courant", "Arrivées d\'eau", "Chauffage", "Réseau")' },
        model: { type: 'string', description: 'Model identifier key (e.g. "prise-courant-simple", "arrivee-eau-froide", "radiateur-eau")' },
        name: { type: 'string', description: 'Descriptive element label' },
        mount_height: { type: 'number', description: 'Mounting height in meters' },
        rotation: { type: 'number', description: 'Radians counterclockwise in world plan coordinates; never degrees. At zero the wall-mounted face points south (-Y).' },
        storey_id: { type: 'string', description: 'Target storey ID (uses focused storey if omitted)' },
        coordinates_in_pixels: { type: 'boolean', description: 'If true, coordinates are in image pixels and will be auto-converted to meters using the storey floorplan calibration.' },
        pixel_space: PIXEL_SPACE,
        amperage: { type: 'string', description: 'Optional amperage for electrical (e.g. "16A", "32A")' },
        circuit_ref: { type: 'string', description: 'Optional circuit reference for electrical' },
        fluid_type: { type: 'string', description: 'Optional fluid type for plumbing (e.g. "froide", "chaude")' },
        diameter: { type: 'number', description: 'Optional pipe diameter in mm' },
        hvac_type: { type: 'string', description: 'Optional heating/cooling type' },
      },
      required: ['point', 'discipline', 'category', 'model'],
    },
  },
  {
    name: 'update_technical',
    description: 'Update the properties, placement coordinate, or specifications of an existing technical element.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The unique element ID or GlobalId of the technical element to update.' },
        point: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: 'Updated [x, y] coordinates in metres (or pixels if coordinates_in_pixels is true)' },
        discipline: { type: 'string', enum: [...TECHNICAL_DISCIPLINES] },
        category: { type: 'string' },
        model: { type: 'string' },
        name: { type: 'string' },
        mount_height: { type: 'number' },
        rotation: { type: 'number', description: 'Radians counterclockwise in world plan coordinates; zero faces south (-Y).' },
        coordinates_in_pixels: { type: 'boolean' },
        pixel_space: PIXEL_SPACE,
        amperage: { type: 'string' },
        circuit_ref: { type: 'string' },
        fluid_type: { type: 'string' },
        diameter: { type: 'number' },
        hvac_type: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_column',
    description: 'Create a structural column (IfcColumn) centred on point. Rectangular (width × depth) or circular (diameter). Height defaults to the storey height (floor to next floor). Pass coordinates_in_pixels: true when coordinates come from a floorplan image.',
    inputSchema: { type: 'object', properties: {
      point: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: 'Centre [x, y] in metres (or pixels if coordinates_in_pixels is true).' },
      shape: { type: 'string', enum: ['rect', 'circle'], description: 'Section shape; default rect.' },
      width: { type: 'number', description: 'Section width along local X in metres (rect; default 0.30).' },
      depth: { type: 'number', description: 'Section depth along local Y in metres (rect; default 0.30).' },
      diameter: { type: 'number', description: 'Diameter in metres (circle).' },
      height: { type: 'number', description: 'Height in metres; defaults to the storey height.' },
      rotation: { type: 'number', description: 'Radians counterclockwise; never degrees.' },
      material: { type: 'string' }, name: { type: 'string' }, storey_id: { type: 'string' },
      coordinates_in_pixels: { type: 'boolean' }, pixel_space: PIXEL_SPACE,
    }, required: ['point'] },
  },
  {
    name: 'update_column',
    description: 'Update an existing column: position, shape, section, height, rotation, material or name. Omitted fields are kept.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string', description: 'Column ID or GlobalId.' },
      point: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
      shape: { type: 'string', enum: ['rect', 'circle'] },
      width: { type: 'number' }, depth: { type: 'number' }, diameter: { type: 'number' }, height: { type: 'number' },
      rotation: { type: 'number', description: 'Radians counterclockwise.' },
      material: { type: 'string' }, name: { type: 'string' },
      coordinates_in_pixels: { type: 'boolean' }, pixel_space: PIXEL_SPACE,
    }, required: ['id'] },
  },
  {
    name: 'create_chimney',
    description: 'Create a chimney, fireplace or stove (IfcChimney) centred on point. kind "flue": a single shaft (width × depth, default 0.50 × 0.50). kind "fireplace": a hearth block (width × depth × hearth_height, default 1.20 × 0.60 × 1.00) with a flue (flue_width × flue_depth) rising from it against its back (+Y local side). Height defaults to the storey height or, when a roof (of any storey of the building) covers the point, to 0.50 m above that roof surface.',
    inputSchema: { type: 'object', properties: {
      point: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, description: 'Centre [x, y] in metres (or pixels if coordinates_in_pixels is true).' },
      through_roof: { type: 'boolean', description: 'Default true: raise the chimney 0.50 m above the roof covering it, unless height is given.' },
      kind: { type: 'string', enum: ['flue', 'fireplace', 'stove'], description: 'Default flue. stove: a wood/pellet stove body (width × depth × hearth_height, default 0.50 × 0.45 × 0.90) with a round flue pipe (diameter flue_width, default 0.15) up to the height.' },
      width: { type: 'number' }, depth: { type: 'number' },
      height: { type: 'number', description: 'Total height in metres; defaults to the storey height.' },
      flue_width: { type: 'number' }, flue_depth: { type: 'number' }, hearth_height: { type: 'number' },
      rotation: { type: 'number', description: 'Radians counterclockwise; at zero a fireplace opens towards -Y.' },
      material: { type: 'string' }, name: { type: 'string' }, storey_id: { type: 'string' },
      coordinates_in_pixels: { type: 'boolean' }, pixel_space: PIXEL_SPACE,
    }, required: ['point'] },
  },
  {
    name: 'update_chimney',
    description: 'Update an existing chimney: position, kind, dimensions, rotation, material or name. Omitted fields are kept; switching kind resets width/depth to the new kind defaults unless given.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string', description: 'Chimney ID or GlobalId.' },
      point: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
      kind: { type: 'string', enum: ['flue', 'fireplace', 'stove'] },
      width: { type: 'number' }, depth: { type: 'number' }, height: { type: 'number' },
      flue_width: { type: 'number' }, flue_depth: { type: 'number' }, hearth_height: { type: 'number' },
      through_roof: { type: 'boolean', description: 'Raise the chimney 0.50 m above the roof covering it (unless height is given).' },
      rotation: { type: 'number' }, material: { type: 'string' }, name: { type: 'string' },
      coordinates_in_pixels: { type: 'boolean' }, pixel_space: PIXEL_SPACE,
    }, required: ['id'] },
  },
  {
    name: 'generate_visualization',
    description: 'Generate an architectural illustration. Cloud mode uses the saved project and account AI preferences; local mode uses the open editor. Requires write access and approval unless confirmation is disabled. Video support depends on the provider.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['image', 'video'], description: 'Type of rendering: "image" or "video"' },
        prompt: { type: 'string', description: 'Description of the architectural rendering or scene, including materials, style, lighting, camera position, and atmosphere.' },
        room_id: { type: 'string', description: 'Optional ID or name of a specific room/space to focus the generation on' },
        style: { type: 'string', enum: ['modern', 'scandinavian', 'industrial', 'classic', 'minimalist', 'rustic', 'brutalist'], description: 'Architectural style' },
        time_of_day: { type: 'string', enum: ['daylight', 'sunset', 'night', 'twilight'], description: 'Lighting/atmosphere time of day' },
        aspect_ratio: { type: 'string', enum: ['16:9', '4:3', '1:1'], description: 'Aspect ratio of the rendering' },
      },
      required: ['type', 'prompt'],
    }
  },
] satisfies Tool[];
