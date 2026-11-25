import { createHash, randomBytes } from 'node:crypto';
import { readSurveyArchive, SURVEY_UPLOAD_CHUNK } from './surveyFile.js';
import { tr } from './lang.js';

/**
 * Sending to the account (ADR 0011): survey files sent from the Survey app, stored per account as
 * revisions, plus the pairing keys (scoped to sending surveys only, never MCP or projects).
 *
 *   users/{uid}/surveyKeys/{sha256(key)}          { name, createdAt, lastUsedAt }   — the key itself is never stored
 *   users/{uid}/surveyUploads/{uploadId}           { chunkCount, sha256, bytes, startedAt }
 *   users/{uid}/surveyUploads/{uploadId}/chunks/{i} { data }
 *   users/{uid}/surveys/{uploadId}                 { surveyId, name, revision, bytes, chunkCount, receivedAt }
 */

/** Minimal Firestore surface used here (firebase-admin in production, a fake in tests). */
export interface Db {
  doc(path: string): { get(): Promise<{ exists: boolean; data(): any }>; set(data: any): Promise<unknown>; delete(): Promise<unknown> };
  collection(path: string): { get(): Promise<{ docs: { id: string; data(): any }[] }> };
}

export class InboxError extends Error { constructor(message: string, public status = 400) { super(message); } }

/** Firestore documents are capped at 1 MiB; chunks stay well under. */
export const CHUNK_BYTES = SURVEY_UPLOAD_CHUNK;
export const MAX_SURVEY_BYTES = 100 * 1024 * 1024;
const KEY = /^sv_([A-Za-z0-9_-]{1,128})_([a-f0-9]{40})$/;
const UPLOAD_ID = /^[a-f0-9]{64}$/;
const hash = (v: Uint8Array | string) => createHash('sha256').update(v).digest('hex');

// ── Pairing keys ──────────────────────────────────────────────────────────────

export async function createKey(db: Db, uid: string, name: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new InboxError(tr('Compte invalide.', 'Invalid account.'));
  const key = `sv_${uid}_${randomBytes(20).toString('hex')}`;
  const id = hash(key);
  const meta = { name: (name || tr('Téléphone', 'Phone')).trim().slice(0, 80), createdAt: now.toISOString(), lastUsedAt: null };
  await db.doc(`users/${uid}/surveyKeys/${id}`).set(meta);
  // Shown once: only its hash is kept.
  return { key, id, ...meta };
}

