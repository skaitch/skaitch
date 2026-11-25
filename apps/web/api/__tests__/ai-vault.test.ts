import { beforeEach, expect, it, vi } from 'vitest';
const memory = vi.hoisted(() => ({ docs: new Map<string, any>(), queue: Promise.resolve() }));
vi.mock('../_lib/admin', () => {
  const snapshot = (path: string) => ({ id: path.split('/').at(-1), exists: memory.docs.has(path), data: () => structuredClone(memory.docs.get(path)) });
  return { getAdminDb: () => ({
    doc: (path: string) => ({ path, get: async () => snapshot(path) }),
    collection: (path: string) => ({ get: async () => ({ docs: [...memory.docs.keys()].filter(key => key.startsWith(path + '/')).map(snapshot) }) }),
    runTransaction: (callback: any) => {
      const pending = memory.queue.then(async () => {
        const writes: (() => void)[] = [];
        let writing = false;
        const result = await callback({
          get: async (ref: any) => { if (writing) throw new Error('Reads must precede writes'); return snapshot(ref.path); },
          set: (ref: any, data: unknown) => { writing = true; writes.push(() => memory.docs.set(ref.path, structuredClone(data))); },
          delete: (ref: any) => { writing = true; writes.push(() => memory.docs.delete(ref.path)); },
        });
        writes.forEach(write => write()); return result;
      });
      memory.queue = pending.catch(() => {});
      return pending;
    },
  }) };
});
import { aiCredentials, resolveAiCredentials } from '../../server/ai/vault';
const config = { provider: 'openai', model: 'm', apiKey: '', temperature: 0 };
const save = (uid = 'u', secret = 'real-secret-never-returned') => aiCredentials(uid, { action: 'save', role: 'chat', provider: 'openai', secret, expectedVersion: 0 }) as Promise<any>;
beforeEach(() => { memory.docs.clear(); memory.queue = Promise.resolve(); process.env.AI_VAULT_SECRET = 'test-vault-secret-at-least-thirty-two-characters'; });

