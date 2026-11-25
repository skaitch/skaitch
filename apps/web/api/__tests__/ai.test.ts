import { Readable, Writable } from 'node:stream';
import { gzipSync, gunzipSync } from 'node:zlib';
import { beforeEach, expect, it, vi } from 'vitest';
const session = vi.hoisted(() => ({ uid: 'u' as string | null }));
vi.mock('../_lib/sessionAuth', () => ({ authenticateSession: vi.fn(async () => session.uid) }));
vi.mock('../../server/ai/upstream', () => ({ upstreamFetch: vi.fn() }));
vi.mock('../../server/ai/vault', () => ({
  resolveAiCredentials: vi.fn(async (_uid, config) => config),
  aiCredentials: vi.fn(async () => []),
}));
import { aiCredentials } from '../../server/ai/vault';
vi.mock('../../server/ai/preferences', () => ({ getAiPreferences: vi.fn(async () => ({ revision: 0, config: null })), saveAiPreferences: vi.fn(async (_uid, config) => ({ revision: 1, config })) }));
import { getAiPreferences, saveAiPreferences } from '../../server/ai/preferences';
import { upstreamFetch } from '../../server/ai/upstream';
import handler from '../ai';
class Reply extends Writable {
  statusCode = 0;
  headers: Record<string, string> = {};
  chunks: Buffer[] = [];
  setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; }
  _write(chunk: Buffer, _encoding: string, done: () => void) { this.chunks.push(Buffer.from(chunk)); done(); }
}
const ai = { provider: 'openai', model: 'model', apiKey: 'private-provider-key', temperature: 0 };
const request = (operation: string, data: unknown, headers = {}, method = 'POST') => Object.assign(Readable.from([gzipSync(Buffer.from(JSON.stringify(data)))]), { method, url: `/api/ai?operation=${operation}`, headers: { host: 'app.test', authorization: 'Bearer firebase-session', 'content-encoding': 'gzip', ...headers } });
async function call(operation: string, data: unknown, headers = {}, method = 'POST') {
  const res = new Reply();
  await handler(request(operation, data, headers, method), res);
  let bytes = Buffer.concat(res.chunks);
  if (res.headers['content-encoding'] === 'gzip') bytes = gunzipSync(bytes);
  const text = bytes.toString();
  return { status: res.statusCode, headers: res.headers, text, data: res.headers['content-type']?.includes('ndjson') ? text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : JSON.parse(text) };
}
const stream = (...events: unknown[]) => new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''), { headers: { 'Content-Type': 'text/event-stream' } });
beforeEach(() => { session.uid = 'u'; vi.mocked(upstreamFetch).mockReset(); });
it('authenticates before parsing input and rejects cross-site or malformed requests', async () => {
  session.uid = null;
  expect((await call('chat', {})).status).toBe(401);
  session.uid = 'u';
  expect((await call('chat', {}, { origin: 'https://evil.test' })).status).toBe(403);
  expect((await call('chat', {}, {}, 'GET')).status).toBe(405);
  expect((await call('unknown', {})).status).toBe(400);
  expect((await call('chat', { ai, messages: [{ role: 'admin', content: 'bad' }], system: '' })).status).toBe(400);
  expect((await call('chat', { ai: { ...ai, apiKey: 'key\r\nheader' }, messages: [], system: '' })).status).toBe(400);
  expect(upstreamFetch).not.toHaveBeenCalled();
});
it('normalizes OpenAI text and fragmented tool arguments without forwarding browser credentials', async () => {
  vi.mocked(upstreamFetch).mockResolvedValue(stream(
    { choices: [{ delta: { content: 'Bonjour é', tool_calls: [{ index: 0, id: 't', function: { name: 'create_wall', arguments: '{"height":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '2.8}' } }] }, finish_reason: 'tool_calls' }] },
  ));
  const response = await call('chat', { ai, messages: [{ role: 'user', content: 'Hello' }], system: 'BIM' }, { cookie: 'browser-secret' });
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.data.at(-1).result).toEqual({ text: 'Bonjour é', toolUses: [{ id: 't', name: 'create_wall', input: { height: 2.8 } }] });
  const options = vi.mocked(upstreamFetch).mock.calls[0][1]!;
  expect(options.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer private-provider-key' });
  expect(JSON.stringify(options)).not.toContain('firebase-session');
  expect(JSON.stringify(options)).not.toContain('browser-secret');
});
it('keeps Gemini reasoning separate and assembles Anthropic partial_json tool calls', async () => {
  vi.mocked(upstreamFetch).mockResolvedValueOnce(stream({ candidates: [{ content: { parts: [{ thought: true, text: 'thinking' }, { text: 'answer' }] } }] }));
  const gemini = await call('chat', { ai: { ...ai, provider: 'gemini' }, messages: [], system: 'BIM' });
  expect(gemini.data[0]).toEqual({ chunk: 'thinking', thinking: true });
  expect(gemini.data.at(-1).result.text).toBe('answer');
  vi.mocked(upstreamFetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 'model', capabilities: {} })));
  vi.mocked(upstreamFetch).mockResolvedValueOnce(stream(
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'create_wall' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"height":2.8}' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'read', name: 'list_projects', input: {} } },
    { type: 'content_block_stop', index: 1 },
  ));
  const anthropic = await call('chat', { ai: { ...ai, provider: 'anthropic' }, messages: [], system: 'BIM' });
  expect(anthropic.data.at(-1).result.toolUses).toEqual([{ id: 't', name: 'create_wall', input: { height: 2.8 } }, { id: 'read', name: 'list_projects', input: {} }]);
});
const sentBody = (call: number) => JSON.parse(String(vi.mocked(upstreamFetch).mock.calls[call][1]!.body));
const claudeModel = (id: string, adaptive: boolean, maxTokens: number) => new Response(JSON.stringify({ id, max_tokens: maxTokens, capabilities: {
  thinking: { supported: adaptive, types: { adaptive: { supported: adaptive }, enabled: { supported: false } } },
  effort: { supported: adaptive, low: { supported: adaptive }, medium: { supported: adaptive }, high: { supported: adaptive }, xhigh: { supported: false }, max: { supported: adaptive } },
} }));
it('shapes Claude requests from the Models API, never from the model name', async () => {
  vi.mocked(upstreamFetch).mockResolvedValueOnce(claudeModel('claude-new', true, 128000)).mockResolvedValueOnce(stream()).mockResolvedValueOnce(stream());
  const config = { ...ai, provider: 'anthropic', model: 'claude-new', temperature: 0.4, effort: 'high' };
  expect((await call('chat', { ai: config, messages: [], system: 'BIM' })).status).toBe(200);
  expect(String(vi.mocked(upstreamFetch).mock.calls[0][0])).toBe('https://api.anthropic.com/v1/models/claude-new');
  expect(sentBody(1)).toMatchObject({ thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: 'high' }, max_tokens: 32000 });
  expect(sentBody(1)).not.toHaveProperty('temperature');
  // A second round reuses the model description.
  await call('chat', { ai: { ...config, effort: undefined }, messages: [], system: 'BIM' });
  expect(vi.mocked(upstreamFetch)).toHaveBeenCalledTimes(3);
  expect(sentBody(2)).not.toHaveProperty('output_config');

  vi.mocked(upstreamFetch).mockReset();
  vi.mocked(upstreamFetch).mockResolvedValueOnce(claudeModel('claude-old', false, 8192)).mockResolvedValueOnce(stream());
  await call('chat', { ai: { ...config, model: 'claude-old', effort: undefined }, messages: [], system: 'BIM' });
  expect(sentBody(1)).toMatchObject({ temperature: 0.4, max_tokens: 8192 });
  expect(sentBody(1)).not.toHaveProperty('thinking');
  expect(sentBody(1)).not.toHaveProperty('output_config');
});
it('sends an explicit effort to Gemini and OpenAI-compatible providers, and nothing otherwise', async () => {
  vi.mocked(upstreamFetch).mockResolvedValue(stream());
  await call('chat', { ai: { ...ai, provider: 'gemini', effort: 'low' }, messages: [], system: 'BIM' });
  expect(sentBody(0).generationConfig).toEqual({ temperature: 0, thinkingConfig: { thinkingLevel: 'low', includeThoughts: true } });
  await call('chat', { ai: { ...ai, provider: 'gemini' }, messages: [], system: 'BIM' });
  expect(sentBody(1).generationConfig).toEqual({ temperature: 0 });
  await call('chat', { ai: { ...ai, effort: 'xhigh' }, messages: [], system: 'BIM' });
  expect(sentBody(2)).toMatchObject({ reasoning_effort: 'xhigh' });
  expect(sentBody(2)).not.toHaveProperty('temperature');
  await call('chat', { ai, messages: [], system: 'BIM' });
  expect(sentBody(3)).toMatchObject({ temperature: 0 });
  expect(sentBody(3)).not.toHaveProperty('reasoning_effort');
  expect((await call('chat', { ai: { ...ai, effort: 'extreme' }, messages: [], system: 'BIM' })).status).toBe(400);
});
it('shows OpenRouter reasoning as thinking', async () => {
  vi.mocked(upstreamFetch).mockResolvedValueOnce(stream({ choices: [{ delta: { reasoning: 'pondering' } }] }, { choices: [{ delta: { content: 'done' } }] }));
  const result = await call('chat', { ai: { ...ai, provider: 'openrouter' }, messages: [], system: 'BIM' });
  expect(result.data[0]).toEqual({ chunk: 'pondering', thinking: true });
  expect(result.data.at(-1).result.text).toBe('done');
});
it('does not expose upstream errors or secrets to the browser', async () => {
  vi.mocked(upstreamFetch).mockResolvedValue(new Response('private-provider-key stack details', { status: 401 }));
  const result = await call('chat', { ai, messages: [], system: 'BIM' });
  expect(result.data.at(-1).error).toBeDefined();
  expect(result.text).not.toMatch(/private-provider-key|stack details/);
  vi.mocked(upstreamFetch).mockResolvedValue(stream({ error: { message: 'private-provider-key' } }));
  const streamed = await call('chat', { ai, messages: [], system: '' });
  expect(streamed.data.at(-1).error).toBeDefined();
  expect(streamed.text).not.toContain('private-provider-key');
});
it('lists models and refuses to forward a rendering key to a different polling origin', async () => {
  vi.mocked(upstreamFetch).mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'm1' }] })));
  expect((await call('models', { ai })).data).toEqual(['m1']);
  vi.mocked(upstreamFetch).mockResolvedValueOnce(new Response(JSON.stringify({ status: 'starting', urls: { get: 'https://evil.test/poll' } })));
  const rendered = await call('render', { ai: { ...ai, visualizerProvider: 'replicate', visualizerApiKey: 'render-secret' }, args: { prompt: 'House', type: 'image' }, items: {} });
  expect(rendered.data.error).toContain('suivi');
  expect(upstreamFetch).toHaveBeenCalledTimes(2);
  expect(rendered.text).not.toContain('render-secret');
});
it('cancels the upstream request when the browser disconnects', async () => {
  let began!: () => void;
  const ready = new Promise<void>(resolve => { began = resolve; });
  let captured: AbortSignal;
  vi.mocked(upstreamFetch).mockImplementation(async (_url, options) => {
    captured = options!.signal!;
    return new Response(new ReadableStream({ start(controller) {
      captured.addEventListener('abort', () => controller.error(new Error('aborted')));
      began();
    } }));
  });
  const res = new Reply();
  const pending = handler(request('chat', { ai, messages: [], system: '' }), res);
  await ready;
  res.destroy();
  await pending;
  expect(captured!.aborted).toBe(true);
});

