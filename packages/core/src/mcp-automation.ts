import { CHAT_SKILLS, CHAT_TOOL_HINTS, getToolSchema, searchChatTools } from './ai/tools.js';
import { GENERATION_GUIDE } from './lib/generationGuide.js';
import { TOOLS } from './mcp-tools.js';

export const MCP_BATCH_TOOLS = [
  'create_slab', 'create_wall', 'connect_walls', 'create_space', 'create_door',
  'create_window', 'create_dimension', 'create_furniture', 'create_technical', 'create_marker', 'create_roof',
  'create_column', 'create_chimney',
] as const;

export const MCP_TOOLS = [
  ...TOOLS,
  ...CHAT_TOOL_HINTS.map(tool => ({
    name: tool.name, description: tool.hint, inputSchema: getToolSchema(tool.name),
  })),
  {
    name: 'apply_model_batch',
    description: 'Preview and apply up to 64 ordered creations or wall connections in the selected storey after a single user approval. Read the plan and inventory first. Use search_tools for individual argument schemas. Give a creation an alias and use {"$ref":"alias.id"} as a later argument value to reference its ID. A failed operation prevents the whole batch from applying.',
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array', minItems: 1, maxItems: 64,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', enum: MCP_BATCH_TOOLS },
              alias: { type: 'string' },
              args: { type: 'object', additionalProperties: true },
            },
            required: ['name', 'args'],
          },
        },
      },
      required: ['operations'],
    },
  },
];

const PUBLIC_NAMES = new Set(['list_projects', 'select_project', 'select_storey', 'search_tools', 'load_skill', 'execute_script', 'apply_model_batch', 'call_tool']);
export const MCP_PUBLIC_TOOLS = MCP_TOOLS.filter(tool => PUBLIC_NAMES.has(tool.name));
export const MCP_INSTRUCTIONS = 'Select the project and storey first. Prefer execute_script for several reads. Before modelling, load_skill edit_model, find individual argument schemas with search_tools, and use apply_model_batch for related creations. For a single operation, use call_tool.';

export function unwrapMcpTool(name: string, args: Record<string, unknown>) {
  if (name !== 'call_tool') return { name, args };
  if (typeof args?.name !== 'string' || !TOOLS.some(tool => tool.name === args.name) || typeof args.arguments_json !== 'string') {
    throw new Error('Expected a BIM tool name and arguments_json.');
  }
  const input: unknown = JSON.parse(args.arguments_json);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a JSON object in arguments_json.');
  return { name: args.name, args: input as Record<string, unknown> };
}

export function mcpDiscovery(name: string, args: Record<string, unknown>, available = MCP_TOOLS) {
  if (name === 'search_tools') {
    const query = typeof args?.query === 'string' ? args.query.trim().toLowerCase() : '';
    const exact = available.find(tool => tool.name === query);
    return exact ? { tools: [exact] } : searchChatTools(args?.query, new Set(available.map(tool => tool.name)));
  }
  if (name === 'load_skill') {
    const id = args?.id;
    if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(CHAT_SKILLS, id)) return { error: 'Unknown skill' };
    if (id === 'edit_model') return {
      ...CHAT_SKILLS.edit_model,
      instructions: 'Inspect the selected storey and inventory requested objects before writing. Discover argument schemas with search_tools. Use call_tool for a single operation. For related creations use apply_model_batch and reference earlier IDs with {"$ref":"alias.id"}. The user approves the proposal once. Verify geometry, openings, dimensions, fixtures and omissions against the source plan.\n\n' + GENERATION_GUIDE,
    };
    return CHAT_SKILLS[id as keyof typeof CHAT_SKILLS];
  }
}
