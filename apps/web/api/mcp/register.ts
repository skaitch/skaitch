// RFC 7591 dynamic client registration (stateless: client_id seals the redirect URIs).
import { cors, json, readBody, seal } from '../_lib/oauth.js';

function validRedirect(u: unknown): u is string {
  if (typeof u !== 'string') return false;
  try {
    const url = new URL(u);
    if (url.hash) return false;
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  } catch { return false; }
}

export default async function handler(req: any, res: any) {
  cors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') return json(res, 405, { error: 'invalid_request' });

  const body: any = await readBody(req);
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10 || !uris.every(validRedirect)) {
    return json(res, 400, { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be https URLs' });
  }
  const name = String(body.client_name || 'MCP client').slice(0, 100);
  const client_id = seal('client', { ru: uris, n: name });

  json(res, 201, {
    client_id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  });
}
