import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '@skaitch/core/types/ifc';
import { TOOL_HINTS } from '../aiTools';
import { currentContextBlock, extractToolUsesFromText } from '../../../server/ai/conversation';
import { LOAD_TOOLS, withDiscovery, discoveryPrompt, requestedNames, splitKnown, textLoadToolsCall, toolsForRequest, toolsUsedInHistory } from '../toolDiscovery';
import { localLlm } from '../localLlm';

const ai = { provider: 'custom', model: 'lfm3-vl', baseUrl: 'http://localhost:8080/v1', temperature: 0, apiKey: '' } as AiConfig;

/** One streamed answer: optional text, then optional native tool calls. */
function sse(text: string, calls: { name: string; args: unknown }[] = []) {
  const events = [
    ...(text ? [{ choices: [{ delta: { content: text } }] }] : []),
    ...calls.map((call, index) => ({ choices: [{ delta: { tool_calls: [{ index, id: `call_${index}`, function: { name: call.name, arguments: JSON.stringify(call.args) } }] } }] })),
    { choices: [{ delta: {}, finish_reason: calls.length ? 'tool_calls' : 'stop' }] },
  ];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}

function mockAnswers(...answers: Response[]) {
  const bodies: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const next = answers.shift();
    if (!next) throw new Error('unexpected request');
    return next;
  }));
  return bodies;
}
const toolNames = (body: any) => (body.tools ?? []).map((tool: any) => tool.function.name);

afterEach(() => vi.unstubAllGlobals());

describe('tool discovery helpers', () => {
  it('lists every in-app tool in a catalogue far smaller than the schemas', () => {
    const prompt = discoveryPrompt();
    const session = ['list_projects', 'select_project', 'select_storey'];
    for (const { name } of TOOL_HINTS) {
      if (session.includes(name)) expect(prompt).not.toContain(`- ${name}:`);
      else expect(prompt).toContain(`- ${name}:`);
    }
    expect(prompt.length).toBeLessThan(8000);
  });

  it('restates project, storey and selection with their parents at the very end', () => {
    const items: any = {
      prj: { id: 'prj', type: 'Project', name: 'Maison', parentId: null },
      bld: { id: 'bld', type: 'Building', name: 'Bâtiment A', parentId: 'prj' },
      sty_23: { id: 'sty_23', type: 'Storey', name: 'RDC', parentId: 'bld' },
      wall_1: { id: 'wall_1', type: 'Wall', name: 'Mur nord', parentId: 'sty_23' },
    };
    const block = currentContextBlock(items, 'sty_23', ['wall_1']);
    expect(block).toContain('Project "Maison" (id prj)');
    expect(block).toContain('Storey "RDC" (id sty_23) in Building "Bâtiment A" (id bld) < Project "Maison" (id prj)');
    expect(block).toContain('storey_id "sty_23"');
    expect(block).toContain('Wall "Mur nord" (id wall_1) in Storey "RDC" (id sty_23) < Building');
    expect(currentContextBlock(items, 'sty_23', [])).toContain('Nothing is selected.');

    const system = withDiscovery(`RULES\n\n${block}`);
    expect(system.indexOf('TOOL CATALOGUE')).toBeLessThan(system.indexOf('CURRENT CONTEXT'));
    expect(system.trimEnd().endsWith('Nothing is selected.') || system.trimEnd().endsWith('mean these objects.')).toBe(true);
  });

  it('keeps tools called in earlier rounds, matched by name only', () => {
    const used = toolsUsedInHistory([
      { role: 'user', content: 'create_door( is ignored in user text' },
      { role: 'assistant', content: 'Done.\n\n[Tool calls]\ncreate_wall({"start_point":[0,0],"end_point":[4,' },
      { role: 'assistant', content: 'unknown_tool({})' },
    ]);
    expect([...used]).toEqual(['create_wall']);
  });

  it('reads names from native and text-form load_tools calls', () => {
    expect(requestedNames({ names: ['create_wall', 3] })).toEqual(['create_wall']);
    expect(requestedNames(null)).toEqual([]);
    // Seen with LFM3-VL: JSON text without the closing brace.
    expect(textLoadToolsCall('{"name": "load_tools", "parameters": {"names": ["create_wall", "create_door"]}')).toEqual(['create_wall', 'create_door']);
    expect(textLoadToolsCall('Bonjour !')).toBeNull();
  });

  it('maps French and English element words to their tools', () => {
    expect([...toolsForRequest([{ role: 'user', content: 'Ajoute une porte et deux fenêtres' }])].sort()).toEqual(['create_door', 'create_window']);
    expect([...toolsForRequest([{ role: 'user', content: 'Create the rooms' }])]).toEqual(['create_space']);
    expect([...toolsForRequest([{ role: 'user', content: 'Bonjour' }])]).toEqual([]);
    // Tool results are not the user's words.
    expect([...toolsForRequest([{ role: 'user', content: '[Tool results]\nwall door' }])]).toEqual([]);
  });

  it('reads calls written in the history record format', () => {
    // Seen with LFM3-VL after a tool round: it imitates the "[Tool calls]" record.
    const text = '[Tool calls]\ncreate_wall({\n  "start_point": [0, 0],\n  "end_point": [6, 0],\n  "name": "Mur {nord}"\n})\ncreate_wall({"start_point":[6,0],"end_point":[6,4]})\nfly({"x":1})';
    const uses = extractToolUsesFromText(text);
    expect(uses.map(use => use.name)).toEqual(['create_wall', 'create_wall']);
    expect(uses[0].input).toEqual({ start_point: [0, 0], end_point: [6, 0], name: 'Mur {nord}' });
    expect(extractToolUsesFromText('Je vais créer un mur (plus tard).')).toEqual([]);
  });

  it('separates catalogue names from invented ones', () => {
    expect(splitKnown(['create_wall', 'fly', 'create_wall'])).toEqual({ known: ['create_wall'], unknown: ['fly'] });
  });
});

