import { Readable } from 'node:stream';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { buildStarter } from '@skaitch/core/data/starter';
import fixture from '../../src/lib/__tests__/fixtures/bimwiq.json';
import { BIM_BODY_LIMIT, BIM_WIRE_LIMIT } from '@skaitch/core/types/bim';

const session = vi.hoisted(() => ({ uid: 'user' as string | null }));
vi.mock('../_lib/sessionAuth.js', () => ({ authenticateSession: vi.fn(async () => session.uid) }));
vi.mock('../../server/bim/projectStore.js', () => ({
  readStoredProject: vi.fn(async (_uid, id) => ({ id })),
  listStoredProjects: vi.fn(async () => []),
  writeStoredProject: vi.fn(async (_uid, id, patch) => ({ ...patch, id, modelRevision: 1 })),
  deleteStoredProject: vi.fn(async () => {}),
}));
import { listStoredProjects, writeStoredProject, deleteStoredProject } from '../../server/bim/projectStore';
import handler from '../bim';

async function call(operation: string, data: unknown, options: { raw?: boolean; headers?: Record<string, string>; method?: string } = {}) {
  const raw = options.raw ? data as Buffer : gzipSync(Buffer.from(JSON.stringify(data)));
  const req = Object.assign(Readable.from([raw]), {
    url: `/api/bim?operation=${operation}`, method: options.method || 'POST',
    headers: { host: 'skaitch.test', authorization: 'Bearer token', ...(!options.raw ? { 'content-encoding': 'gzip' } : {}), ...options.headers },
  });
  const res = {
    statusCode: 0, headers: {} as Record<string, string>, body: Buffer.alloc(0),
    setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; },
    end(body: string | Buffer) { this.body = Buffer.from(body); },
  };
  await handler(req, res);
  const bytes = res.headers['content-encoding'] === 'gzip' ? gunzipSync(res.body) : res.body;
  return { status: res.statusCode, headers: res.headers, data: JSON.parse(bytes.toString()) };
}
beforeEach(() => { session.uid = 'user'; });

it('requires authentication before reading or processing the payload', async () => {
  session.uid = null;
  expect((await call('import-ifc', Buffer.from('invalid'), { raw: true })).status).toBe(401);
});
it('rejects cross-site calls, unsupported methods and operations', async () => {
  expect((await call('export-ifc', {}, { headers: { origin: 'https://evil.test' } })).status).toBe(403);
  expect((await call('export-ifc', {}, { method: 'GET' })).status).toBe(405);
  expect((await call('unknown', {})).status).toBe(400);
});
it('rejects malformed, oversized or untrusted geometry input', async () => {
  expect((await call('export-ifc', Buffer.from('not-json'), { raw: true })).status).toBe(400);
  expect((await call('import-ifc', Buffer.alloc(BIM_WIRE_LIMIT + 1), { raw: true })).status).toBe(413);
  expect((await call('import-ifc', Buffer.from('not an IFC'), { raw: true })).status).toBe(400);
  expect((await call('export-ifc', { items: { wrong: { id: 'another', type: 'Wall' } } })).status).toBe(400);
  expect((await call('export-ifc', { items: JSON.parse('{"__proto__":{"id":"__proto__","type":"Project"}}') })).status).toBe(400);
  const items = buildStarter();
  const wall = Object.values(items).find(item => item.type === 'Wall')!;
  (wall.geom as any).x1 = 'bad';
  expect((await call('export-ifc', { items })).status).toBe(400);
});
it('bounds decompression and model element counts before running the engines', async () => {
  const inflated = gzipSync(Buffer.alloc(BIM_BODY_LIMIT + 1));
  expect((await call('import-ifc', inflated, { raw: true, headers: { 'content-encoding': 'gzip' } })).status).toBe(413);
  const items = Object.fromEntries(Array.from({ length: 20_001 }, (_, i) => [`p_${i}`, { id: `p_${i}`, type: 'Project' }]));
  expect((await call('export-ifc', { items })).status).toBe(413);
});
it('imports BIMWIQ on the server with all walls, spaces and openings', async () => {
  const response = await call('import-bimwiq', fixture);
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('private, no-store');
  const all = Object.values(response.data.items) as any[];
  expect(all.filter(item => item.type === 'Wall')).toHaveLength(40);
  expect(all.filter(item => item.type === 'Window')).toHaveLength(8);
  expect(all.filter(item => item.type === 'Door')).toHaveLength(8);
});
it('exports, patches and verifies the same model through the authenticated API', async () => {
  const items = buildStarter();
  const exported = await call('export-ifc', { items });
  expect(exported.status).toBe(200);
  expect(exported.data).toContain('ISO-10303-21;');
  const checked = await call('check-ifc', { items, ifcText: exported.data });
  expect(checked.status).toBe(200);
  expect(checked.data.matched).toBeGreaterThan(0);
  const patched = await call('patch-ifc', { items, ifcText: exported.data });
  expect(patched.status).toBe(200);
  expect(patched.data).toContain('IFCWALL');
  const fixed = await call('fix-ifc', { items });
  expect(fixed.status).toBe(200);
  expect(Object.keys(fixed.data)).toHaveLength(Object.keys(items).length);
});
it('imports a real IFC with the installed Node WASM and excludes duplicate mesh/buffer payloads', async () => {
  const source = readFileSync('public/ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc');
  const response = await call('import-ifc', gzipSync(source), { raw: true, headers: { 'content-encoding': 'gzip' } });
  expect(response.status).toBe(200);
  expect(Object.values(response.data.items).some((item: any) => item.type === 'Wall')).toBe(true);
  expect(response.data.meshes).toBeUndefined();
  expect(response.data.rawIfcBuffer).toBeUndefined();
}, 30000);

