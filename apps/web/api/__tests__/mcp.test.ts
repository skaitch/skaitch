import { MCP_INSTRUCTIONS, MCP_PUBLIC_TOOLS } from '@skaitch/core/mcp-automation';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';

const store = vi.hoisted(() => ({ docs: new Map<string, any>(), calls: [] as any[], timeout: false, revoked: false, unavailable: false, approved: true }));
vi.mock('../../server/bim/mcpSession.js', () => ({ executeCloudTool: vi.fn(async () => ({ handled: false, projectId: 'p', storeyId: 's', forceConfirm: false })) }));
import { executeCloudTool } from '../../server/bim/mcpSession';
vi.mock('firebase/app', () => ({ initializeApp: () => ({}), getApps: () => [{}], getApp: () => ({}) }));
vi.mock('../_lib/admin', () => ({ getAdminDb: () => { if (store.unavailable) throw new Error('credentials missing'); return ({
  doc: (ref: string) => ({
    get: async () => ({ exists: !store.revoked && ref.endsWith('/apiKeys/ak_user_' + 'a'.repeat(40)), data: () => ({}) }),
    set: async (data: any) => { store.docs.set(ref, data); store.calls.push({ ref, data }); },
    delete: async () => { store.docs.delete(ref); },
    onSnapshot: (cb: any) => {
      const mailbox = ref.split('/').pop();
      const request = store.calls.find(c => c.data.id === mailbox)?.data;
      if (!store.timeout) queueMicrotask(() => cb({ exists: true, data: () => ({ payload: {
        jsonrpc: '2.0', id: mailbox, result: { content: [{ type: 'text', text: request?.approvalOnly ? JSON.stringify({ approved: store.approved }) : request?.name || 'ok' }] },
      } }) }));
      return () => {};
    },
  }),
  collectionGroup: () => ({ where: () => ({ get: async () => ({ empty: true }) }) }),
}); } }));
vi.mock('../_lib/account-grant', () => ({ createAccountGrant: vi.fn(async () => 'ak_user_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') }));
import { createAccountGrant } from '../_lib/account-grant';
import handler from '../mcp';
import buildInfo from '../../build-info.json';
import register from '../mcp/register';
import authorize from '../mcp/authorize';
import token from '../mcp/token';
import metadata from '../oauth/metadata';
import { seal, unseal } from '../_lib/oauth';
import { createHash } from 'node:crypto';

function response() {
  return { status: 200, headers: {} as Record<string, string>, body: '',
    on() {}, off() {},
    setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; },
    writeHead(status: number, headers = {}) { this.status = status; Object.entries(headers).forEach(([k,v]) => this.setHeader(k, v as string)); },
    end(body = '') { this.body = body; },
  };
}
const req = (body: any = {}, headers = {}) => ({ method: 'POST', headers: { host: 'example.com', ...headers }, query: {}, body });
/** Renders the consent page like a browser would and returns its consent field and cookie. */
async function consentFor(params: Record<string, string>) {
  const page = response();
  await authorize({ ...req(), method: 'GET', query: params }, page);
  const consent = /name="consent" value="([^"]+)"/.exec(page.body)![1];
  const cookie = page.headers['set-cookie'].split(';')[0];
  return { consent, cookie };
}
/** POST to /api/mcp/authorize from a browser that displayed the consent page. */
async function consentedPost(params: Record<string, string>, extra: Record<string, string>, res: any) {
  const { consent, cookie } = await consentFor(params);
  await authorize(req({ ...params, ...extra, consent }, { cookie }), res);
}
beforeEach(() => { store.docs.clear(); store.calls = []; store.timeout = false; store.revoked = false; store.unavailable = false; store.approved = true; process.env.OAUTH_SECRET = 'test-secret-with-at-least-thirty-two-characters'; });

