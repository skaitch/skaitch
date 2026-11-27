import { createServer, type Server } from 'node:http';
import { hostname, networkInterfaces } from 'node:os';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  authenticateSurveyKey, createKey, deleteKey, deleteSurvey, finishUpload, InboxError, listKeys, listSurveys,
  putChunk, readChunk, uploadStatus, CHUNK_BYTES, type Db,
} from '@skaitch/core/survey/inbox';

/**
 * Receiving surveys on the local network (ADR 0011, desktop variant): the desktop app serves the
 * same upload protocol as the web API, without an account. The phone finds this computer by
 * scanning a QR code that carries its local addresses and a pairing key.
 */

/** The desktop inbox has a single, local owner. */
export const LOCAL_OWNER = 'local';
export const DEFAULT_SURVEY_PORT = 3924;
const APP_OPS = new Set(['hello', 'upload-status', 'upload-chunk', 'upload-finish']);
/** Origins of the Capacitor web view (Android, iOS) and of the app in development. */
const APP_ORIGINS = new Set(['https://localhost', 'http://localhost', 'capacitor://localhost', 'http://localhost:5175']);

/** Firestore-like documents stored as JSON files; binary fields are kept as base64. */
export function fileDb(root: string): Db {
  const safe = (path: string) => {
    if (!/^[A-Za-z0-9_\-/]+$/.test(path) || path.split('/').some(p => !p || p === '..')) throw new InboxError('Chemin invalide.');
    return join(root, path);
  };
  const encode = (data: unknown) => JSON.stringify(data, (_k, v) => (v && v.type === 'Buffer' && Array.isArray(v.data) ? { __b64: Buffer.from(v.data).toString('base64') } : v));
  const decode = (text: string) => JSON.parse(text, (_k, v) => (v && typeof v.__b64 === 'string' ? Buffer.from(v.__b64, 'base64') : v));
  return {
    doc(path) {
      const file = `${safe(path)}.json`;
      return {
        async get() {
          try { const data = decode(await readFile(file, 'utf8')); return { exists: true, data: () => data }; }
          catch { return { exists: false, data: () => undefined }; }
        },
        async set(data) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, encode(data)); },
        async delete() { await rm(file, { force: true }); },
      };
    },
    collection(path) {
      return {
        async get() {
          const dir = safe(path);
          const names = await readdir(dir).catch(() => [] as string[]);
          const docs = await Promise.all(names.filter(n => n.endsWith('.json')).map(async n => {
            const data = decode(await readFile(join(dir, n), 'utf8'));
            return { id: n.slice(0, -5), data: () => data };
          }));
          return { docs };
        },
      };
    },
  };
}

/** IPv4 addresses of this computer on the local networks, most likely first (Wi-Fi / Ethernet). */
export function localAddresses(): string[] {
  const out: string[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    if (/^(docker|br-|veth|virbr|vmnet|vboxnet|lo|tun|tap|zt|tailscale)/i.test(name)) continue;
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** What the QR code carries: every local address, the key, and a name to show on the phone. */
export function pairingUri(port: number, key: string) {
  const servers = localAddresses().map(ip => `http://${ip}:${port}`);
  return `skaitch-survey:pair?${new URLSearchParams({ servers: servers.join(','), key, name: hostname() })}`;
}

/** Loopback, RFC 1918, link-local and IPv6 unique-local addresses: the phone must be on the same network. */
export function isPrivateAddress(address: string | undefined): boolean {
  if (!address) return false;
  const ip = address.toLowerCase().replace(/^::ffff:/, '');
  if (ip === '::1' || /^(fc|fd)[0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip)) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

export interface SurveyReceiver { port: number; db: Db; close(): Promise<void> }

export async function startSurveyReceiver(root: string, port = DEFAULT_SURVEY_PORT): Promise<SurveyReceiver> {
  const db = fileDb(root);
  const server: Server = createServer(async (req, res) => {
    // Listening on every interface is needed for QR pairing; refuse anything outside the local network.
    if (!isPrivateAddress(req.socket.remoteAddress)) { res.writeHead(403); res.end(); return; }
    const origin = req.headers.origin;
    if (origin && APP_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url ?? '/', 'http://survey.local');
    const op = url.searchParams.get('operation') ?? '';
    if (req.method !== 'POST' || url.pathname !== '/api/survey' || !APP_OPS.has(op)) return send(404, { error: 'Introuvable.' });
    try {
      const uid = await authenticateSurveyKey(db, req.headers.authorization);
      if (uid !== LOCAL_OWNER) return send(401, { error: 'Clé d’appairage inconnue ou révoquée : appairez de nouveau.' });
      if (op === 'hello') return send(200, { name: hostname() });
      const upload = url.searchParams.get('upload') ?? '';
      if (op === 'upload-status') return send(200, await uploadStatus(db, uid, upload));
      if (op === 'upload-finish') return send(200, await finishUpload(db, uid, upload));
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > CHUNK_BYTES) throw new InboxError('Morceau trop volumineux.', 413);
        chunks.push(c as Buffer);
      }
      await putChunk(db, uid, upload, Number(url.searchParams.get('index')), Number(url.searchParams.get('count')), new Uint8Array(Buffer.concat(chunks)));
      return send(200, { ok: true });
    } catch (error) {
      if (error instanceof InboxError) return send(error.status, { error: error.message });
      console.error('[survey receiver]', error);
      return send(500, { error: 'Réception impossible sur cet ordinateur.' });
    }
  });
  // The next free port if the default one is taken.
  for (let p = port; ; p++) {
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(p, '0.0.0.0', () => { server.off('error', reject); resolve(); }); });
      return { port: p, db, close: () => new Promise(r => server.close(() => r())) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || p > port + 10) throw e;
    }
  }
}

/** The renderer's side of the desktop inbox (same operations as the web editor's). */
export function surveyInboxOps(receiver: SurveyReceiver) {
  const { db } = receiver;
  return {
    list: () => listSurveys(db, LOCAL_OWNER),
    readChunk: (id: string, index: number) => readChunk(db, LOCAL_OWNER, id, index),
    remove: (id: string) => deleteSurvey(db, LOCAL_OWNER, id),
    listKeys: () => listKeys(db, LOCAL_OWNER),
    async createKey(name: string) {
      const k = await createKey(db, LOCAL_OWNER, name);
      return { ...k, pairingUri: pairingUri(receiver.port, k.key) };
    },
    revokeKey: (id: string) => deleteKey(db, LOCAL_OWNER, id),
  };
}
