import type { ElementDef } from '@skaitch/core/data/elementCatalogue';
import { useState, useEffect, useCallback } from 'react';
import type { Project, ProjectMeta } from '@skaitch/core/types/project';
import type { ItemsMap } from '@skaitch/core/types/ifc';
import { buildEmpty } from '@skaitch/core/data/starter';
import { set as idbSet, get as idbGet, del as idbDel } from 'idb-keyval';
import { renameProjectItems, uniqueProjectName } from '@skaitch/core/lib/projectName';
import type { ProjectRepository } from '@skaitch/core/lib/projectRepository';
import { generateThumbnailSvg } from '@skaitch/core/lib/thumbnail';
import { canAddProject, PROJECT_LIMIT_MESSAGE } from '@skaitch/core/lib/projectLimit';

// ── IFC buffer — IndexedDB (local cache, not synced) ──────────────────────

export async function saveIfcBuffer(id: string, buffer: ArrayBuffer) {
  await idbSet(`ifc_buffer_${id}`, buffer);
}

export async function loadIfcBuffer(id: string): Promise<ArrayBuffer | null> {
  return (await idbGet(`ifc_buffer_${id}`)) || null;
}

// ── Firestore helpers ──────────────────────────────────────────────────────

function newId(): string {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function now(): string {
  return new Date().toISOString();
}

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * `repo` is null when no project space is available (signed out on the web).
 * `limit` caps how many projects the account may hold; omit it for no limit.
 */
export function useProjects(repo: ProjectRepository | null, limit?: number) {
  const [list, setList] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!repo) {
      setList([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    repo.list()
      .then(setList)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [repo]);

  const createProject = useCallback(async (name = 'Nouveau projet', description = '', lang?: string): Promise<Project> => {
    if (!canAddProject(list.length, limit)) throw new Error(PROJECT_LIMIT_MESSAGE.replace('{limit}', String(limit)));
    const id = newId();
    const ts = now();
    if (!repo) name = uniqueProjectName(name, list.map(p => p.name));
    let items = renameProjectItems(buildEmpty(lang), name);
    let meta: ProjectMeta = { id, name, description, createdAt: ts, updatedAt: ts };
    if (repo) {
      const stored = await repo.write(id, { ...meta, itemsJson: JSON.stringify(items) });
      meta = { ...meta, name: stored.name };
      items = JSON.parse(stored.itemsJson);
    }
    setList((l) => [meta, ...l]);
    return { ...meta, items };
  }, [repo, list, limit]);

  const openProject = useCallback(async (id: string): Promise<Project | null> => {
    if (!repo) return null;
    const data = await repo.read(id);
    if (!data) return null;
    const items: ItemsMap = data.itemsJson ? JSON.parse(data.itemsJson) : buildEmpty();
    return { ...data, items: renameProjectItems(items, data.name) };
  }, [repo]);

  const saveProject = useCallback(async (id: string, items: ItemsMap, meta?: Partial<Pick<ProjectMeta, 'name' | 'description'>>, catalogue?: ElementDef[]) => {
    if (!repo) return;
    const name = meta?.name ?? Object.values(items).find(item => item.type === 'Project')?.name;
    if (name !== undefined) {
      items = renameProjectItems(items, name);
      meta = { ...meta, name };
    }
    const thumbnailSvg = generateThumbnailSvg(items);
    const ts = now();
    const patch = { ...meta, ...(catalogue ? { catalogue } : {}), thumbnailSvg, updatedAt: ts, itemsJson: JSON.stringify(items) };
    const stored = await repo.write(id, patch);
    setList((l) => l.map((p) => p.id === id ? { ...p, ...meta, name: stored.name, thumbnailSvg, updatedAt: ts } : p));
    return stored.name;
  }, [repo]);

  const updateMeta = useCallback(async (id: string, patch: Partial<Pick<ProjectMeta, 'name' | 'description'>>) => {
    if (!repo) return;
    const update = { ...patch, updatedAt: now() };
    const stored = await repo.write(id, update);
    setList((l) => l.map((p) => p.id === id ? { ...p, ...update, name: stored.name } : p));
  }, [repo]);

  const duplicateProject = useCallback(async (id: string): Promise<ProjectMeta | null> => {
    if (!repo) return null;
    if (!canAddProject(list.length, limit)) throw new Error(PROJECT_LIMIT_MESSAGE.replace('{limit}', String(limit)));
    const src = await repo.read(id);
    if (!src) return null;
    const nid = newId();
    const ts = now();
    let newMeta: ProjectMeta = { id: nid, name: src.name + ' (copie)', description: src.description, createdAt: ts, updatedAt: ts, ...(src.thumbnailSvg ? { thumbnailSvg: src.thumbnailSvg } : {}) };
    const stored = await repo.write(nid, { ...newMeta, ...(src.catalogue ? { catalogue: src.catalogue } : {}), itemsJson: JSON.stringify(src.itemsJson ? JSON.parse(src.itemsJson) : buildEmpty()) });
    newMeta = { ...newMeta, name: stored.name };
    setList((l) => [newMeta, ...l]);
    return newMeta;
  }, [repo, list, limit]);

  const deleteProject = useCallback(async (id: string) => {
    if (!repo) return;
    await repo.delete(id);
    setList((l) => l.filter((p) => p.id !== id));
    idbDel(`ifc_buffer_${id}`).catch(console.error);
  }, [repo]);

  const setArchived = useCallback(async (id: string, archived: boolean) => {
    if (!repo) return;
    const meta = await repo.setArchived(id, archived);
    setList((l) => l.map((p) => p.id === id ? { ...p, archivedAt: meta.archivedAt ?? null } : p));
  }, [repo]);

  const subscribeProject = useCallback((id: string, getItems: () => ItemsMap, receive: (items: ItemsMap, catalogue?: ElementDef[]) => void, fail: (error: Error) => void) => {
    if (!repo) return () => {};
    return repo.watch(id, getItems, stored => {
      const { itemsJson, catalogue, ...meta } = stored;
      setList(list => list.map(project => project.id === id ? meta : project));
      receive(JSON.parse(itemsJson), catalogue);
    }, fail);
  }, [repo]);

  return { subscribeProject, list, loading, createProject, openProject, saveProject, updateMeta, duplicateProject, deleteProject, setArchived };
}
