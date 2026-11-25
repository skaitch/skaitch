import type { AiConfig } from '@skaitch/core/types/ifc';
import type { AiMessage, ConversationContext, ConversationResult, ModelCapabilities, ToolUse } from '@skaitch/core/types/ai';

/** What the shared chat needs from the host's AI engine (web API, Electron main process). */
export interface AiService {
  fetchConversation(messages: AiMessage[], ai: AiConfig, context: ConversationContext, image?: string | null,
    onChunk?: (text: string, thinking: boolean) => void, signal?: AbortSignal, round?: number, receipts?: string[]): Promise<ConversationResult>;
  conversationIntent(context: ConversationContext, signal?: AbortSignal): Promise<{ name: string; args: Record<string, unknown> } | null>;
  adjustConversation(context: ConversationContext, name: string, args: Record<string, unknown>, geom: unknown, remaining: ToolUse[], signal?: AbortSignal): Promise<ToolUse[]>;
  discoverModelCapabilities(provider: string, model: string, apiKey: string, baseUrl?: string, useCorsProxy?: boolean, apiKeyRef?: string, credentialVersion?: number): Promise<ModelCapabilities>;
}

let service: AiService | null = null;

/** The host app registers its AI engine once, before the first render. */
export function provideAiService(next: AiService) {
  service = next;
}

function current(): AiService {
  if (!service) throw new Error('Moteur IA non configuré : appelez provideAiService au démarrage de l’application.');
  return service;
}

export const fetchConversation: AiService['fetchConversation'] = (...args) => current().fetchConversation(...args);
export const conversationIntent: AiService['conversationIntent'] = (...args) => current().conversationIntent(...args);
export const adjustConversation: AiService['adjustConversation'] = (...args) => current().adjustConversation(...args);
export const discoverModelCapabilities: AiService['discoverModelCapabilities'] = (...args) => current().discoverModelCapabilities(...args);