describe('localLlm progressive discovery', () => {
  // Neutral wording: no element word, so nothing is preloaded from the request.
  const messages = [{ role: 'user' as const, content: 'Fais ce qui est demandé.' }];

  it('preloads the tools named by the request, even after a read tool round', async () => {
    const bodies = mockAnswers(sse('OK'));
    await localLlm([
      { role: 'user', content: 'Create the walls visible on the plan' },
      { role: 'assistant', content: '[Tool calls]\nget_storey_floorplan({"storey_id":"sty_23"})' },
      { role: 'user', content: '[Tool results]\nget_storey_floorplan: {"plan":{"url":"[Image attached to the next request]"}} door' },
    ], ai, 'SYSTEM');
    expect(toolNames(bodies[0]).sort()).toEqual([LOAD_TOOLS, 'create_wall', 'get_storey_floorplan', 'update_wall'].sort());
  });

  it('sends only load_tools first, then the requested schema, and hides load_tools', async () => {
    const bodies = mockAnswers(
      sse('', [{ name: LOAD_TOOLS, args: { names: ['create_wall', 'teleport'] } }]),
      sse('', [{ name: 'create_wall', args: { start_point: [0, 0], end_point: [4, 0] } }]),
    );
    const result = await localLlm(messages, ai, 'SYSTEM');
    expect(toolNames(bodies[0])).toEqual([LOAD_TOOLS]);
    expect(bodies[0].messages[0].content).toContain('TOOL CATALOGUE');
    expect(toolNames(bodies[1])).toEqual([LOAD_TOOLS, 'create_wall']);
    const toolMessage = bodies[1].messages.at(-1);
    expect(toolMessage.role).toBe('tool');
    expect(toolMessage.content).toContain('Loaded: create_wall.');
    expect(toolMessage.content).toContain('Not in the catalogue: teleport.');
    expect(result.toolUses.map(use => use.name)).toEqual(['create_wall']);
  });

  it('accepts a load_tools call written as text', async () => {
    const bodies = mockAnswers(
      sse('{"name": "load_tools", "parameters": {"names": ["create_wall"]}'),
      sse('', [{ name: 'create_wall', args: {} }]),
    );
    const result = await localLlm(messages, ai, 'SYSTEM');
    expect(toolNames(bodies[1])).toContain('create_wall');
    expect(result.toolUses.map(use => use.name)).toEqual(['create_wall']);
  });

  it('loads a catalogue tool the model called directly as text', async () => {
    const bodies = mockAnswers(
      sse('{"name":"create_wall","arguments":{"}}'),
      sse('', [{ name: 'create_wall', args: { start_point: [0, 0] } }]),
    );
    const result = await localLlm(messages, ai, 'SYSTEM');
    expect(toolNames(bodies[1])).toEqual([LOAD_TOOLS, 'create_wall']);
    expect(result.toolUses.map(use => use.name)).toEqual(['create_wall']);
  });

  it('leaves a text call to an already loaded tool for the conversation parser', async () => {
    const bodies = mockAnswers(sse('{"name":"create_wall","arguments":{}}'));
    const history = [...messages, { role: 'assistant' as const, content: '[Tool calls]\ncreate_wall({})' }, { role: 'user' as const, content: '[Tool results]\nok' }];
    const result = await localLlm(history, ai, 'SYSTEM');
    expect(bodies).toHaveLength(1);
    expect(result.text).toContain('create_wall');
  });

  it('allows several tool calls per answer without forcing them', async () => {
    const bodies = mockAnswers(sse('', [{ name: 'create_wall', args: {} }, { name: 'create_wall', args: {} }]));
    const result = await localLlm([{ role: 'user', content: 'Create the walls' }], ai, 'SYSTEM');
    expect(bodies[0].parallel_tool_calls).toBe(true);
    expect(bodies[0].tool_choice).toBeUndefined();
    expect(result.toolUses).toHaveLength(2);
  });

  it('returns a plain answer after a single request', async () => {
    const bodies = mockAnswers(sse('Bonjour !'));
    expect(await localLlm(messages, ai, 'SYSTEM')).toEqual({ text: 'Bonjour !', toolUses: [] });
    expect(bodies).toHaveLength(1);
  });

  it('preloads tools from earlier rounds', async () => {
    const bodies = mockAnswers(sse('OK'));
    await localLlm([...messages, { role: 'assistant', content: '[Tool calls]\ncreate_wall({})' }, { role: 'user', content: '[Tool results]\nok' }], ai, 'SYSTEM');
    expect(toolNames(bodies[0])).toEqual([LOAD_TOOLS, 'create_wall']);
  });

  it('stops after the allowed discovery passes', async () => {
    const load = () => sse('', [{ name: LOAD_TOOLS, args: { names: ['create_wall'] } }]);
    const bodies = mockAnswers(load(), load(), load());
    const result = await localLlm(messages, ai, 'SYSTEM');
    expect(bodies).toHaveLength(3);
    expect(result.toolUses).toEqual([]);
  });

  it('keeps sending no tools to Ollama', async () => {
    const bodies = mockAnswers(sse('Bonjour !'));
    await localLlm(messages, { ...ai, provider: 'ollama' } as AiConfig, 'SYSTEM');
    expect(bodies[0].tools).toBeUndefined();
    expect(bodies[0].messages[0].content).toBe('SYSTEM');
  });
});
