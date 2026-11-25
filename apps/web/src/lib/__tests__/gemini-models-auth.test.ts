import { describe, expect, it, vi } from 'vitest';

const calls: { url: string; headers: Record<string, string> }[] = [];
vi.mock('../../../server/ai/upstream.js', async original => ({
  ...(await original<object>()),
  upstreamFetch: vi.fn(async (url: string, options: RequestInit) => {
    calls.push({ url, headers: options.headers as Record<string, string> });
    return new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash' }] }));
  }),
}));

describe('Gemini model list', () => {
  it('sends the key as x-goog-api-key, never as a Bearer token or in the URL', async () => {
    const { listAiModels } = await import('../../../server/ai/models');
    const models = await listAiModels({ provider: 'gemini', model: 'list', apiKey: 'AIza-test', temperature: 0 } as never);
    expect(models).toEqual(['gemini-2.5-flash']);
    expect(calls[0].headers).toEqual({ 'x-goog-api-key': 'AIza-test' });
    expect(calls[0].url).not.toContain('AIza-test');
  });
});
