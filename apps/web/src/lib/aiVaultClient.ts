import type { AiPreferences, SavedAiPreferences } from './aiPreferences';
import { auth } from './firebase';
import { serverRequest } from './serverRequest';
import type { AiConfig } from '@skaitch/core/types/ifc';
import { credentialOrigin, localAiEndpoint, type AiCredentialMeta, type AiCredentialRole } from '@skaitch/core/lib/aiCredentialTarget';

export const LEGACY_AI_KEY = 'skaitch:legacy-ai-keys';
export function publicAiConfig(ai: Partial<AiConfig> = {}) {
  const { apiKey, apiKeys, visualizerApiKey, apiKeyRef, visualizerKeyRef, credentials, preferencesRevision, savedPreferencesSignature, ...safe } = ai;
  return { ...safe, apiKey: '' };
}
const hasSecrets = (ai: Partial<AiConfig>) => !!(ai.apiKey || ai.visualizerApiKey || Object.values(ai.apiKeys || {}).some(Boolean));
export function captureLegacyAi(ai: Partial<AiConfig> = {}, storage: Storage = localStorage) {
  if (!hasSecrets(ai)) return;
  const records: Partial<AiConfig>[] = JSON.parse(storage.getItem(LEGACY_AI_KEY) || '[]');
  const record = { provider: ai.provider, apiKey: ai.apiKey, apiKeys: ai.apiKeys, baseUrl: ai.baseUrl, baseUrls: ai.baseUrls,
    visualizerProvider: ai.visualizerProvider, visualizerBaseUrl: ai.visualizerBaseUrl, visualizerApiKey: ai.visualizerApiKey };
  if (!records.some(value => JSON.stringify(value) === JSON.stringify(record))) {
    if (records.length >= 32) throw new Error('Trop de configurations anciennes à transférer.');
    storage.setItem(LEGACY_AI_KEY, JSON.stringify([...records, record]));
  }
}
function requireAccount(uid: string) {
  if (auth.currentUser?.uid !== uid) throw new Error('Le compte connecté a changé. Rouvrez les réglages.');
}
export async function listAiCredentials(uid: string): Promise<AiCredentialMeta[]> {
  requireAccount(uid);
  const result = await (await serverRequest('/api/ai?operation=credentials', { action: 'list' })).json();
  requireAccount(uid);
  return result;
}
export async function saveAiCredential(uid: string, role: AiCredentialRole, provider: string, baseUrl: string | undefined, secret: string, expectedVersion: number): Promise<AiCredentialMeta> {
  requireAccount(uid);
  const result = await (await serverRequest('/api/ai?operation=credentials', { action: 'save', role, provider, baseUrl, secret, expectedVersion })).json();
  requireAccount(uid);
  return result;
}
export async function deleteAiCredential(uid: string, entry: AiCredentialMeta) {
  requireAccount(uid);
  await serverRequest('/api/ai?operation=credentials', { action: 'delete', id: entry.id, expectedVersion: entry.version });
  requireAccount(uid);
}
export function legacyAiRecords(storage: Storage = localStorage): Partial<AiConfig>[] {
  return JSON.parse(storage.getItem(LEGACY_AI_KEY) || '[]');
}
export function legacyAiEntries(storage: Storage = localStorage) {
  const snapshot = storage.getItem(LEGACY_AI_KEY);
  const records: Partial<AiConfig>[] = JSON.parse(snapshot || '[]');
  const entries: { role: AiCredentialRole; provider: string; baseUrl?: string; secret: string }[] = [];
  for (const ai of records) {
    const keys = Object.entries(ai.apiKeys || {});
    if (ai.provider && ai.apiKey) keys.push([ai.provider, ai.apiKey]);
    for (const [provider, secret] of keys) {
      const baseUrl = provider === ai.provider ? ai.baseUrl : ai.baseUrls?.[provider];
      if (secret && !localAiEndpoint(provider, baseUrl)) entries.push({ role: 'chat', provider, baseUrl, secret });
    }
    if (ai.visualizerApiKey && ai.visualizerProvider && !localAiEndpoint(ai.visualizerProvider, ai.visualizerBaseUrl || (ai.visualizerProvider === 'custom' ? 'http://localhost:11434' : undefined))) entries.push({ role: 'render', provider: ai.visualizerProvider, baseUrl: ai.visualizerBaseUrl, secret: ai.visualizerApiKey });
  }
  const unique = new Map<string, typeof entries[number]>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.role, entry.provider, credentialOrigin(entry.role, entry.provider, entry.baseUrl)]);
    if (unique.has(key) && unique.get(key)!.secret !== entry.secret) throw new Error('Plusieurs anciennes clés diffèrent pour une même destination. Conservez la copie locale et enregistrez la clé choisie manuellement.');
    unique.set(key, entry);
  }
  return { snapshot, records, entries: [...unique.values()] };
}
export async function migrateAiCredentials(uid: string, storage: Storage = localStorage): Promise<AiCredentialMeta[]> {
  requireAccount(uid);
  const { snapshot, records, entries } = legacyAiEntries(storage);
  if (!entries.length) throw new Error('Aucune ancienne clé cloud à transférer. Les clés des endpoints locaux restent sur ce poste.');
  const result: AiCredentialMeta[] = await (await serverRequest('/api/ai?operation=credentials', { action: 'migrate', entries })).json();
  requireAccount(uid);
  if (!Array.isArray(result) || entries.some(entry => !result.some(saved => saved.role === entry.role && saved.provider === entry.provider && saved.origin === credentialOrigin(entry.role, entry.provider, entry.baseUrl) && /^[a-f0-9]{64}$/.test(saved.id) && Number.isSafeInteger(saved.version) && saved.version > 0))) throw new Error('Le serveur n’a pas confirmé toutes les clés ; la copie locale est conservée.');
  if (storage.getItem(LEGACY_AI_KEY) !== snapshot) throw new Error('La copie locale a changé pendant le transfert ; elle est conservée.');
  const matches = (role: AiCredentialRole, provider: string, baseUrl: string | undefined, secret: string | undefined) => entries.some(entry => entry.role === role && entry.provider === provider && entry.secret === secret && credentialOrigin(role, provider, baseUrl) === credentialOrigin(role, provider, entry.baseUrl));
  const remaining = records.map(ai => {
    const copy = { ...ai, apiKeys: { ...ai.apiKeys } };
    for (const [provider, secret] of Object.entries(copy.apiKeys)) if (matches('chat', provider, provider === ai.provider ? ai.baseUrl : ai.baseUrls?.[provider], secret)) delete copy.apiKeys[provider];
    if (ai.provider && matches('chat', ai.provider, ai.baseUrl, ai.apiKey)) copy.apiKey = '';
    if (ai.visualizerProvider && matches('render', ai.visualizerProvider, ai.visualizerBaseUrl, ai.visualizerApiKey)) copy.visualizerApiKey = '';
    return copy;
  }).filter(hasSecrets);
  if (remaining.length) storage.setItem(LEGACY_AI_KEY, JSON.stringify(remaining)); else storage.removeItem(LEGACY_AI_KEY);
  return result;
}

export async function getAiPreferences(uid: string): Promise<SavedAiPreferences> {
  requireAccount(uid);
  const result = await (await serverRequest('/api/ai?operation=preferences', { action: 'get' })).json();
  requireAccount(uid);
  return result;
}
export async function saveAiPreferences(uid: string, config: AiPreferences, expectedRevision: number): Promise<SavedAiPreferences> {
  requireAccount(uid);
  const result = await (await serverRequest('/api/ai?operation=preferences', { action: 'set', config, expectedRevision })).json();
  requireAccount(uid);
  return result;
}
