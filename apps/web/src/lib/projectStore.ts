import { jsonEqual } from '@skaitch/core/lib/jsonEqual';
import type { ElementDef } from '@skaitch/core/data/elementCatalogue';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db, auth } from './firebase';
import { requestBim } from './bimClient';
import type { ProjectMeta } from '@skaitch/core/types/project';
import type { ItemsMap } from '@skaitch/core/types/ifc';
import type { ProjectRepository, StoredProject } from '@skaitch/core/lib/projectRepository';

export type { StoredProject };
const bases = new Map<string, StoredProject>();
const writes = new Map<string, Promise<unknown>>();
const key = (uid: string, id: string) => `${uid}/${id}`;
function requireAccount(uid: string) {
  if (auth.currentUser?.uid !== uid) throw new Error('La session a changé. Rouvrez le projet avec le compte connecté.');
}
const projectRef = (uid: string, id: string) => doc(db, 'users', uid, 'projects', id);

export async function listStoredProjects(uid: string): Promise<ProjectMeta[]> {
  requireAccount(uid);
  return requestBim('project-list', {});
}

export async function readStoredProject(uid: string, id: string): Promise<StoredProject | null> {
  await writes.get(key(uid, id))?.catch(() => {});
  requireAccount(uid);
  const snapshot = await getDoc(projectRef(uid, id));
  if (!snapshot.exists()) return null;
  const stored = snapshot.data().modelChunks ? await requestBim<StoredProject>('project-read', { id }) : snapshot.data() as StoredProject;
  requireAccount(uid);
  bases.set(key(uid, id), stored);
  return stored;
}

export async function writeStoredProject(uid: string, id: string, patch: Partial<StoredProject>): Promise<StoredProject> {
  const k = key(uid, id);
  const pending = (writes.get(k) ?? Promise.resolve()).catch(() => {}).then(async () => {
    requireAccount(uid);
    const stored = await requestBim<StoredProject>('project-write', {
      id, patch, expectedRevision: bases.get(k)?.modelRevision ?? 0,
    });
    requireAccount(uid);
    bases.set(k, stored);
    return stored;
  });
  writes.set(k, pending);
  try { return await pending; }
  finally { if (writes.get(k) === pending) writes.delete(k); }
}

export async function deleteStoredProject(uid: string, id: string) {
  // Read the latest revision before an explicit deletion from the home page.
  const stored = await readStoredProject(uid, id);
  if (!stored) return;
  requireAccount(uid);
  await requestBim('project-delete', { id, expectedRevision: stored.modelRevision ?? 0 });
  bases.delete(key(uid, id));
}

export function isStoredModel(uid: string, id: string, items: ItemsMap, catalogue?: ElementDef[]) {
  const stored = bases.get(key(uid, id));
  if (catalogue && !jsonEqual(stored?.catalogue, catalogue)) return false;
  return bases.get(key(uid, id))?.itemsJson === JSON.stringify(items);
}

/** Wait for our saves before comparing snapshots; never overwrite unsaved local edits. */
export function watchStoredProject(uid: string, id: string, getItems: () => ItemsMap,
  receive: (project: StoredProject) => void, fail: (error: Error) => void) {
  let active = true;
  const unsubscribe = onSnapshot(projectRef(uid, id), async snapshot => {
    await writes.get(key(uid, id))?.catch(() => {});
    if (!active || snapshot.metadata.hasPendingWrites) return;
    if (!snapshot.exists()) { fail(new Error('Ce projet a été supprimé. Vos changements locaux sont conservés.')); return; }
    let remote: StoredProject;
    try {
      remote = snapshot.data().modelChunks ? await requestBim<StoredProject>('project-read', { id }) : snapshot.data() as StoredProject;
      if (!remote) throw new Error('Ce projet a été supprimé.');
      if (!active) return;
      requireAccount(uid);
    } catch (error) { if (active) fail(error as Error); return; }
    const base = bases.get(key(uid, id));
    if ((remote.modelRevision ?? 0) <= (base?.modelRevision ?? -1)) return;
    const local = JSON.stringify(getItems());
    if (local !== base?.itemsJson && local !== remote.itemsJson) {
      fail(new Error('Une autre version du projet est disponible. Vos changements locaux sont conservés ; exportez-les avant de rouvrir le projet.'));
      return;
    }
    bases.set(key(uid, id), remote);
    receive(remote);
  }, error => fail(error));
  return () => { active = false; unsubscribe(); };
}

/** The signed-in user's projects, stored in Firestore through the server API. */
export function firestoreProjectRepository(uid: string): ProjectRepository {
  return {
    list: () => listStoredProjects(uid),
    read: id => readStoredProject(uid, id),
    write: (id, patch) => writeStoredProject(uid, id, patch),
    delete: id => deleteStoredProject(uid, id),
    // Metadata-only write: no model revision check, and the archived state stays out of the project file (ADR 0020).
    setArchived: async (id, archived) => {
      const { itemsJson, catalogue, ...meta } = await writeStoredProject(uid, id, { archivedAt: archived ? new Date().toISOString() : null });
      return meta;
    },
    isSaved: (id, items, catalogue) => isStoredModel(uid, id, items, catalogue),
    watch: (id, getItems, receive, fail) => watchStoredProject(uid, id, getItems, receive, fail),
  };
}
