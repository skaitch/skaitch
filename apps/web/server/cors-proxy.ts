import type { Plugin } from 'vite';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Development-only, same-origin bridge for APIs that do not allow browser CORS. */
export function corsProxyPlugin(): Plugin {
  return {
    name: 'cors-proxy-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/cors-proxy/')) return next();
        const reject = (status: number, message: string) => {
          res.writeHead(status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
          res.end(message);
        };
        // Do not expose a proxy to unrelated websites, or forward browser cookies.
        try {
          if ((req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
            || req.headers['sec-fetch-site'] === 'cross-site') return reject(403, 'Same-origin requests only');
        } catch { return reject(403, 'Invalid origin'); }
        if (!['GET', 'HEAD', 'POST'].includes(req.method || 'GET')) return reject(405, 'Method not allowed');
        let target: URL;
        try {
          target = new URL(decodeURIComponent(req.url.slice('/cors-proxy/'.length)));
          if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.hash) {
            return reject(400, 'Invalid proxy target');
          }
        } catch { return reject(400, 'Invalid proxy target'); }

        const controller = new AbortController();
        const cancel = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', cancel);
        try {
          const headers = new Headers();
          for (const name of ['accept', 'content-type', 'authorization', 'x-api-key', 'anthropic-version', 'anthropic-beta']) {
            const value = req.headers[name];
            if (typeof value === 'string') headers.set(name, value);
          }
          const options: RequestInit & { duplex: 'half' } = {
            method: req.method, headers,
            body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : Readable.toWeb(req) as ReadableStream<Uint8Array>,
            duplex: 'half', redirect: 'error', signal: controller.signal,
          };
          const response = await fetch(target, options);
          res.statusCode = response.status;
          res.setHeader('Cache-Control', 'no-store');
          // Fetch decompresses upstream bodies; never forward their old lengths/encoding.
          for (const name of ['content-type', 'retry-after']) {
            const value = response.headers.get(name);
            if (value) res.setHeader(name, value);
          }
          if (response.body) await pipeline(Readable.fromWeb(response.body as any), res);
          else res.end();
        } catch {
          if (!res.headersSent && !res.destroyed) reject(502, 'Upstream API request failed');
          else res.destroy();
        } finally { res.off('close', cancel); }
      });
    },
  };
}
