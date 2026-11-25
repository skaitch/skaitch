import type { ServerAiConfig as AiConfig } from './vault.js';
import { upstreamError, upstreamFetch } from './upstream.js';

export async function listAiModels(ai: AiConfig, signal?: AbortSignal): Promise<string[]> {
  const defaults: Record<string, string> = { openai: 'https://api.openai.com', anthropic: 'https://api.anthropic.com', qwen: 'https://dashscope.aliyuncs.com/compatible-mode', openrouter: 'https://openrouter.ai/api', mistral: 'https://api.mistral.ai', deepseek: 'https://api.deepseek.com' };
  let base = (ai.baseUrl || defaults[ai.provider] || '').replace(/\/$/, '');
  const headers: Record<string, string> = {};
  if (ai.apiKey) headers.Authorization = `Bearer ${ai.apiKey}`;
  let url: string;
  if (ai.provider === 'gemini') {
    // Google reads a Bearer header as an OAuth token and rejects API keys there (HTTP 401).
    delete headers.Authorization;
    headers['x-goog-api-key'] = ai.apiKey;
    url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000';
  }
  else if (ai.provider === 'huggingface') url = 'https://huggingface.co/api/models?pipeline_tag=text-generation&inference=warm&sort=likes&direction=-1&limit=80&filter=conversational';
  else if (ai.provider === 'ollama') url = `${base.replace(/\/v1$/, '')}/api/tags`;
  else {
    if (base.endsWith('/v1')) base = base.slice(0, -3);
    url = `${base}/v1/models`;
    if (ai.provider === 'anthropic') {
      delete headers.Authorization;
      headers['x-api-key'] = ai.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    }
  }
  const response = await upstreamFetch(url, { headers, signal }, ai.credentialOrigins);
  if (!response.ok) throw await upstreamError('HTTP', response, ai.apiKey);
  const data = await response.json();
  const models = ai.provider === 'ollama' ? data.models?.map((m: any) => m.name) : ai.provider === 'gemini' ? data.models?.map((m: any) => m.name.split('/').pop())
    : ai.provider === 'huggingface' ? (Array.isArray(data) ? data : []).map(m => m.modelId || m.id)
    : (data.data || data.models)?.map((m: any) => m.id);
  return (models ?? []).filter((model: unknown) => typeof model === 'string');
}
