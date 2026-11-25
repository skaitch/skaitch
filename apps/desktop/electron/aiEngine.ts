// The web app's AI engine (apps/web/server/ai), run in the Electron main process instead of
// a server: same prompts, providers and conversation protocol, keys from the local store.
import { fetchLLM } from '../../web/server/ai/chat';
import { buildConversationPrompt, conversationContext, conversationMessages, finishConversation, parseIntent, propagateModifications } from '../../web/server/ai/conversation';
import { listAiModels } from '../../web/server/ai/models';
import { discoverModelCapabilities } from '../../web/server/ai/capabilities';
import type { ServerAiConfig } from '../../web/server/ai/vault';
import { localLlm } from '../../web/src/lib/localLlm';
import { providerHttpError } from '../../web/src/lib/aiStream';
import { localAiEndpoint } from '@skaitch/core/lib/aiCredentialTarget';
import { InputError, finiteData, record } from '@skaitch/core/bim/validation';
import type { AiConfig } from '@skaitch/core/types/ifc';
import { isAiEffort, type AiMessage, type AiResult, type ModelCapabilities } from '@skaitch/core/types/ai';
import type { AiKeyStore } from './aiKeys';

import { tr } from './lang';

export const AI_OPERATIONS = ['chat', 'models', 'capabilities', 'test', 'conversation-intent', 'conversation-adjust'] as const;
export type AiOperation = typeof AI_OPERATIONS[number];
const PROVIDERS = ['gemini', 'anthropic', 'openai', 'mistral', 'deepseek', 'qwen', 'openrouter', 'huggingface', 'custom', 'ollama'];
const MAX_ROUNDS = 50;

export interface AiEngineDeps {
  keys: Pick<AiKeyStore, 'resolve'>;
  /** Tests replace the provider calls. */
  fetchLLM?: typeof fetchLLM;
  localLlm?: typeof localLlm;
  capabilities?: typeof discoverModelCapabilities;
}

/** Same checks as the web API (api/ai.ts): only public settings, never a raw key. */
function validateConfig(value: unknown): AiConfig {
  const ai = record(value);
  if (!PROVIDERS.includes(ai.provider)) throw new InputError(tr('Fournisseur IA inconnu.', 'Unknown AI provider.'));
  for (const field of ['model', 'baseUrl']) {
    if (ai[field] !== undefined && (typeof ai[field] !== 'string' || ai[field].length > 4096 || /[\r\n]/.test(ai[field]))) throw new InputError(tr('Configuration IA invalide.', 'Invalid AI settings.'));
  }
  if (typeof ai.model !== 'string' || !ai.model) throw new InputError(tr('Choisissez un modèle IA dans les réglages.', 'Choose an AI model in the settings.'));
  const temperature = typeof ai.temperature === 'number' ? ai.temperature : 0;
  if (temperature < 0 || temperature > 2) throw new InputError(tr('Température IA invalide.', 'Invalid AI temperature.'));
  if (ai.effort !== undefined && !isAiEffort(ai.effort)) throw new InputError(tr('Effort IA invalide.', 'Invalid AI effort.'));
  return { provider: ai.provider, model: ai.model, baseUrl: ai.baseUrl || undefined, temperature, effort: ai.effort || undefined, apiKey: '' } as AiConfig;
}

/** Fills in the stored key; cloud providers need one, local ones (Ollama, LM Studio…) may not. */
async function withKey(input: unknown, deps: AiEngineDeps, requireKey: boolean): Promise<ServerAiConfig> {
  const ai: ServerAiConfig = validateConfig(input);
  const local = localAiEndpoint(ai.provider, ai.baseUrl);
  const stored = await deps.keys.resolve(ai.provider, ai.baseUrl);
  if (stored) { ai.apiKey = stored.secret; if (!local) ai.credentialOrigins = stored.origins; }
  else if (requireKey && !local) throw new InputError(tr('Enregistrez une clé pour ce fournisseur dans Réglages → Intelligence Artificielle.', 'Save a key for this provider in Settings → AI.'));
  return ai;
}

function validateMessages(messages: unknown): AiMessage[] {
  if (!Array.isArray(messages) || messages.length > 1000 || messages.some((m: any) => !m || !['user', 'assistant', 'tool'].includes(m.role) || m.content !== undefined && typeof m.content !== 'string')) throw new InputError('Messages IA invalides.');
  return messages as AiMessage[];
}

