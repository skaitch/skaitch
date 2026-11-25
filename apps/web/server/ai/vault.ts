import { createHash, timingSafeEqual } from 'node:crypto';
import { getAdminDb } from '../../api/_lib/admin.js';
import { seal, unseal } from '../../api/_lib/oauth.js';
import { credentialOrigin, type AiCredentialMeta, type AiCredentialRole } from '@skaitch/core/lib/aiCredentialTarget';
import type { AiConfig } from '@skaitch/core/types/ifc';
import { InputError, record } from '@skaitch/core/bim/validation';

export interface ServerAiConfig extends AiConfig { credentialOrigins?: string[]; visualizerCredentialOrigins?: string[] }
const chatProviders = ['gemini','anthropic','openai','mistral','deepseek','qwen','openrouter','huggingface','custom','ollama'];
const renderProviders = ['gemini','openai','fal','replicate','huggingface','custom'];
const ref = (uid: string, id: string) => getAdminDb().doc(`users/${uid}/ai_credentials/${id}`);
const metadata = (id: string, value: any): AiCredentialMeta => ({ id, role: value.role, provider: value.provider, origin: value.origin, version: value.version });
function descriptor(input: unknown) {
  const data = record(input);
  const role = data.role as AiCredentialRole;
  if (!['chat','render'].includes(role) || !(role === 'chat' ? chatProviders : renderProviders).includes(data.provider)) throw new InputError('Fournisseur de clé invalide.');
  if (data.baseUrl !== undefined && (typeof data.baseUrl !== 'string' || data.baseUrl.length > 4096)) throw new InputError('Destination de clé invalide.');
  let origin: string;
  try {
    origin = credentialOrigin(role, data.provider, data.baseUrl);
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.port && url.port !== '443') throw new Error();
    const source = data.baseUrl ? new URL(data.baseUrl) : null;
    if (source?.username || source?.password || source?.hash) throw new Error();
  } catch { throw new InputError('La clé cloud doit être associée à une destination HTTPS.'); }
  return { role, provider: data.provider as string, origin };
}
const idFor = (value: { role: string; provider: string; origin: string }) => createHash('sha256').update(JSON.stringify([value.role, value.provider, value.origin])).digest('hex');
function encrypt(uid: string, value: ReturnType<typeof descriptor>, secret: unknown) {
  if (typeof secret !== 'string' || !secret || secret.length > 4096 || /[\r\n]/.test(secret)) throw new InputError('Clé IA invalide.');
  try { return seal('ai-secret', { uid, ...value, secret }); }
  catch { throw new InputError('Chiffrement des clés IA non configuré sur le serveur.', 503); }
}
export async function aiCredentials(uid: string, data: Record<string, unknown>) {
  if (data.action === 'list') {
    const snapshots = await getAdminDb().collection(`users/${uid}/ai_credentials`).get();
    return snapshots.docs.map(snapshot => metadata(snapshot.id, snapshot.data()));
  }
  if (data.action === 'migrate') {
    if (!Array.isArray(data.entries) || !data.entries.length || data.entries.length > 32) throw new InputError('Liste de clés invalide.');
    const entries = data.entries.map(input => {
      const entry = record(input), value = descriptor(entry), id = idFor(value);
      return { id, ...value, ciphertext: encrypt(uid, value, entry.secret), version: 1 };
    });
    if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new InputError('Clés en double dans le transfert.');
    return getAdminDb().runTransaction(async tx => {
      const snapshots = await Promise.all(entries.map(entry => tx.get(ref(uid, entry.id))));
      const result = snapshots.map((snapshot, index) => {
        const entry = entries[index];
        if (!snapshot.exists) return metadata(entry.id, entry);
        const stored = snapshot.data()!;
        const previous = unseal<any>('ai-secret', stored.ciphertext);
        const incoming = unseal<any>('ai-secret', entry.ciphertext);
        if (!previous || !incoming || previous.uid !== uid || previous.role !== entry.role || previous.provider !== entry.provider || previous.origin !== entry.origin) throw new InputError('Clé existante illisible ; la copie locale est conservée.', 503);
        const before = Buffer.from(previous.secret), after = Buffer.from(incoming.secret);
        if (before.length !== after.length || !timingSafeEqual(before, after)) throw new InputError('Une autre clé est déjà enregistrée pour cette destination. Les anciennes clés locales sont conservées.', 409);
        return metadata(entry.id, stored);
      });
      entries.forEach((entry, index) => { if (!snapshots[index].exists) { const { id, ...stored } = entry; tx.set(ref(uid, id), stored); } });
      return result;
    });
  }
  if (data.action === 'save') {
    const value = descriptor(data), id = idFor(value), ciphertext = encrypt(uid, value, data.secret);
    return getAdminDb().runTransaction(async tx => {
      const snapshot = await tx.get(ref(uid, id));
      if (!Number.isSafeInteger(data.expectedVersion) || data.expectedVersion !== (snapshot.data()?.version ?? 0)) throw new InputError('Cette clé a changé dans une autre session. Rechargez les réglages.', 409);
      const stored = { ...value, ciphertext, version: Number(data.expectedVersion) + 1 };
      tx.set(ref(uid, id), stored);
      return metadata(id, stored);
    });
  }
  if (data.action === 'delete') {
    if (typeof data.id !== 'string' || !/^[a-f0-9]{64}$/.test(data.id)) throw new InputError('Identifiant de clé invalide.');
    await getAdminDb().runTransaction(async tx => {
      const snapshot = await tx.get(ref(uid, data.id as string));
      if (!snapshot.exists) throw new InputError('Clé introuvable.', 404);
      if (!Number.isSafeInteger(data.expectedVersion) || data.expectedVersion !== snapshot.data()!.version) throw new InputError('Cette clé a changé dans une autre session.', 409);
      tx.delete(ref(uid, data.id as string));
    });
    return { success: true };
  }
  throw new InputError('Opération de clé inconnue.');
}
function allowedOrigins(provider: string, origin: string) {
  return provider === 'huggingface' && ['https://router.huggingface.co','https://api-inference.huggingface.co'].includes(origin)
    ? ['https://router.huggingface.co','https://api-inference.huggingface.co','https://huggingface.co'] : [origin];
}
async function decrypt(uid: string, id: string, role: AiCredentialRole, provider: string, origin: string, allowChat = false) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new InputError('Identifiant de clé invalide.');
  const snapshot = await ref(uid, id).get();
  if (!snapshot.exists) throw new InputError('Clé IA introuvable. Enregistrez-la dans les réglages.', 404);
  const value = snapshot.data()!;
  if (value.provider !== provider || value.role !== role && !(allowChat && value.role === 'chat') || !allowedOrigins(provider, value.origin).includes(origin)) throw new InputError('La clé ne correspond pas à cette destination.', 403);
  const payload = unseal<{ uid: string; role: string; provider: string; origin: string; secret: string }>('ai-secret', value.ciphertext);
  if (!payload || payload.uid !== uid || payload.role !== value.role || payload.provider !== provider || payload.origin !== value.origin) throw new InputError('Clé IA illisible. Vérifiez la configuration de chiffrement du serveur.', 503);
  return { secret: payload.secret, origins: allowedOrigins(provider, value.origin) };
}
export async function resolveAiCredentials(uid: string, input: AiConfig, operation: string): Promise<ServerAiConfig> {
  // Never trust caller-supplied origin constraints or raw cloud secrets.
  if (input.apiKey || input.visualizerApiKey) throw new InputError('Enregistrez la clé cloud dans les réglages avant de l’utiliser.');
  const ai: ServerAiConfig = { provider: input.provider, model: input.model, temperature: input.temperature, effort: input.effort, apiKey: '', baseUrl: input.baseUrl,
    visualizerProvider: input.visualizerProvider, visualizerModel: input.visualizerModel, visualizerApiKey: '', visualizerBaseUrl: input.visualizerBaseUrl };
  if (operation !== 'render' && input.apiKeyRef) {
    const loaded = await decrypt(uid, input.apiKeyRef, 'chat', ai.provider, credentialOrigin('chat', ai.provider, ai.baseUrl));
    ai.apiKey = loaded.secret; ai.credentialOrigins = loaded.origins;
  }
  if (operation === 'render') {
    const provider = ai.visualizerProvider || 'pollinations';
    const base = ai.visualizerBaseUrl || (provider === ai.provider ? ai.baseUrl : undefined);
    const id = input.visualizerKeyRef || (provider === ai.provider ? input.apiKeyRef : undefined);
    if (id && provider !== 'pollinations') {
      const loaded = await decrypt(uid, id, 'render', provider, credentialOrigin('render', provider, base), provider === ai.provider);
      ai.visualizerApiKey = loaded.secret; ai.visualizerCredentialOrigins = loaded.origins;
    }
  }
  if (operation === 'chat' && !['custom','ollama'].includes(ai.provider) && !ai.apiKey) throw new InputError('Enregistrez une clé IA pour ce compte dans les réglages.');
  return ai;
}
