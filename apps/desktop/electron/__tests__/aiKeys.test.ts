import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { AiKeyStore } from '../aiKeys';

// Reversible stand-in for the system keychain.
const cipher = { encrypt: (plain: string) => Buffer.from([...plain].reverse().join('')), decrypt: (sealed: Buffer) => [...sealed.toString()].reverse().join('') };
let file: string;
let store: AiKeyStore;

beforeEach(async () => {
  file = join(await mkdtemp(join(tmpdir(), 'skaitch-keys-')), 'ai-keys.json');
  store = new AiKeyStore(file, cipher);
});

it('stores keys encrypted, and only lists provider and origin', async () => {
  const listed = await store.set('anthropic', undefined, 'sk-ant-secret');
  expect(listed).toEqual([expect.objectContaining({ role: 'chat', provider: 'anthropic', origin: 'https://api.anthropic.com', version: 1 })]);
  expect(JSON.stringify(listed)).not.toContain('secret');
  expect(await readFile(file, 'utf8')).not.toContain('sk-ant-secret');
  expect(await new AiKeyStore(file, cipher).resolve('anthropic', undefined)).toEqual({ secret: 'sk-ant-secret', origins: ['https://api.anthropic.com'] });
});

it('gives a key only to the endpoint it was saved for', async () => {
  await store.set('openai', 'https://api.openai.com', 'sk-1');
  expect(await store.resolve('openai', 'https://evil.example')).toBeNull();
  expect(await store.resolve('anthropic', undefined)).toBeNull();
});

it('replaces and deletes keys', async () => {
  await store.set('openai', undefined, 'sk-1');
  const [replaced] = await store.set('openai', undefined, 'sk-2');
  expect(replaced.version).toBe(2);
  expect((await store.resolve('openai', undefined))?.secret).toBe('sk-2');
  expect(await store.set('openai', undefined, '')).toEqual([]);
  expect(await store.resolve('openai', undefined)).toBeNull();
});

it('rejects unknown providers and multi-line keys', async () => {
  await expect(store.set('evil', undefined, 'x')).rejects.toThrow(/inconnu/);
  await expect(store.set('openai', undefined, 'a\nb')).rejects.toThrow(/invalide/);
});
