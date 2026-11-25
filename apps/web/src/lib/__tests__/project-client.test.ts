import { beforeEach, expect, it, vi } from 'vitest';
import { buildEmpty } from '@skaitch/core/data/starter';
import type { StoredProject } from '../projectStore';
const state = vi.hoisted(() => ({ uid: 'u', stored: null as any, listener: null as any }));
vi.mock('../firebase', () => ({ db: {}, auth: { get currentUser() { return { uid: state.uid }; } } }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDoc: async () => ({ exists: () => !!state.stored, data: () => state.stored }),
  onSnapshot: (_ref: unknown, next: any) => { state.listener = next; return vi.fn(); },
}));
vi.mock('../bimClient', () => ({ requestBim: vi.fn() }));
import { requestBim } from '../bimClient';
import { readStoredProject, writeStoredProject, watchStoredProject, isStoredModel, firestoreProjectRepository } from '../projectStore';
const makeProject = (id: string, revision = 1): StoredProject => ({ id, name: 'Maison', description: '', createdAt: '', updatedAt: '', modelRevision: revision, itemsJson: JSON.stringify(buildEmpty()) });
const emit = (stored: StoredProject) => state.listener({ exists: () => true, data: () => stored, metadata: { hasPendingWrites: false } });
beforeEach(() => { state.uid = 'u'; vi.mocked(requestBim).mockReset(); });

it('serializes saves using the revision returned by the previous server write', async () => {
  state.stored = makeProject('queued');
  await readStoredProject('u', 'queued');
  vi.mocked(requestBim).mockImplementation(async (_op, input: any) => ({ ...state.stored, modelRevision: input.expectedRevision + 1 }));
  await Promise.all([writeStoredProject('u', 'queued', { itemsJson: state.stored.itemsJson }), writeStoredProject('u', 'queued', { itemsJson: state.stored.itemsJson })]);
  expect(vi.mocked(requestBim).mock.calls.map(call => (call[1] as any).expectedRevision)).toEqual([1, 2]);
  state.uid = 'other';
  await expect(writeStoredProject('u', 'queued', {})).rejects.toThrow('session a changé');
  expect(requestBim).toHaveBeenCalledTimes(2);
});

it('receives newer models only when local changes are safe to replace', async () => {
  state.stored = makeProject('remote');
  await readStoredProject('u', 'remote');
  let items = JSON.parse(state.stored.itemsJson);
  const receive = vi.fn((stored: StoredProject) => { items = JSON.parse(stored.itemsJson); });
  const fail = vi.fn();
  const stop = watchStoredProject('u', 'remote', () => items, receive, fail);
  const remote = { ...state.stored, modelRevision: 2, itemsJson: JSON.stringify({ ...items, remote: { id: 'remote', type: 'Marker' } }) };
  await emit(remote);
  expect(receive).toHaveBeenCalledTimes(1);
  expect(isStoredModel('u', 'remote', items)).toBe(true);
  items.local = { id: 'local', type: 'Marker' };
  await emit({ ...remote, modelRevision: 3 });
  expect(fail).toHaveBeenCalledTimes(1);
  expect(items.local).toBeDefined();
  expect(receive).toHaveBeenCalledTimes(1);
  stop();
  await emit({ ...remote, modelRevision: 4 });
  expect(fail).toHaveBeenCalledTimes(1);
});

it('waits for an in-flight save before treating its snapshot as a remote edit', async () => {
  state.stored = makeProject('echo');
  await readStoredProject('u', 'echo');
  const items = JSON.parse(state.stored.itemsJson);
  items.local = { id: 'local' };
  let resolve!: (value: any) => void;
  vi.mocked(requestBim).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = writeStoredProject('u', 'echo', { itemsJson: JSON.stringify(items) });
  await Promise.resolve(); await Promise.resolve();
  const receive = vi.fn(), fail = vi.fn();
  const stop = watchStoredProject('u', 'echo', () => items, receive, fail);
  const remote = { ...state.stored, modelRevision: 2, itemsJson: JSON.stringify(items) };
  const event = emit(remote);
  resolve(remote);
  await pending; await event;
  expect(receive).not.toHaveBeenCalled();
  expect(fail).not.toHaveBeenCalled();
  stop();
});

it('hydrates chunked snapshots through the authenticated server and preserves unsaved edits', async () => {
  const stored = makeProject('chunk-client');
  state.stored = { ...stored, itemsJson: '', modelChunks: { revision: 1, count: 1 } };
  vi.mocked(requestBim).mockResolvedValueOnce(stored);
  expect(await readStoredProject('u', 'chunk-client')).toEqual(stored);
  expect(requestBim).toHaveBeenCalledWith('project-read', { id: 'chunk-client' });
  const items = JSON.parse(stored.itemsJson);
  items.local = { id: 'local' };
  const receive = vi.fn(), fail = vi.fn();
  const stop = watchStoredProject('u', 'chunk-client', () => items, receive, fail);
  vi.mocked(requestBim).mockResolvedValueOnce({ ...stored, modelRevision: 2 });
  await emit({ ...state.stored, modelRevision: 2 });
  expect(receive).not.toHaveBeenCalled();
  expect(fail).toHaveBeenCalledTimes(1);
  stop();
});

it('does not autosave an unchanged catalogue reordered by Firestore', async () => {
  const catalogue = [{ id: 'door', type: 'Door' as const, category: 'doors', labelFr: 'Porte', labelEn: 'Door', defaults: { width: 1, height: 2 } }];
  state.stored = { ...makeProject('catalogue-order'), catalogue: catalogue.map(({ defaults, ...entry }) => ({ defaults: { height: defaults.height, width: defaults.width }, ...entry })) };
  await readStoredProject('u', 'catalogue-order');
  const items = JSON.parse(state.stored.itemsJson);
  expect(isStoredModel('u', 'catalogue-order', items, catalogue)).toBe(true);
  expect(isStoredModel('u', 'catalogue-order', items, [{ ...catalogue[0], defaults: { width: 2, height: 2 } }])).toBe(false);
});

it('binds the Firestore repository to its account', async () => {
  state.stored = makeProject('bound');
  const repo = firestoreProjectRepository('u');
  const stored = await repo.read('bound');
  expect(stored?.id).toBe('bound');
  expect(repo.isSaved('bound', JSON.parse(stored!.itemsJson))).toBe(true);
  vi.mocked(requestBim).mockResolvedValueOnce([{ id: 'bound' }]);
  await expect(repo.list()).resolves.toEqual([{ id: 'bound' }]);
  expect(requestBim).toHaveBeenCalledWith('project-list', {});
  state.uid = 'other';
  await expect(repo.read('bound')).rejects.toThrow('session a changé');
});
