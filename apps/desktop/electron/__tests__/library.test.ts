import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import { buildEmpty } from '@skaitch/core/data/starter';
import { readSkaitchFile, writeSkaitchFile } from '@skaitch/core/file/skaitchFile';
import { ProjectLibrary } from '../library';

let dir: string;
let trash: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>;
let library: ProjectLibrary;
const now = '2026-11-15T10:00:00.000Z';
const create = (id: string, name: string) => library.write(id, { id, name, description: '', createdAt: now, updatedAt: now, itemsJson: JSON.stringify(buildEmpty()) });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skaitch-library-'));
  trash = vi.fn(async (path: string) => { await rm(path); });
  library = new ProjectLibrary(dir, '0.4.0', trash);
});

it('stores each project as a .skaitch file named after the project', async () => {
  const stored = await create('proj_1', 'Maison');
  expect(await readdir(dir)).toEqual(['Maison.skaitch']);
  expect(stored).toMatchObject({ id: 'proj_1', name: 'Maison', modelRevision: 1 });
  const file = readSkaitchFile(new Uint8Array(await readFile(join(dir, 'Maison.skaitch'))));
  expect(file.meta).toMatchObject({ id: 'proj_1', name: 'Maison' });
  expect(Object.values(file.items).find(item => item.type === 'Project')?.name).toBe('Maison');
  expect((await library.list()).map(p => p.id)).toEqual(['proj_1']);
});

it('keeps project names unique and renames the file with the project', async () => {
  await create('proj_1', 'Maison');
  expect((await create('proj_2', 'Maison')).name).toBe('Maison (2)');
  await library.write('proj_1', { name: 'Garage' });
  expect((await readdir(dir)).sort()).toEqual(['Garage.skaitch', 'Maison (2).skaitch']);
});

it('only bumps the revision when the model changes and keeps the original IFC', async () => {
  await create('proj_1', 'Maison');
  const path = join(dir, 'Maison.skaitch');
  const withIfc = readSkaitchFile(new Uint8Array(await readFile(path)));
  await writeFile(path, writeSkaitchFile({ ...withIfc, sourceIfc: new TextEncoder().encode('ISO-10303-21;') }, '0.4.0'));
  await library.list();
  expect((await library.write('proj_1', { description: 'Plan' })).modelRevision).toBe(1);
  const items = buildEmpty();
  const storey = Object.values(items).find(item => item.type === 'Storey')!;
  storey.name = 'Rez-de-chaussée';
  expect((await library.write('proj_1', { itemsJson: JSON.stringify(items) })).modelRevision).toBe(2);
  expect(readSkaitchFile(new Uint8Array(await readFile(path))).sourceIfc).toBeDefined();
});

it('lists files dropped into the folder and refuses unknown or unsafe ids', async () => {
  await writeFile(join(dir, 'Reçu.skaitch'), writeSkaitchFile({ meta: { name: 'Reçu', description: '', createdAt: now, updatedAt: now }, items: buildEmpty() }, '0.4.0'));
  await writeFile(join(dir, 'notes.txt'), 'ignored');
  const [project] = await library.list();
  expect(project).toMatchObject({ id: 'file_Re_u', name: 'Reçu' });
  await expect(library.read('../secret')).rejects.toThrow('invalide');
  await expect(library.write('proj_x', { name: 'X' })).rejects.toThrow('introuvable');
});

it('moves deleted projects to the trash instead of erasing them', async () => {
  await create('proj_1', 'Maison');
  await library.delete('proj_1');
  expect(trash).toHaveBeenCalledWith(join(dir, 'Maison.skaitch'));
  expect(await library.list()).toEqual([]);
});

it('archives a project by moving its file into Archives/ and back, without rewriting it', async () => {
  await create('proj_1', 'Maison');
  const bytes = await readFile(join(dir, 'Maison.skaitch'));
  const archived = await library.setArchived('proj_1', true);
  expect(archived.archivedAt).toEqual(expect.any(String));
  expect(await readdir(dir)).toEqual(['Archives']);
  expect(await readFile(join(dir, 'Archives', 'Maison.skaitch'))).toEqual(bytes);
  // A fresh library (app restart) still sees it as archived.
  const reopened = new ProjectLibrary(dir, '0.4.0', trash);
  expect((await reopened.list()).map(p => [p.id, !!p.archivedAt])).toEqual([['proj_1', true]]);
  // Saving an archived project keeps it in Archives/.
  await reopened.write('proj_1', { description: 'modifiée' });
  expect(await readdir(join(dir, 'Archives'))).toEqual(['Maison.skaitch']);
  expect((await reopened.setArchived('proj_1', false)).archivedAt).toBeUndefined();
  expect((await readdir(dir)).sort()).toEqual(['Archives', 'Maison.skaitch']);
});

it('suffixes the file name when archiving onto an existing file', async () => {
  await create('proj_1', 'Maison');
  await mkdir(join(dir, 'Archives'));
  await writeFile(join(dir, 'Archives', 'Maison.skaitch'), 'not a project');
  await library.setArchived('proj_1', true);
  expect((await readdir(join(dir, 'Archives'))).sort()).toEqual(['Maison (2).skaitch', 'Maison.skaitch']);
});
