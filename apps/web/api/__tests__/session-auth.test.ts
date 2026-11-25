import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  apps: [] as any[], verify: vi.fn(), initialize: vi.fn(),
}));
vi.mock('firebase-admin/app', () => ({
  getApps: () => state.apps,
  initializeApp: (...args: any[]) => { state.initialize(...args); const app = { name: 'skaitch-browser-auth' }; state.apps.push(app); return app; },
}));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: state.verify }) }));
import { authenticateSession } from '../_lib/sessionAuth';
beforeEach(() => { state.apps = []; state.verify.mockReset(); state.initialize.mockReset(); vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'trusted-project'); });
afterEach(() => vi.unstubAllEnvs());
it('only accepts a bearer token verified by Firebase for the configured project', async () => {
  state.verify.mockResolvedValue({ uid: 'owner' });
  expect(await authenticateSession('Bearer signed-id-token')).toBe('owner');
  expect(state.initialize).toHaveBeenCalledWith({ projectId: 'trusted-project' }, 'skaitch-browser-auth');
  expect(state.verify).toHaveBeenCalledWith('signed-id-token');
});
it('rejects absent, malformed, expired or otherwise invalid tokens', async () => {
  expect(await authenticateSession(undefined)).toBeNull();
  expect(await authenticateSession('ak_api_key')).toBeNull();
  expect(state.verify).not.toHaveBeenCalled();
  state.verify.mockRejectedValue(new Error('invalid token'));
  expect(await authenticateSession('Bearer forged-token')).toBeNull();
});
it('fails closed when the trusted project is missing', async () => {
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', '');
  await expect(authenticateSession('Bearer token')).rejects.toThrow('not configured');
  expect(state.verify).not.toHaveBeenCalled();
});
