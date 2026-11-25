import { request } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startMcpServer, type RunningMcpServer } from '../mcpServer';
import { RendererCalls } from '../rendererCalls';

const project = { id: 'p1', name: 'Maison', description: '', createdAt: '2026-11-15', updatedAt: '2026-11-15', thumbnailSvg: '<svg/>' };
let server: RunningMcpServer;
let calls: RendererCalls;
let sent: { id: string; name: string; args: Record<string, unknown> }[];
let client: Client;
const onActivity = vi.fn();

beforeEach(async () => {
  calls = new RendererCalls(200);
  sent = [];
  server = await startMcpServer({
    port: 0, version: 'test',
    listProjects: async () => [project],
    callRenderer: (name, args) => calls.call(name, args),
    onActivity,
  });
  client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
});

afterEach(async () => {
  await client.close();
  await server.close();
});

const text = (result: any) => result.content[0].text as string;

it('listens on loopback only', () => {
  expect(server.url).toBe(`http://127.0.0.1:${server.port}/mcp`);
});

it('lists navigation and compact tools, with BIM schemas available on demand', async () => {
  const { tools } = await client.listTools();
  const names = tools.map(tool => tool.name);
  expect(names).toEqual(expect.arrayContaining(['list_projects', 'select_project', 'search_tools', 'load_skill', 'execute_script', 'apply_model_batch', 'call_tool']));
  expect(names).not.toContain('create_wall');
  const schema = await client.callTool({ name: 'search_tools', arguments: { query: 'create_wall' } });
  expect(JSON.parse(text(schema)).tools.map((tool: { name: string }) => tool.name)).toEqual(['create_wall']);
  expect(client.getInstructions()).toBeTruthy();
});

it('answers list_projects from the library without a window, and without file details', async () => {
  const result = await client.callTool({ name: 'list_projects', arguments: {} });
  expect(JSON.parse(text(result))).toEqual([{ id: 'p1', name: 'Maison', description: '', createdAt: '2026-11-15', updatedAt: '2026-11-15' }]);
  expect(onActivity).toHaveBeenCalled();
});

it('forwards other tools to the editor window and returns its result', async () => {
  calls.ready(call => {
    sent.push(call);
    queueMicrotask(() => calls.reply(call.id, { result: { storeys: 2 } }));
  });
  const result = await client.callTool({ name: 'get_ifc_scene_overview', arguments: { detail: 'short' } });
  expect(sent).toMatchObject([{ name: 'get_ifc_scene_overview', args: { detail: 'short' } }]);
  expect(JSON.parse(text(result))).toEqual({ storeys: 2 });
  expect(result.isError).toBeUndefined();
});

it('reports editor errors, a missing window and a timeout as tool errors', async () => {
  let result: any = await client.callTool({ name: 'get_ifc_scene_overview', arguments: {} });
  expect(result.isError).toBe(true);
  expect(text(result)).toMatch(/pas prêt/);

  calls.ready(call => queueMicrotask(() => calls.reply(call.id, { error: 'Action refusée par l’utilisateur.' })));
  result = await client.callTool({ name: 'create_wall', arguments: {} });
  expect(result.isError).toBe(true);
  expect(text(result)).toMatch(/refusée/);

  calls.ready(() => {});
  result = await client.callTool({ name: 'get_ifc_scene_overview', arguments: {} });
  expect(text(result)).toMatch(/Pas de réponse/);
});

it('refuses tools the desktop app does not offer', async () => {
  const result: any = await client.callTool({ name: 'generate_visualization', arguments: {} });
  expect(result.isError).toBe(true);
});

function rawPost(headers: Record<string, string>, path = '/mcp', port = server.port) {
  return new Promise<number>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers } }, res => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject);
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  });
}

it('rejects requests from web pages and rebound host names', async () => {
  expect(await rawPost({ Origin: 'https://evil.example' })).toBe(403);
  expect(await rawPost({ Host: `evil.example:${server.port}` })).toBe(403);
});

it('refuses the secret remote path when remote access is off', async () => {
  expect(await rawPost({ Host: 'tunnel.example' }, '/mcp/anything')).toBe(403);
});

it('accepts remote clients only through the tunnel host and the secret path', async () => {
  const token = 'x'.repeat(43);
  const remote = await startMcpServer({ port: 0, version: 'test', listProjects: async () => [project], callRenderer: async () => null, remote: { host: 'tunnel.example', token } });
  try {
    expect(remote.remoteUrl).toBe(`https://tunnel.example/mcp/${token}`);
    const post = (headers: Record<string, string>, path: string) => rawPost(headers, path, remote.port);
    expect(await post({ Host: 'tunnel.example' }, `/mcp/${token}`)).toBe(200);
    expect(await post({ Host: 'TUNNEL.example' }, `/mcp/${token}`)).toBe(200);
    expect(await post({ Host: 'tunnel.example' }, '/mcp')).toBe(403);
    expect(await post({ Host: 'tunnel.example' }, `/mcp/${'y'.repeat(43)}`)).toBe(403);
    expect(await post({ Host: 'tunnel.example' }, `/mcp/${token}x`)).toBe(403);
    expect(await post({ Host: 'other.example' }, `/mcp/${token}`)).toBe(403);
    expect(await post({ Host: 'tunnel.example', Origin: 'https://evil.example' }, `/mcp/${token}`)).toBe(403);
    // Local clients keep the plain path, and cannot use the secret one without the tunnel host.
    expect(await post({}, '/mcp')).toBe(200);
  } finally {
    await remote.close();
  }
});

it('requires the local secret token from processes on this machine', async () => {
  const token = 'z'.repeat(43);
  const local = await startMcpServer({ port: 0, version: 'test', listProjects: async () => [project], callRenderer: async () => null, localToken: token });
  try {
    expect(local.url).toBe(`http://127.0.0.1:${local.port}/mcp/${token}`);
    const post = (headers: Record<string, string>, path: string) => rawPost(headers, path, local.port);
    expect(await post({}, `/mcp/${token}`)).toBe(200);
    expect(await post({}, '/mcp')).toBe(403);
    expect(await post({}, `/mcp/${'y'.repeat(43)}`)).toBe(403);
    expect(await post({}, `/mcp/${token}x`)).toBe(403);
    expect(await post({ Origin: 'https://evil.example' }, `/mcp/${token}`)).toBe(403);
  } finally {
    await local.close();
  }
});
