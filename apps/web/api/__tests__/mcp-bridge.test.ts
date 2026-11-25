// Regression tests for the local `pnpm mcp` bridge (server/mcp-server.ts): a peer on the
// WebSocket must never receive the API key, foreign web origins are refused, and the SSE
// endpoint grants no CORS.
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createHash, createHmac } from 'node:crypto';
import { get } from 'node:http';
import path from 'node:path';
import WebSocket from 'ws';

const root = path.resolve(import.meta.dirname, '../..');
const KEY = 'ak_DUMMY_' + 'b'.repeat(40);
const WS_PORT = 39000 + Math.floor(Math.random() * 500);
const SSE_PORT = WS_PORT + 500;

function startBridge() {
  return new StdioClientTransport({ command: process.execPath,
    args: ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, 'server/mcp-server.ts')],
    cwd: '/tmp', stderr: 'pipe',
    env: { PATH: process.env.PATH!, SKAITCH_API_KEY: KEY, SKAITCH_WS_PORT: String(WS_PORT), SKAITCH_SSE_PORT: String(SSE_PORT) } });
}

function openPeer(origin: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`, { headers: { origin } });
    ws.once('open', () => resolve(ws));
    ws.once('unexpected-response', (_req, res) => reject(new Error(`rejected ${res.statusCode}`)));
    ws.once('error', reject);
  });
}

function sseStatus(headers: Record<string, string>): Promise<{ status: number; acao?: string }> {
  return new Promise((resolve, reject) => {
    const r = get({ host: '127.0.0.1', port: SSE_PORT, path: '/sse', headers }, res => {
      resolve({ status: res.statusCode!, acao: res.headers['access-control-allow-origin'] as string | undefined });
      res.destroy();
    });
    r.on('error', reject);
  });
}

describe('local MCP bridge peer trust', () => {
  it('refuses foreign origins and never sends the API key to the peer', async () => {
    const client = new Client({ name: 'bridge-test', version: '1' });
    await client.connect(startBridge());
    try {
      await expect(openPeer('https://attacker.example')).rejects.toThrow(/rejected 401/);

      const peer = await openPeer('http://localhost:5173');
      const seen: any[] = [];
      peer.on('message', raw => {
        const msg = JSON.parse(raw.toString());
        seen.push(msg);
        if (msg.type === 'verify_key') peer.send(JSON.stringify({ type: 'verify_key_result', id: msg.id, result: { uid: 'u', permissions: {}, accountAccess: 'read' } }));
        if (msg.type === 'tool_call') peer.send(JSON.stringify({ type: 'tool_result', id: msg.id, result: [] }));
      });
      const proof = new Promise<any>(resolve => peer.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.type === 'hello_proof') resolve(m); }));
      peer.send(JSON.stringify({ type: 'hello', nonce: 'n0nce' }));
      const hello = await proof;
      expect(hello.keyHash).toBe(createHash('sha256').update(KEY).digest('hex'));
      expect(hello.mac).toBe(createHmac('sha256', KEY).update('n0nce').digest('hex'));
      await client.callTool({ name: 'list_projects', arguments: {} });
      const verify = seen.find(m => m.type === 'verify_key');
      expect(verify.tokenHash).toBe(createHash('sha256').update(KEY).digest('hex'));
      expect(JSON.stringify(seen)).not.toContain(KEY);
      peer.close();

      const browser = await sseStatus({ host: `127.0.0.1:${SSE_PORT}`, origin: 'https://attacker.example' });
      expect(browser.status).toBe(403);
      expect(browser.acao).toBeUndefined();
      const rebound = await sseStatus({ host: `attacker.example:${SSE_PORT}` });
      expect(rebound.status).toBe(403);
    } finally { await client.close(); }
  }, 30_000);
});
