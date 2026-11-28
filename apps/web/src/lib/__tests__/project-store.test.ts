import { randomBytes } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { buildEmpty, buildStarter } from '@skaitch/core/data/starter';
import { uniqueProjectName } from '@skaitch/core/lib/projectName';
import { BUILTIN_CATALOGUE } from '@skaitch/core/data/elementCatalogue';

const memory = vi.hoisted(() => ({ docs: new Map<string, any>(), queue: Promise.resolve(), beforeTransaction: null as null | (() => void) }));
vi.mock('../../../server/ai/upstream', () => ({ upstreamFetch: vi.fn() }));
import { upstreamFetch } from '../../../server/ai/upstream';
vi.mock('../../../api/_lib/admin.js', () => {
  const snapshot = (ref: string) => ({ ref, id: ref.substring(ref.lastIndexOf('/') + 1), exists: memory.docs.has(ref), data: () => structuredClone(memory.docs.get(ref)) });
  const reference = (path: string) => ({ path, get: async () => snapshot(path) });
  const pathOf = (ref: any) => typeof ref === 'string' ? ref : ref.path;
  return { getAdminDb: () => ({
    doc: reference,
    collection: (path: string) => ({ get: async () => ({ docs: [...memory.docs.keys()].filter(key => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/')).map(snapshot) }) }),
    runTransaction: (callback: any) => {
      const result = memory.queue.then(async () => {
        memory.beforeTransaction?.();
        memory.beforeTransaction = null;
        let written = false;
        return callback({
          get: async (ref: any) => { if (written) throw new Error('Reads must precede writes'); return snapshot(pathOf(ref)); },
          set: (ref: any, value: unknown) => { written = true; memory.docs.set(pathOf(ref), structuredClone(value)); },
          update: (ref: any, value: object) => { written = true; memory.docs.set(pathOf(ref), { ...memory.docs.get(pathOf(ref)), ...value }); },
          delete: (ref: any) => { written = true; memory.docs.delete(pathOf(ref)); },
        });
      });
      memory.queue = result.then(() => undefined, () => undefined);
      return result;
    },
  }) };
});
import { readStoredProject, deleteStoredProject, listStoredProjects, writeStoredProject } from '../../../server/bim/projectStore';
import { executeCloudTool } from '../../../server/bim/mcpSession';
import { getAiPreferences, saveAiPreferences } from '../../../server/ai/preferences';
import { aiCredentials } from '../../../server/ai/vault';
import { aiPreferences } from '../aiPreferences';
import { mcpSettings } from '../../../server/bim/mcpSettings';
const project = (id: string, name: string) => ({ id, name, description: 'preserved', createdAt: '2026-11-13', updatedAt: '2026-11-13', itemsJson: JSON.stringify(buildEmpty()) });
beforeEach(() => { memory.docs.clear(); memory.queue = Promise.resolve(); memory.beforeTransaction = null; vi.mocked(upstreamFetch).mockReset().mockRejectedValue(new Error('Unexpected external request')); process.env.AI_VAULT_SECRET = 'test-render-vault-secret-at-least-thirty-two-characters'; });

it('compares names without case, redundant whitespace or Unicode composition differences', () => {
  expect(uniqueProjectName('  MAISON  test ', ['Maison test', 'MAISON test (2)'])).toBe('MAISON test (3)');
  expect(uniqueProjectName('Cafe\u0301', ['Café'])).toBe('Café (2)');
  expect(uniqueProjectName(' ', ['Nouveau projet'])).toBe('Nouveau projet (2)');
});
it('reserves distinct names for simultaneous imports and keeps model names synchronized', async () => {
  const results = await Promise.all(['a', 'b'].map(id => writeStoredProject('u', id, project(id, 'Maison'))));
  expect(results.map(p => p.name)).toEqual(['Maison', 'Maison (2)']);
  for (const p of results) expect(Object.values(JSON.parse(p.itemsJson)).find((item: any) => item.type === 'Project')).toMatchObject({ name: p.name, Name: p.name });
});
it('disambiguates renames and repeated saves without incrementing their own suffix', async () => {
  await writeStoredProject('u', 'a', project('a', 'Maison'));
  await writeStoredProject('u', 'b', project('b', 'Bureau'));
  const renamed = await writeStoredProject('u', 'b', { name: 'maison' });
  expect(renamed.name).toBe('maison (2)');
  expect((await writeStoredProject('u', 'b', { description: 'updated' })).name).toBe('maison (2)');
});
it('releases the name after deleting its project', async () => {
  await writeStoredProject('u', 'a', project('a', 'Maison'));
  await deleteStoredProject('u', 'a', memory.docs.get('users/u/projects/a').modelRevision);
  expect((await writeStoredProject('u', 'b', project('b', 'Maison'))).name).toBe('Maison');
});
it('distinguishes legacy duplicates without deleting their models or taking an existing suffixed name', async () => {
  for (const [id, name] of [['a', 'Maison'], ['b', ' maison '], ['c', 'Maison (2)']]) memory.docs.set(`users/u/projects/${id}`, project(id, name));
  const projects = await listStoredProjects('u');
  expect(projects).toHaveLength(3);
  expect(new Set(projects.map(p => p.name.toLowerCase())).size).toBe(3);
  expect(projects.every(p => p.description === 'preserved')).toBe(true);
  expect(projects.find(p => p.id === 'c')!.name).toBe('Maison (2)');
  for (const p of projects) expect(JSON.parse(memory.docs.get(`users/u/projects/${p.id}`).itemsJson)).toBeTruthy();
});
it('keeps different accounts independent', async () => {
  expect((await writeStoredProject('u', 'a', project('a', 'Maison'))).name).toBe('Maison');
  expect((await writeStoredProject('other', 'b', project('b', 'Maison'))).name).toBe('Maison');
});

it('does not recreate a deleted project when an old autosave arrives', async () => {
  await writeStoredProject('u', 'a', project('a', 'Maison'));
  await deleteStoredProject('u', 'a', memory.docs.get('users/u/projects/a').modelRevision);
  await expect(writeStoredProject('u', 'a', { name: 'Maison', itemsJson: JSON.stringify(buildEmpty()) })).rejects.toThrow('Projet introuvable');
  expect(memory.docs.has('users/u/projects/a')).toBe(false);
});

it('rejects concurrent stale model writes and stale deletions without changing stored data', async () => {
  const created = await writeStoredProject('u', 'a', project('a', 'Maison'));
  const before = memory.docs.get('users/u/projects/a');
  const model = JSON.parse(before.itemsJson);
  const entity: any = Object.values(model)[0];
  entity.description = 'edited';
  const first = await writeStoredProject('u', 'a', { itemsJson: JSON.stringify(model) }, created.modelRevision);
  expect(first.modelRevision).toBe(created.modelRevision! + 1);
  await expect(writeStoredProject('u', 'a', { itemsJson: before.itemsJson }, created.modelRevision)).rejects.toMatchObject({ status: 409 });
  await expect(deleteStoredProject('u', 'a', created.modelRevision)).rejects.toMatchObject({ status: 409 });
  expect(memory.docs.get('users/u/projects/a').itemsJson).toBe(first.itemsJson);
});

it('accepts a repeated committed model save without advancing its revision', async () => {
  const created = await writeStoredProject('u', 'retry', project('retry', 'Maison'));
  const items = JSON.parse(created.itemsJson);
  Object.values<any>(items)[0].description = 'edited';
  const patch = { itemsJson: JSON.stringify(items), catalogue: [] };
  const saved = await writeStoredProject('u', 'retry', patch, created.modelRevision);
  const repeated = await writeStoredProject('u', 'retry', patch, created.modelRevision);
  expect(repeated.itemsJson).toBe(saved.itemsJson);
  expect(repeated.modelRevision).toBe(saved.modelRevision);
  await expect(writeStoredProject('u', 'retry', { catalogue: [BUILTIN_CATALOGUE[0]] }, created.modelRevision)).rejects.toMatchObject({ status: 409 });
  expect((await readStoredProject('u', 'retry'))!.catalogue).toEqual([]);
});

it('supports legacy revision zero and validates project IDs and model input', async () => {
  memory.docs.set('users/u/projects/legacy', project('legacy', 'Ancien'));
  const stored = await writeStoredProject('u', 'legacy', { description: 'updated', itemsJson: project('legacy', 'Ancien').itemsJson }, 0);
  expect(stored.modelRevision).toBe(1);
  await expect(writeStoredProject('u', '../other', project('../other', 'Bad'))).rejects.toMatchObject({ status: 400 });
  await expect(writeStoredProject('u', 'a', { ...project('a', 'Bad'), itemsJson: '{broken' })).rejects.toMatchObject({ status: 400 });
  await expect(writeStoredProject('u', 'a', { ...project('a', 'Bad'), modelRevision: 99 })).rejects.toMatchObject({ status: 400 });
});

it('saves large models in atomic chunks, hydrates them, and removes obsolete chunks', async () => {
  const created = await writeStoredProject('u', 'large', project('large', 'Maison'));
  const items = JSON.parse(created.itemsJson);
  (Object.values(items)[0] as any).description = randomBytes(800_000).toString('base64');
  const saved = await writeStoredProject('u', 'large', { itemsJson: JSON.stringify(items) }, created.modelRevision);
  const raw = memory.docs.get('users/u/projects/large');
  expect(raw.itemsJson).toBe('');
  expect(raw.modelChunks.count).toBeGreaterThan(1);
  expect(raw.modelBytes).toBe(Buffer.byteLength(saved.itemsJson));
  expect(memory.docs.get('users/u/projects/large')).toHaveProperty('modelBytes');
  expect(await readStoredProject('u', 'large')).not.toHaveProperty('modelBytes');
  expect((await listStoredProjects('u'))[0]).not.toHaveProperty('modelBytes');
  expect((await readStoredProject('u', 'large'))!.itemsJson).toBe(saved.itemsJson);
  expect(await listStoredProjects('u')).toHaveLength(1);
  const small = await writeStoredProject('u', 'large', { itemsJson: created.itemsJson }, saved.modelRevision);
  expect((await readStoredProject('u', 'large'))!.itemsJson).toBe(small.itemsJson);
  expect(memory.docs.get('users/u/projects/large').modelBytes).toBe(Buffer.byteLength(small.itemsJson));
  expect([...memory.docs.keys()].some(path => path.includes('/modelChunks/'))).toBe(false);
});
it('detects missing chunks and deletes all project chunks with the project', async () => {
  const data = project('chunks', 'Maison');
  const items = JSON.parse(data.itemsJson);
  Object.values<any>(items)[0].description = 'x'.repeat(960_000);
  const saved = await writeStoredProject('u', 'chunks', { ...data, itemsJson: JSON.stringify(items) });
  const part = [...memory.docs.keys()].find(path => path.includes('/modelChunks/'))!;
  const content = memory.docs.get(part);
  memory.docs.delete(part);
  await expect(readStoredProject('u', 'chunks')).rejects.toThrow('incomplète');
  memory.docs.set(part, content);
  await deleteStoredProject('u', 'chunks', saved.modelRevision);
  expect([...memory.docs.keys()].some(path => path.startsWith('users/u/projects/chunks'))).toBe(false);
});


const token = 'ak_test';
const grant = (permissions: Record<string, string>, key = token) => memory.docs.set(`users/u/apiKeys/${key}`, { permissions });
async function setupCloud() {
  const created = await writeStoredProject('u', 'a', project('a', 'Maison'));
  grant({ a: 'write' });
  await executeCloudTool('u', token, 'select_project', { project_id: 'a' });
  return created;
}
it('lists only granted projects and keeps context independent for each API key', async () => {
  await setupCloud();
  await writeStoredProject('u', 'b', project('b', 'Bureau'));
  await writeStoredProject('u', 'hidden', project('hidden', 'Invisible'));
  grant({ a: 'read' }); grant({ b: 'read' }, 'ak_other');
  const listed: any = await executeCloudTool('u', token, 'list_projects', {});
  expect(listed.result.map((p: any) => p.id)).toEqual(['a']);
  await executeCloudTool('u', 'ak_other', 'select_project', { project_id: 'b' });
  const first: any = await executeCloudTool('u', token, 'list_spatial_structure', {});
  const second: any = await executeCloudTool('u', 'ak_other', 'list_spatial_structure', {});
  expect(first.result.project.name).toBe('Maison'); expect(second.result.project.name).toBe('Bureau');
  await expect(executeCloudTool('u', token, 'select_project', { project_id: 'b' })).rejects.toThrow('Access denied');
  await expect(executeCloudTool('u', token, 'select_project', { project_id: '../b' })).rejects.toThrow('Select a project');
});
it('commits MCP changes without a browser by default and requires confirmation when opted in', async () => {
  const created = await setupCloud();
  const args = { start_point: [0, 0], end_point: [4, 0] };
  const result: any = await executeCloudTool('u', token, 'create_wall', args);
  expect(result).toMatchObject({ handled: true, result: { success: true, model_revision: created.modelRevision! + 1 } });
  await mcpSettings('u', { action: 'set', enabled: true, alwaysValidate: true, expectedRevision: 0 });
  expect(await executeCloudTool('u', token, 'create_wall', args)).toMatchObject({ handled: false, projectId: 'a', forceConfirm: true });
  expect(memory.docs.get('users/u/projects/a').modelRevision).toBe(created.modelRevision! + 1);
  const stored = JSON.parse(memory.docs.get('users/u/projects/a').itemsJson);
  expect(stored[result.result.id].geom.x2).toBe(4);
  const exported: any = await executeCloudTool('u', token, 'export_ifc', {});
  expect(exported.result.content).toContain('IFCWALL');
  expect([...memory.docs.keys()].some(path => path.includes('mcp_requests'))).toBe(false);
});
it('checks current grants and confirmation settings again inside the commit transaction', async () => {
  await setupCloud();
  await mcpSettings('u', { action: 'set', enabled: true, alwaysValidate: false, expectedRevision: 0 });
  const before = memory.docs.get('users/u/projects/a').itemsJson;
  const args = { start_point: [0, 0], end_point: [4, 0] };
  memory.beforeTransaction = () => grant({ a: 'read' });
  await expect(executeCloudTool('u', token, 'create_wall', args)).rejects.toThrow('read-only');
  expect(memory.docs.get('users/u/projects/a').itemsJson).toBe(before);
  grant({ a: 'write' });
  memory.beforeTransaction = () => memory.docs.set('users/u/metadata/mcp', { enabled: true, alwaysValidate: true, revision: 2 });
  await expect(executeCloudTool('u', token, 'create_wall', args)).rejects.toThrow('confirmation settings changed');
  expect(memory.docs.get('users/u/projects/a').itemsJson).toBe(before);
});
it('preserves cascade deletion semantics when MCP deletes a wall on the server', async () => {
  await writeStoredProject('u', 'a', { ...project('a', 'Maison'), itemsJson: JSON.stringify(buildStarter()) });
  grant({ a: 'write' });
  await executeCloudTool('u', token, 'select_project', { project_id: 'a' });
  await mcpSettings('u', { action: 'set', enabled: true, alwaysValidate: false, expectedRevision: 0 });
  const items = JSON.parse(memory.docs.get('users/u/projects/a').itemsJson);
  const door: any = Object.values(items).find((i: any) => i.type === 'Door');
  await executeCloudTool('u', token, 'delete_element', { ids: [door.geom.wallId] });
  const after = JSON.parse(memory.docs.get('users/u/projects/a').itemsJson);
  expect(after[door.id]).toBeUndefined(); expect(after[door.geom.wallId]).toBeUndefined();
});
it('persists MCP policy with revision checks, honors disabled mode and rejects revoked keys', async () => {
  await setupCloud();
  expect(await mcpSettings('u', { action: 'get' })).toMatchObject({ enabled: true, alwaysValidate: false });
  await mcpSettings('u', { action: 'set', enabled: false, alwaysValidate: true, expectedRevision: 0 });
  await expect(mcpSettings('u', { action: 'set', enabled: true, alwaysValidate: false, expectedRevision: 0 })).rejects.toMatchObject({ status: 409 });
  await expect(executeCloudTool('u', token, 'list_projects', {})).rejects.toThrow('disabled');
  memory.docs.delete(`users/u/apiKeys/${token}`);
  await expect(executeCloudTool('u', token, 'list_projects', {})).rejects.toThrow('revoked');
});


it('names browser-free MCP creations in the language saved with the MCP settings', async () => {
  await setupCloud();
  const created = async () => {
    const wall: any = await executeCloudTool('u', token, 'create_wall', { start_point: [0, 0], end_point: [4, 0] });
    return JSON.parse(memory.docs.get('users/u/projects/a').itemsJson)[wall.result.id].name;
  };
  await mcpSettings('u', { action: 'set', enabled: true, alwaysValidate: false, expectedRevision: 0 });
  expect(await created()).toBe('Mur MCP');
  await mcpSettings('u', { action: 'set', enabled: true, alwaysValidate: false, lang: 'en', expectedRevision: 1 });
  expect(await created()).toBe('MCP wall');
  // A write without a language keeps the saved one.
  expect(await mcpSettings('u', { action: 'set', enabled: true, alwaysValidate: false, expectedRevision: 2 })).toMatchObject({ lang: 'en' });
  expect(await mcpSettings('u', { action: 'get' })).toMatchObject({ lang: 'en' });
  await expect(mcpSettings('u', { action: 'set', enabled: true, alwaysValidate: false, lang: 'xx', expectedRevision: 3 })).rejects.toThrow();
});

it('selects storeys and uses a saved project catalogue for browser-free creation', async () => {
  await setupCloud();
  const before = memory.docs.get('users/u/projects/a');
  const custom = { id: 'custom-door', type: 'Door' as const, category: 'Custom', labelFr: 'Porte test', labelEn: 'Test door', source: 'project' as const, defaults: { width: 1.2, height: 2.3 } };
  await writeStoredProject('u', 'a', { catalogue: [custom] }, before.modelRevision);
  await mcpSettings('u', { action: 'set', enabled: true, alwaysValidate: false, expectedRevision: 0 });
  await executeCloudTool('u', token, 'select_storey', { storey_id: 'sty_A0' });
  await expect(executeCloudTool('u', token, 'select_storey', { storey_id: 'missing' })).rejects.toThrow('Storey not found');
  const wall: any = await executeCloudTool('u', token, 'create_wall', { start_point: [0, 0], end_point: [4, 0] });
  const door: any = await executeCloudTool('u', token, 'create_door', { wall_id: wall.result.id, catalogue_id: custom.id });
  const after = JSON.parse(memory.docs.get('users/u/projects/a').itemsJson);
  expect(after[door.result.id].geom).toMatchObject({ width: 1.2, height: 2.3 });
  const listed: any = await executeCloudTool('u', token, 'list_opening_types', {});
  expect(listed.result).toEqual([custom]);
});

it('refuses a model commit when the API key selection changes during computation', async () => {
  await setupCloud();
  await mcpSettings('u', { action: 'set', enabled: true, alwaysValidate: false, expectedRevision: 0 });
  const before = memory.docs.get('users/u/projects/a').itemsJson;
  const sessionPath = [...memory.docs.keys()].find(path => path.includes('/mcp_sessions/'))!;
  memory.beforeTransaction = () => memory.docs.set(sessionPath, { ...memory.docs.get(sessionPath), revision: 99 });
  await expect(executeCloudTool('u', token, 'create_marker', { point: [0, 0] })).rejects.toThrow('selection changed');
  expect(memory.docs.get('users/u/projects/a').itemsJson).toBe(before);
});


it('saves public AI preferences per account with revision checks and rejects secret fields', async () => {
  const config = aiPreferences({ provider: 'openai', model: 'm', temperature: 0.5, visualizerProvider: 'openai' });
  expect(await getAiPreferences('u')).toEqual({ revision: 0, config: null });
  expect(await saveAiPreferences('u', config, 0)).toEqual({ revision: 1, config });
  expect(await getAiPreferences('other')).toEqual({ revision: 0, config: null });
  await expect(saveAiPreferences('u', { ...config, model: 'stale' }, 0)).rejects.toMatchObject({ status: 409 });
  await expect(saveAiPreferences('u', { ...config, apiKey: 'should-not-be-persisted' }, 1)).rejects.toMatchObject({ status: 400 });
  await expect(saveAiPreferences('u', { ...config, baseUrl: 'https://provider.example/?key=secret' }, 1)).rejects.toMatchObject({ status: 400 });
  expect((await getAiPreferences('u')).config?.model).toBe('m');
});
async function setupRender(confirmation = true) {
  await setupCloud();
  const config = aiPreferences({ provider: 'openai', model: 'chat', temperature: 0, visualizerProvider: 'openai', visualizerModel: 'image-model' });
  await saveAiPreferences('u', config, 0);
  const key: any = await aiCredentials('u', { action: 'save', role: 'render', provider: 'openai', secret: 'hidden-render-key', expectedVersion: 0 });
  if (!confirmation) await mcpSettings('u', { action: 'set', enabled: true, alwaysValidate: false, expectedRevision: 0 });
  vi.mocked(upstreamFetch).mockResolvedValue(new Response(JSON.stringify({ data: [{ url: 'https://image.example/render.png' }] })));
  return { config, key };
}
it('renders from saved AI preferences and encrypted credentials without a browser when opted in', async () => {
  await setupRender(false);
  const result: any = await executeCloudTool('u', token, 'generate_visualization', { prompt: 'House', type: 'image' });
  expect(result).toMatchObject({ handled: true, result: { success: true, url: 'https://image.example/render.png' } });
  expect(upstreamFetch).toHaveBeenCalledTimes(1);
  const [url, options, origins] = vi.mocked(upstreamFetch).mock.calls[0];
  expect(url).toBe('https://api.openai.com/v1/images/generations');
  expect(options!.headers).toMatchObject({ Authorization: 'Bearer hidden-render-key' });
  expect(JSON.parse(options!.body as string).model).toBe('image-model');
  expect(origins).toEqual(['https://api.openai.com']);
  expect(JSON.stringify(result)).not.toContain('hidden-render-key');
});
it('requires approval, when validation is enabled, before making a paid render call and rechecks configuration afterwards', async () => {
  const { config } = await setupRender();
  await mcpSettings('u', { action: 'set', enabled: true, alwaysValidate: true, expectedRevision: 0 });
  const args = { prompt: 'House' };
  const plan: any = await executeCloudTool('u', token, 'generate_visualization', args);
  expect(plan).toMatchObject({ handled: false, approvalOnly: true, forceConfirm: true, aiPreferences: config });
  expect(upstreamFetch).not.toHaveBeenCalled();
  await saveAiPreferences('u', { ...config, visualizerModel: 'changed' }, 1);
  await expect(executeCloudTool('u', token, 'generate_visualization', args, plan.confirmationContext)).rejects.toMatchObject({ status: 409 });
  expect(upstreamFetch).not.toHaveBeenCalled();
  const next: any = await executeCloudTool('u', token, 'generate_visualization', args);
  expect(await executeCloudTool('u', token, 'generate_visualization', args, next.confirmationContext)).toMatchObject({ handled: true, result: { success: true } });
  expect(upstreamFetch).toHaveBeenCalledTimes(1);
});
it('refuses render calls after grant revocation or key replacement and preserves local-provider fallback', async () => {
  const { key, config } = await setupRender(false);
  memory.beforeTransaction = () => grant({ a: 'read' });
  await expect(executeCloudTool('u', token, 'generate_visualization', { prompt: 'House' })).rejects.toThrow('read-only');
  expect(upstreamFetch).not.toHaveBeenCalled();
  grant({ a: 'write' });
  memory.beforeTransaction = () => memory.docs.set(`users/u/ai_credentials/${key.id}`, { ...memory.docs.get(`users/u/ai_credentials/${key.id}`), version: 2 });
  await expect(executeCloudTool('u', token, 'generate_visualization', { prompt: 'House' })).rejects.toThrow('clé');
  expect(upstreamFetch).not.toHaveBeenCalled();
  await saveAiPreferences('u', { ...config, visualizerProvider: 'custom', visualizerBaseUrl: 'http://localhost:11434' }, 1);
  expect(await executeCloudTool('u', token, 'generate_visualization', { prompt: 'Local' })).toMatchObject({ handled: false, aiPreferences: { visualizerProvider: 'custom' } });
  expect(upstreamFetch).not.toHaveBeenCalled();
});

it('refuses an oversized atomic save before changing any document', async () => {
  const created = await writeStoredProject('u', 'oversized', project('oversized', 'Maison'));
  const items = JSON.parse(created.itemsJson);
  Object.values<any>(items)[0].description = randomBytes(3_200_000).toString('base64');
  const before = structuredClone([...memory.docs]);
  await expect(writeStoredProject('u', 'oversized', { itemsJson: JSON.stringify(items) }, created.modelRevision)).rejects.toMatchObject({ status: 413 });
  expect([...memory.docs]).toEqual(before);
});
it('reads chunked models through cloud MCP without an editor', async () => {
  const created = await setupCloud();
  const items = JSON.parse(created.itemsJson);
  Object.values<any>(items)[0].description = 'x'.repeat(960_000);
  await writeStoredProject('u', 'a', { itemsJson: JSON.stringify(items) }, created.modelRevision);
  expect(memory.docs.get('users/u/projects/a').modelChunks).toBeDefined();
  const result = await executeCloudTool('u', token, 'get_ifc_scene_overview', {});
  expect(result.handled).toBe(true);
  if (!result.handled) throw new Error('Expected server execution');
  expect(result.result).toBeDefined();
});

it('keeps the revision stable for Firestore catalogue maps with reordered keys', async () => {
  const catalogue = [BUILTIN_CATALOGUE[0]];
  const saved = await writeStoredProject('u', 'catalogue-order', { ...project('catalogue-order', 'Maison'), catalogue });
  const document = memory.docs.get('users/u/projects/catalogue-order');
  document.catalogue = catalogue.map(({ defaults, ...entry }) => ({ defaults: Object.fromEntries(Object.entries(defaults).reverse()), ...entry }));
  const repeated = await writeStoredProject('u', 'catalogue-order', { itemsJson: saved.itemsJson, catalogue }, saved.modelRevision);
  expect(repeated.modelRevision).toBe(saved.modelRevision);
});

it('limits each web account to three projects while keeping updates and legacy accounts working', async () => {
  for (const id of ['a', 'b', 'c']) await writeStoredProject('u', id, project(id, `P ${id}`));
  await expect(writeStoredProject('u', 'd', project('d', 'P d'))).rejects.toMatchObject({ status: 403 });
  expect(memory.docs.has('users/u/projects/d')).toBe(false);
  expect((await writeStoredProject('u', 'a', { description: 'still editable' })).description).toBe('still editable');
  expect((await writeStoredProject('other', 'd', project('d', 'P d'))).id).toBe('d');
  await deleteStoredProject('u', 'c', memory.docs.get('users/u/projects/c').modelRevision);
  expect((await writeStoredProject('u', 'd', project('d', 'P d'))).id).toBe('d');
  // An account that already holds more projects keeps them but cannot add another.
  for (const id of ['l1', 'l2', 'l3', 'l4']) memory.docs.set(`users/legacy/projects/${id}`, project(id, id));
  expect(await listStoredProjects('legacy')).toHaveLength(4);
  await expect(writeStoredProject('legacy', 'l5', project('l5', 'l5'))).rejects.toMatchObject({ status: 403 });
});
it('lets administrators create projects beyond the beta limit', async () => {
  vi.stubEnv('SKAITCH_ADMIN_UIDS', 'boss');
  for (const id of ['a', 'b', 'c', 'd', 'e']) await writeStoredProject('boss', id, project(id, `P ${id}`));
  expect(await listStoredProjects('boss')).toHaveLength(5);
  await expect(writeStoredProject('u2', 'x', project('x', 'x')).then(() => Promise.all(['y', 'z', 'w'].map(id => writeStoredProject('u2', id, project(id, id)))))).rejects.toMatchObject({ status: 403 });
  vi.unstubAllEnvs();
});
it('refuses simultaneous creations beyond the limit', async () => {
  const results = await Promise.allSettled(['a', 'b', 'c', 'd', 'e'].map(id => writeStoredProject('u', id, project(id, id))));
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(3);
  expect((await listStoredProjects('u'))).toHaveLength(3);
});
