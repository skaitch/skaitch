import type { AiConfig } from '@skaitch/core/types/ifc';
import type { AiEffort } from '@skaitch/core/types/ai';
export interface AiPreferences {
  provider: string; model: string; temperature: number; effort: AiEffort | ''; baseUrl: string;
  visualizerProvider: string; visualizerModel: string; visualizerBaseUrl: string;
}
export interface SavedAiPreferences { revision: number; config: AiPreferences | null }
export function aiPreferences(ai: Partial<AiConfig>): AiPreferences {
  return { provider: ai.provider || 'gemini', model: ai.model || '', temperature: ai.temperature ?? 0, effort: ai.effort || '', baseUrl: ai.baseUrl || '',
    visualizerProvider: ai.visualizerProvider || 'pollinations', visualizerModel: ai.visualizerModel || '', visualizerBaseUrl: ai.visualizerBaseUrl || '' };
}
