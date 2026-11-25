import { localAiEndpoint } from '@skaitch/core/lib/aiCredentialTarget';
import { getAdminDb } from '../../api/_lib/admin.js';
import { InputError, record } from '@skaitch/core/bim/validation';
import { isAiEffort } from '@skaitch/core/types/ai';
import { aiPreferences, type AiPreferences, type SavedAiPreferences } from '../../src/lib/aiPreferences.js';

function validate(value: unknown): AiPreferences {
  const config = record(value);
  const fields = ['provider','model','temperature','effort','baseUrl','visualizerProvider','visualizerModel','visualizerBaseUrl'];
  if (Object.keys(config).some(field => !fields.includes(field))) throw new InputError('Les préférences IA ne doivent contenir que des réglages publics.');
  if (!['gemini','anthropic','openai','mistral','deepseek','qwen','openrouter','huggingface','custom','ollama'].includes(config.provider) || !['pollinations','gemini','openai','fal','replicate','huggingface','custom'].includes(config.visualizerProvider)) throw new InputError('Fournisseur IA invalide.');
  if (typeof config.temperature !== 'number' || !Number.isFinite(config.temperature) || config.temperature < 0 || config.temperature > 2) throw new InputError('Température IA invalide.');
  // Preferences saved before the effort setting existed have no such field.
  if (config.effort !== undefined && !isAiEffort(config.effort)) throw new InputError('Effort IA invalide.');
  for (const field of fields.filter(field => field !== 'temperature' && field !== 'effort')) if (typeof config[field] !== 'string' || config[field].length > 4096 || /[\r\n]/.test(config[field])) throw new InputError('Préférences IA invalides.');
  for (const field of ['baseUrl','visualizerBaseUrl']) {
    if (!config[field]) continue;
    try {
      const url = new URL(config[field]);
      const provider = field === 'baseUrl' ? config.provider : config.visualizerProvider;
      const local = localAiEndpoint(provider, config[field]);
      if (!['http:','https:'].includes(url.protocol) || !local && (url.protocol !== 'https:' || url.port && url.port !== '443') || url.username || url.password || url.search || url.hash) throw new Error();
    } catch { throw new InputError('URL IA invalide : n’y placez pas de clé ou d’identifiant.'); }
  }
  return aiPreferences(config);
}
export async function getAiPreferences(uid: string): Promise<SavedAiPreferences> {
  const snapshot = await getAdminDb().doc(`users/${uid}/metadata/ai`).get();
  if (!snapshot.exists) return { revision: 0, config: null };
  if (!Number.isSafeInteger(snapshot.data()!.revision) || snapshot.data()!.revision < 1) throw new InputError('Préférences IA illisibles.', 503);
  return { revision: snapshot.data()!.revision, config: validate(snapshot.data()!.config) };
}
export async function saveAiPreferences(uid: string, value: unknown, expectedRevision: unknown): Promise<SavedAiPreferences> {
  const config = validate(value);
  const ref = getAdminDb().doc(`users/${uid}/metadata/ai`);
  return getAdminDb().runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const revision = snapshot.data()?.revision ?? 0;
    if (!Number.isSafeInteger(expectedRevision) || revision !== expectedRevision) throw new InputError('Les préférences IA ont changé dans une autre session. Rechargez-les avant de les modifier.', 409);
    const stored = { config, revision: revision + 1 };
    tx.set(ref, stored);
    return stored;
  });
}
