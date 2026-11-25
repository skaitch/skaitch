import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readSkaitchFile, writeSkaitchFile, SKAITCH_EXTENSION, type SkaitchProject } from '@skaitch/core/file/skaitchFile';
import { renameProjectItems, uniqueProjectName } from '@skaitch/core/lib/projectName';
import { generateThumbnailSvg } from '@skaitch/core/lib/thumbnail';
import { buildEmpty } from '@skaitch/core/data/starter';
import { jsonEqual } from '@skaitch/core/lib/jsonEqual';
import { InputError, validateCatalogue, validateItems } from '@skaitch/core/bim/validation';
import type { StoredProject } from '@skaitch/core/lib/projectRepository';
import type { ProjectMeta } from '@skaitch/core/types/project';

const ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Subfolder of the library holding archived projects (ADR 0020). */
export const ARCHIVES_DIR = 'Archives';

interface Entry {
  path: string;
  project: SkaitchProject;
  /** In-memory model revision; files carry no revision of their own. */
  revision: number;
  /** When the file entered `Archives/` (its change time); null when active. */
  archivedAt: string | null;
}

/** A file name the user will recognise in their Documents folder. */
function fileStem(name: string) {
  const stem = name.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 100);
  return stem || 'Projet';
}

/** Id for a file dropped into the library without one in its manifest. */
const idFromFile = (path: string) => `file_${basename(path, SKAITCH_EXTENSION).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120)}`;

/**
 * The desktop project library (CONTEXT.md: Bibliothèque de projets): one `.skaitch`
 * file per project in a folder. Writes follow the same rules as the web server:
 * unique project names, the Project item renamed with the project, and a revision
 * that only moves when the model changes.
 */
export class ProjectLibrary {
  private entries = new Map<string, Entry>();

  constructor(readonly dir: string, private readonly appVersion: string, private readonly trash: (path: string) => Promise<void>) {}

  private get archives() { return join(this.dir, ARCHIVES_DIR); }

  private async scan() {
    await mkdir(this.dir, { recursive: true });
    const previous = this.entries;
    const next = new Map<string, Entry>();
    const files = (await readdir(this.dir)).map(name => join(this.dir, name));
    if (existsSync(this.archives)) files.push(...(await readdir(this.archives)).map(name => join(this.archives, name)));
    for (const path of files) {
      if (!path.toLowerCase().endsWith(SKAITCH_EXTENSION)) continue;
      const archived = dirname(path) === this.archives;
      let project: SkaitchProject;
      try { project = readSkaitchFile(new Uint8Array(await readFile(path))); }
      catch { continue; } // Unreadable files stay on disk untouched; they are just not listed.
      let id = project.meta.id && ID.test(project.meta.id) ? project.meta.id : idFromFile(path);
      if (next.has(id)) id = idFromFile(path);
      const old = previous.get(id);
      const same = old && old.path === path && old.project.meta.updatedAt === project.meta.updatedAt;
      const archivedAt = archived ? (old?.archivedAt ?? (await stat(path)).ctime.toISOString()) : null;
      next.set(id, { path, project, archivedAt, revision: same ? old.revision : (old?.revision ?? 0) + (old ? 1 : 0) });
    }
    this.entries = next;
  }

  private stored(id: string, entry: Entry): StoredProject {
    const { project } = entry;
    return {
      id, name: project.meta.name, description: project.meta.description,
      createdAt: project.meta.createdAt, updatedAt: project.meta.updatedAt,
      thumbnailSvg: generateThumbnailSvg(project.items), modelRevision: entry.revision,
      itemsJson: JSON.stringify(project.items),
      ...(project.catalogue ? { catalogue: project.catalogue } : {}),
      ...(entry.archivedAt ? { archivedAt: entry.archivedAt } : {}),
    };
  }

