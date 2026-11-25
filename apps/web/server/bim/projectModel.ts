import { gzipSync, gunzipSync } from 'node:zlib';
import type { Transaction } from 'firebase-admin/firestore';
import { getAdminDb } from '../../api/_lib/admin.js';
import { BIM_BODY_LIMIT, BIM_WIRE_LIMIT } from '@skaitch/core/types/bim';
import { InputError } from '@skaitch/core/bim/validation';
import type { StoredProject } from './projectStore.js';

// shortcut: 8 chunks keep the complete atomic write below Firestore's 10 MiB transaction limit.
const CHUNK_SIZE = 500_000, MAX_CHUNKS = 8;
type ModelManifest = { count: number; revision: number };
type ProjectDocument = Partial<StoredProject> & { modelChunks?: ModelManifest; modelBytes?: number };
const chunkRef = (uid: string, id: string, revision: number, index: number) => getAdminDb().doc(`users/${uid}/projects/${id}/modelChunks/${revision}_${index}`);
function manifest(data: ProjectDocument): ModelManifest | undefined {
  const value = data.modelChunks;
  if (value && (!Number.isSafeInteger(value.count) || value.count < 1 || value.count > MAX_CHUNKS || !Number.isSafeInteger(value.revision) || value.revision < 0)) throw new InputError('Sauvegarde de modèle invalide.');
  return value;
}
export async function hydrateProject(uid: string, id: string, data: ProjectDocument, tx?: Transaction): Promise<StoredProject> {
  const chunks = manifest(data);
  const { modelChunks: _, modelBytes: __, ...project } = data;
  if (!chunks) return project as StoredProject;
  const parts = await Promise.all(Array.from({ length: chunks.count }, (_, index) => {
    const ref = chunkRef(uid, id, chunks.revision, index);
    return tx ? tx.get(ref) : ref.get();
  }));
  const encoded = parts.map(part => {
    const value = part.data()?.content;
    if (typeof value !== 'string' || value.length > CHUNK_SIZE) throw new InputError('Sauvegarde de modèle incomplète.');
    return value;
  }).join('');
  let itemsJson: string;
  try { itemsJson = gunzipSync(Buffer.from(encoded, 'base64'), { maxOutputLength: BIM_BODY_LIMIT }).toString('utf8'); }
  catch { throw new InputError('Sauvegarde de modèle illisible.'); }
  return { ...project, itemsJson } as StoredProject;
}
export function storeProjectModel(tx: Transaction, uid: string, id: string, stored: StoredProject, previous: ProjectDocument = {}) {
  if (Buffer.byteLength(stored.itemsJson) > BIM_BODY_LIMIT || gzipSync(JSON.stringify(stored)).length > BIM_WIRE_LIMIT) throw new InputError('Modèle trop volumineux pour le transfert serveur.', 413);
  const old = manifest(previous);
  // modelBytes feeds the administrators' storage block (sum across all projects).
  let document: ProjectDocument = { ...stored, modelBytes: Buffer.byteLength(stored.itemsJson) };
  let parts: string[] = [];
  if (Buffer.byteLength(JSON.stringify(stored)) > 950_000) {
    const encoded = gzipSync(stored.itemsJson).toString('base64');
    if (encoded.length > CHUNK_SIZE * MAX_CHUNKS) throw new InputError('Modèle trop volumineux pour une sauvegarde atomique.', 413);
    for (let offset = 0; offset < encoded.length; offset += CHUNK_SIZE) parts.push(encoded.slice(offset, offset + CHUNK_SIZE));
    document = { ...document, itemsJson: '', modelChunks: { count: parts.length, revision: stored.modelRevision ?? 0 } };
    if (Buffer.byteLength(JSON.stringify(document)) > 950_000) throw new InputError('Métadonnées du projet trop volumineuses.', 413);
  }
  if (old) for (let index = 0; index < old.count; index++) {
    if (old.revision !== document.modelChunks?.revision || index >= parts.length) tx.delete(chunkRef(uid, id, old.revision, index));
  }
  parts.forEach((content, index) => tx.set(chunkRef(uid, id, stored.modelRevision ?? 0, index), { content }));
  tx.set(getAdminDb().doc(`users/${uid}/projects/${id}`), document);
}
export function deleteProjectChunks(tx: Transaction, uid: string, id: string, data: ProjectDocument) {
  const old = manifest(data);
  if (old) for (let index = 0; index < old.count; index++) tx.delete(chunkRef(uid, id, old.revision, index));
}
