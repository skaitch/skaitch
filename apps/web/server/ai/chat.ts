import type { ServerAiConfig as AiConfig } from './vault.js';
import type { AiMessage as Message, ToolUse } from '../../src/types/ai.js';
import { CHAT_TOOL_HINTS, getToolSchema } from '../../src/lib/aiTools.js';
import { readSSE } from '../../src/lib/aiStream.js';
import { upstreamError, upstreamFetch } from './upstream.js';
import { anthropicBase, anthropicModelInfo } from './capabilities.js';

/**
 * Output ceiling for one Claude round: the model's own cap from the Models API, held under a
 * client-side limit because the provider counts `max_tokens` against output rate limits upfront.
 * The fallback only applies when the Models API does not answer.
 */
const ANTHROPIC_MAX_TOKENS = 32000;
const ANTHROPIC_FALLBACK_MAX_TOKENS = 8192;
/**
 * Base URL of an OpenAI-compatible chat endpoint. The model list already calls `<origin>/v1/models`,
 * so a bare origin (https://integrate.api.nvidia.com) gets `/v1` too; Ollama always needs it.
 * A URL with its own path (…/openai/v1, …/compatible-mode/v1) is kept as entered.
 */
export function openAiCompatibleBase(provider: string, baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (/\/v\d+$/.test(trimmed)) return trimmed;
  if (provider === 'ollama') return `${trimmed}/v1`;
  try { return new URL(trimmed).pathname.replace(/\/+$/, '') === '' ? `${trimmed}/v1` : trimmed; }
  catch { return trimmed; }
}

