import type { AiConfig } from '@skaitch/core/types/ifc';
import type { AiMessage as Message, ToolUse } from '../types/ai';
import { TOOL_HINTS } from './aiTools';
import { LOAD_TOOLS, MAX_DISCOVERY_PASSES, MAX_OUTPUT_TOKENS, loadToolsDef, requestedNames, splitKnown, textLoadToolsCall, textToolNames, toolDef, toolsForRequest, toolsUsedInHistory, withDiscovery } from './toolDiscovery';
import { providerHttpError, readSSE } from './aiStream';
import { aiRequestUrl } from './aiRequestUrl';
export async function localLlm(messages: Message[], ai: AiConfig, system: string, image?: string | null, onChunk?: (text: string, thinking: boolean) => void, signal?: AbortSignal, vision?: boolean) {
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
    } else if (ai.provider === 'ollama' && !/\/v1\/?$/.test(baseUrl)) {
      // If baseUrl doesn't include /v1, append it
      baseUrl = baseUrl.replace(/\/$/, '') + '/v1';
    }
  }
  let url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
  url = aiRequestUrl(url, ai.useCorsProxy);

  // Only send tools to providers that support them (not Ollama, not HuggingFace). Custom
  // endpoints get them too: the endpoint answers with a clear error if it cannot call tools.
  const supportsToolsInApi = ai.provider !== 'ollama' && ai.provider !== 'huggingface';
  // Local endpoints usually serve small models with short contexts and slow prompt reading:
  // send a tool catalogue and load the schemas on demand instead of all of them up front.
  const progressive = supportsToolsInApi;

  const history = [
    { role: 'system', content: progressive ? withDiscovery(system) : system },
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

  const allToolDefs = supportsToolsInApi && !progressive ? TOOL_HINTS.map(h => toolDef(h.name)) : [];
  // Schemas are not kept between conversation rounds: tools already called stay loaded, and
  // so do the tools the user's request obviously needs.
  const loaded = new Set([...toolsUsedInHistory(messages), ...toolsForRequest(messages)]);
  const discovery: unknown[] = [];
  for (let pass = 0; ; pass++) {
    const tools = progressive ? [loadToolsDef, ...[...loaded].map(toolDef)] : allToolDefs;
    const result = await streamOnce([...msgs, ...discovery], tools);
    if (!progressive) return result;
    const native = result.toolUses.find(use => use.name === LOAD_TOOLS);
    // The app cannot run load_tools: it never leaves this function.
    const toolUses = result.toolUses.filter(use => use.name !== LOAD_TOOLS);
    // Small models often skip load_tools and call a catalogue tool directly, natively or as
    // JSON text: treat that as a request to load it. Text calls to loaded tools still run.
    const requested = [
      ...(native ? requestedNames(native.input) : textLoadToolsCall(result.text) ?? []),
      ...toolUses.map(use => use.name),
      ...(toolUses.length ? [] : textToolNames(result.text)),
    ].filter(name => name !== LOAD_TOOLS && !loaded.has(name));
    const asked = native || requested.length;
    if (!asked || pass >= MAX_DISCOVERY_PASSES) return { text: asked && toolUses.length ? '' : result.text, toolUses };
    // A load mixed with real calls is retried: those calls were made without their schemas.
    const { known, unknown } = splitKnown(requested);
    known.forEach(name => loaded.add(name));
    const id = native?.id || `${LOAD_TOOLS}_${pass}`;
    discovery.push(
      { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: LOAD_TOOLS, arguments: JSON.stringify({ names: requested }) } }] },
      { role: 'tool', tool_call_id: id, content: [
        known.length ? `Loaded: ${known.join(', ')}.` : 'No tool loaded.',
        unknown.length ? `Not in the catalogue: ${unknown.join(', ')}.` : '',
        'Call the loaded tools now to fulfil the request.',
      ].filter(Boolean).join(' ') },
    );
  }

  async function streamOnce(payload: unknown[], tools: unknown[]): Promise<{ text: string; toolUses: ToolUse[] }> {
  const body: Record<string, unknown> = {
    model: ai.model,
    messages: payload,
    // Reasoning models reject a custom temperature, so an explicit effort replaces it.
    ...(ai.effort ? { reasoning_effort: ai.effort } : { temperature: ai.temperature }),
    stream: true,
    ...(tools.length && { tools }),
    // llama-server allows one call per answer unless asked: one wall per round otherwise.
    ...(progressive && tools.length && { parallel_tool_calls: true }),
    // A small model can loop on tool calls until the context is full (20k tokens, ~9 min seen).
    ...(progressive && { max_tokens: MAX_OUTPUT_TOKENS }),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ai.apiKey ? { Authorization: `Bearer ${ai.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    // Keeps the provider's reason ("exceeds the available context size"…), key masked.
    throw await providerHttpError('IA locale', res, ai.apiKey);
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
        // Ollama's OpenAI-compatible stream names it `reasoning`.
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
}
