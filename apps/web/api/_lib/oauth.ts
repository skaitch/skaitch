// Stateless OAuth 2.1 helpers (PKCE S256, AES-256-GCM sealed codes/tokens).
// Requires env OAUTH_SECRET (>= 32 random chars). Files under api/_lib are not routes.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'crypto';

type SealType = 'client' | 'code' | 'access' | 'refresh' | 'consent' | 'ai-secret';
const derive = (s: string) => createHash('sha256').update(s).digest();
function key(typ: SealType): Buffer {
  const s = typ === 'ai-secret' ? process.env.AI_VAULT_SECRET : process.env.OAUTH_SECRET;
  if (!s || s.length < 32) throw new Error('Server encryption secret is missing or too short');
  return derive(s);
}
/** Keys accepted when opening a sealed value: the current one, then OAUTH_SECRET_PREVIOUS during a rotation. */
function openKeys(typ: SealType): Buffer[] {
  const previous = typ === 'ai-secret' ? undefined : process.env.OAUTH_SECRET_PREVIOUS;
  return [key(typ), ...(previous && previous.length >= 32 ? [derive(previous)] : [])];
}

const b64u = (b: Buffer) => b.toString('base64url');

/** Encrypt + authenticate a payload. `typ` prevents using a code as a token, etc. */
export function seal(typ: SealType, payload: Record<string, unknown>, ttlSec?: number): string {
  const body = { ...payload, typ, ...(ttlSec ? { exp: Math.floor(Date.now() / 1000) + ttlSec } : {}) };
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(typ), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(body), 'utf8'), c.final()]);
  return `${typ}.${b64u(Buffer.concat([iv, c.getAuthTag(), ct]))}`;
}

function open(k: Buffer, raw: Buffer): any {
  try {
    const d = createDecipheriv('aes-256-gcm', k, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

export function unseal<T = any>(typ: SealType, token: string): T | null {
  if (!token || !token.startsWith(typ + '.')) return null;
  const raw = Buffer.from(token.slice(typ.length + 1), 'base64url');
  for (const k of openKeys(typ)) {
    const body = open(k, raw);
    if (!body) continue;
    if (body.typ !== typ) return null;
    if (body.exp && body.exp < Math.floor(Date.now() / 1000)) return null;
    return body as T;
  }
  return null;
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!verifier || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const a = Buffer.from(b64u(createHash('sha256').update(verifier).digest()));
  const b = Buffer.from(challenge || '');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function baseUrl(req: any): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

export async function readBody(req: any): Promise<Record<string, string>> {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = typeof req.body === 'string' ? req.body : '';
  if (!raw) {
    raw = await new Promise<string>((resolve) => {
      let s = '';
      req.on('data', (c: any) => (s += c));
      req.on('end', () => resolve(s));
    });
  }
  try { return JSON.parse(raw); } catch {}
  return Object.fromEntries(new URLSearchParams(raw));
}

export function json(res: any, status: number, body: unknown, extra: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}

export function cors(res: any, methods = 'GET, POST, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-protocol-version');
}

export const ACCESS_TTL = 60 * 60; // 1 hour; API key revocation still applies (re-checked per request)
export const REFRESH_TTL = 60 * 60 * 24 * 90; // 90 days; a new one is issued on every refresh (stateless, so earlier ones stay valid until they expire)
export const CODE_TTL = 120;
export const CONSENT_TTL = 600; // the consent page must be submitted within 10 minutes
