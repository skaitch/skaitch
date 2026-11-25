import { auth } from './firebase';
import { findCredential, localAiEndpoint as localEndpoint } from '@skaitch/core/lib/aiCredentialTarget';
import type { AiConfig, ItemsMap } from '@skaitch/core/types/ifc';
import type { AiMessage, AiResult, ModelCapabilities, ConversationContext, ToolUse, ConversationResult } from '../types/ai';
import { serverRequest } from './serverRequest';
import { aiRequestUrl } from './aiRequestUrl';
import { providerHttpError } from './aiStream';
import { renderPrompt } from './renderPrompt';

function config(ai: AiConfig, render = false) {
  return { provider: ai.provider, model: ai.model, apiKey: '', apiKeyRef: findCredential(ai.credentials, 'chat', ai.provider, ai.baseUrl)?.id, temperature: ai.temperature, effort: ai.effort || undefined,
    baseUrl: ai.baseUrl, ...(render ? { visualizerProvider: ai.visualizerProvider, visualizerModel: ai.visualizerModel,
    visualizerApiKey: '', visualizerKeyRef: findCredential(ai.credentials, 'render', ai.visualizerProvider || 'pollinations', ai.visualizerBaseUrl || (ai.visualizerProvider === ai.provider ? ai.baseUrl : undefined))?.id, visualizerBaseUrl: ai.visualizerBaseUrl } : {}) };
}
const capabilities = new Map<string, ModelCapabilities>();
const capsKey = (provider: string, model: string, base?: string, key?: string) => JSON.stringify([auth.currentUser?.uid, provider, model, base, key]);
export async function discoverModelCapabilities(provider: string, model: string, apiKey: string, baseUrl?: string, _useCorsProxy?: boolean, apiKeyRef?: string, credentialVersion?: number): Promise<ModelCapabilities> {
  const key = capsKey(provider, model, baseUrl, `${apiKeyRef || ''}:${credentialVersion || 0}`);
  if (capabilities.has(key)) return capabilities.get(key)!;
  const fallback = { text: true, image: false, tools: false, thinking: false };
  if (localEndpoint(provider, baseUrl)) return fallback;
  try {
    const result = await (await serverRequest('/api/ai?operation=capabilities', { ai: { provider, model, apiKey: '', apiKeyRef, baseUrl, temperature: 0 } })).json();
    capabilities.set(key, result);
    return result;
  } catch { return fallback; }
}
export async function listAiModels(ai: AiConfig): Promise<string[]> {
  if (!localEndpoint(ai.provider, ai.baseUrl)) return (await serverRequest('/api/ai?operation=models', { ai: config(ai) })).json();
  const base = (ai.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
  const url = ai.provider === 'ollama' ? `${base.replace(/\/v1$/, '')}/api/tags` : `${base.replace(/\/v1$/, '')}/v1/models`;
  const response = await fetch(aiRequestUrl(url, ai.useCorsProxy), { headers: ai.apiKey ? { Authorization: `Bearer ${ai.apiKey}` } : {} });
  if (!response.ok) throw await providerHttpError('IA locale', response, ai.apiKey);
  const data = await response.json();
  return ai.provider === 'ollama' ? data.models?.map((m: any) => m.name) ?? [] : data.data?.map((m: any) => m.id) ?? [];
}
export async function fetchLlm(messages: AiMessage[], ai: AiConfig, system: string, image?: string | null,
  onChunk?: (text: string, thinking: boolean) => void, signal?: AbortSignal, context?: ConversationContext, round?: number, receipts?: string[]): Promise<AiResult> {
  const saved = findCredential(ai.credentials, 'chat', ai.provider, ai.baseUrl);
  const vision = capabilities.get(capsKey(ai.provider, ai.model, ai.baseUrl, `${saved?.id || ''}:${saved?.version || 0}`))?.image;
  if (localEndpoint(ai.provider, ai.baseUrl)) {
    const { localLlm } = await import('./localLlm');
    return localLlm(messages, ai, system, image, onChunk, signal, vision);
  }
  const response = await serverRequest('/api/ai?operation=chat', { ai: config(ai), messages: messages.map(({ role, content }) => ({ role, content })), system, image, vision, ...(context ? { context, round, receipts } : {}) }, signal);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '', result: AiResult | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.error) throw new Error(event.error);
    if (event.chunk !== undefined) onChunk?.(event.chunk, event.thinking === true);
    if (event.result) result = event.result;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
      for (const line of lines) consume(line);
      if (done) break;
    }
    if (buffer) consume(buffer);
    if (!result) throw new Error('Réponse IA interrompue.');
    return result;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function renderAi(args: Record<string, unknown>, items: ItemsMap, ai?: AiConfig) {
  const visualBase = ai?.visualizerBaseUrl || (ai?.provider === 'custom' ? ai.baseUrl : '') || 'http://localhost:11434';
  const visualKey = ai?.visualizerApiKey || (ai?.provider === 'custom' ? ai.apiKey : '');
  if (ai?.visualizerProvider === 'custom' && localEndpoint('custom', visualBase)) {
    const { finalPrompt, type, style, timeOfDay, aspect } = renderPrompt(args, items);
    const base = visualBase.replace(/\/$/, '').replace(/\/v1$/, '');
    const response = await fetch(aiRequestUrl(`${base}/v1/images/generations`, ai.useCorsProxy), {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(visualKey ? { Authorization: `Bearer ${visualKey}` } : {}) },
      body: JSON.stringify({ model: ai.visualizerModel || 'custom', prompt: finalPrompt, n: 1, size: aspect === '16:9' ? '1792x1024' : aspect === '4:3' ? '1024x768' : '1024x1024', response_format: 'b64_json' }),
    });
    if (!response.ok) throw await providerHttpError('IA locale', response, visualKey);
    const data = await response.json();
    const url = data.data?.[0]?.b64_json ? `data:image/png;base64,${data.data[0].b64_json}` : data.data?.[0]?.url;
    if (!url) throw new Error('Aucune image reçue.');
    return { success: true, type, url, prompt: finalPrompt, style: style || 'modern', time_of_day: timeOfDay || 'daylight', is_simulated: type === 'video', aspect_ratio: aspect };
  }
  return (await serverRequest('/api/ai?operation=render', { ai: ai ? config(ai, true) : { provider: 'gemini', model: '', apiKey: '', temperature: 0 }, args, items })).json();
}

