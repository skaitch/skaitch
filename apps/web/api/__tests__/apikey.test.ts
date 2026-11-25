import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ db: vi.fn(), doc: vi.fn(), get: vi.fn(), legacy: vi.fn() }));
vi.mock('../_lib/admin', () => ({ getAdminDb: () => { mocks.db(); return ({
  doc: mocks.doc,
  collectionGroup: () => ({ where: () => ({ get: mocks.legacy }) }),
}); } }));
import { authenticateKey } from '../_lib/apikey';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.doc.mockReturnValue({ get: mocks.get });
  mocks.get.mockResolvedValue({ exists: true });
  mocks.legacy.mockResolvedValue({ empty: true });
});
it('validates the key at its owner path, including uids with underscores', async () => {
  const key = 'ak_user_with_underscores_' + 'a'.repeat(40);
  expect(await authenticateKey(key)).toBe('user_with_underscores');
  expect(mocks.doc).toHaveBeenCalledWith(`users/user_with_underscores/apiKeys/${key}`);
});
it('rejects a revoked key without looking for another owner', async () => {
  mocks.get.mockResolvedValue({ exists: false });
  expect(await authenticateKey('ak_user_' + 'a'.repeat(40))).toBeNull();
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it.each(['', 'invalid-smoke-test', 'Bearer ak_user_' + 'a'.repeat(40), 'ak_user/path_' + 'a'.repeat(40)])('rejects malformed credentials before accessing Firestore: %s', async key => {
  expect(await authenticateKey(key)).toBeNull();
  expect(mocks.db).not.toHaveBeenCalled();
});
it('preserves lookup of legacy keys without an owner uid', async () => {
  const key = 'ak_' + 'a'.repeat(40);
  mocks.legacy.mockResolvedValue({ empty: false, docs: [{ data: () => ({ uid: 'legacy-user' }) }] });
  expect(await authenticateKey(key)).toBe('legacy-user');
  expect(mocks.doc).not.toHaveBeenCalled();
  expect(mocks.legacy).toHaveBeenCalledOnce();
});
