import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { beforeEach, expect, it, vi } from 'vitest';

const counters = vi.hoisted(() => ({ writes: [] as string[], fail: false }));
vi.mock('../_lib/admin.js', () => ({
  getAdminDb: () => {
    if (counters.fail) throw new Error('counter storage down');
    return {
      batch: () => ({ set: (ref: any) => counters.writes.push(ref.path), commit: async () => {} }),
      doc: (path: string) => ({ path, set: async () => { counters.writes.push(path); } }),
    };
  },
}));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: (n: number) => n }, Timestamp: { fromMillis: (ms: number) => ms } }));
const session = vi.hoisted(() => ({ uid: 'user' as string | null }));
vi.mock('../_lib/sessionAuth.js', () => ({ authenticateSession: vi.fn(async () => session.uid) }));
vi.mock('../_lib/apikey.js', () => ({ authenticateKey: vi.fn(async (key: string) => key === 'ak_good' ? 'user' : null) }));
vi.mock('../../server/bim/mcpSession.js', () => ({ executeCloudTool: vi.fn(async () => ({ handled: true, result: { ok: true } })) }));
vi.mock('../../server/bim/projectStore.js', () => ({ listStoredProjects: vi.fn(async () => []) }));
import { TOOLS } from '@skaitch/core/mcp-tools';
import mcp from '../mcp';
import bim from '../bim';

function fakeRes() {
  const res: any = {
    statusCode: 0, body: Buffer.alloc(0), headers: {} as Record<string, string>, destroyed: false, writableEnded: false,
    setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; },
    writeHead(status: number, headers?: Record<string, string>) { this.statusCode = status; Object.assign(this.headers, headers); },
    end(body?: string | Buffer) { this.body = body ? Buffer.from(body) : Buffer.alloc(0); this.writableEnded = true; },
    on() {}, off() {},
  };
  return res;
}
const callMcp = async (body: unknown, key = 'ak_good') => {
  const res = fakeRes();
  await mcp({ method: 'POST', url: '/api/mcp', body, headers: { 'x-api-key': key, host: 'skaitch.test' } }, res);
  return res;
};
const callBim = async (operation: string, data: unknown) => {
  const res = fakeRes();
  await bim(Object.assign(Readable.from([Buffer.from(JSON.stringify(data))]), { url: `/api/bim?operation=${operation}`, method: 'POST', headers: { host: 'skaitch.test', authorization: 'Bearer t' } }), res);
  return { status: res.statusCode, data: JSON.parse((res.headers['content-encoding'] === 'gzip' ? gunzipSync(res.body) : res.body).toString()) };
};

beforeEach(() => { counters.writes = []; counters.fail = false; session.uid = 'user'; vi.spyOn(console, 'log').mockImplementation(() => {}); });

it('counts an MCP tool call once, under the tool name', async () => {
  await callMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: TOOLS[0].name, arguments: {} } });
  expect(counters.writes).toHaveLength(2);
  expect(counters.writes[0]).toMatch(new RegExp(`_mcp:tool:${TOOLS[0].name}$`));
});

it('does not count MCP protocol exchanges', async () => {
  for (const method of ['initialize', 'tools/list', 'ping', 'notifications/initialized']) await callMcp({ jsonrpc: '2.0', id: method.startsWith('notif') ? undefined : 1, method });
  await callMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'no_such_tool' } });
  expect(counters.writes).toEqual([]);
});

it('counts an MCP authentication reject without any account', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await callMcp({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'ak_bad');
  expect(counters.writes).toHaveLength(1);
  expect(counters.writes[0]).toMatch(/^usage_auth_rejects\//);
});

it('counts a BIM operation once, per operation and per account', async () => {
  await callBim('project-list', {});
  expect(counters.writes.map(p => p.replace(/\d{4}-\d{2}-\d{2}_/, ''))).toEqual(['usage_operations/bim:project-list', 'usage_accounts/user']);
});

it('returns the same response when the counter storage is down', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const before = await callBim('project-list', {});
  counters.fail = true;
  expect(await callBim('project-list', {})).toEqual(before);
  const tool = await callMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: TOOLS[0].name, arguments: {} } });
  expect(tool.statusCode).toBe(200);
  expect(warn).toHaveBeenCalled();
});