it('stops oversized chat output before returning an oversized response', async () => {
  vi.mocked(upstreamFetch).mockResolvedValue(stream({ choices: [{ delta: { content: 'x'.repeat(4_000_000) } }] }));
  const result = await call('chat', { ai, messages: [], system: '' });
  expect(result.text.length).toBeLessThan(1024);
  expect(result.data.at(-1).error).toContain('4 Mo');
});


it('scopes credential operations to the verified account and requires a session', async () => {
  expect((await call('credentials', { action: 'list', uid: 'victim' })).status).toBe(200);
  expect(aiCredentials).toHaveBeenLastCalledWith('u', { action: 'list', uid: 'victim' });
  const count = vi.mocked(aiCredentials).mock.calls.length;
  session.uid = null;
  expect((await call('credentials', { action: 'list' })).status).toBe(401);
  expect(vi.mocked(aiCredentials).mock.calls.length).toBe(count);
});


it('scopes public preference reads and writes to the authenticated account', async () => {
  expect((await call('preferences', { action: 'get', uid: 'victim' })).data).toEqual({ revision: 0, config: null });
  expect(getAiPreferences).toHaveBeenLastCalledWith('u');
  const config = { provider: 'openai' };
  expect((await call('preferences', { action: 'set', config, expectedRevision: 0 })).status).toBe(200);
  expect(saveAiPreferences).toHaveBeenLastCalledWith('u', config, 0);
  session.uid = null;
  expect((await call('preferences', { action: 'get' })).status).toBe(401);
});

