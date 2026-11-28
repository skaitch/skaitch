// OAuth 2.1 authorization endpoint (PKCE S256 mandatory).
// GET  → consent page asking for the user's SKAITCH API key.
// POST → key verified server-side, then redirect with a short-lived sealed code bound to
//        client_id + redirect_uri + code_challenge. The API key never appears in a URL.
//
// Consent binding: only the GET page shows which client (redirect host) receives the grant.
// It issues a sealed `consent` value plus an HttpOnly cookie holding the same random nonce,
// both bound to client_id + redirect_uri + code_challenge. A POST is accepted only with both,
// so a link sent by a third party (e.g. straight to /oauth/google) cannot mint a grant in a
// browser that never displayed the consent page.
import { randomBytes, timingSafeEqual } from 'crypto';
import { authenticateKey } from '../_lib/apikey.js';
import { createAccountGrant } from '../_lib/account-grant.js';
import { CODE_TTL, CONSENT_TTL, baseUrl, readBody, seal, unseal } from '../_lib/oauth.js';

const CONSENT_COOKIE = 'skaitch_oauth_consent';

type Consent = { n: string; cid: string; ru: string; cc: string };

function cookieValue(req: any, name: string): string {
  for (const part of String(req.headers?.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

/** True when the POST carries a consent issued by the GET page to this same browser. */
function consentValid(req: any, p: Record<string, string>): boolean {
  const c = unseal<Consent>('consent', p.consent || '');
  if (!c || c.cid !== p.client_id || c.ru !== p.redirect_uri || c.cc !== p.code_challenge) return false;
  const a = Buffer.from(cookieValue(req, CONSENT_COOKIE));
  const b = Buffer.from(c.n);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

type Params = Record<string, string>;

/** Redirect URIs allowed for a client: DCR-sealed client_id, or a static client from env. */
function allowedRedirects(clientId: string): string[] | null {
  const c = unseal<{ ru: string[] }>('client', clientId);
  if (c) return c.ru;
  if (process.env.OAUTH_CLIENT_ID && clientId === process.env.OAUTH_CLIENT_ID) {
    return (process.env.OAUTH_REDIRECT_URIS || '').split(',').map((s) => s.trim()).filter(Boolean);
  }
  return null;
}

/** Validates the request. Errors before redirect_uri is trusted are shown, never redirected. */
function validate(p: Params): { fatal?: string; redirectError?: string } {
  const allowed = allowedRedirects(p.client_id || '');
  if (!allowed) return { fatal: 'client_id inconnu.' };
  if (!p.redirect_uri || !allowed.includes(p.redirect_uri)) return { fatal: 'redirect_uri non autorisé pour ce client.' };
  if (p.response_type !== 'code') return { redirectError: 'unsupported_response_type' };
  if (!p.code_challenge || p.code_challenge_method !== 'S256') return { redirectError: 'invalid_request' };
  return {};
}

function redirectWith(res: any, uri: string, params: Params) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  res.writeHead(302, { Location: u.toString(), 'Cache-Control': 'no-store' });
  res.end();
}

const esc = (s: string) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const FIELDS = ['client_id', 'redirect_uri', 'response_type', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource', 'consent'];

function page(res: any, status: number, p: Params, message = '') {
  // A fresh consent for every rendering: the page is what the user actually sees.
  const nonce = randomBytes(18).toString('base64url');
  p = { ...p, consent: seal('consent', { n: nonce, cid: p.client_id, ru: p.redirect_uri, cc: p.code_challenge }, CONSENT_TTL) };
  const hidden = FIELDS.map((f) => `<input type="hidden" name="${f}" value="${esc(p[f])}">`).join('');
  let host = '';
  try { host = new URL(p.redirect_uri).host; } catch {}
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Set-Cookie': `${CONSENT_COOKIE}=${nonce}; Path=/; Max-Age=${CONSENT_TTL}; HttpOnly; Secure; SameSite=Lax`,
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  });
  res.end(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Autoriser l'accès | SkAItch</title>
<style>*{box-sizing:border-box}body{font-family:system-ui,sans-serif;background-color:#fff;background-image:linear-gradient(#edf0f2 1px,transparent 1px),linear-gradient(90deg,#edf0f2 1px,transparent 1px);background-size:32px 32px;color:#0c0c0d;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
.card{background:#fff;border:1px solid #dce1e5;border-radius:12px;padding:32px;max-width:440px;width:100%;box-shadow:0 8px 32px #0c0c0d0d}
.brand{font-size:24px;font-weight:700;letter-spacing:-.03em;margin-bottom:24px}.brand b{color:oklch(0.55 0.12 235)}h1{font-size:22px;margin:0 0 12px}p{color:#66717a;font-size:14px;line-height:1.5}
label{display:block;font-size:12px;font-weight:500;color:#66717a;margin:20px 0 6px}
input[type=password],input[type=email],select{width:100%;padding:11px 14px;border-radius:8px;border:1.5px solid #dce1e5;background:#fff;color:#0c0c0d;font-size:14px}
button,.google{display:block;margin-top:20px;width:100%;padding:12px;border:0;border-radius:8px;background:oklch(0.55 0.12 235);color:#fff;font-size:14px;font-weight:600;cursor:pointer;text-align:center;text-decoration:none}.google{border:1.5px solid #dce1e5;background:#fff;color:#0c0c0d}.mode{border:1px solid #e7e5e2;border-radius:10px;padding:20px;margin-top:16px}.mode summary{font-size:16px;font-weight:700;cursor:pointer}.mode p{margin:8px 0}.err{color:#a52222;background:#fff1f0;border:1px solid #f0c5c1;border-radius:8px;padding:10px 14px;font-size:14px}</style></head><body><main class="card">
<div class="brand">Sk<b>AI</b>tch</div>
<h1>Autoriser l'accès à vos projets</h1>
<p>L'application <b>${esc(host)}</b> demande l'accès à vos projets SkAItch. Connectez-vous avec votre compte ou utilisez une clé API existante. L'application reçoit uniquement un jeton d'accès.</p>
${message ? `<p class="err">${esc(message)}</p>` : ''}
<details class="mode"${message && p.email ? ' open' : ''}><summary>Email et mot de passe</summary>
<form method="POST" action="/api/mcp/authorize">${hidden}
<label for="email">Email du compte</label><input type="email" id="email" name="email" autocomplete="username" required>
<label for="password">Mot de passe</label><input type="password" id="password" name="password" autocomplete="current-password" required>
<label for="access">Accès à tous les projets de ce compte, présents et futurs</label><select id="access" name="access"><option value="write" selected>Lecture et modification</option><option value="read">Lecture seule</option></select>
<button type="submit">Continuer avec email</button></form></details>
<details class="mode"${message && p.google_id_token ? ' open' : ''}><summary>Google</summary><p>Connectez-vous avec votre compte Google et choisissez les droits d’accès.</p>
<a class="google" href="/oauth/google?${esc(new URLSearchParams(Object.fromEntries(FIELDS.map(f => [f, p[f] || '']))).toString())}">Continuer avec Google</a></details>
<details class="mode"${message && p.api_key ? ' open' : ''}><summary>Clé API</summary><p>Les permissions existantes de cette clé s'appliquent.</p>
<form method="POST" action="/api/mcp/authorize">${hidden}<label for="k">Clé API (SKAITCH_API_KEY)</label><input type="password" id="k" name="api_key" placeholder="ak_..." autocomplete="off" required>
<button type="submit">Continuer avec la clé API</button></form></details>
<p>Les autorisations par compte sont visibles et révocables dans vos clés API sous « Connexion OAuth ». Les nouveaux projets sont automatiquement accessibles avec les mêmes droits.</p>
</main></body></html>`);
}

function fatal(res: any, msg: string) {
  res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`Requête d'autorisation invalide : ${msg}`);
}

export default async function handler(req: any, res: any) {
  const p: Params = req.method === 'POST' ? await readBody(req) : (req.query || {});
  const v = validate(p);
  const issuer = baseUrl(req);
  if (v.fatal) return fatal(res, v.fatal);
  if (v.redirectError) return redirectWith(res, p.redirect_uri, { error: v.redirectError, state: p.state, iss: issuer });

  if (req.method === 'GET') return page(res, 200, p);
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }

  if (p.resource && p.resource !== `${issuer}/api/mcp`) return fatal(res, 'resource non autorisée.');
  if (!consentValid(req, p)) {
    return page(res, 403, p, 'Confirmez l’autorisation depuis cette page : elle indique quelle application recevra l’accès.');
  }

  let apiKey = (p.api_key || '').trim();
  let accountVerified = false;
  if (!apiKey && (p.google_id_token || (p.email && p.password))) {
    // Ensure OAuth signing is configured before creating a persistent grant.
    seal('code', {}, 1);
    try {
      apiKey = await createAccountGrant((p.email || '').trim(), p.password || '', p.access === 'write' ? 'write' : 'read', p.google_id_token);
      accountVerified = true;
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'unknown';
      console.error('OAuth account grant failed:', code);
      if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(code)) {
        return page(res, 401, p, 'Identifiants incorrects. Vérifiez votre email et votre mot de passe, ou utilisez votre méthode de connexion habituelle.');
      }
      return page(res, 503, p, 'Impossible de créer l’autorisation pour le moment. Réessayez ou contactez l’administrateur.');
    }
  }
  if (!accountVerified && !await authenticateKey(apiKey)) return page(res, 401, p, 'Clé API invalide.');

  const code = seal('code', {
    k: apiKey,
    cid: p.client_id,
    ru: p.redirect_uri,
    cc: p.code_challenge,
    res: `${issuer}/api/mcp`,
  }, CODE_TTL);
  redirectWith(res, p.redirect_uri, { code, state: p.state, iss: issuer });
}
