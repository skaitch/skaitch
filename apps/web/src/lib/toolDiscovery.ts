// Progressive tool discovery for small local models: instead of sending every tool schema
// (~13k tokens for 48 tools), the model gets a one-line catalogue plus a `load_tools` tool,
// and only the schemas it asks for are sent on the next pass.
import { TOOL_HINTS, getToolSchema } from './aiTools';
import type { AiMessage } from '../types/ai';

export const LOAD_TOOLS = 'load_tools';
/** Discovery passes allowed inside one conversation round before the answer is returned as is. */
export const MAX_DISCOVERY_PASSES = 2;
/** Output cap per request in discovery mode: room for ~40 tool calls, not for a runaway loop. */
export const MAX_OUTPUT_TOKENS = 4096;

/**
 * MCP session tools: an external client needs them to open a project and a storey, but the
 * in-app chat already works in the open project and active storey. Small models offered them
 * wander off listing projects and invent storey IDs, so the catalogue leaves them out.
 */
const SESSION_TOOLS = new Set(['list_projects', 'select_project', 'select_storey']);
const TOOL_NAMES = new Set(TOOL_HINTS.map(h => h.name).filter(name => !SESSION_TOOLS.has(name)));

export const loadToolsDef = {
  type: 'function',
  function: {
    name: LOAD_TOOLS,
    description: 'Loads the full definitions of the named tools from the catalogue so they can be called next.',
    parameters: {
      type: 'object',
      properties: { names: { type: 'array', items: { type: 'string' }, description: 'Tool names from the catalogue.' } },
      required: ['names'],
    },
  },
};

export function toolDef(name: string) {
  const hint = TOOL_HINTS.find(h => h.name === name);
  return { type: 'function', function: { name, description: hint?.hint ?? name, parameters: getToolSchema(name) } };
}

/** First sentence of each tool hint, kept short: enough to choose, not to call. */
export function toolCatalogue(): string {
  return TOOL_HINTS.filter(h => TOOL_NAMES.has(h.name)).map(h =>`- ${h.name}: ${h.hint.split(/(?<=[.;])\s/)[0].slice(0, 90)}`).join('\n');
}

export function discoveryPrompt(): string {
  return `TOOL DISCOVERY:
Only the tools whose definitions were loaded can be called. To act, first call ${LOAD_TOOLS} with every catalogue tool you need for the request, then call them. Do not load tools to answer a plain question. When the user asks to create or change elements, call the tools: never only describe what you would create. The project and the storey are already open: never try to list or select them.
TOOL CATALOGUE:
${toolCatalogue()}`;
}

/**
 * Adds the discovery section to the system prompt, keeping the conversation's closing
 * "CURRENT CONTEXT:" block last: small models follow the final lines best.
 */
export function withDiscovery(system: string, contextMarker = 'CURRENT CONTEXT:'): string {
  const at = system.lastIndexOf(`\n${contextMarker}`);
  if (at < 0) return `${system}\n\n${discoveryPrompt()}`;
  return `${system.slice(0, at).trimEnd()}\n\n${discoveryPrompt()}\n\n${system.slice(at + 1)}`;
}

/** Tools called in earlier rounds stay loaded, as their schemas are not kept between rounds. */
export function toolsUsedInHistory(messages: Pick<AiMessage, 'role' | 'content'>[]): Set<string> {
  const used = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'assistant' || typeof message.content !== 'string') continue;
    for (const name of TOOL_NAMES) if (message.content.includes(`${name}(`)) used.add(name);
  }
  return used;
}

/** Element words (French and English) and the tools that obviously serve them. */
const REQUEST_TOOLS: [RegExp, string[]][] = [
  [/\b(murs?|walls?|cloisons?|partitions?)\b/i, ['create_wall', 'update_wall']],
  [/\b(portes?|doors?)\b/i, ['create_door']],
  [/\b(fen[eê]tres?|windows?|baies?)\b/i, ['create_window']],
  [/\b(pi[eè]ces?|rooms?|spaces?|chambres?|salons?|cuisines?)\b/i, ['create_space']],
  [/\b(dalles?|slabs?|planchers?)\b/i, ['create_slab']],
  [/\b(toits?|toitures?|roofs?)\b/i, ['create_roof']],
  [/\b(escaliers?|stairs?|staircases?)\b/i, ['create_stair']],
  [/\b(cotes?|cotations?|dimensions?)\b/i, ['create_dimension']],
  [/\b(meubles?|mobiliers?|furniture|[ée]viers?|sinks?|wc|lavabos?|vasques?)\b/i, ['create_furniture']],
  [/\b(poteaux?|colonnes?|piliers?|columns?|pillars?)\b/i, ['create_column', 'update_column']],
  [/\b(chemin[ée]es?|conduits?|foyers?|chimneys?|fireplaces?|flues?|po[eê]les?|stoves?)\b/i, ['create_chimney', 'update_chimney']],
  [/\b(supprime[rz]?|efface[rz]?|delete|remove)\b/i, ['delete_element']],
];

/**
 * Tools the user's own words call for. Small models often answer in prose instead of calling
 * load_tools, so these are loaded from the start; the catalogue still covers everything else.
 */
export function toolsForRequest(messages: Pick<AiMessage, 'role' | 'content'>[]): Set<string> {
  const text = messages
    .filter(m => m.role === 'user' && typeof m.content === 'string' && !m.content.startsWith('[Tool results]'))
    .map(m => m.content).join('\n');
  const names = new Set<string>();
  for (const [pattern, tools] of REQUEST_TOOLS) if (pattern.test(text)) tools.forEach(name => names.add(name));
  return names;
}

/** Names requested by a native `load_tools` call. */
export function requestedNames(input: unknown): string[] {
  const names = (input as { names?: unknown } | null)?.names;
  return Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string') : [];
}

/** Some models write the call as JSON text (often without the closing brace) instead of a native call. */
export function textLoadToolsCall(text: string): string[] | null {
  const match = text.match(new RegExp(`"${LOAD_TOOLS}"[\\s\\S]*?"names"\\s*:\\s*\\[([^\\]]*)\\]`));
  if (!match) return null;
  return [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
}

/** Catalogue tools a model tried to call as JSON text, e.g. {"name": "create_wall", "arguments": …}. */
export function textToolNames(text: string): string[] {
  return [...text.matchAll(/"(?:name|tool)"\s*:\s*"([^"]+)"/g)].map(m => m[1]).filter(name => TOOL_NAMES.has(name));
}

export function splitKnown(names: string[]): { known: string[]; unknown: string[] } {
  const unique = [...new Set(names)];
  return { known: unique.filter(n => TOOL_NAMES.has(n)), unknown: unique.filter(n => !TOOL_NAMES.has(n)) };
}
