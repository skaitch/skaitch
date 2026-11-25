// Serves both /.well-known/oauth-authorization-server and /.well-known/oauth-protected-resource
// (routed here by vercel.json rewrites with ?kind=as|pr).
import { baseUrl, cors, json } from '../_lib/oauth.js';

export default function handler(req: any, res: any) {
  cors(res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const base = baseUrl(req);

  if (req.query.kind === 'pr') {
    return json(res, 200, {
      resource: `${base}/api/mcp`,
      authorization_servers: [base],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp'],
    });
  }

  json(res, 200, {
    issuer: base,
    authorization_response_iss_parameter_supported: true,
    authorization_endpoint: `${base}/api/mcp/authorize`,
    token_endpoint: `${base}/api/mcp/token`,
    registration_endpoint: `${base}/api/mcp/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
  });
}
