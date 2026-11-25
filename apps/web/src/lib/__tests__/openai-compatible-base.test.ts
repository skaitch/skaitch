import { describe, expect, it } from 'vitest';
import { openAiCompatibleBase } from '../../../server/ai/chat';

describe('OpenAI-compatible chat base URL', () => {
  it('adds /v1 to a bare origin, like the model list does', () => {
    expect(openAiCompatibleBase('custom', 'https://integrate.api.nvidia.com/')).toBe('https://integrate.api.nvidia.com/v1');
    expect(openAiCompatibleBase('custom', 'https://integrate.api.nvidia.com')).toBe('https://integrate.api.nvidia.com/v1');
  });

  it('keeps a URL that already has its path or version', () => {
    expect(openAiCompatibleBase('custom', 'https://integrate.api.nvidia.com/v1/')).toBe('https://integrate.api.nvidia.com/v1');
    expect(openAiCompatibleBase('custom', 'https://api.groq.com/openai/v1')).toBe('https://api.groq.com/openai/v1');
    expect(openAiCompatibleBase('qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
  });

  it('always gives Ollama its /v1', () => {
    expect(openAiCompatibleBase('ollama', 'http://localhost:11434/api')).toBe('http://localhost:11434/api/v1');
  });
});