const conversation = { items: {}, focusStorey: 's', lang: 'fr', selection: [], finalTxt: 'Ajoute un mur' };
it('builds the prompt and schedules conversation rounds on the server', async () => {
  vi.mocked(upstreamFetch).mockResolvedValueOnce(stream({ choices: [{ delta: { content: '{"tool_calls":[{"name":"create_wall","args":{"height":2.8}}]}' } }] }));
  const first = await call('chat', { ai, context: conversation, round: 0, messages: [{ role: 'user', content: conversation.finalTxt }] });
  expect(first.status).toBe(200);
  const result = first.data.at(-1).result;
  expect(result.toolUses).toEqual([{ id: 'create_wall_0', name: 'create_wall', input: { height: 2.8 } }]);
  expect(result.next.round).toBe(1);
  const payload = JSON.parse(vi.mocked(upstreamFetch).mock.calls[0][1]!.body as string);
  expect(payload.messages[0].content).toContain('expert BIM assistant');
  expect(payload.messages[0].content).toContain('Language: fr');
  expect(payload.messages[0].content).toContain('WALL THICKNESS');
  vi.mocked(upstreamFetch).mockResolvedValueOnce(stream({ choices: [{ delta: { content: 'Terminé' } }] }));
  const second = await call('chat', { ai, context: conversation, ...result.next, receipts: ['create_wall: {"success":true}'] });
  expect(second.data.at(-1).result.next).toBeNull();
  const followup = JSON.parse(vi.mocked(upstreamFetch).mock.calls[1][1]!.body as string);
  expect(followup.messages.at(-1).content).toContain('[Tool results]');
  expect(followup.messages.at(-1).content).toContain('success');
  expect((await call('chat', { ai, context: conversation, round: 50, messages: [] })).status).toBe(400);
});
it('validates conversation context and never guesses a mutation target through shortcuts', async () => {
  expect((await call('conversation-intent', { context: conversation })).data).toBeNull();
  expect((await call('conversation-intent', { context: { ...conversation, finalTxt: 'supprime un élément' } })).data).toBeNull();
  expect((await call('conversation-intent', { context: { ...conversation, finalTxt: 'Combien de murs ?' } })).data.name).toBe('list_ifc_entities');
  expect((await call('conversation-prepare', { context: { ...conversation, selection: [1] } })).status).toBe(400);
  expect((await call('conversation-adjust', { context: conversation, name: 'create_wall', args: {}, geom: {}, remaining: [null] })).status).toBe(400);
  expect(upstreamFetch).not.toHaveBeenCalled();
});
it('propagates an adjusted wall endpoint and thickness to the remaining batch on the server', async () => {
  const response = await call('conversation-adjust', {
    context: conversation, name: 'create_wall', args: { start_point: [0, 0], end_point: [4, 0], thickness: 0.2 },
    geom: { x1: 0, y1: 0, x2: 5, y2: 0, thickness: 0.3, height: 2.8 },
    remaining: [{ id: 'next', name: 'create_wall', input: { start_point: [4, 0], end_point: [4, 3], thickness: 0.2 } }],
  });
  expect(response.status).toBe(200);
  expect(response.data[0].input).toMatchObject({ start_point: [5, 0], end_point: [4, 3], thickness: 0.3 });
});