export async function fetchLLM(
  messages: Message[],
  ai: AiConfig,
  system: string,
  image?: string | null,
  onChunk?: (text: string, isThinking: boolean) => void,
  signal?: AbortSignal,
  vision?: boolean,
): Promise<{ text: string; toolUses: ToolUse[] }> {
  const requestUpstream = (url: string, options: RequestInit) => upstreamFetch(url, options, ai.credentialOrigins);
  // ── Gemini ─────────────────────────────────────────────────────────────────
  if (ai.provider === 'gemini') {
    let url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ai.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(ai.apiKey)}`;
    const history = [
      { role: 'user', content: system },
      ...messages.filter(m => m.role !== 'tool'),
    ];
    const contents = history.map((m, idx) => {
      const parts: any[] = [{ text: m.content }];
      if (image && idx === history.length - 1 && m.role === 'user') {
        const mime = image.split(';')[0].split(':')[1];
        const data = image.split(',')[1];
        parts.push({ inline_data: { mime_type: mime, data } });
      }
      return { role: m.role === 'assistant' ? 'model' : 'user', parts };
    });

    const tools = [{
      functionDeclarations: CHAT_TOOL_HINTS.map(h => ({
        name: h.name,
        description: h.hint,
        parameters: geminiSchema(getToolSchema(h.name)),
      })),
    }];

    const res = await requestUpstream(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: ai.temperature,
          // Only an explicit effort is sent: without it the model keeps its own thinking default.
          ...(ai.effort ? { thinkingConfig: { thinkingLevel: ai.effort, includeThoughts: true } } : {}),
        },
        tools,
      }),
      signal,
    });
    if (!res.ok) {
      throw await upstreamError('Gemini API', res, ai.apiKey);
    }

    let text = '';
    let toolUses: ToolUse[] = [];

    await readSSE(res, (json) => {
      if (!json || json === '[DONE]') return;
      try {
        const data = JSON.parse(json);
        const parts = data.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (part.text) {
            if (part.thought) onChunk?.(part.text, true);
            else { text += part.text; onChunk?.(part.text, false); }
          }
          if (part.functionCall) {
            toolUses.push({
              id: part.functionCall.name,
              name: part.functionCall.name,
              input: part.functionCall.args || {},
            });
          }
        }
      } catch {}
    }, ai.apiKey);
    return { text, toolUses };
  }

  // ── Anthropic native API ───────────────────────────────────────────────────
  if (ai.provider === 'anthropic') {
    const url = `${anthropicBase(ai.baseUrl)}/v1/messages`;
    // The Models API decides thinking, effort and the output cap; the model name decides nothing.
    const info = await anthropicModelInfo(ai.model, ai.apiKey, ai.baseUrl, signal, ai.credentialOrigins);

    const msgs = messages
      .filter(m => m.role !== 'tool')
      .map((m, idx) => {
        let content: any = m.content ?? '';
        if (image && idx === messages.filter(x => x.role !== 'tool').length - 1 && m.role === 'user') {
          const mime = image.split(';')[0].split(':')[1];
          const imgData = image.split(',')[1];
          content = [
            { type: 'image', source: { type: 'base64', media_type: mime, data: imgData } },
            { type: 'text', text: m.content ?? '' },
          ];
        }
        return { role: m.role === 'assistant' ? 'assistant' : 'user', content };
      });

    const tools = CHAT_TOOL_HINTS.map(h => ({
      name: h.name,
      description: h.hint,
      input_schema: getToolSchema(h.name),
    }));

    const body: Record<string, unknown> = {
      model: ai.model,
      system,
      messages: msgs,
      max_tokens: info?.maxTokens ? Math.min(info.maxTokens, ANTHROPIC_MAX_TOKENS) : ANTHROPIC_FALLBACK_MAX_TOKENS,
      stream: true,
      tools,
    };
    if (info?.adaptiveThinking) {
      // Adaptive models size their own thinking; recent ones reject sampling parameters.
      body.thinking = { type: 'adaptive', display: 'summarized' };
      if (ai.effort) body.output_config = { effort: ai.effort };
    } else if (info) {
      body.temperature = ai.temperature;
      if (ai.effort) body.output_config = { effort: ai.effort };
    } else if (ai.effort) {
      // Unknown model: pass the user's effort and let the API say if the model lacks it.
      body.output_config = { effort: ai.effort };
    }

    const res = await requestUpstream(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ai.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      throw await upstreamError('Anthropic API', res, ai.apiKey);
    }

    let fullText = '';
    let toolUses: ToolUse[] = [];
    const blockTypes: Record<number, 'thinking' | 'text' | 'tool_use'> = {};
    const toolBlocks: Record<number, { id: string; name: string; input: any }> = {};

    await readSSE(res, (json) => {
      if (!json || json === '[DONE]') return;
      try {
        const ev = JSON.parse(json);
        if (ev.type === 'content_block_start') {
          const type = ev.content_block?.type ?? 'text';
          blockTypes[ev.index] = type === 'thinking' ? 'thinking' : type === 'tool_use' ? 'tool_use' : 'text';
          if (type === 'tool_use') {
            toolBlocks[ev.index] = {
              id: ev.content_block?.id ?? '',
              name: ev.content_block?.name ?? '',
              input: ev.content_block?.input && Object.keys(ev.content_block.input).length ? JSON.stringify(ev.content_block.input) : '',
            };
          }
        } else if (ev.type === 'content_block_delta') {
          const type = blockTypes[ev.index];
          if (type === 'thinking') {
            const chunk = ev.delta?.thinking ?? '';
            if (chunk) onChunk?.(chunk, true);
          } else if (type === 'tool_use') {
            const input = ev.delta?.partial_json ?? ev.delta?.input ?? '';
            if (input) {
              toolBlocks[ev.index].input += input;
            }
          } else {
            const chunk = ev.delta?.text ?? '';
            if (chunk) {
              fullText += chunk;
              onChunk?.(chunk, false);
            }
          }
        } else if (ev.type === 'content_block_stop' && blockTypes[ev.index] === 'tool_use') {
          const tb = toolBlocks[ev.index];
          try {
            toolUses.push({
              id: tb.id,
              name: tb.name,
              input: tb.input ? JSON.parse(tb.input) : {},
            });
          } catch {}
        }
      } catch {}
    }, ai.apiKey);
    return { text: fullText, toolUses };
  }

  // ── OpenAI-compatible (openai, mistral, openrouter, ollama, huggingface, custom) ─────────
  let baseUrl = '';
  if (ai.provider === 'openrouter') {
    baseUrl = 'https://openrouter.ai/api/v1';
  } else if (ai.provider === 'huggingface') {
    // HF Serverless Inference API — OpenAI-compatible router
    baseUrl = 'https://router.huggingface.co/v1';
  } else {
    baseUrl = ai.baseUrl || '';
    if (!baseUrl) {
      if (ai.provider === 'openai') baseUrl = 'https://api.openai.com/v1';
      if (ai.provider === 'mistral') baseUrl = 'https://api.mistral.ai/v1';
      if (ai.provider === 'deepseek') baseUrl = 'https://api.deepseek.com/v1';
      if (ai.provider === 'qwen') baseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
      if (ai.provider === 'ollama') baseUrl = 'http://localhost:11434/v1';
    } else {
      baseUrl = openAiCompatibleBase(ai.provider, baseUrl);
    }
  }
  let url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;

  const history = [
    { role: 'system', content: system },
    ...messages.filter(m => m.role !== 'tool'),
  ];
  // Check vision support via cache; fall back to name heuristic for providers with static caps
  const cachedCaps = vision === undefined ? undefined : { image: vision };
  const supportsVisionInApi = cachedCaps
    ? cachedCaps.image
    : ai.provider !== 'deepseek' || !/reasoner/.test(ai.model.toLowerCase());

  const msgs = history.map((m, idx) => {
    let content: any = m.content;
    if (image && supportsVisionInApi && idx === history.length - 1 && m.role === 'user') {
      content = [
        { type: 'text', text: m.content },
        { type: 'image_url', image_url: { url: image } },
      ];
    }
    return { role: m.role, content };
  });

  // Only send tools to providers that support them (not Ollama, not HuggingFace). Custom
  // endpoints get them too: the endpoint answers with a clear error if it cannot call tools.
  const supportsToolsInApi = ai.provider !== 'ollama' && ai.provider !== 'huggingface';
  const toolDefs = supportsToolsInApi ? CHAT_TOOL_HINTS.map(h => ({
    type: 'function',
    function: {
      name: h.name,
      description: h.hint,
      parameters: getToolSchema(h.name),
    },
  })) : [];

  const body: Record<string, unknown> = {
    model: ai.model,
    messages: msgs,
    // Reasoning models reject a custom temperature, so an explicit effort replaces it.
    ...(ai.effort ? { reasoning_effort: ai.effort } : { temperature: ai.temperature }),
    stream: true,
    ...(supportsToolsInApi && { tools: toolDefs }),
  };

  const res = await requestUpstream(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ai.apiKey ? { Authorization: `Bearer ${ai.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
      throw await upstreamError('AI API', res, ai.apiKey);
  }

  let fullText = '';
  let toolUses: ToolUse[] = [];
  const currentToolCalls: Record<number, { id: string; name: string; args: string }> = {};
  let isThinking = false; // Fallback for <think> tags

  await readSSE(res, (json) => {
    if (!json || json === '[DONE]') return;
    try {
      const parsed = JSON.parse(json);
      const choice = parsed.choices?.[0];
      const delta = choice?.delta;

      // Reasoning content (DeepSeek-R1 / OpenAI o1)
      if (delta?.reasoning_content) {
        onChunk?.(delta.reasoning_content, true);
      } else if (typeof delta?.reasoning === 'string' && delta.reasoning) {
        // OpenRouter streams reasoning under `reasoning`.
        onChunk?.(delta.reasoning, true);
      }

      // Text content
      if (delta?.content) {
        let content = delta.content;

        // Simple fallback for models that don't support reasoning_content
        // but send <think>...</think> in the main content (like local Ollama models)
        if (!isThinking && content.includes('<think>')) {
          const parts = content.split('<think>');
          if (parts[0]) {
            fullText += parts[0];
            onChunk?.(parts[0], false);
          }
          isThinking = true;
          content = parts[1] || '';
        }

        if (isThinking && content.includes('</think>')) {
          const parts = content.split('</think>');
          if (parts[0]) onChunk?.(parts[0], true);
          isThinking = false;
          content = parts[1] || '';
        }

        if (content) {
          if (isThinking) {
            onChunk?.(content, true);
          } else {
            fullText += content;
            onChunk?.(content, false);
          }
        }
      }

      // Tool calls (OpenAI format) - track by index for proper accumulation
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (tc.id || tc.function?.name) {
            currentToolCalls[idx] = {
              id: tc.id ?? currentToolCalls[idx]?.id ?? '',
              name: tc.function?.name ?? currentToolCalls[idx]?.name ?? '',
              args: currentToolCalls[idx]?.args ?? ''
            };
          }
          if (tc.function?.arguments) {
            currentToolCalls[idx].args += tc.function.arguments;
          }
        }
      }

      // Finalize tool calls when choice finishes
      if (choice?.finish_reason === 'tool_calls') {
        for (const toolCall of Object.values(currentToolCalls)) {
          if (toolCall.name && toolCall.args) {
            try {
              toolUses.push({
                id: toolCall.id,
                name: toolCall.name,
                input: JSON.parse(toolCall.args),
              });
            } catch (e) {

            }
          }
        }
      }
    } catch {}
  }, ai.apiKey);
  return { text: fullText, toolUses };
}

/**
 * Gemini accepts only an OpenAPI subset for tool parameters: every other key
 * (additionalProperties, exclusiveMinimum, $schema…) is dropped, and enums must be strings.
 */
const GEMINI_SCHEMA_KEYS = new Set(['type', 'format', 'title', 'description', 'nullable', 'enum', 'properties', 'required', 'items', 'minItems', 'maxItems', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'anyOf', 'propertyOrdering']);
export function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue;
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, geminiSchema(child)]));
    } else out[key] = geminiSchema(value);
  }
  if (Array.isArray(out.enum)) {
    out.enum = out.enum.filter(v => v !== null).map(String);
    out.type = 'string';
  }
  return out;
}
