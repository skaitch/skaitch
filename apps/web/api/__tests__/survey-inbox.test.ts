import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { addPhoto, addRectangleRoom, newSurvey } from '@skaitch/core/survey/edit';
import { writeSurveyFile } from '@skaitch/core/survey/surveyFile';
import {
  authenticateSurveyKey, createKey, deleteKey, deleteSurvey, finishUpload, listKeys, listSurveys, putChunk, readChunk, uploadStatus, CHUNK_BYTES, type Db,
} from '@skaitch/core/survey/inbox';

/** In-memory stand-in for the Firestore paths the inbox uses. */
function fakeDb(): Db & { store: Map<string, any> } {
  const store = new Map<string, any>();
  return {
    store,
    doc: path => ({
      get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
      set: async data => { store.set(path, data); },
      delete: async () => { store.delete(path); },
    }),
    collection: path => ({
      get: async () => ({ docs: [...store].filter(([k]) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/')).map(([k, v]) => ({ id: k.slice(path.length + 1), data: () => v })) }),
    }),
  };
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function surveyFile(name = 'Maison', id?: string, padding = 0) {
  let s = newSurvey(name);
  if (id) s = { ...s, id };
  const r = addRectangleRoom(s, s.levels[0].id, 'Salon', 0, 0, 4, 3);
  if (!padding) return writeSurveyFile(r.survey, '0');
  const jpeg = new Uint8Array(padding).map(() => Math.floor(Math.random() * 256));
  return writeSurveyFile(addPhoto(r.survey, r.roomId, { kind: 'floor' }, { id: 'p1', width: 10, height: 10 }), '0', { 'photos/p1.jpg': jpeg });
}
async function send(db: Db, uid: string, file: Uint8Array, skip: number[] = []) {
  const id = sha(file), count = Math.ceil(file.length / CHUNK_BYTES);
  for (let i = 0; i < count; i++) if (!skip.includes(i)) await putChunk(db, uid, id, i, count, file.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES));
  return { id, count };
}

describe('sending a survey to the account', () => {
  it('pairing keys are shown once, stored hashed, scoped, and revocable', async () => {
    const db = fakeDb();
    const k = await createKey(db, 'alice', 'Pixel de chantier');
    expect(k.key).toMatch(/^sv_alice_[a-f0-9]{40}$/);
    expect([...db.store.keys()].some(p => p.includes(k.key))).toBe(false);
    expect(await authenticateSurveyKey(db, `Bearer ${k.key}`)).toBe('alice');
    expect((await listKeys(db, 'alice'))[0]).toMatchObject({ name: 'Pixel de chantier', lastUsedAt: expect.any(String) });
    expect(await authenticateSurveyKey(db, `Bearer ak_alice_${'a'.repeat(40)}`)).toBeNull();
    expect(await authenticateSurveyKey(db, `Bearer sv_bob_${k.key.slice(-40)}`)).toBeNull();
    await deleteKey(db, 'alice', k.id);
    expect(await authenticateSurveyKey(db, `Bearer ${k.key}`)).toBeNull();
  });

  it('resumes an interrupted upload, checks the file, and lets the editor read it back', async () => {
    const db = fakeDb();
    const file = surveyFile('Maison', 'srv_m', 2 * CHUNK_BYTES);
    const { id, count } = await send(db, 'alice', file, [1]);
    expect(count).toBe(3);
    expect(await uploadStatus(db, 'alice', id)).toEqual({ received: [0, 2], done: false });
    await expect(finishUpload(db, 'alice', id)).rejects.toThrow(/Morceau 2\/3 manquant/);
    await putChunk(db, 'alice', id, 1, count, file.subarray(CHUNK_BYTES, 2 * CHUNK_BYTES));
    const rec = await finishUpload(db, 'alice', id);
    expect(rec).toMatchObject({ surveyId: 'srv_m', name: 'Maison', revision: 1, bytes: file.length });
    expect((await uploadStatus(db, 'alice', id)).done).toBe(true);
    const back = new Uint8Array(file.length); let at = 0;
    for (let i = 0; i < count; i++) { const c = await readChunk(db, 'alice', id, i); back.set(c, at); at += c.length; }
    expect(sha(back)).toBe(id);
    expect(await listSurveys(db, 'bob')).toEqual([]);
  });

  it('each send of the same survey is a new revision; a tampered or invalid file is refused', async () => {
    const db = fakeDb();
    const a = await send(db, 'alice', surveyFile('Maison', 'srv_m'));
    await finishUpload(db, 'alice', a.id);
    const b = await send(db, 'alice', surveyFile('Maison v2', 'srv_m'));
    expect(await finishUpload(db, 'alice', b.id)).toMatchObject({ revision: 2, name: 'Maison v2' });
    expect((await listSurveys(db, 'alice')).map(s => s.revision).sort()).toEqual([1, 2]);

    const junk = new TextEncoder().encode('pas un relevé');
    const j = await send(db, 'alice', junk);
    await expect(finishUpload(db, 'alice', j.id)).rejects.toThrow(/Fichier relevé refusé/);
    const fake = 'f'.repeat(64);
    await putChunk(db, 'alice', fake, 0, 1, surveyFile());
    await expect(finishUpload(db, 'alice', fake)).rejects.toThrow(/altéré/);
    await deleteSurvey(db, 'alice', a.id);
    expect((await listSurveys(db, 'alice')).map(s => s.id)).toEqual([b.id]);
  });

  it('bounds chunk size and count', async () => {
    const db = fakeDb();
    await expect(putChunk(db, 'alice', 'a'.repeat(64), 0, 1, new Uint8Array(CHUNK_BYTES + 1))).rejects.toThrow(/taille/);
    await expect(putChunk(db, 'alice', 'a'.repeat(64), 0, 10_000, new Uint8Array(1))).rejects.toThrow(/volumineux/);
    await expect(putChunk(db, 'alice', 'nope', 0, 1, new Uint8Array(1))).rejects.toThrow(/invalide/);
  });
});