it('computes MCP changes through the authenticated API and validates the resulting geometry', async () => {
  const items = buildStarter();
  const focusStorey = Object.values(items).find(i => i.type === 'Storey')!.id;
  const context = { items, focusStorey, catalogue: [], name: 'create_wall', args: { start_point: [0, 0], end_point: [3, 0] } };
  const response = await call('mcp-model', context);
  expect(response.status).toBe(200);
  expect(response.data.changes).toContainEqual(expect.objectContaining({ kind: 'add', item: expect.objectContaining({ type: 'Wall' }) }));
  expect((await call('mcp-model', { ...context, name: 'generate_visualization' })).status).toBe(400);
  expect((await call('mcp-model', { ...context, args: { ...context.args, thickness: -1 } })).status).toBe(400);
  session.uid = null;
  expect((await call('mcp-model', context)).status).toBe(401);
});


it('scopes project operations to the verified session instead of the supplied account', async () => {
  expect((await call('project-list', { uid: 'victim' })).status).toBe(200);
  expect(listStoredProjects).toHaveBeenLastCalledWith('user');
  const patch = { name: 'Maison' };
  expect((await call('project-write', { uid: 'victim', id: 'a', patch, expectedRevision: 3 })).status).toBe(200);
  expect(writeStoredProject).toHaveBeenLastCalledWith('user', 'a', patch, 3);
  expect((await call('project-delete', { uid: 'victim', id: 'a', expectedRevision: 3 })).status).toBe(200);
  expect(deleteStoredProject).toHaveBeenLastCalledWith('user', 'a', 3);
  const count = vi.mocked(writeStoredProject).mock.calls.length;
  session.uid = null;
  expect((await call('project-write', { id: 'a', patch })).status).toBe(401);
  expect(vi.mocked(writeStoredProject).mock.calls.length).toBe(count);
});


it('reads model queries through the authenticated route and rejects non-query tools', async () => {
  const context = { items: buildStarter(), catalogue: [], name: 'get_ifc_scene_overview', args: {} };
  const response = await call('mcp-read', context);
  expect(response.status).toBe(200);
  expect(response.data.total_elements).toBe(Object.keys(context.items).length);
  expect((await call('mcp-read', { ...context, name: 'create_wall' })).status).toBe(400);
});

it('exports valid DXF and BIM JSON on the server without changing the source', async () => {
  const items = buildStarter();
  const before = JSON.stringify(items);
  const dxf = await call('export-dxf', { items, projectName: 'Maison' });
  expect(dxf.status).toBe(200);
  expect(dxf.data).toContain('SECTION\n2\nENTITIES');
  expect(dxf.data).toContain('WALLS');
  expect(dxf.data).toMatch(/0\nEOF$/);
  const json = await call('export-json', { items, projectId: 'p', projectName: 'Maison' });
  expect(JSON.parse(json.data)).toMatchObject({ format: 'BIMJSON', project: { id: 'p', name: 'Maison' } });
  expect(JSON.stringify(items)).toBe(before);
  expect((await call('export-dxf', { items, projectName: 5 })).status).toBe(400);
});
it('computes generic IFC tools on the server and refuses identity corruption', async () => {
  const items = buildStarter();
  const focusStorey = Object.values(items).find(i => i.type === 'Storey')!.id;
  const base = { items, focusStorey, catalogue: [] };
  const created = await call('mcp-model', { ...base, name: 'create_ifc_element', args: { ifc_type: 'IfcWall', id: 'new', geom: { x1: 90, y1: 0, x2: 94, y2: 0 } } });
  expect(created.status).toBe(200);
  expect(created.data.changes[0]).toMatchObject({ kind: 'add', item: { id: 'new', type: 'Wall' } });
  const wall = Object.values(items).find(i => i.type === 'Wall')!;
  expect((await call('mcp-model', { ...base, name: 'update_ifc_element', args: { id: wall.id, properties: { id: 'corrupt' } } })).status).toBe(400);
  const deleted = await call('mcp-model', { ...base, name: 'delete_ifc_element', args: { ids: [focusStorey, wall.id] } });
  expect(deleted.data.changes).toEqual([{ kind: 'delete', ids: [wall.id] }]);
});
