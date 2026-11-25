import { jsonEqual } from '@skaitch/core/lib/jsonEqual';
import { hydrateProject, storeProjectModel, deleteProjectChunks } from './projectModel.js';
import type { ElementDef } from '@skaitch/core/data/elementCatalogue';
import type { Transaction } from 'firebase-admin/firestore';
import { getAdminDb } from '../../api/_lib/admin.js';
import { InputError, finiteData, validateItems, validateCatalogue } from '@skaitch/core/bim/validation';
import { buildEmpty } from '@skaitch/core/data/starter';
import { renameProjectItems, uniqueProjectName } from '@skaitch/core/lib/projectName';
import type { ProjectMeta } from '@skaitch/core/types/project';
import { WEB_PROJECT_LIMIT, canAddProject } from '@skaitch/core/lib/projectLimit';
import { isAdministrator } from '../../api/_lib/adminRole.js';

export type StoredProject = ProjectMeta & { itemsJson: string; catalogue?: ElementDef[] };
const catalogRef = (uid: string) => getAdminDb().doc(`users/${uid}/metadata/projectNames`);
const projectRef = (uid: string, id: string) => getAdminDb().doc(`users/${uid}/projects/${id}`);

async function ensureProjectNames(uid: string) {
  const ref = catalogRef(uid);
  if ((await ref.get()).exists) return;
  const legacy = await getAdminDb().collection(`users/${uid}/projects`).get();
  await getAdminDb().runTransaction(async tx => {
    if ((await tx.get(ref)).exists) return;
    const snapshots = await Promise.all(legacy.docs.map(snapshot => tx.get(snapshot.ref)));
    const projects = snapshots.filter(snapshot => snapshot.exists);
    const names: Record<string, string> = Object.fromEntries(projects.map(snapshot => [snapshot.id, snapshot.data()!.name]));
    const models = await Promise.all(projects.map(snapshot => hydrateProject(uid, snapshot.id, snapshot.data()!, tx)));
    for (const [index, snapshot] of projects.entries()) {
      const data = models[index];
      const name = uniqueProjectName(data.name, Object.entries(names).filter(([id]) => id !== snapshot.id).map(([, value]) => value));
      names[snapshot.id] = name;
      if (name !== data.name) storeProjectModel(tx, uid, snapshot.id, {
        ...data, name, modelRevision: (data.modelRevision ?? 0) + 1, itemsJson: JSON.stringify(renameProjectItems(data.itemsJson ? JSON.parse(data.itemsJson) : buildEmpty(), name)),
      }, snapshot.data());
    }
    tx.set(ref, { names });
  });
}

