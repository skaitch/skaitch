import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { corsProxyPlugin } from '../../../server/cors-proxy';
import { aiRequestUrl } from '../aiRequestUrl';

let upstream: Server, proxy: Server, upstreamUrl: string, proxyUrl: string;
const seen: { headers?: any; body?: string } = {};
async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${(server.address() as any).port}`;
}
beforeAll(async () => {
  upstream = createServer(async (req, res) => {
    seen.headers = req.headers; let body = '';
    for await (const chunk of req) body += chunk;
    seen.body = body;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Set-Cookie': 'upstream=private' });
    res.write('data: first\n\n'); res.end('data: second\n\n');
  });
  upstreamUrl = await listen(upstream);
  let middleware: any;
  const plugin = corsProxyPlugin();
  (plugin.configureServer as any)({ middlewares: { use(fn: any) { middleware = fn; } } });
  proxy = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  proxyUrl = await listen(proxy);
});
afterAll(async () => {
  for (const server of [proxy, upstream]) {
    if (server) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
  }
});
it('streams POST responses while forwarding API credentials and excluding browser credentials', async () => {
  const result = await fetch(`${proxyUrl}/cors-proxy/${encodeURIComponent(upstreamUrl + '/chat?model=a')}`, {
    method: 'POST', headers: { Origin: proxyUrl, Authorization: 'Bearer test-api-key', Cookie: 'session=private', 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: ['hello'] }),
  });
  expect(result.status).toBe(200);
  expect(await result.text()).toBe('data: first\n\ndata: second\n\n');
  expect(result.headers.get('set-cookie')).toBeNull();
  expect(result.headers.get('access-control-allow-origin')).toBeNull();
  expect(seen.headers.authorization).toBe('Bearer test-api-key');
  expect(seen.headers.cookie).toBeUndefined();
  expect(JSON.parse(seen.body!)).toEqual({ messages: ['hello'] });
});
it('rejects cross-origin requests and malformed or unsupported targets', async () => {
  const url = `${proxyUrl}/cors-proxy/${encodeURIComponent(upstreamUrl)}`;
  expect((await fetch(url, { headers: { Origin: 'https://unrelated.example' } })).status).toBe(403);
  expect((await fetch(url, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
  expect((await fetch(url, { method: 'DELETE' })).status).toBe(405);
  expect((await fetch(`${proxyUrl}/cors-proxy/%INVALID`)).status).toBe(400);
  expect((await fetch(`${proxyUrl}/cors-proxy/${encodeURIComponent('file:///etc/passwd')}`)).status).toBe(400);
});
it('only rewrites URLs during development', () => {
  const url = 'https://example.com/v1/chat?model=a';
  expect(aiRequestUrl(url, true, true)).toBe('/cors-proxy/' + encodeURIComponent(url));
  expect(aiRequestUrl(url, true, false)).toBe(url);
  expect(aiRequestUrl(url, false, true)).toBe(url);
});
