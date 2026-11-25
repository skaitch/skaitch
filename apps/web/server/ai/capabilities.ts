import type { ModelCapabilities } from '../../src/types/ai.js';
import { AI_EFFORTS, type AiEffort } from '@skaitch/core/types/ai';
import { upstreamFetch } from './upstream.js';

/** What Anthropic's Models API says about one model: the request is shaped from this, never from its name. */
export interface AnthropicModelInfo { adaptiveThinking: boolean; effort: AiEffort[]; maxTokens?: number; image: boolean }
const anthropicModels = new Map<string, Promise<AnthropicModelInfo | null>>();
export const anthropicBase = (baseUrl?: string) => (baseUrl || 'https://api.anthropic.com').replace(/\/$/, '').replace(/\/v1$/, '');

/** Reads GET /v1/models/{id} once per process and model; null when the API does not answer. */
export function anthropicModelInfo(model: string, apiKey: string, baseUrl?: string, signal?: AbortSignal, allowedOrigins?: readonly string[]): Promise<AnthropicModelInfo | null> {
  const key = JSON.stringify([anthropicBase(baseUrl), model]);
  const cached = anthropicModels.get(key);
  if (cached) return cached;
  const pending = (async () => {
    const res = await upstreamFetch(`${anthropicBase(baseUrl)}/v1/models/${encodeURIComponent(model)}`, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, signal,
    }, allowedOrigins);
    if (!res.ok) return null;
    const data: any = await res.json();
    const caps = data?.capabilities ?? {};
    return {
      adaptiveThinking: caps.thinking?.types?.adaptive?.supported === true,
      effort: caps.effort?.supported === true ? AI_EFFORTS.filter(level => caps.effort?.[level]?.supported === true) : [],
      maxTokens: Number.isSafeInteger(data?.max_tokens) && data.max_tokens > 0 ? data.max_tokens : undefined,
      image: caps.image_input?.supported === true,
    };
  })().catch(() => null);
  anthropicModels.set(key, pending);
  // A failed lookup is retried on the next request instead of being remembered.
  pending.then(info => { if (!info) anthropicModels.delete(key); });
  return pending;
}

export async function discoverModelCapabilities(
  provider: string,
  model: string,
  apiKey: string,
  baseUrl?: string,
  signal?: AbortSignal,
  allowedOrigins?: readonly string[]
): Promise<ModelCapabilities> {
  try {
    let url = '';
    const headers: Record<string, string> = {};
    const encodedModel = encodeURIComponent(model);

    switch (provider) {
      case 'openai':
        url = `${(baseUrl || 'https://api.openai.com').replace(/\/$/, '').replace(/\/v1$/, '')}/v1/models/${encodedModel}`;
        headers['Authorization'] = `Bearer ${apiKey}`;
        break;
      case 'qwen':
        url = baseUrl ? `${baseUrl}/models/${encodedModel}` : `https://dashscope.aliyuncs.com/compatible-mode/v1/models/${encodedModel}`;
        headers['Authorization'] = `Bearer ${apiKey}`;
        break;
      case 'anthropic': {
        // Every Claude model calls tools; the rest comes from the Models API.
        const info = await anthropicModelInfo(model, apiKey, baseUrl, signal, allowedOrigins);
        if (!info) return { text: true, image: false, tools: true, thinking: false };
        return { text: true, image: info.image, tools: true, thinking: info.adaptiveThinking, effort: info.effort };
      }
      case 'mistral':
        url = `${(baseUrl || 'https://api.mistral.ai').replace(/\/$/, '').replace(/\/v1$/, '')}/v1/models/${encodedModel}`;
        headers['Authorization'] = `Bearer ${apiKey}`;
        break;
      case 'openrouter':
        url = `https://openrouter.ai/api/v1/models`;
        headers['Authorization'] = `Bearer ${apiKey}`;
        break;
      case 'gemini':
        url = `https://generativelanguage.googleapis.com/v1beta/models/${encodedModel}?key=${apiKey}`;
        break;
      case 'huggingface':
        url = `https://huggingface.co/api/models/${encodedModel}`;
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        break;
      case 'deepseek': {
        const lowModel = model.toLowerCase();
        const isReasoner = /reasoner/.test(lowModel);
        const caps = {
          text: true,
          image: !isReasoner,
          tools: !isReasoner,
          thinking: isReasoner,
        };
        return caps;
      }
      default:
        return { text: true, image: false, tools: false, thinking: false };
    }


    const res = await upstreamFetch(url, { headers, signal }, allowedOrigins);
    if (!res.ok) return { text: true, image: false, tools: false, thinking: false };

    const data = await res.json();
    let modelData: any;

    if (provider === 'openrouter') {
      modelData = data.data?.find((m: any) => m.id === model);
      if (!modelData) {
        return { text: true, image: false, tools: false, thinking: false };
      }
    } else {
      modelData = data;
    }

    const input_modalities = modelData?.architecture?.input_modalities || [];
    const output_modalities = modelData?.architecture?.output_modalities || [];
    const supported_params: string[] = modelData?.supported_parameters || [];
    const lowModel = model.toLowerCase();

    // Hugging Face: parse model card tags
    if (provider === 'huggingface') {
      const tags: string[] = modelData?.tags || [];
      const pipelineTag: string = modelData?.pipeline_tag || '';
      const hasVision = tags.some((t: string) => /vision|visual|multimodal|image/.test(t)) || /vision|visual|llava|idefics/.test(lowModel);
      const hasThinking = /deepseek-r1|qwq|reasoning/.test(lowModel);
      const caps = {
        text: pipelineTag === 'text-generation' || pipelineTag === 'conversational' || true,
        image: hasVision,
        tools: false, // very few HF models support OpenAI-style tool calling natively
        thinking: hasThinking,
      };
      return caps;
    }

    const caps = {
      text: output_modalities.length === 0 || output_modalities.includes('text'),
      image: input_modalities.includes('image') || input_modalities.includes('vision') ||
             /vision|flash|gpt-4o|claude-3|gemini-/.test(lowModel),
      tools: supported_params.includes('tools') ||
             !!(modelData?.capabilities?.function_calling || modelData?.function_calling_enabled) ||
             /gpt-4|gpt-3.5|claude-3|gemini-/.test(lowModel),
      thinking: supported_params.includes('thinking') ||
                !!(modelData?.capabilities?.thinking) || modelData?.thinking === true ||
                output_modalities.includes('thinking') ||
                /thinking|o1|deepseek-r1|reasoning/.test(lowModel),
    };
    return caps;
  } catch (e) {
    const defaultCaps = { text: true, image: false, tools: false, thinking: false };
    return defaultCaps;
  }
}
