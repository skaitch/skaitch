import { afterEach, expect, it, vi } from 'vitest';
vi.mock('vite', async importOriginal => ({
  ...await importOriginal<typeof import('vite')>(),
  loadEnv: vi.fn(() => ({ VITE_FIREBASE_PROJECT_ID: 'test-project' })),
}));
import configuration from '../../vite.config';
afterEach(() => vi.unstubAllEnvs());
it('does not stringify missing server credentials into an undefined string', () => {
  for (const key of ['VITE_FIREBASE_PROJECT_ID','FIREBASE_SERVICE_ACCOUNT_JSON','GOOGLE_APPLICATION_CREDENTIALS','AI_VAULT_SECRET']) vi.stubEnv(key, undefined);
  (configuration as Function)({ mode: 'development' });
  expect(process.env.VITE_FIREBASE_PROJECT_ID).toBe('test-project');
  expect(process.env.FIREBASE_SERVICE_ACCOUNT_JSON).toBeUndefined();
  expect(process.env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
  expect(process.env.AI_VAULT_SECRET).toBeUndefined();
});
