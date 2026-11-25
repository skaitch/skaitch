import { afterEach, expect, it, vi } from 'vitest';
import { assistantConfig, testMcpConnection } from '@skaitch/ui/lib/mcpConnection';

afterEach(() => vi.unstubAllGlobals());
it('produces client-specific configurations without a real API key', () => {
  const url = 'https://skaitch.example/api/mcp';
  const gemini = JSON.parse(assistantConfig('gemini', 'token', url));
  expect(gemini.mcpServers.skaitch).toEqual({ httpUrl: url, headers: { Authorization: 'Bearer ${SKAITCH_API_KEY}' } });
  const claude = JSON.parse(assistantConfig('claude', 'oauth', url));
  expect(claude.mcpServers.skaitch.args).toEqual(['-y', 'mcp-remote', url]);
  expect(assistantConfig('chatgpt', 'oauth', url)).toBe(url);
});
it('requires a successful project-list round trip after initialization', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '[{"id":"p"}]' }] } }) });
  vi.stubGlobal('fetch', fetch);
  expect(await testMcpConnection('/api/mcp', 'temporary')).toBe(1);
  expect(JSON.parse(fetch.mock.calls[1][1].body).params.name).toBe('list_projects');
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer temporary');
});
it.each([401, 503])('does not report success for HTTP %s', async status => {
  const fetch = vi.fn().mockResolvedValue({ ok: false, status });
  vi.stubGlobal('fetch', fetch);
  await expect(testMcpConnection('/api/mcp', 'temporary')).rejects.toThrow();
  expect(fetch).toHaveBeenCalledOnce();
});
it('does not report success when the editor times out or returns an error', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 2, error: { code: -32000 } }) }));
  await expect(testMcpConnection('/api/mcp', 'temporary')).rejects.toThrow('editor');
});
