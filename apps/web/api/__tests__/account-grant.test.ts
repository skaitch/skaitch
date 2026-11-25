import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn(), login: vi.fn(), googleLogin: vi.fn() }));
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})), deleteApp: mocks.remove }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({}), signInWithEmailAndPassword: mocks.login, signOut: vi.fn(), signInWithCredential: mocks.googleLogin, GoogleAuthProvider: { credential: (token: string) => ({ token }) } }));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => ({}), collection: vi.fn(), doc: (_: unknown, ...p: string[]) => p.join('/'),
  getDocs: async () => ({ docs: [{ id: 'project1' }, { id: 'project2' }] }), setDoc: mocks.save,
}));
import { createAccountGrant } from '../_lib/account-grant';
beforeEach(() => { vi.clearAllMocks(); mocks.login.mockResolvedValue({ user: { uid: 'user' } }); });
it.each(['read', 'write'] as const)('creates a revocable grant with account-wide %s access', async access => {
  const key = await createAccountGrant('user@example.com', 'password', access);
  expect(key).toMatch(/^ak_user_[a-f0-9]{40}$/);
  expect(mocks.save).toHaveBeenCalledWith(`users/user/apiKeys/${key}`, expect.objectContaining({ permissions: {}, accountAccess: access }));
  expect(mocks.remove).toHaveBeenCalledOnce();
});
it('does not create a grant after failed login and disposes the isolated app', async () => {
  mocks.login.mockRejectedValue(new Error('invalid credentials'));
  await expect(createAccountGrant('bad', 'bad', 'read')).rejects.toThrow();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.remove).toHaveBeenCalledOnce();
});

it('authenticates Google credentials before creating a grant', async () => {
  mocks.googleLogin.mockResolvedValue({ user: { uid: 'google-user' } });
  const key = await createAccountGrant('', '', 'read', 'google-id-token');
  expect(mocks.googleLogin).toHaveBeenCalledWith({}, { token: 'google-id-token' });
  expect(mocks.login).not.toHaveBeenCalled();
  expect(mocks.save).toHaveBeenCalledWith(`users/google-user/apiKeys/${key}`, expect.objectContaining({ uid: 'google-user', permissions: {}, accountAccess: 'read' }));
});
it('rejects invalid Google credentials without creating a grant', async () => {
  mocks.googleLogin.mockRejectedValue(new Error('invalid credential'));
  await expect(createAccountGrant('', '', 'read', 'invalid')).rejects.toThrow();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.remove).toHaveBeenCalledOnce();
});