it('encrypts at rest and returns only safe metadata, even when listing keys', async () => {
  const entry = await save();
  const stored = memory.docs.get(`users/u/ai_credentials/${entry.id}`);
  expect(stored.ciphertext).toMatch(/^ai-secret\./);
  expect(JSON.stringify(stored)).not.toContain('real-secret-never-returned');
  expect(entry).toEqual({ id: entry.id, role: 'chat', provider: 'openai', origin: 'https://api.openai.com', version: 1 });
  expect(await aiCredentials('u', { action: 'list' })).toEqual([entry]);
  const resolved = await resolveAiCredentials('u', { ...config, apiKeyRef: entry.id }, 'chat');
  expect(resolved.apiKey).toBe('real-secret-never-returned');
  expect(resolved.credentialOrigins).toEqual(['https://api.openai.com']);
});
it('isolates accounts and refuses copied ciphertext, modified destinations and roles', async () => {
  const entry = await save();
  await expect(resolveAiCredentials('other', { ...config, apiKeyRef: entry.id }, 'chat')).rejects.toMatchObject({ status: 404 });
  memory.docs.set(`users/other/ai_credentials/${entry.id}`, memory.docs.get(`users/u/ai_credentials/${entry.id}`));
  await expect(resolveAiCredentials('other', { ...config, apiKeyRef: entry.id }, 'chat')).rejects.toMatchObject({ status: 503 });
  await expect(resolveAiCredentials('u', { ...config, apiKeyRef: entry.id, baseUrl: 'https://evil.test' }, 'chat')).rejects.toMatchObject({ status: 403 });
  await expect(resolveAiCredentials('u', { ...config, provider: 'anthropic', apiKeyRef: entry.id }, 'chat')).rejects.toMatchObject({ status: 403 });
  const rendered = await resolveAiCredentials('u', { ...config, apiKeyRef: entry.id, visualizerProvider: 'openai' }, 'render');
  expect(rendered.visualizerApiKey).toBe('real-secret-never-returned');
  expect(rendered.visualizerCredentialOrigins).toEqual(['https://api.openai.com']);
  const renderOnly: any = await aiCredentials('u', { action: 'save', role: 'render', provider: 'openai', secret: 'render', expectedVersion: 0 });
  await expect(resolveAiCredentials('u', { ...config, apiKeyRef: renderOnly.id }, 'chat')).rejects.toMatchObject({ status: 403 });
});
it('checks versions before replacing or deleting a key and never accepts a raw cloud secret', async () => {
  const first = await save();
  const second: any = await aiCredentials('u', { action: 'save', role: 'chat', provider: 'openai', secret: 'replacement', expectedVersion: 1 });
  expect(second.version).toBe(2);
  await expect(aiCredentials('u', { action: 'save', role: 'chat', provider: 'openai', secret: 'stale', expectedVersion: 1 })).rejects.toMatchObject({ status: 409 });
  await expect(aiCredentials('u', { action: 'delete', id: first.id, expectedVersion: 1 })).rejects.toMatchObject({ status: 409 });
  await expect(resolveAiCredentials('u', { ...config, apiKey: 'inline-secret' }, 'chat')).rejects.toMatchObject({ status: 400 });
  await aiCredentials('u', { action: 'delete', id: second.id, expectedVersion: 2 });
  expect(await aiCredentials('u', { action: 'list' })).toEqual([]);
});
it('fails closed when encryption is missing, changed or tampered, independently of OAuth rotation', async () => {
  delete process.env.AI_VAULT_SECRET;
  await expect(save()).rejects.toMatchObject({ status: 503 });
  expect(memory.docs.size).toBe(0);
  process.env.AI_VAULT_SECRET = 'test-vault-secret-at-least-thirty-two-characters';
  const entry = await save();
  process.env.OAUTH_SECRET = 'rotated-oauth-secret-should-not-affect-vault';
  expect((await resolveAiCredentials('u', { ...config, apiKeyRef: entry.id }, 'chat')).apiKey).toBe('real-secret-never-returned');
  process.env.AI_VAULT_SECRET = 'another-vault-secret-at-least-thirty-two-characters';
  await expect(resolveAiCredentials('u', { ...config, apiKeyRef: entry.id }, 'chat')).rejects.toMatchObject({ status: 503 });
});
it('migrates atomically and leaves existing server keys unchanged on conflicts', async () => {
  const entries = [
    { role: 'chat', provider: 'openai', secret: 'legacy-one' },
    { role: 'chat', provider: 'anthropic', secret: 'legacy-two' },
  ];
  const migrated: any = await aiCredentials('u', { action: 'migrate', entries });
  expect(migrated).toHaveLength(2);
  expect(await aiCredentials('u', { action: 'migrate', entries })).toEqual(migrated);
  expect(JSON.stringify(migrated)).not.toContain('legacy-');
  await expect(aiCredentials('u', { action: 'migrate', entries: [{ ...entries[0], secret: 'different' }, { role: 'render', provider: 'fal', secret: 'new' }] })).rejects.toMatchObject({ status: 409 });
  expect(await aiCredentials('u', { action: 'list' })).toHaveLength(2);
  expect((await resolveAiCredentials('u', { ...config, apiKeyRef: migrated[0].id }, 'chat')).apiKey).toBe('legacy-one');
});
it('rejects malformed credentials and does not honor caller-supplied origin constraints', async () => {
  await expect(aiCredentials('u', { action: 'save', role: 'chat', provider: 'custom', baseUrl: 'http://localhost:1234', secret: 'x', expectedVersion: 0 })).rejects.toMatchObject({ status: 400 });
  await expect(aiCredentials('u', { action: 'save', role: 'chat', provider: 'openai', secret: 'x\r\ny', expectedVersion: 0 })).rejects.toMatchObject({ status: 400 });
  await expect(aiCredentials('u', { action: 'delete', id: '../other', expectedVersion: 0 })).rejects.toMatchObject({ status: 400 });
  const entry = await save();
  const resolved = await resolveAiCredentials('u', { ...config, apiKeyRef: entry.id, credentialOrigins: ['https://evil.test'] } as any, 'chat');
  expect(resolved.credentialOrigins).toEqual(['https://api.openai.com']);
});

it('refuses modified ciphertext without replacing the encrypted record', async () => {
  const entry = await save();
  const path = `users/u/ai_credentials/${entry.id}`;
  const stored = memory.docs.get(path);
  const chars = stored.ciphertext.split('');
  chars[30] = chars[30] === 'A' ? 'B' : 'A';
  const tampered = chars.join('');
  memory.docs.set(path, { ...stored, ciphertext: tampered });
  await expect(resolveAiCredentials('u', { ...config, apiKeyRef: entry.id }, 'chat')).rejects.toMatchObject({ status: 503 });
  expect(memory.docs.get(path).ciphertext).toBe(tampered);
});
