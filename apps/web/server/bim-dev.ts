import type { Plugin } from 'vite';

/** Run the same authenticated BIM handler locally; production uses api/bim.ts. */
export function bimServerPlugin(): Plugin {
  return {
    name: 'bim-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost');
        // Same rewrite as vercel.json: /download/:platform → /api/download?platform=:platform
        const download = /^\/download\/([^/]+)$/.exec(url.pathname);
        if (download) {
          url.searchParams.set('platform', decodeURIComponent(download[1]));
          req.url = `/api/download?${url.searchParams}`;
        }
        const pathname = download ? '/api/download' : url.pathname;
        if (!['/api/bim', '/api/ai', '/api/mcp', '/api/download'].includes(pathname)) return next();
        try {
          const { default: handler } = await server.ssrLoadModule(`${pathname}.ts`);
          await handler(req, res);
        } catch (error) {
          server.config.logger.error(`BIM server: ${String(error)}`);
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'Serveur BIM local indisponible.' }));
        }
      });
    },
  };
}
