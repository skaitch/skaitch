import { gunzipSync } from 'node:zlib';
import { afterEach, expect, it, vi } from 'vitest';
const session = vi.hoisted(() => ({ user: { getIdToken: vi.fn(async () => 'firebase-token') } as any }));
vi.mock('../firebase', () => ({ auth: { get currentUser() { return session.user; } } }));
import { fetchLlm, renderAi } from '../aiClient';
import { providerHttpError, providerReason, readSSE } from '../aiStream';
const ai = { provider: 'openai', model: 'model', apiKey: 'provider-secret', credentials: [{ id: 'a'.repeat(64), role: 'chat' as const, provider: 'openai', origin: 'https://api.openai.com', version: 1 }], temperature: 0, apiKeys: { other: 'unrelated-secret' }, visualizerApiKey: 'unrelated-render-secret' };
afterEach(() => { vi.unstubAllGlobals(); session.user = { getIdToken: vi.fn(async () => 'firebase-token') }; });
it('sends cloud credentials only inside the authenticated body and decodes fragmented normalized events', async () => {
  const text = JSON.stringify({ chunk: 'é', thinking: false }) + '\n' + JSON.stringify({ result: { text: 'é', toolUses: [] } });
  const bytes = new TextEncoder().encode(text);
  const fetch = vi.fn(async (_url: string, _options?: RequestInit) => new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } })));
  vi.stubGlobal('fetch', fetch);
  const onChunk = vi.fn();
  expect(await fetchLlm([{ role: 'user', content: 'Hello' }], ai, 'BIM', null, onChunk)).toEqual({ text: 'é', toolUses: [] });
  expect(onChunk).toHaveBeenCalledWith('é', false);
  const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/api/ai?operation=chat');
  expect(options.headers).toMatchObject({ Authorization: 'Bearer firebase-token' });
  const raw = gunzipSync(Buffer.from(await (options.body as Blob).arrayBuffer())).toString();
  expect(JSON.parse(raw).ai.apiKey).toBe('');
  expect(JSON.parse(raw).ai.apiKeyRef).toBe('a'.repeat(64));
  expect(raw).not.toContain('provider-secret');
  expect(raw).not.toContain('unrelated-secret');
  expect(raw).not.toContain('unrelated-render-secret');
});
it('requires a session for cloud calls and never falls back to a direct provider request', async () => {
  const fetch = vi.fn(async (_url: string, _options?: RequestInit) => new Response(JSON.stringify({ error: 'Serveur indisponible' }), { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  session.user = null;
  await expect(fetchLlm([], ai, '')).rejects.toThrow('Connectez-vous');
  expect(fetch).not.toHaveBeenCalled();
  session.user = { getIdToken: vi.fn(async () => 'token') };
  await expect(fetchLlm([], ai, '')).rejects.toThrow('Serveur indisponible');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe('/api/ai?operation=chat');
});
it('preserves explicitly local Ollama inference without a cloud round trip', async () => {
  session.user = null;
  const fetch = vi.fn(async (_url: string, _options?: RequestInit) => new Response('data: {"choices":[{"delta":{"content":"local"}}]}\n\ndata: [DONE]'));
  vi.stubGlobal('fetch', fetch);
  expect(await fetchLlm([], { ...ai, provider: 'ollama', baseUrl: 'http://localhost:11434' }, '')).toEqual({ text: 'local', toolUses: [] });
  expect(fetch.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions');
});
it('does not send the chat key to a different local visualizer provider', async () => {
  const fetch = vi.fn(async (_url: string, _options?: RequestInit) => new Response(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }] })));
  vi.stubGlobal('fetch', fetch);
  await renderAi({ prompt: 'House' }, {}, { ...ai, visualizerProvider: 'custom', visualizerApiKey: '', visualizerBaseUrl: 'http://localhost:11434' });
  const options = fetch.mock.calls[0][1] as unknown as RequestInit;
  expect(options.headers).not.toHaveProperty('Authorization');
});
it('reads multiline SSE, UTF-8 boundaries and final events, and rejects upstream errors with their masked reason', async () => {
  const bytes = new TextEncoder().encode(': comment\r\ndata: {"text":\r\ndata: "é"}\r\n\r\ndata:[DONE]');
  const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }));
  const events: string[] = [];
  await readSSE(response, event => events.push(event));
  expect(JSON.parse(events[0])).toEqual({ text: 'é' });
  expect(events[1]).toBe('[DONE]');
  await expect(readSSE(new Response('data: {"error":{"message":"secret"}}\n\n'), () => {})).rejects.toThrow('refusé');
  // The reason is shown, but never the key, even when the provider echoes it.
  const error = readSSE(new Response('data: {"error":{"message":"Context too long for key sk-123 (40000 > 32768)"}}\n\n'), () => {}, 'sk-123');
  await expect(error).rejects.toThrow('Le fournisseur IA a refusé la requête : Context too long for key *** (40000 > 32768)');
  await expect(readSSE(new Response('data: {"error":"x"}\n\n'), () => {}, 'sk-123')).rejects.not.toThrow('sk-123');
});

it('turns a failed HTTP response into a short error with the masked reason', async () => {
  const res = new Response(JSON.stringify({ error: { message: 'request (40000 tokens) exceeds the available context size, key=abc' } }), { status: 400 });
  const error = await providerHttpError('IA locale', res, 'abc');
  expect(error.message).toBe('IA locale : HTTP 400 — request (40000 tokens) exceeds the available context size, key=***');
  expect((await providerHttpError('IA locale', new Response('', { status: 502 }))).message).toBe('IA locale : HTTP 502');
  expect(providerReason('a'.repeat(1000)).length).toBe(300);
});