export async function conversationIntent(context: ConversationContext, signal?: AbortSignal): Promise<{ name: string; args: Record<string, unknown> } | null> {
  return (await serverRequest('/api/ai?operation=conversation-intent', { context }, signal)).json();
}
export async function adjustConversation(context: ConversationContext, name: string, args: Record<string, unknown>, geom: unknown, remaining: ToolUse[], signal?: AbortSignal): Promise<ToolUse[]> {
  return (await serverRequest('/api/ai?operation=conversation-adjust', { context, name, args, geom, remaining }, signal)).json();
}
export async function fetchConversation(messages: AiMessage[], ai: AiConfig, context: ConversationContext, image?: string | null,
  onChunk?: (text: string, thinking: boolean) => void, signal?: AbortSignal, round = 0, receipts?: string[]): Promise<ConversationResult> {
  if (!localEndpoint(ai.provider, ai.baseUrl)) return fetchLlm(messages, ai, '', image, onChunk, signal, context, round, receipts) as Promise<ConversationResult>;
  const prepared = await (await serverRequest('/api/ai?operation=conversation-prepare', { context, messages, receipts }, signal)).json();
  const answer = await fetchLlm(prepared.messages, ai, prepared.system, image, onChunk, signal);
  return (await serverRequest('/api/ai?operation=conversation-finish', { answer, messages, round, receipts }, signal)).json();
}
