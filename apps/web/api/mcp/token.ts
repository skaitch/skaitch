// OAuth 2.1 token endpoint: authorization_code + PKCE → sealed Bearer access token.
import { ACCESS_TTL, cors, json, readBody, seal, unseal, verifyPkce } from '../_lib/oauth.js';

export default async function handler(req: any, res: any) {
  cors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') return json(res, 405, { error: 'invalid_request' });

  try {
    const b = await readBody(req);
    if (b.grant_type !== 'authorization_code') return json(res, 400, { error: 'unsupported_grant_type' });

    const c = unseal<{ k: string; cid: string; ru: string; cc: string; res: string }>('code', b.code || '');
    if (!c) return json(res, 400, { error: 'invalid_grant', error_description: 'code invalid or expired' });
    if (!b.client_id || b.client_id !== c.cid) return json(res, 400, { error: 'invalid_grant', error_description: 'client mismatch' });
    if (b.redirect_uri !== c.ru) return json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
    if (!verifyPkce(b.code_verifier || '', c.cc)) return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });

    if (b.resource && b.resource !== c.res) return json(res, 400, { error: 'invalid_target' });

    // The access token wraps the API key (encrypted) so revoking the key revokes the token.
    json(res, 200, {
      access_token: seal('access', { k: c.k, cid: c.cid, res: c.res }, ACCESS_TTL),
      token_type: 'Bearer',
      expires_in: ACCESS_TTL,
      scope: 'mcp',
    });
  } catch (err) {
    console.error('[oauth/token]', err);
    json(res, 500, { error: 'server_error' });
  }
}