describe('OAuth installation flow (ChatGPT / Claude redirect URIs)', () => {
  it.each(['https://chatgpt.com/connector/oauth/callback-test', 'https://claude.ai/api/mcp/auth_callback'])(
    'registers, authorizes and exchanges a PKCE code for %s', async redirect => {
      const registration = response();
      await register(req({ redirect_uris: [redirect] }), registration);
      expect(registration.status).toBe(201);
      const client = JSON.parse(registration.body).client_id;
      const verifier = 'a'.repeat(43);
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const auth = response();
      await consentedPost({ client_id: client, redirect_uri: redirect, response_type: 'code',
        code_challenge: challenge, code_challenge_method: 'S256', state: 'test-state',
        resource: 'https://example.com/api/mcp' }, { api_key: 'ak_user_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, auth);
      expect(auth.status).toBe(302);
      const location = new URL(auth.headers.location);
      expect(location.searchParams.get('state')).toBe('test-state');
      expect(location.searchParams.get('iss')).toBe('https://example.com');
      const code = location.searchParams.get('code');
      const bad = response();
      await token(req({ grant_type: 'authorization_code', code, client_id: client, redirect_uri: redirect, code_verifier: 'b'.repeat(43) }), bad);
      expect(bad.status).toBe(400);
      const exchanged = response();
      await token(req({ grant_type: 'authorization_code', code, client_id: client, redirect_uri: redirect, code_verifier: verifier }), exchanged);
      expect(exchanged.status).toBe(200);
      const { access_token: access, refresh_token: refresh } = JSON.parse(exchanged.body);
      const wrongClient = response();
      await token(req({ grant_type: 'refresh_token', refresh_token: refresh, client_id: 'other' }), wrongClient);
      expect(wrongClient.status).toBe(400);
      const refreshed = response();
      await token(req({ grant_type: 'refresh_token', refresh_token: refresh, client_id: client }), refreshed);
      expect(refreshed.status).toBe(200);
      expect(unseal<any>('access', JSON.parse(refreshed.body).access_token).res).toBe('https://example.com/api/mcp');
      expect(unseal<any>('access', access).res).toBe('https://example.com/api/mcp');
      const tools = response();
      await handler(req({ jsonrpc: '2.0', id: 0, method: 'tools/list' }, { authorization: `Bearer ${access}` }), tools);
      expect(tools.status).toBe(200);
      expect(JSON.parse(tools.body).result.tools.length).toBe(MCP_PUBLIC_TOOLS.length);
    });
  it('offers Google login and preserves the OAuth request through consent', async () => {
    const registration = response();
    const redirect = 'http://127.0.0.1:33679/callback';
    await register(req({ redirect_uris: [redirect] }), registration);
    const params = { client_id: JSON.parse(registration.body).client_id, redirect_uri: redirect,
      response_type: 'code', state: 'google-state', code_challenge: 'challenge', code_challenge_method: 'S256' };
    const page = response();
    await authorize({ ...req(), method: 'GET', query: params }, page);
    expect(page.body).toContain('/oauth/google?');
    expect(page.body).toContain('Continuer avec Google');
    expect(page.body).toMatch(/\/oauth\/google\?[^"]*consent=consent\./);
    const result = response();
    await consentedPost(params, { google_id_token: 'google-token', access: 'write' }, result);
    expect(createAccountGrant).toHaveBeenCalledWith('', '', 'write', 'google-token');
    expect(result.status).toBe(302);
    const location = new URL(result.headers.location);
    expect(location.searchParams.get('state')).toBe('google-state');
    expect(unseal<any>('code', location.searchParams.get('code')!).k).toBe('ak_user_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });
  it('refuses to mint a grant without the consent page shown in this browser', async () => {
    const redirect = 'https://attacker.example/cb';
    const registration = response();
    await register(req({ redirect_uris: [redirect, 'https://other.example/cb'] }), registration);
    const params = { client_id: JSON.parse(registration.body).client_id, redirect_uri: redirect,
      response_type: 'code', code_challenge: 'challenge', code_challenge_method: 'S256' };
    const google = { google_id_token: 'victim-token', access: 'read' };
    vi.mocked(createAccountGrant).mockClear();
    const { consent, cookie } = await consentFor(params);
    // Link sent straight to /oauth/google: no consent at all.
    const direct = response();
    await authorize(req({ ...params, ...google }), direct);
    // Consent obtained by the attacker on their own browser, replayed in the victim's (no cookie).
    const replayed = response();
    await authorize(req({ ...params, ...google, consent }), replayed);
    // Consent bound to another redirect URI.
    const swapped = response();
    await authorize(req({ ...params, ...google, consent, redirect_uri: 'https://other.example/cb' }, { cookie }), swapped);
    for (const r of [direct, replayed, swapped]) {
      expect(r.status).toBe(403);
      expect(r.headers.location).toBeUndefined();
    }
    expect(direct.body).toContain('attacker.example');
    expect(createAccountGrant).not.toHaveBeenCalled();
  });
  it('distinguishes rejected credentials from a server failure', async () => {
    const redirect = 'https://chatgpt.com/connector/oauth/callback-test';
    const registration = response();
    await register(req({ redirect_uris: [redirect] }), registration);
    const params = { client_id: JSON.parse(registration.body).client_id, redirect_uri: redirect,
      response_type: 'code', code_challenge: 'challenge', code_challenge_method: 'S256' };
    const credentials = { email: 'user@example.com', password: 'password' };
    vi.mocked(createAccountGrant).mockRejectedValueOnce({ code: 'auth/invalid-credential' });
    const invalid = response();
    await consentedPost(params, credentials, invalid);
    expect(invalid.status).toBe(401);
    expect(invalid.body).toContain('Identifiants incorrects');
    vi.mocked(createAccountGrant).mockRejectedValueOnce({ code: 'permission-denied' });
    const unavailable = response();
    await consentedPost(params, credentials, unavailable);
    expect(unavailable.status).toBe(503);
    expect(unavailable.body).toContain('Impossible de créer l’autorisation');
  });
  it('exposes the deployed commit even without credentials', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123');
    try {
      const denied = response();
      await handler(req(), denied);
      expect(denied.status).toBe(401);
      expect(denied.headers['x-skaitch-build']).toBe(buildInfo.build);
      expect(denied.headers['x-skaitch-release']).toBe(buildInfo.release);
      expect(denied.headers['access-control-expose-headers']).toContain('X-Skaitch-Build');
      const initialized = response();
      await handler(req({ jsonrpc: '2.0', id: 1, method: 'initialize' }, { 'x-api-key': 'ak_user_' + 'a'.repeat(40) }), initialized);
      expect(JSON.parse(initialized.body).result.serverInfo.version).toBe(`${buildInfo.release}+${buildInfo.build}`);
    } finally { vi.unstubAllEnvs(); }
  });
  it('publishes discovery and challenges missing credentials', async () => {
    const discovery = response(); metadata({ ...req(), method: 'GET', query: { kind: 'pr' } }, discovery);
    expect(JSON.parse(discovery.body).authorization_servers).toEqual(['https://example.com']);
    const denied = response(); await handler(req(), denied);
    expect(denied.status).toBe(401);
    expect(denied.headers['www-authenticate']).toContain('/.well-known/oauth-protected-resource');
  });
  it('cleans up timed-out mailboxes and preserves JSON-RPC id zero', async () => {
    vi.useFakeTimers();
    store.timeout = true;
    try {
      const result = response();
      const running = handler(req({ jsonrpc: '2.0', id: 0, method: 'tools/call', params: { name: 'list_projects' } }, { 'x-api-key': 'ak_user_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }), result);
      await vi.advanceTimersByTimeAsync(120_000);
      await running;
      expect(JSON.parse(result.body)).toMatchObject({ id: 0, error: { code: -32000 } });
      expect(store.docs.size).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('distinguishes a server credential failure from an invalid API key', async () => {
    store.unavailable = true;
    const unavailable = response();
    await handler(req({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: 'Bearer ak_user_' + 'a'.repeat(40) }), unavailable);
    expect(unavailable.status).toBe(503);
    expect(store.calls).toHaveLength(0);
  });
  it('rejects invalid and revoked API keys supplied as Bearer tokens', async () => {
    for (const key of ['invalid', 'ak_user_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']) {
      store.revoked = key === 'ak_user_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const denied = response();
      await handler(req({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: `Bearer ${key}` }), denied);
      expect(denied.status).toBe(401);
      expect(store.calls.filter(c => !c.ref.startsWith('usage_'))).toHaveLength(0);
    }
  });
  it('still opens tokens sealed with the previous secret during a rotation', async () => {
    const old = seal('access', { k: 'ak_user_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', res: 'https://example.com/api/mcp' }, 60);
    process.env.OAUTH_SECRET_PREVIOUS = process.env.OAUTH_SECRET;
    process.env.OAUTH_SECRET = 'a-brand-new-secret-with-thirty-two-plus-chars';
    try {
      expect(unseal<any>('access', old)?.k).toBe('ak_user_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      delete process.env.OAUTH_SECRET_PREVIOUS;
      expect(unseal('access', old)).toBeNull();
    } finally { delete process.env.OAUTH_SECRET_PREVIOUS; }
  });
  it('ignores API keys passed in the URL', async () => {
    const denied = response();
    await handler({ ...req({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), query: { apiKey: 'ak_user_' + 'a'.repeat(40) } }, denied);
    expect(denied.status).toBe(401);
  });
  it('rejects access tokens issued for another MCP resource', async () => {
    const denied = response();
    await handler(req({}, { authorization: `Bearer ${seal('access', { k: 'ak_user_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', res: 'https://other.com/api/mcp' }, 60)}` }), denied);
    expect(denied.status).toBe(401);
  });
});

describe('real MCP SDK transports', () => {
  let http: Server; let url: URL;
  beforeAll(async () => {
    http = createServer(async (incoming, outgoing) => {
      await handler(incoming, outgoing);
    });
    await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', resolve); });
    url = new URL(`http://127.0.0.1:${(http.address() as any).port}/api/mcp`);
  });
  afterAll(() => new Promise<void>(resolve => http.close(() => resolve())));
  it.each(['x-api-key', 'authorization'])('initializes, lists and calls tools using %s', async header => {
    const clients = [new Client({ name: 'chatgpt-test', version: '1' }), new Client({ name: 'claude-test', version: '1' })];
    try {
      for (const client of clients) await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { [header]: header === 'authorization' ? 'Bearer ak_user_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : 'ak_user_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } } }));
      const listed = (await clients[0].listTools()).tools;
      expect(listed.map(tool => tool.name)).toEqual(MCP_PUBLIC_TOOLS.map(tool => tool.name));
      for (const name of ['create_technical', 'update_opening', 'update_element', 'create_furniture', 'get_view', 'set_view', 'capture_view']) {
        const found = await clients[0].callTool({ name: 'search_tools', arguments: { query: name } });
        expect(JSON.parse((found.content as { text: string }[])[0].text).tools.map((tool: { name: string }) => tool.name)).toEqual([name]);
      }
      const results = await Promise.all(clients.map(c => c.callTool({ name: 'list_projects', arguments: {} })));
      expect(results.every(r => (r.content as any[])[0].text === 'list_projects')).toBe(true);
      expect(store.calls).toHaveLength(2); // No initialize/list/ping documents, no duplicate SSE delivery.
      expect(store.calls[0].data.id).not.toBe(store.calls[1].data.id);
      expect(store.docs.size).toBe(0);
    } finally { await Promise.all(clients.map(c => c.close())); }
  });
  it('starts Claude Desktop stdio from a different working directory', async () => {
    const root = process.cwd();
    const client = new Client({ name: 'claude-desktop-test', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath,
      args: ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, 'server/mcp-server.ts')],
      cwd: '/tmp', env: { PATH: process.env.PATH!, SKAITCH_WS_PORT: '0', SKAITCH_SSE_PORT: '0' }, stderr: 'pipe' });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.length).toBe(MCP_PUBLIC_TOOLS.length);
      expect((await client.callTool({ name: 'list_projects', arguments: {} })).isError).toBe(true);
    } finally { await client.close(); }
  });
});

it('delivers compact instructions during MCP initialization', async () => {
  const res = response();
  await handler(req({ jsonrpc: '2.0', id: 'guide', method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    { 'x-api-key': 'ak_user_' + 'a'.repeat(40) }), res);
  expect(res.status).toBe(200);
  expect(JSON.parse(res.body).result.instructions).toBe(MCP_INSTRUCTIONS);
});


it('returns server tool results without creating a browser mailbox', async () => {
  vi.mocked(executeCloudTool).mockResolvedValueOnce({ handled: true, result: [{ id: 'p', name: 'Maison' }] });
  const res = response();
  await handler(req({ jsonrpc: '2.0', id: 0, method: 'tools/call', params: { name: 'list_projects', arguments: {} } },
    { 'x-api-key': 'ak_user_' + 'a'.repeat(40) }), res);
  expect(JSON.parse(JSON.parse(res.body).result.content[0].text)).toEqual([{ id: 'p', name: 'Maison' }]);
  expect(store.calls).toHaveLength(0);
});


it('runs a render on the server only after receiving explicit browser approval', async () => {
  const context = { projectId: 'p', contextRevision: 1, settingsRevision: 0, preferencesRevision: 1, modelRevision: 1, credentialId: 'a'.repeat(64), credentialVersion: 1 };
  vi.mocked(executeCloudTool).mockResolvedValueOnce({ handled: false, projectId: 'p', storeyId: 's', forceConfirm: true, approvalOnly: true, confirmationContext: context });
  vi.mocked(executeCloudTool).mockResolvedValueOnce({ handled: true, result: { success: true, url: 'https://image.example/render.png' } });
  const count = vi.mocked(executeCloudTool).mock.calls.length;
  const res = response();
  await handler(req({ jsonrpc: '2.0', id: 'render', method: 'tools/call', params: { name: 'generate_visualization', arguments: { prompt: 'House' } } }, { 'x-api-key': 'ak_user_' + 'a'.repeat(40) }), res);
  expect(vi.mocked(executeCloudTool).mock.calls.length - count).toBe(2);
  expect(vi.mocked(executeCloudTool).mock.calls.at(-1)![4]).toEqual(context);
  expect(store.calls[0].data.approvalOnly).toBe(true);
  expect(JSON.parse(JSON.parse(res.body).result.content[0].text)).toMatchObject({ success: true });
  expect(store.docs.size).toBe(0);
});
it('does not start the server render when the browser rejects approval', async () => {
  store.approved = false;
  vi.mocked(executeCloudTool).mockResolvedValueOnce({ handled: false, projectId: 'p', storeyId: 's', forceConfirm: true, approvalOnly: true, confirmationContext: { projectId: 'p', contextRevision: 1, settingsRevision: 0, preferencesRevision: 1, modelRevision: 1, credentialId: '', credentialVersion: 0 } });
  const count = vi.mocked(executeCloudTool).mock.calls.length;
  const res = response();
  await handler(req({ jsonrpc: '2.0', id: 'render', method: 'tools/call', params: { name: 'generate_visualization', arguments: { prompt: 'House' } } }, { 'x-api-key': 'ak_user_' + 'a'.repeat(40) }), res);
  expect(vi.mocked(executeCloudTool).mock.calls.length - count).toBe(1);
  expect(JSON.parse(res.body).error.message).toContain('approuvé');
  expect(store.docs.size).toBe(0);
});

it('never commits a refused batch and reuses the preview context for an approved batch', async () => {
  vi.mocked(executeCloudTool).mockClear();
  const confirmationContext = { batch: true as const, projectId: 'p', storeyId: 's', modelRevision: 4, contextRevision: 2 };
  const preview = { handled: false as const, projectId: 'p', storeyId: 's', forceConfirm: true, approvalOnly: true, confirmationContext };
  const key = 'ak_user_' + 'a'.repeat(40);
  const args = { operations: [{ name: 'create_wall', args: { start_point: [0, 0], end_point: [3, 0] } }] };
  const input = { jsonrpc: '2.0', id: 'batch', method: 'tools/call', params: { name: 'apply_model_batch', arguments: args } };
  store.approved = false;
  vi.mocked(executeCloudTool).mockResolvedValueOnce(preview);
  await handler(req(input, { 'x-api-key': key }), response());
  expect(vi.mocked(executeCloudTool)).toHaveBeenCalledTimes(1);

  store.approved = true;
  vi.mocked(executeCloudTool).mockClear();
  vi.mocked(executeCloudTool).mockResolvedValueOnce(preview).mockResolvedValueOnce({ handled: true, result: { success: true } });
  const result = response();
  await handler(req(input, { 'x-api-key': key }), result);
  expect(vi.mocked(executeCloudTool)).toHaveBeenNthCalledWith(2, expect.any(String), key, 'apply_model_batch', args, confirmationContext, expect.any(AbortSignal));
  expect(JSON.parse(result.body).result).toBeDefined();
});
