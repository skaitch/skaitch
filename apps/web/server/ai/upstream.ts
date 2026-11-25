import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request } from 'node:https';
import { Readable, Transform } from 'node:stream';
import { InputError } from '@skaitch/core/bim/validation';

const private4 = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const) private4.addSubnet(address, prefix, 'ipv4');
const global6 = new BlockList(); global6.addSubnet('2000::', 3, 'ipv6');
const special6 = new BlockList();
for (const [address, prefix] of [['2001::',23],['2001:db8::',32],['2002::',16]] as const) special6.addSubnet(address, prefix, 'ipv6');
export function isPublicAddress(address: string) {
  if (isIP(address) === 4) return !private4.check(address, 'ipv4');
  return isIP(address) === 6 && global6.check(address, 'ipv6') && !special6.check(address, 'ipv6');
}
export async function resolveAiTarget(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new InputError('Adresse du fournisseur IA invalide.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port && url.port !== '443') throw new InputError('Le fournisseur cloud doit utiliser HTTPS sur le port 443.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) throw new InputError('Adresse privée ou réservée refusée pour le fournisseur cloud.');
  return { url, addresses };
}

/** Pin the vetted DNS answer to the TLS connection; never follow upstream redirects. */
export async function upstreamFetch(raw: string, options: RequestInit = {}, allowedOrigins?: readonly string[]): Promise<Response> {
  if (allowedOrigins && !allowedOrigins.includes(new URL(raw).origin)) throw new InputError('La clé ne peut pas être transmise à cette destination.', 403);
  const { url, addresses } = await resolveAiTarget(raw);
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(options.headers));
    const req = request(url, {
      method: options.method || 'GET', headers, signal: options.signal ?? AbortSignal.timeout(170_000),
      lookup: (_hostname, options: any, callback: any) => options.all
        ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family),
    }, incoming => {
      if ([204, 205, 304].includes(incoming.statusCode || 0)) { incoming.resume(); resolve(new Response(null, { status: incoming.statusCode })); return; }
      let size = 0;
      const bounded = new Transform({ transform(chunk, _encoding, done) {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) done(new Error('AI response too large'));
        else done(null, chunk);
      } });
      incoming.on('error', error => bounded.destroy(error));
      bounded.on('error', () => incoming.destroy());
      incoming.pipe(bounded);
      const responseHeaders = new Headers();
      for (const name of ['content-type', 'retry-after']) if (typeof incoming.headers[name] === 'string') responseHeaders.set(name, incoming.headers[name] as string);
      resolve(new Response(Readable.toWeb(bounded) as ReadableStream<Uint8Array>, { status: incoming.statusCode || 502, headers: responseHeaders }));
    });
    req.on('error', reject);
    if (options.body != null && typeof options.body !== 'string') { req.destroy(); reject(new Error('Invalid AI request body')); return; }
    req.end(options.body);
  });
}

/**
 * Error for a failed provider call: the HTTP status plus the provider's own reason
 * (Google, OpenAI and Anthropic put it in `error.message`), with any secret scrubbed.
 */
export async function upstreamError(label: string, res: Response, secret?: string): Promise<Error> {
  let reason = '';
  try {
    const body = await res.text();
    try {
      const json = JSON.parse(body);
      reason = json?.error?.message ?? json?.message ?? json?.detail ?? (typeof json?.error === 'string' ? json.error : '');
    } catch { reason = body; }
  } catch { /* no body */ }
  reason = String(reason ?? '').replace(/\s+/g, ' ').trim();
  if (secret) reason = reason.split(secret).join('***');
  reason = reason.replace(/([?&]key=)[^&\s]+/g, '$1***').slice(0, 300);
  return new Error(reason ? `${label} ${res.status}: ${reason}` : `${label} ${res.status}`);
}