export async function listKeys(db: Db, uid: string) {
  const snap = await db.collection(`users/${uid}/surveyKeys`).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function deleteKey(db: Db, uid: string, id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new InboxError(tr('Clé invalide.', 'Invalid key.'));
  await db.doc(`users/${uid}/surveyKeys/${id}`).delete();
}

/** The account a pairing key sends to, or null for an unknown or revoked key. */
export async function authenticateSurveyKey(db: Db, authorization: unknown, now = new Date()): Promise<string | null> {
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null;
  const key = authorization.slice(7);
  const m = KEY.exec(key);
  if (!m) return null;
  const ref = db.doc(`users/${m[1]}/surveyKeys/${hash(key)}`);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.set({ ...snap.data(), lastUsedAt: now.toISOString() });
  return m[1];
}

// ── Resumable upload ──────────────────────────────────────────────────────────

/**
 * The upload id is the SHA-256 of the whole file: sending the same file again resumes it,
 * and the server checks the assembled bytes against it.
 */
export async function uploadStatus(db: Db, uid: string, uploadId: string): Promise<{ received: number[]; done: boolean }> {
  if (!UPLOAD_ID.test(uploadId)) throw new InboxError('Envoi invalide.');
  if ((await db.doc(`users/${uid}/surveys/${uploadId}`).get()).exists) return { received: [], done: true };
  const chunks = await db.collection(`users/${uid}/surveyUploads/${uploadId}/chunks`).get();
  return { received: chunks.docs.map(d => Number(d.id)).sort((a, b) => a - b), done: false };
}

export async function putChunk(db: Db, uid: string, uploadId: string, index: number, count: number, bytes: Uint8Array, now = new Date()) {
  if (!UPLOAD_ID.test(uploadId)) throw new InboxError('Envoi invalide.');
  if (!Number.isInteger(count) || count < 1 || count * CHUNK_BYTES > MAX_SURVEY_BYTES) throw new InboxError(tr('Fichier relevé trop volumineux.', 'Survey file too large.'), 413);
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new InboxError('Morceau invalide.');
  if (bytes.byteLength === 0 || bytes.byteLength > CHUNK_BYTES) throw new InboxError('Morceau de taille invalide.', 413);
  const upload = db.doc(`users/${uid}/surveyUploads/${uploadId}`);
  const meta = await upload.get();
  if (meta.exists && meta.data().chunkCount !== count) throw new InboxError(tr('Nombre de morceaux incohérent avec l’envoi en cours.', 'Number of parts inconsistent with the upload in progress.'), 409);
  if (!meta.exists) await upload.set({ chunkCount: count, startedAt: now.toISOString() });
  await db.doc(`users/${uid}/surveyUploads/${uploadId}/chunks/${index}`).set({ data: Buffer.from(bytes) });
}

/** Assembles, checks the hash and the survey file, and records a new revision. */
export async function finishUpload(db: Db, uid: string, uploadId: string, now = new Date()) {
  if (!UPLOAD_ID.test(uploadId)) throw new InboxError('Envoi invalide.');
  const existing = await db.doc(`users/${uid}/surveys/${uploadId}`).get();
  if (existing.exists) return { id: uploadId, ...existing.data() };
  const meta = await db.doc(`users/${uid}/surveyUploads/${uploadId}`).get();
  if (!meta.exists) throw new InboxError(tr('Envoi introuvable.', 'Upload not found.'), 404);
  const count: number = meta.data().chunkCount;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const c = await db.doc(`users/${uid}/surveyUploads/${uploadId}/chunks/${i}`).get();
    if (!c.exists) throw new InboxError(tr(`Morceau ${i + 1}/${count} manquant : reprenez l’envoi.`, `Part ${i + 1}/${count} missing: resume the upload.`), 409);
    parts.push(new Uint8Array(c.data().data));
  }
  const file = Buffer.concat(parts);
  if (hash(file) !== uploadId) throw new InboxError(tr('Fichier altéré pendant l’envoi : renvoyez-le.', 'File altered during upload: send it again.'), 422);
  let survey;
  try { survey = readSurveyArchive(new Uint8Array(file)).survey; }
  catch (e) { throw new InboxError(tr(`Fichier relevé refusé : ${(e as Error).message}`, `Survey file rejected: ${(e as Error).message}`), 422); }
  // Each send is a new revision of that survey; nothing is merged.
  const previous = (await db.collection(`users/${uid}/surveys`).get()).docs.filter(d => d.data().surveyId === survey.id);
  const record = { surveyId: survey.id, name: survey.name, revision: previous.length + 1, bytes: file.byteLength, chunkCount: count, receivedAt: now.toISOString() };
  await db.doc(`users/${uid}/surveys/${uploadId}`).set(record);
  // The chunks now belong to the received survey; only the in-progress marker goes.
  await db.doc(`users/${uid}/surveyUploads/${uploadId}`).delete();
  return { id: uploadId, ...record };
}

// ── Received surveys (web editor) ─────────────────────────────────────────────

export async function listSurveys(db: Db, uid: string) {
  const snap = await db.collection(`users/${uid}/surveys`).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
}

export async function readChunk(db: Db, uid: string, id: string, index: number): Promise<Uint8Array> {
  if (!UPLOAD_ID.test(id) || !Number.isInteger(index) || index < 0) throw new InboxError('Lecture invalide.');
  if (!(await db.doc(`users/${uid}/surveys/${id}`).get()).exists) throw new InboxError(tr('Relevé introuvable.', 'Survey not found.'), 404);
  const c = await db.doc(`users/${uid}/surveyUploads/${id}/chunks/${index}`).get();
  if (!c.exists) throw new InboxError(tr('Morceau introuvable.', 'Part not found.'), 404);
  return new Uint8Array(c.data().data);
}

export async function deleteSurvey(db: Db, uid: string, id: string) {
  if (!UPLOAD_ID.test(id)) throw new InboxError(tr('Relevé invalide.', 'Invalid survey.'));
  const rec = await db.doc(`users/${uid}/surveys/${id}`).get();
  if (!rec.exists) return;
  for (let i = 0; i < rec.data().chunkCount; i++) await db.doc(`users/${uid}/surveyUploads/${id}/chunks/${i}`).delete();
  await db.doc(`users/${uid}/surveys/${id}`).delete();
}
