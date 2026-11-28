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

const GOOGLE_ICON = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';

const CONSENT_CSS = `:root{--bg:#f6f7f8;--card:#fff;--ink:#0c0c0d;--ink2:#5b6670;--line:#e3e7ea;--accent:oklch(0.55 0.12 235);--accent-soft:oklch(0.95 0.03 235);--ok:oklch(0.62 0.14 150);--err:#a52222;--err-bg:#fff1f0}
@media (prefers-color-scheme:dark){:root{--bg:#0f1113;--card:#171a1d;--ink:#eceef0;--ink2:#9aa4ad;--line:#2a2f34;--accent:oklch(0.7 0.12 235);--accent-soft:oklch(0.3 0.05 235);--err:#ff9b94;--err-bg:#3a1714}}
*{box-sizing:border-box}html,body{margin:0}body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);background-image:radial-gradient(circle at 1px 1px,var(--line) 1px,transparent 0);background-size:24px 24px;color:var(--ink);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px}
.card{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px;box-shadow:0 1px 2px #0000000a,0 12px 40px #0000000f}
.link{display:flex;align-items:center;gap:10px;margin-bottom:20px}.chip{font-size:13px;font-weight:600;padding:6px 10px;border:1px solid var(--line);border-radius:999px;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.chip.brand b{color:var(--accent)}
.arrow{flex:1;height:1px;background:repeating-linear-gradient(90deg,var(--ink2) 0 4px,transparent 4px 8px);opacity:.5}
h1{font-size:20px;line-height:1.3;margin:0 0 6px;letter-spacing:-.01em;overflow-wrap:anywhere}.lead{margin:0;color:var(--ink2);font-size:14px}
.grants{list-style:none;margin:20px 0;padding:14px 16px;border-radius:12px;background:var(--accent-soft);font-size:14px;display:grid;gap:8px}.grants li{display:flex;align-items:center;gap:10px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--ink2);flex:none}.dot.ok{background:var(--ok)}
.btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:12px 16px;border-radius:10px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;border:1px solid transparent;transition:filter .15s,background .15s}
.btn:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.primary{background:var(--accent);color:#fff;margin-top:18px}.primary:hover{filter:brightness(1.08)}
.google{background:var(--card);color:var(--ink);border-color:var(--line)}.google:hover{background:var(--bg)}
.or{display:flex;align-items:center;gap:12px;color:var(--ink2);font-size:12px;margin:18px 0 10px}.or:before,.or:after{content:"";flex:1;height:1px;background:var(--line)}
.mode{border-top:1px solid var(--line)}.mode:first-of-type{border-top:0}.mode summary{list-style:none;cursor:pointer;padding:12px 0;font-weight:600;font-size:14px;display:flex;justify-content:space-between;align-items:center}
.mode summary::-webkit-details-marker{display:none}.mode summary:after{content:"+";color:var(--ink2);font-size:18px;font-weight:400}.mode[open] summary:after{content:"−"}.mode form{padding-bottom:14px}
label{display:block;font-size:12px;font-weight:600;color:var(--ink2);margin:12px 0 6px}
input[type=email],input[type=password]{width:100%;padding:11px 13px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink);font:inherit}
fieldset{border:0;padding:0;margin:16px 0 0}legend{font-size:12px;font-weight:600;color:var(--ink2);margin-bottom:6px;padding:0}
.opt{display:flex;gap:10px;align-items:flex-start;margin:8px 0 0;padding:11px 13px;border:1px solid var(--line);border-radius:10px;cursor:pointer;color:var(--ink);font-weight:400}
.opt:has(input:checked){border-color:var(--accent);background:var(--accent-soft)}.opt input{margin:3px 0 0;accent-color:var(--accent)}.opt b{display:block;font-size:14px}.opt small{color:var(--ink2);font-size:12px}
.hint{margin:0;color:var(--ink2);font-size:13px}.err{color:var(--err);background:var(--err-bg);border-radius:10px;padding:10px 14px;font-size:14px;margin:0 0 16px}
.foot{margin:16px 0 0;color:var(--ink2);font-size:12px;text-align:center}`;

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
  const googleHref = `/oauth/google?${esc(new URLSearchParams(Object.fromEntries(FIELDS.map(f => [f, p[f] || '']))).toString())}`;
  res.end(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Autoriser l'accès | SkAItch</title>
<style>${CONSENT_CSS}</style></head><body><main class="card">
<header class="top"><div class="link"><span class="chip">${esc(host) || 'Application'}</span><span class="arrow" aria-hidden="true"></span><span class="chip brand">Sk<b>AI</b>tch</span></div>
<h1>Connecter ${esc(host) || 'cette application'} à SkAItch</h1>
<p class="lead">Cette application pourra travailler sur vos projets pendant que vous gardez la main.</p></header>
<ul class="grants"><li><span class="dot ok"></span>Lire vos projets, présents et futurs</li><li><span class="dot ok"></span>Modifier les modèles si vous l’autorisez</li><li><span class="dot"></span>Elle ne voit jamais votre mot de passe</li></ul>
${message ? `<p class="err" role="alert">${esc(message)}</p>` : ''}
<a class="btn google" href="${googleHref}">${GOOGLE_ICON}Continuer avec Google</a>
<div class="or"><span>ou</span></div>
<details class="mode"${message && p.email ? ' open' : ''}><summary>Email et mot de passe</summary>
<form method="POST" action="/api/mcp/authorize">${hidden}
<label for="email">Email</label><input type="email" id="email" name="email" autocomplete="username" required>
<label for="password">Mot de passe</label><input type="password" id="password" name="password" autocomplete="current-password" required>
<fieldset><legend>Droits sur tous vos projets</legend>
<label class="opt"><input type="radio" name="access" value="write" checked><span><b>Lecture et modification</b><small>Recommandé pour modéliser avec l’assistant</small></span></label>
<label class="opt"><input type="radio" name="access" value="read"><span><b>Lecture seule</b><small>Consulter et exporter, sans rien changer</small></span></label></fieldset>
<button class="btn primary" type="submit">Autoriser l’accès</button></form></details>
<details class="mode"${message && p.api_key ? ' open' : ''}><summary>Clé API existante</summary><p class="hint">Les permissions de cette clé s’appliquent.</p>
<form method="POST" action="/api/mcp/authorize">${hidden}<label for="k">Clé API</label><input type="password" id="k" name="api_key" placeholder="ak_…" autocomplete="off" required>
<button class="btn primary" type="submit">Continuer avec la clé API</button></form></details>
<p class="foot">Révocable à tout moment dans vos clés API, sous « Connexion OAuth ».</p>
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
