export type AssistantClient = 'claude' | 'chatgpt' | 'gemini';
export type ConnectionAuth = 'oauth' | 'token';

/** Templates never contain a user's API key. */
export function assistantConfig(client: AssistantClient, auth: ConnectionAuth, url: string) {
  if (client === 'chatgpt') return url;
  const server = client === 'gemini'
    ? { httpUrl: url, ...(auth === 'token' ? { headers: { Authorization: 'Bearer ${SKAITCH_API_KEY}' } } : {}) }
    : { command: 'npx', args: ['-y', 'mcp-remote', url,
      ...(auth === 'token' ? ['--header', 'Authorization:${SKAITCH_AUTH_HEADER}'] : [])],
      ...(auth === 'token' ? { env: { SKAITCH_AUTH_HEADER: 'Bearer REPLACE_WITH_YOUR_API_KEY' } } : {}) };
  return JSON.stringify({ mcpServers: { skaitch: server } }, null, 2);
}

/** Check the actual mailbox round trip, not just HTTP availability. */
export async function testMcpConnection(url: string, key: string): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 125_000);
  try {
    async function call(method: string, params: object, id: number) {
      const response = await fetch(url, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'mcp-protocol-version': '2025-03-26' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
      if (response.status === 401) throw new Error('The key was rejected. Check that it has not been revoked.');
      if (response.status === 503) throw new Error('The MCP server cannot access Firebase. Check its server credentials.');
      if (!response.ok) throw new Error('The MCP server returned an HTTP error.');
      const payload = await response.json();
      if (payload.error || payload.result?.isError) throw new Error('The editor did not complete the request. Keep SkAItch open with MCP enabled.');
      if (payload.jsonrpc !== '2.0' || payload.id !== id || !payload.result) throw new Error('Invalid MCP response.');
      return payload.result;
    }
    await call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'skaitch-connection-test', version: '1' } }, 1);
    const result = await call('tools/call', { name: 'list_projects', arguments: {} }, 2);
    const projects = JSON.parse(result.content?.find((c: { type: string }) => c.type === 'text')?.text ?? 'null');
    if (!Array.isArray(projects)) throw new Error('Invalid project list.');
    return projects.length;
  } finally {
    clearTimeout(timer);
  }
}