export async function listStoredProjects(uid: string): Promise<ProjectMeta[]> {
  await ensureProjectNames(uid);
  const snapshots = await getAdminDb().collection(`users/${uid}/projects`).get();
  return snapshots.docs.map(snapshot => { const { itemsJson, catalogue, modelChunks, modelBytes, ...meta } = snapshot.data(); return meta as ProjectMeta; })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The catalog and project are committed together, so concurrent imports cannot claim the same name. */
export async function writeStoredProject(uid: string, id: string, patch: Partial<StoredProject>, expectedRevision?: number, authorize?: (tx: Transaction) => Promise<void>): Promise<StoredProject> {
  validatePatch(id, patch);
  await ensureProjectNames(uid);
  return getAdminDb().runTransaction(async tx => {
    await authorize?.(tx);
    const ref = projectRef(uid, id);
    const catalog = await tx.get(catalogRef(uid));
    const snapshot = await tx.get(ref);
    if (!snapshot.exists && patch.id !== id) throw new InputError('Projet introuvable.', 404);
    const previous = snapshot.exists ? await hydrateProject(uid, id, snapshot.data()!, tx) : undefined;
    if (!previous && ['name', 'description', 'createdAt', 'updatedAt'].some(field => typeof patch[field] !== 'string')) throw new InputError('Métadonnées du nouveau projet incomplètes.');
    const names = { ...catalog.data()!.names } as Record<string, string>;
    // Beta: existing accounts keep their projects, but cannot add one beyond the limit. Administrators have no limit.
    if (!previous && !isAdministrator(uid) && !canAddProject(Object.keys(names).length, WEB_PROJECT_LIMIT)) {
      throw new InputError(`Limite atteinte (${WEB_PROJECT_LIMIT} projets pendant la bêta, archivés compris). Supprimez un projet pour en créer un nouveau.`, 403);
    }
    const data = { ...previous, ...patch } as StoredProject;
    const name = uniqueProjectName(data.name, Object.entries(names).filter(([other]) => other !== id).map(([, value]) => value));
    const stored = { ...data, name, itemsJson: JSON.stringify(renameProjectItems(data.itemsJson ? JSON.parse(data.itemsJson) : buildEmpty(), name)) };
    const modelChanged = stored.itemsJson !== previous?.itemsJson || !jsonEqual(stored.catalogue, previous?.catalogue);
    // A repeated save may already be committed even if its response was lost.
    if (snapshot.exists && (patch.itemsJson !== undefined || patch.catalogue !== undefined) && modelChanged) checkRevision(previous, expectedRevision);
    stored.modelRevision = (previous?.modelRevision ?? 0) + (modelChanged ? 1 : 0);
    // shortcut: models fit one Firestore document; use chunked storage before raising this bound.
    // shortcut: one Firestore document per model; use chunked storage for larger projects.
    storeProjectModel(tx, uid, id, stored, snapshot.data());
    if (names[id] !== name) tx.set(catalogRef(uid), { names: { ...names, [id]: name } });
    return stored;
  });
}

export async function deleteStoredProject(uid: string, id: string, expectedRevision?: number) {
  validateId(id);
  await ensureProjectNames(uid);
  await getAdminDb().runTransaction(async tx => {
    const snapshot = await tx.get(catalogRef(uid));
    const project = await tx.get(projectRef(uid, id));
    if (!project.exists) throw new InputError('Projet introuvable.', 404);
    checkRevision(project.data() as StoredProject, expectedRevision);
    const names = { ...snapshot.data()!.names };
    delete names[id];
    deleteProjectChunks(tx, uid, id, project.data()!);
    tx.delete(projectRef(uid, id));
    tx.set(catalogRef(uid), { names });
  });
}

function validateId(id: string) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new InputError('Identifiant de projet invalide.');
}
function checkRevision(previous: StoredProject | undefined, expected: number | undefined) {
  if (!Number.isSafeInteger(expected) || expected !== (previous?.modelRevision ?? 0)) {
    throw new InputError('Conflit de sauvegarde : une autre version du projet existe. Vos changements locaux sont conservés ; exportez-les avant de rouvrir le projet.', 409);
  }
}
function validatePatch(id: string, patch: Partial<StoredProject>) {
  validateId(id);
  const fields = ['id', 'name', 'description', 'createdAt', 'updatedAt', 'itemsJson', 'thumbnailSvg'];
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'catalogue') { validateCatalogue(value); continue; }
    if (key === 'archivedAt' && (value === null || (typeof value === 'string' && value.length <= 40))) continue;
    if (!fields.includes(key) || typeof value !== 'string') throw new InputError('Donnée de projet invalide.');
  }
  if (patch.id !== undefined && patch.id !== id) throw new InputError('Identifiant de projet incohérent.');
  for (const key of ['name', 'description', 'thumbnailSvg'] as const) {
    if (patch[key] && patch[key].length > (key === 'thumbnailSvg' ? 300_000 : key === 'name' ? 300 : 10_000)) throw new InputError('Métadonnée de projet trop longue.');
  }
  if (patch.itemsJson !== undefined) {
    let items;
    try { items = JSON.parse(patch.itemsJson); } catch { throw new InputError('Modèle JSON invalide.'); }
    finiteData(items);
    validateItems(items);
  }
}

export async function readStoredProject(uid: string, id: string): Promise<StoredProject | null> {
  validateId(id);
  return getAdminDb().runTransaction(async tx => {
    const snapshot = await tx.get(projectRef(uid, id));
    return snapshot.exists ? hydrateProject(uid, id, snapshot.data()!, tx) : null;
  });
}
