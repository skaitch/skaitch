import { authenticateSession } from './_lib/sessionAuth.js';
import { getAdminDb } from './_lib/admin.js';
import { withUsage } from './_lib/usage.js';
import {
  authenticateSurveyKey, createKey, deleteKey, deleteSurvey, finishUpload, InboxError, listKeys, listSurveys,
  putChunk, readChunk, uploadStatus, CHUNK_BYTES, type Db,
} from '@skaitch/core/survey/inbox';

/**
 * Sending to the account (ADR 0011).
 * Survey app, with a pairing key (cross-origin from the Capacitor web view): upload-status, upload-chunk, upload-finish.
 * Web editor, with the Firebase session (same origin): key-create, key-list, key-delete, list, read-chunk, delete.
 */
const APP_OPS = new Set(['upload-status', 'upload-chunk', 'upload-finish']);
const WEB_OPS = new Set(['key-create', 'key-list', 'key-delete', 'list', 'read-chunk', 'delete']);
/** Origins of the Capacitor web view (Android, iOS) and of the app in development. */
const APP_ORIGINS = new Set(['https://localhost', 'http://localhost', 'capacitor://localhost', 'http://localhost:5175']);

async function body(req: any, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
    size += b.length;
    if (size > limit) throw new InboxError('Requête trop volumineuse.', 413);
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

export default withUsage('survey', async function handler(req: any, res: any, usage) {
  res.setHeader('Cache-Control', 'private, no-store');
  const url = new URL(req.url, 'http://survey.local');
  const op = url.searchParams.get('operation') ?? '';
  usage.operation = APP_OPS.has(op) || WEB_OPS.has(op) ? op : 'unknown';
  const origin = req.headers.origin as string | undefined;
  const appOrigin = !!origin && APP_ORIGINS.has(origin);
  if (appOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  const send = (status: number, data: unknown, binary = false) => {
    res.statusCode = status;
    res.setHeader('Content-Type', binary ? 'application/octet-stream' : 'application/json; charset=utf-8');
    res.end(binary ? Buffer.from(data as Uint8Array) : JSON.stringify(data));
  };
  if (req.method === 'OPTIONS') { res.statusCode = appOrigin ? 204 : 403; return res.end(); }
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST, OPTIONS'); return send(405, { error: 'Méthode non autorisée.' }); }
  try {
    const db = getAdminDb() as unknown as Db;
    if (APP_OPS.has(op)) {
      // Only the pairing key authorizes sending; a session cookie never does.
      const uid = await authenticateSurveyKey(db, req.headers.authorization);
      if (!uid) { usage.authRejected = true; return send(401, { error: 'Clé d’appairage inconnue ou révoquée : appairez de nouveau l’application.' }); }
      usage.uid = uid;
      const upload = url.searchParams.get('upload') ?? '';
      if (op === 'upload-chunk') {
        const bytes = await body(req, CHUNK_BYTES);
        await putChunk(db, uid, upload, Number(url.searchParams.get('index')), Number(url.searchParams.get('count')), bytes);
        return send(200, { ok: true });
      }
      await body(req, 0);
      return send(200, op === 'upload-status' ? await uploadStatus(db, uid, upload) : await finishUpload(db, uid, upload));
    }
    if (!WEB_OPS.has(op)) return send(400, { error: 'Opération inconnue.' });
    try {
      if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && new URL(origin).host !== req.headers.host)) return send(403, { error: 'Requête intersite refusée.' });
    } catch { return send(403, { error: 'Origine invalide.' }); }
    const uid = await authenticateSession(req.headers.authorization);
    if (!uid) { usage.authRejected = true; return send(401, { error: 'Session requise ou expirée.' }); }
    usage.uid = uid;
    let payload: any = {};
    const raw = await body(req, 64 * 1024);
    if (raw.length) { try { payload = JSON.parse(raw.toString('utf8')); } catch { return send(400, { error: 'JSON invalide.' }); } }
    if (op === 'key-create') return send(200, await createKey(db, uid, String(payload.name ?? '')));
    if (op === 'key-list') return send(200, await listKeys(db, uid));
    if (op === 'key-delete') { await deleteKey(db, uid, String(payload.id)); return send(200, { ok: true }); }
    if (op === 'list') return send(200, await listSurveys(db, uid));
    if (op === 'read-chunk') return send(200, await readChunk(db, uid, String(payload.id), Number(payload.index)), true);
    await deleteSurvey(db, uid, String(payload.id));
    return send(200, { ok: true });
  } catch (error) {
    if (error instanceof InboxError) return send(error.status, { error: error.message });
    console.error('[survey]', error);
    return send(503, { error: 'Service d’envoi indisponible. Réessayez : l’envoi reprendra où il s’est arrêté.' });
  }
});