  async list(): Promise<ProjectMeta[]> {
    await this.scan();
    return [...this.entries].map(([id, entry]) => { const { itemsJson, catalogue, ...meta } = this.stored(id, entry); return meta; })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async read(id: string): Promise<StoredProject | null> {
    if (!ID.test(id)) throw new InputError('Identifiant de projet invalide.');
    if (!this.entries.has(id)) await this.scan();
    const entry = this.entries.get(id);
    return entry ? this.stored(id, entry) : null;
  }

  async write(id: string, patch: Partial<StoredProject>): Promise<StoredProject> {
    if (!ID.test(id)) throw new InputError('Identifiant de projet invalide.');
    if (!this.entries.has(id)) await this.scan();
    const previous = this.entries.get(id);
    if (!previous && patch.id !== id) throw new InputError('Projet introuvable.', 404);
    if (!previous && ['name', 'description', 'createdAt', 'updatedAt'].some(field => typeof patch[field as keyof StoredProject] !== 'string')) throw new InputError('Métadonnées du nouveau projet incomplètes.');
    const before = previous ? this.stored(id, previous) : undefined;
    const data = { ...before, ...patch } as StoredProject;
    const items = validateItems(data.itemsJson ? JSON.parse(data.itemsJson) : buildEmpty());
    if (data.catalogue !== undefined) validateCatalogue(data.catalogue);
    const name = uniqueProjectName(data.name, [...this.entries].filter(([other]) => other !== id).map(([, entry]) => entry.project.meta.name));
    const project: SkaitchProject = {
      meta: { id, name, description: data.description ?? '', createdAt: data.createdAt ?? '', updatedAt: data.updatedAt ?? new Date().toISOString() },
      items: renameProjectItems(items, name),
      ...(data.catalogue ? { catalogue: data.catalogue } : {}),
      // Keep the original IFC a previous version of the file carried.
      ...(previous?.project.sourceIfc ? { sourceIfc: previous.project.sourceIfc } : {}),
    };
    const modelChanged = JSON.stringify(project.items) !== before?.itemsJson || !jsonEqual(project.catalogue, before?.catalogue);
    // An archived project is saved in place, inside Archives/.
    const folder = previous ? dirname(previous.path) : this.dir;
    const path = previous && fileStem(previous.project.meta.name) === fileStem(name) ? previous.path : this.freePath(folder, name, previous?.path);
    await this.writeAtomically(path, writeSkaitchFile(project, this.appVersion));
    if (previous && previous.path !== path) await rm(previous.path, { force: true });
    const entry = { path, project, archivedAt: previous?.archivedAt ?? null, revision: (previous?.revision ?? 0) + (modelChanged ? 1 : 0) };
    this.entries.set(id, entry);
    return this.stored(id, entry);
  }

  async delete(id: string) {
    if (!ID.test(id)) throw new InputError('Identifiant de projet invalide.');
    if (!this.entries.has(id)) await this.scan();
    const entry = this.entries.get(id);
    if (!entry) throw new InputError('Projet introuvable.', 404);
    await this.trash(entry.path);
    this.entries.delete(id);
  }

  /** Moves the file into or out of `Archives/`, suffixing its name on a collision; the file itself is never rewritten. */
  async setArchived(id: string, archived: boolean): Promise<ProjectMeta> {
    if (!ID.test(id)) throw new InputError('Identifiant de projet invalide.');
    if (!this.entries.has(id)) await this.scan();
    const entry = this.entries.get(id);
    if (!entry) throw new InputError('Projet introuvable.', 404);
    if (!!entry.archivedAt !== archived) {
      const folder = archived ? this.archives : this.dir;
      await mkdir(folder, { recursive: true });
      const path = this.freePath(folder, entry.project.meta.name);
      await rename(entry.path, path);
      entry.path = path;
      entry.archivedAt = archived ? new Date().toISOString() : null;
    }
    const { itemsJson, catalogue, ...meta } = this.stored(id, entry);
    return meta;
  }

  private freePath(folder: string, name: string, current?: string) {
    const stem = fileStem(name);
    for (let n = 1; ; n++) {
      const path = join(folder, `${n === 1 ? stem : `${stem} (${n})`}${SKAITCH_EXTENSION}`);
      if (path === current || !existsSync(path)) return path;
    }
  }

  private async writeAtomically(path: string, bytes: Uint8Array) {
    const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(temporary, bytes);
    try { await rename(temporary, path); }
    catch (error) { await rm(temporary, { force: true }); throw error; }
  }
}
