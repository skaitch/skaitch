import { beforeEach, expect, it, vi } from 'vitest';
const session = vi.hoisted(() => ({ uid: 'u' }));
vi.mock('../firebase', () => ({ auth: { get currentUser() { return { uid: session.uid }; } } }));
vi.mock('../serverRequest', () => ({ serverRequest: vi.fn() }));
import { serverRequest } from '../serverRequest';
import { captureLegacyAi, publicAiConfig, migrateAiCredentials, LEGACY_AI_KEY, saveAiCredential } from '../aiVaultClient';
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } as Storage;
}
const metadata = [{ id: 'a'.repeat(64), role: 'chat', provider: 'openai', origin: 'https://api.openai.com', version: 1 }];
beforeEach(() => { session.uid = 'u'; vi.mocked(serverRequest).mockReset(); });
it('preserves legacy secrets before scrubbing public preferences and does not persist new drafts or references', () => {
  const store = storage();
  const old = { provider: 'openai', apiKey: 'old-key', apiKeys: { openai: 'old-key' }, model: 'm', visualizerApiKey: 'render-key', apiKeyRef: 'opaque', credentials: metadata as any };
  captureLegacyAi(old, store);
  expect(store.getItem(LEGACY_AI_KEY)).toContain('old-key');
  const safe = publicAiConfig(old);
  expect(safe.model).toBe('m');
  expect(JSON.stringify(safe)).not.toMatch(/old-key|render-key|opaque|credentials/);
  expect(old.apiKey).toBe('old-key');
});
it('keeps the recovery copy after server errors or incomplete acknowledgements and removes it only after full confirmation', async () => {
  const store = storage();
  captureLegacyAi({ provider: 'openai', apiKey: 'legacy-key' }, store);
  const before = store.getItem(LEGACY_AI_KEY);
  vi.mocked(serverRequest).mockRejectedValueOnce(new Error('offline'));
  await expect(migrateAiCredentials('u', store)).rejects.toThrow('offline');
  expect(store.getItem(LEGACY_AI_KEY)).toBe(before);
  vi.mocked(serverRequest).mockResolvedValueOnce(new Response('[]'));
  await expect(migrateAiCredentials('u', store)).rejects.toThrow('confirmé');
  expect(store.getItem(LEGACY_AI_KEY)).toBe(before);
  vi.mocked(serverRequest).mockResolvedValueOnce(new Response(JSON.stringify(metadata)));
  await expect(migrateAiCredentials('u', store)).resolves.toEqual(metadata);
  expect(store.getItem(LEGACY_AI_KEY)).toBeNull();
});
it('leaves local endpoint keys on this computer and refuses account changes', async () => {
  const store = storage();
  captureLegacyAi({ provider: 'openai', apiKey: 'legacy-key', apiKeys: { custom: 'local-key' }, baseUrls: { custom: 'http://localhost:1234' } }, store);
  vi.mocked(serverRequest).mockResolvedValueOnce(new Response(JSON.stringify(metadata)));
  await migrateAiCredentials('u', store);
  expect(store.getItem(LEGACY_AI_KEY)).toContain('local-key');
  expect(store.getItem(LEGACY_AI_KEY)).not.toContain('legacy-key');
  session.uid = 'other';
  await expect(saveAiCredential('u', 'chat', 'openai', undefined, 'new-key', 0)).rejects.toThrow('compte connecté');
  expect(serverRequest).toHaveBeenCalledTimes(1);
});
it('does not upload ambiguous legacy keys for the same destination', async () => {
  const store = storage();
  captureLegacyAi({ provider: 'openai', apiKey: 'first' }, store);
  captureLegacyAi({ provider: 'openai', apiKey: 'second' }, store);
  await expect(migrateAiCredentials('u', store)).rejects.toThrow('diffèrent');
  expect(serverRequest).not.toHaveBeenCalled();
  expect(store.getItem(LEGACY_AI_KEY)).toContain('first');
  expect(store.getItem(LEGACY_AI_KEY)).toContain('second');
});
