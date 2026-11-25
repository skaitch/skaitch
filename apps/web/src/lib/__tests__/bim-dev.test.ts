import { Readable } from 'node:stream';
import { createServer } from 'vite';
import { expect, it } from 'vitest';
import { bimServerPlugin } from '../../../server/bim-dev';

it('loads the real Node BIM route in Vite middleware mode without opening the app server', async () => {
  const server = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, plugins: [bimServerPlugin()] });
  try {
    expect(server.httpServer).toBeNull();
    for (const route of ['/api/bim.ts', '/api/ai.ts']) {
    const { default: handler } = await server.ssrLoadModule(route);
    const req = Object.assign(Readable.from([]), { method: 'POST', url: '/api/bim?operation=export-ifc', headers: {} });
    const res = { statusCode: 0, body: '', setHeader() {}, end(body: string) { this.body = body; } };
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toContain('Session Firebase');
    }
    const { default: mcp } = await server.ssrLoadModule('/api/mcp.ts');
    const mcpReq = Object.assign(Readable.from([]), { method: 'POST', url: '/api/mcp', headers: {} });
    const reply = { statusCode: 0, body: '', setHeader() {}, writeHead(status: number) { this.statusCode = status; }, end(body: string) { this.body = body; } };
    await mcp(mcpReq, reply);
    expect(reply.statusCode).toBe(401);
    expect(JSON.parse(reply.body).error).toContain('credentials missing');
  } finally { await server.close(); }
}, 30000);
