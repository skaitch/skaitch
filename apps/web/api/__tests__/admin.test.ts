import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ initialize: vi.fn(() => ({ name: 'skaitch-mcp' })), cert: vi.fn(), adc: vi.fn(() => 'existing-adc'), get: vi.fn() }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [], initializeApp: mocks.initialize, cert: mocks.cert, applicationDefault: mocks.adc }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: mocks.get }));
import { getAdminDb } from '../_lib/admin';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it('fails closed when server credentials are absent', () => {
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'expected');
  vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '');
  vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_JSON', '');
  expect(getAdminDb).toThrow('not configured');
  expect(mocks.initialize).not.toHaveBeenCalled();
});
it('rejects credentials for another project', () => {
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'expected');
  vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_JSON', JSON.stringify({ project_id: 'other', client_email: 'service', private_key: 'private' }));
  expect(getAdminDb).toThrow('project mismatch');
  expect(mocks.initialize).not.toHaveBeenCalled();
});
it('initializes only the server Admin app with a matching credential', () => {
  const account = { project_id: 'expected', client_email: 'service', private_key: 'private' };
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'expected');
  vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_JSON', JSON.stringify(account));
  getAdminDb();
  expect(mocks.cert).toHaveBeenCalledWith(account);
  expect(mocks.get).toHaveBeenCalledWith({ name: 'skaitch-mcp' });
});

it('uses explicitly configured local credentials without changing the selected project', () => {
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'expected');
  vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_JSON', '');
  vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '/existing/adc.json');
  getAdminDb();
  expect(mocks.adc).toHaveBeenCalledOnce();
  expect(mocks.initialize).toHaveBeenCalledWith({ credential: 'existing-adc', projectId: 'expected' }, 'skaitch-mcp');
});