async function localModels(ai: AiConfig, signal?: AbortSignal): Promise<string[]> {
  const base = (ai.baseUrl || 'http://localhost:11434').replace(/\/$/, '').replace(/\/v1$/, '');
  const url = ai.provider === 'ollama' ? `${base}/api/tags` : `${base}/v1/models`;
  const response = await fetch(url, { headers: ai.apiKey ? { Authorization: `Bearer ${ai.apiKey}` } : {}, signal });
  if (!response.ok) throw await providerHttpError('IA locale', response, ai.apiKey);
  const data: any = await response.json();
  return ai.provider === 'ollama' ? data.models?.map((m: any) => m.name) ?? [] : data.data?.map((m: any) => m.id) ?? [];
}

/** One conversation round: the engine builds the prompt, calls the model and reads its tool calls. */
export async function chat(input: unknown, deps: AiEngineDeps, onChunk: (chunk: string, thinking: boolean) => void, signal?: AbortSignal) {
  const data = record(input);
  finiteData(data);
  const ai = await withKey(data.ai, deps, true);
  if (!Number.isInteger(data.round) || data.round < 0 || data.round >= MAX_ROUNDS) throw new InputError('Limite de conversation atteinte.');
  if (data.image != null && (typeof data.image !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/.test(data.image))) throw new InputError('Image IA invalide.');
  const system = buildConversationPrompt(conversationContext(data.context));
  const messages = conversationMessages(validateMessages(data.messages), data.receipts);
  const vision = typeof data.vision === 'boolean' ? data.vision : undefined;
  const answer: AiResult = localAiEndpoint(ai.provider, ai.baseUrl)
    ? await (deps.localLlm ?? localLlm)(messages, ai, system, data.image, onChunk, signal, vision)
    : await (deps.fetchLLM ?? fetchLLM)(messages, ai, system, data.image, onChunk, signal, vision);
  return finishConversation(answer, messages, data.round);
}

/** The other AI operations: quick JSON in, JSON out. */
export async function runAiOperation(operation: string, input: unknown, deps: AiEngineDeps, signal?: AbortSignal): Promise<unknown> {
  const data = record(input);
  finiteData(data);
  switch (operation) {
    case 'models': {
      const ai = await withKey(data.ai, deps, false);
      return localAiEndpoint(ai.provider, ai.baseUrl) ? localModels(ai, signal) : listAiModels(ai, signal);
    }
    case 'capabilities': {
      const fallback: ModelCapabilities = { text: true, image: false, tools: false, thinking: false };
      const ai = await withKey(data.ai, deps, false);
      if (localAiEndpoint(ai.provider, ai.baseUrl) || !ai.apiKey) return fallback;
      return discoverModelCapabilities(ai.provider, ai.model, ai.apiKey, ai.baseUrl, signal, ai.credentialOrigins);
    }
    case 'test': {
      // Sends a tiny prompt with the saved key: proves the provider, URL, key and model answer.
      const ai = await withKey(data.ai, deps, true);
      const local = localAiEndpoint(ai.provider, ai.baseUrl);
      const started = Date.now();
      const messages: AiMessage[] = [{ role: 'user', content: 'Reply with the single word OK.' }];
      const answer = local
        ? await (deps.localLlm ?? localLlm)(messages, ai, 'You are a connection test.', undefined, () => {}, signal)
        : await (deps.fetchLLM ?? fetchLLM)(messages, ai, 'You are a connection test.', undefined, () => {}, signal);
      const ms = Date.now() - started;
      const caps: ModelCapabilities = local || !ai.apiKey
        ? { text: true, image: false, tools: false, thinking: false }
        : await (deps.capabilities ?? discoverModelCapabilities)(ai.provider, ai.model, ai.apiKey, ai.baseUrl, signal, ai.credentialOrigins).catch(() => ({ text: true, image: false, tools: false, thinking: false }));
      return { ms, reply: String(answer.text ?? '').trim().slice(0, 80), image: caps.image, tools: caps.tools };
    }
    case 'conversation-intent': {
      const context = conversationContext(data.context);
      return parseIntent(context.finalTxt, context.items, context.focusStorey, context.lang, context.selection);
    }
    case 'conversation-adjust': {
      const context = conversationContext(data.context);
      if (typeof data.name !== 'string' || !Array.isArray(data.remaining) || data.remaining.length > 1000 || data.remaining.some((tool: any) => !tool || typeof tool.name !== 'string' || !tool.input || typeof tool.input !== 'object')) throw new InputError('Lot IA invalide.');
      propagateModifications(data.name, record(data.args), record(data.geom), data.remaining, context.items, context.focusStorey);
      return data.remaining;
    }
    default:
      throw new InputError(tr('Opération IA inconnue.', 'Unknown AI operation.'));
  }
}
