// OAuth 2.1 token endpoint: authorization_code + PKCE, and refresh_token, → sealed Bearer access token.
import { ACCESS_TTL, REFRESH_TTL, cors, json, readBody, seal, unseal, verifyPkce } from '../_lib/oauth.js';

type Grant = { k: string; cid: string; res: string };

/** The access token wraps the API key (encrypted) so revoking the key revokes the token. */
function issue(res: any, g: Grant) {
  json(res, 200, {
    access_token: seal('access', { k: g.k, cid: g.cid, res: g.res }, ACCESS_TTL),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL,
    refresh_token: seal('refresh', { k: g.k, cid: g.cid, res: g.res }, REFRESH_TTL),
    scope: 'mcp',
  });
}

export default async function handler(req: any, res: any) {
  cors(res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') return json(res, 405, { error: 'invalid_request' });

  try {
    const b = await readBody(req);

    if (b.grant_type === 'refresh_token') {
      const r = unseal<Grant>('refresh', b.refresh_token || '');
      if (!r) return json(res, 400, { error: 'invalid_grant', error_description: 'refresh token invalid or expired' });
      if (!b.client_id || b.client_id !== r.cid) return json(res, 400, { error: 'invalid_grant', error_description: 'client mismatch' });
      if (b.resource && b.resource !== r.res) return json(res, 400, { error: 'invalid_target' });
      return issue(res, r);
    }

    if (b.grant_type !== 'authorization_code') return json(res, 400, { error: 'unsupported_grant_type' });

    const c = unseal<Grant & { ru: string; cc: string }>('code', b.code || '');
    if (!c) return json(res, 400, { error: 'invalid_grant', error_description: 'code invalid or expired' });
    if (!b.client_id || b.client_id !== c.cid) return json(res, 400, { error: 'invalid_grant', error_description: 'client mismatch' });
    if (b.redirect_uri !== c.ru) return json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
    if (!verifyPkce(b.code_verifier || '', c.cc)) return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
    if (b.resource && b.resource !== c.res) return json(res, 400, { error: 'invalid_target' });

    issue(res, c);
  } catch (err) {
    console.error('[oauth/token]', err);
    json(res, 500, { error: 'server_error' });
  }
}
