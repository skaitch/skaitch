import { gunzipSync } from 'node:zlib';
import { afterEach, expect, it, vi } from 'vitest';
const session = vi.hoisted(() => ({ user: { getIdToken: vi.fn(async () => 'id-token') } as { getIdToken: () => Promise<string> } | null }));
vi.mock('../firebase', () => ({ auth: { get currentUser() { return session.user; } } }));
import { requestBim, httpBimService } from '../bimClient';
import { provideBimService } from '@skaitch/ui/lib/bimService';
import { importIFCBuffer } from '@skaitch/ui/lib/importIFC';
import { exportIFC } from '@skaitch/ui/lib/exportIFC';
import { patchIFC } from '@skaitch/ui/lib/patchIFC';
import { checkRoundTrip, fixRoundTripProblems } from '@skaitch/ui/lib/roundTripCheck';

provideBimService(httpBimService);

afterEach(() => { vi.unstubAllGlobals(); session.user = { getIdToken: vi.fn(async () => 'id-token') }; });
it('compresses the model and authenticates same-origin requests without a local engine fallback', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify('IFC response')));
  vi.stubGlobal('fetch', fetch);
  expect(await requestBim('export-ifc', { items: {} })).toBe('IFC response');
  const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/api/bim?operation=export-ifc');
  expect(options.headers).toMatchObject({ Authorization: 'Bearer id-token', 'Content-Encoding': 'gzip' });
  expect(JSON.parse(gunzipSync(Buffer.from(await (options.body as Blob).arrayBuffer())).toString())).toEqual({ items: {} });
});
it('rejects signed-out users and exposes server errors without executing client logic', async () => {
  session.user = null;
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(requestBim('export-ifc', {})).rejects.toThrow('Connectez-vous');
  expect(fetch).not.toHaveBeenCalled();
  session.user = { getIdToken: async () => 'id-token' };
  fetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Session expirée' }), { status: 401 }));
  await expect(requestBim('export-ifc', {})).rejects.toThrow('Session expirée');
});
it('routes every migrated browser operation to the server and preserves the original IFC buffer', async () => {
  const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('import') ? { items: {}, rawStructure: null } : {})));
  vi.stubGlobal('fetch', fetch);
  const original = new TextEncoder().encode('ISO-10303-21;').buffer;
  expect((await importIFCBuffer(original)).rawIfcBuffer).toBe(original);
  await exportIFC({}); await patchIFC({}, original); await checkRoundTrip({}); await fixRoundTripProblems({});
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['import-ifc', 'export-ifc', 'patch-ifc', 'check-ifc', 'fix-ifc'].map(operation => `/api/bim?operation=${operation}`));
});
