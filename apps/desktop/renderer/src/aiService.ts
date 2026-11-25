import type { AiService } from '@skaitch/ui/lib/aiService';
import type { AiConfig } from '@skaitch/core/types/ifc';
import type { ModelCapabilities } from '@skaitch/core/types/ai';

/** Only public settings cross to the main process; it adds the stored key itself. */
export const publicAi = (ai: Pick<AiConfig, 'provider' | 'model' | 'baseUrl' | 'temperature' | 'effort'>) =>
  ({ provider: ai.provider, model: ai.model, baseUrl: ai.baseUrl || undefined, temperature: ai.temperature ?? 0, effort: ai.effort || undefined });

const capabilities = new Map<string, ModelCapabilities>();
const capsKey = (provider: string, model: string, baseUrl?: string, version?: number) => JSON.stringify([provider, model, baseUrl || '', version || 0]);

/** The desktop AI engine: the Electron main process, reached over IPC (electron/aiEngine.ts). */
export const desktopAiService: AiService = {
  async fetchConversation(messages, ai, context, image, onChunk, signal, round = 0, receipts) {
    const bridge = window.skaitchDesktop.ai;
    if (signal?.aborted) throw new DOMException(document.documentElement.lang === 'fr' ? 'Requête IA annulée.' : 'AI request cancelled.', 'AbortError');
    const requestId = crypto.randomUUID();
    const stop = bridge.onChunk(event => { if (event.requestId === requestId) onChunk?.(event.chunk, event.thinking); });
    const abort = () => { void bridge.abort(requestId); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const vision = capabilities.get(capsKey(ai.provider, ai.model, ai.baseUrl))?.image;
      return await bridge.chat(requestId, {
        ai: publicAi(ai), messages: messages.map(({ role, content }) => ({ role, content })),
        context, image, round, receipts, vision,
      });
    } finally {
      stop();
      signal?.removeEventListener('abort', abort);
    }
  },
  conversationIntent: context => window.skaitchDesktop.ai.request('conversation-intent', { context }),
  adjustConversation: (context, name, args, geom, remaining) => window.skaitchDesktop.ai.request('conversation-adjust', { context, name, args, geom, remaining }),
  async discoverModelCapabilities(provider, model, _apiKey, baseUrl) {
    const key = capsKey(provider, model, baseUrl);
    if (capabilities.has(key)) return capabilities.get(key)!;
    try {
      const result = await window.skaitchDesktop.ai.request<ModelCapabilities>('capabilities', { ai: publicAi({ provider, model, baseUrl, temperature: 0 } as AiConfig) });
      capabilities.set(key, result);
      return result;
    } catch {
      return { text: true, image: false, tools: false, thinking: false };
    }
  },
};
