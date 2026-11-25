import { createStore, del, get, set } from 'idb-keyval';
import { SURVEY_UPLOAD_CHUNK, type Survey } from '@skaitch/core/survey/surveyFile';
import { tr } from '@skaitch/core/survey/lang';
import { buildSurveyFile } from './exportFile';

/**
 * Sending to the account (ADR 0011): the app is paired with a skAItch account through a key created
 * in the web editor (scoped to sending surveys). Optional: without it the app works offline.
 */
export interface Pairing { server: string; key: string; pairedAt: string; /** Computer name, when paired with the desktop app. */ name?: string }

const store = createStore('skaitch-survey-settings', 'settings');
export const DEFAULT_SERVER = 'https://app.skaitch.online';
export const loadPairing = () => get<Pairing>('pairing', store);
export const forgetPairing = () => del('pairing', store);

/** localhost and private IPv4 ranges (192.168/16, 10/8, 172.16/12). */
export function isLocalHost(host: string) {
  if (host === 'localhost') return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export async function savePairing(server: string, key: string, name?: string): Promise<Pairing> {
  const k = key.trim();
  if (!/^sv_[A-Za-z0-9_-]+_[a-f0-9]{40}$/.test(k)) throw new Error('Clé d’appairage invalide : copiez-la depuis skAItch (onglet Survey d’un étage).');
  let url: URL;
  try { url = new URL(server.trim() || DEFAULT_SERVER); } catch { throw new Error('Adresse du serveur invalide.'); }
  // Plain HTTP only on the local network (the desktop app); anything else must be HTTPS.
  if (url.protocol !== 'https:' && !isLocalHost(url.hostname)) throw new Error('Le serveur doit être en HTTPS.');
  const pairing: Pairing = { server: url.origin, key: k, pairedAt: new Date().toISOString(), ...(name ? { name } : {}) };
  await set('pairing', pairing, store);
  return pairing;
}

async function call(p: Pairing, op: string, params: Record<string, string | number>, body?: Uint8Array) {
  const q = new URLSearchParams({ operation: op, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  let last: unknown;
  // A few retries per request: the whole upload resumes anyway from what the server has.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${p.server}/api/survey?${q}`, {
        method: 'POST', headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/octet-stream' },
        body: body ? new Blob([body as BlobPart]) : undefined, signal: AbortSignal.timeout(60_000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data;
      // A refused key or file will not get better by retrying.
      if (res.status < 500) throw Object.assign(new Error(data.error || `Envoi refusé (${res.status}).`), { final: true });
      last = new Error(data.error || `Serveur indisponible (${res.status}).`);
    } catch (e) {
      if ((e as { final?: boolean }).final) throw e;
      last = e;
    }
    await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
  }
  if (last instanceof Error && last.name !== 'TypeError' && last.name !== 'TimeoutError') throw last;
  const { host, hostname } = new URL(p.server);
  throw new Error(isLocalHost(hostname)
    ? tr(`skAItch Desktop ne répond pas à l’adresse ${host}. Vérifiez que skAItch est ouvert sur le même Wi-Fi. Si l’adresse a changé, touchez « Oublier », puis scannez un nouveau QR code depuis l’onglet Survey de skAItch.`,
      `skAItch Desktop did not respond at ${host}. Check that skAItch is open on the same Wi-Fi network. If the address changed, tap “Forget”, then scan a new QR code from the Survey tab in skAItch.`)
    : tr(`Le serveur ${host} ne répond pas. Vérifiez la connexion Internet, puis relancez l’envoi pour reprendre où il s’est arrêté.`,
      `The server ${host} did not respond. Check your internet connection, then retry to resume the upload.`));
}

/** Sends the survey file; an interrupted send resumes with the pieces the server is missing. */
export async function sendSurvey(survey: Survey, pairing: Pairing, onProgress: (done: number, total: number) => void): Promise<{ revision: number }> {
  const file = await buildSurveyFile(survey);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', file as BufferSource));
  const upload = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
  const count = Math.max(1, Math.ceil(file.length / SURVEY_UPLOAD_CHUNK));
  const status = await call(pairing, 'upload-status', { upload });
  if (status.done) { onProgress(count, count); return await call(pairing, 'upload-finish', { upload }); }
  const have = new Set<number>(status.received);
  onProgress(have.size, count);
  for (let i = 0; i < count; i++) {
    if (have.has(i)) continue;
    await call(pairing, 'upload-chunk', { upload, index: i, count }, file.subarray(i * SURVEY_UPLOAD_CHUNK, (i + 1) * SURVEY_UPLOAD_CHUNK));
    have.add(i);
    onProgress(have.size, count);
  }
  return await call(pairing, 'upload-finish', { upload });
}

/**
 * Pairing from the QR code shown by skAItch: `skaitch-survey:pair?servers=a,b&key=sv_…&name=…`.
 * The desktop app lists every local address of the computer; the first one that answers is kept.
 */
export async function pairFromQr(text: string): Promise<Pairing> {
  const m = /^skaitch-survey:pair\?(.*)$/.exec(text.trim());
  if (!m) throw new Error('Ce QR code ne vient pas de skAItch (onglet Survey › Appairer un téléphone).');
  const q = new URLSearchParams(m[1]);
  const key = q.get('key') ?? '', name = q.get('name') ?? undefined;
  const servers = (q.get('servers') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!servers.length) throw new Error('QR code incomplet : aucune adresse de serveur.');
  // A single HTTPS server (the web app) is trusted as is; local addresses are probed.
  if (servers.length === 1 && servers[0].startsWith('https://')) return savePairing(servers[0], key, name);
  for (const server of servers) {
    try {
      const res = await fetch(`${server}/api/survey?operation=hello`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(4000) });
      if (res.ok) return savePairing(server, key, name);
      if (res.status === 401) throw Object.assign(new Error('Clé refusée par l’ordinateur : créez un nouveau QR code.'), { final: true });
    } catch (e) { if ((e as { final?: boolean }).final) throw e; }
  }
  throw new Error(`Ordinateur introuvable (${servers.map(s => new URL(s).host).join(', ')}) : vérifiez que le téléphone est sur le même Wi-Fi et que skAItch est ouvert. Le pare-feu doit autoriser skAItch.`);
}
