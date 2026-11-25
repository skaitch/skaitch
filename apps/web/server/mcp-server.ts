#!/usr/bin/env node
import { authorizeMcpTool } from '@skaitch/core/lib/mcpPermissions';
import { mcpToolResult } from '@skaitch/core/lib/mcpToolResult';
import packageInfo from '../package.json' with { type: 'json' };
const { version } = packageInfo;
/**
 * SkAItch — MCP4IFC-compatible server
 *
 * Exposes the SkAItch BIM model as MCP tools.
 * Claude Desktop connects via stdio; the browser connects via WebSocket (:3001).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer, type WebSocket } from 'ws';
import { createHash, createHmac, randomUUID } from 'crypto';
import http from 'http';
import { MCP_TOOLS as TOOLS, MCP_PUBLIC_TOOLS, MCP_INSTRUCTIONS, mcpDiscovery, unwrapMcpTool } from '@skaitch/core/mcp-automation';

// ── State variables ──────────────────────────────────────────────────────────
let sessionProjectId: string | null = null;
let browserActiveProjectId: string | null = null;

// ── WebSocket bridge ──────────────────────────────────────────────────────────
const WSS_PORT = parseInt(process.env.SKAITCH_WS_PORT ?? '3001', 10);
let browserSocket: WebSocket | null = null;

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
const pending = new Map<string, Pending>();

// Only the SkAItch web app may attach as "the browser". Browsers always send Origin, so this
// stops web pages on other sites; local processes are handled by never giving the peer the key.
const ALLOWED_ORIGINS = new Set((process.env.SKAITCH_BRIDGE_ORIGINS
  ?? 'http://localhost:5173,http://127.0.0.1:5173,https://app.skaitch.online,https://skaitch.vercel.app')
  .split(',').map(s => s.trim()).filter(Boolean));

/** Rejects a request whose Host is not loopback (DNS rebinding) or whose Origin is foreign. */
function trustedLocalRequest(headers: http.IncomingHttpHeaders, port: number, requireOrigin: boolean): boolean {
  const host = String(headers.host || '').toLowerCase();
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false;
  const origin = headers.origin;
  if (!origin) return !requireOrigin;
  return ALLOWED_ORIGINS.has(origin);
}

const wss = new WebSocketServer({
  host: '127.0.0.1',
  port: WSS_PORT,
  verifyClient: ({ req }: { req: http.IncomingMessage }) => trustedLocalRequest(req.headers, WSS_PORT, true),
});

wss.on('connection', (ws) => {
  process.stderr.write('[skaitch-mcp] Browser connected\n');
  browserSocket = ws;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as { type: string; id?: string; result?: unknown; error?: string; activeProjectId?: string };
      
      if (msg.type === 'hello' && typeof (msg as { nonce?: unknown }).nonce === 'string') {
        // Prove to the tab that this bridge holds the user's key, without sending the key.
        const key = process.env.SKAITCH_API_KEY ?? '';
        if (key) ws.send(JSON.stringify({ type: 'hello_proof', keyHash: apiKeyHash(key),
          mac: createHmac('sha256', key).update(String((msg as { nonce: string }).nonce)).digest('hex') }));
      } else if (msg.type === 'status') {
        browserActiveProjectId = msg.activeProjectId ?? null;
        process.stderr.write(`[skaitch-mcp] Browser reported active project: ${browserActiveProjectId}\n`);
      } else if (msg.type === 'verify_key_result' && msg.id) {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.result ?? null);
      } else if (msg.type === 'tool_result' && msg.id) {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.result ?? null);
      }
    } catch { /* malformed */ }
  });

  ws.on('close', () => {
    if (browserSocket === ws) browserSocket = null;
    process.stderr.write('[skaitch-mcp] Browser disconnected\n');
  });

  ws.on('error', () => ws.terminate());
});

wss.on('error', (err) => process.stderr.write(`[skaitch-mcp] WS error: ${err.message}\n`));

function callBrowser(name: string, args: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!browserSocket || browserSocket.readyState !== 1 /* OPEN */) {
      reject(new Error('SkAItch is not open in the browser. Open http://localhost:5173 first.'));
      return;
    }
    const id = randomUUID();
    pending.set(id, { resolve, reject });
    browserSocket.send(JSON.stringify({ type: 'tool_call', id, name, args }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout: no response from browser after 120 s (tool=${name})`));
      }
    }, 120_000);
  });
}

// ── API Key Verification & Helpers (Delegated to Browser) ────────────────────
// The peer only receives a SHA-256 of the key: the signed-in tab can match it against the
// user's own key documents, while any other peer learns nothing usable.
const apiKeyHash = (key: string) => createHash('sha256').update(key).digest('hex');

function verifyApiKeyWithBrowser(key: string): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!browserSocket || browserSocket.readyState !== 1 /* OPEN */) {
      reject(new Error('SkAItch is not open in the browser. Open http://localhost:5173 first.'));
      return;
    }
    const id = randomUUID();
    pending.set(id, { resolve, reject });
    browserSocket.send(JSON.stringify({ type: 'verify_key', id, tokenHash: apiKeyHash(key) }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('Timeout: no response from browser for API key verification.'));
      }
    }, 5000);
  });
}

async function validateApiKey(key: string) {
  if (!key) throw new Error("SKAITCH_API_KEY is not defined in your environment.");
  
  const keyData = await verifyApiKeyWithBrowser(key);
  if (!keyData) {
    throw new Error('Invalid SKAITCH_API_KEY. Configure a valid API key in your project settings.');
  }
  
  return keyData as {
    id: string;
    name: string;
    uid: string;
    createdAt: string;
    permissions: Record<string, 'read' | 'write' | 'none'>;
    accountAccess?: 'read' | 'write';
  };
}

// ── MCP tool definitions (mcp4ifc-compatible names) ───────────────────────────
// ── Shared Tool Execution Handler ─────────────────────────────────────────────
async function handleCallTool(name: string, args: Record<string, unknown> | undefined) {
  try {
    const apiKey = process.env.SKAITCH_API_KEY;
    if (!apiKey) {
      return {
        content: [{ type: 'text', text: 'Error: SKAITCH_API_KEY environment variable is not defined on the MCP server. Configure it in your client config.' }],
        isError: true
      };
    }
    const keyData = await validateApiKey(apiKey);
    ({ name, args } = unwrapMcpTool(name, args ?? {}));
    if (!TOOLS.some(tool => tool.name === name)) throw new Error("Unknown tool");
    
    // Handle list_projects tool via browser bridge
    if (name === 'list_projects') {
      const projects = await callBrowser('list_projects', {});
      const list = Array.isArray(projects) ? projects.filter(p => ['read', 'write'].includes(keyData.accountAccess || keyData.permissions[p.id])) : projects;
      return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
    }

    // For select_project, we authorize first, then forward to browser to switch projects
    if (name === 'select_project') {
      const { project_id } = args as { project_id: string };
      const perm = keyData.accountAccess || keyData.permissions[project_id] || 'none';
      if (perm !== 'read' && perm !== 'write') {
        return { content: [{ type: 'text', text: `Error: Access Denied to project ${project_id}` }], isError: true };
      }
      
      const result = await callBrowser(name, args ?? {});
      sessionProjectId = project_id; // update active project in the session
      browserActiveProjectId = project_id;
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    const discovery = mcpDiscovery(name, args ?? {});
    if (discovery !== undefined) return mcpToolResult(discovery);

    // For any other tool, we require a project to be selected in the MCP session
    if (!sessionProjectId) {
      return {
        content: [{ type: 'text', text: 'Error: No project selected. You must call select_project(project_id) first.' }],
        isError: true
      };
    }

    authorizeMcpTool(name, args ?? {}, sessionProjectId, keyData.permissions, keyData.accountAccess);

    // Auto-switch the browser's active project if it differs from the selected MCP project
    if (browserActiveProjectId !== sessionProjectId) {
      process.stderr.write(`[skaitch-mcp] Auto-switching browser to project ${sessionProjectId}...\n`);
      await callBrowser('select_project', { project_id: sessionProjectId });
      browserActiveProjectId = sessionProjectId;
    }

    // Forward the tool call to the browser WebSocket
    const result = (await callBrowser(name, args ?? {})) as any;
    return mcpToolResult(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
  }
}

// ── MCP server (Stdio) ────────────────────────────────────────────────────────
const stdioServer = new Server(
  { name: 'skaitch-stdio', version },
  { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS },
);
stdioServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_PUBLIC_TOOLS }));
stdioServer.setRequestHandler(CallToolRequestSchema, async (req) => {
  return handleCallTool(req.params.name, req.params.arguments);
});

const stdioTransport = new StdioServerTransport();
await stdioServer.connect(stdioTransport);
process.stderr.write(`[skaitch-mcp] Stdio MCP server ready. WebSocket bridge on ws://localhost:${WSS_PORT}\n`);

// ── MCP server (SSE) ──────────────────────────────────────────────────────────
const sseServer = new Server(
  { name: 'skaitch-sse', version },
  { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS },
);
sseServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_PUBLIC_TOOLS }));
sseServer.setRequestHandler(CallToolRequestSchema, async (req) => {
  return handleCallTool(req.params.name, req.params.arguments);
});

const SSE_PORT = parseInt(process.env.SKAITCH_SSE_PORT ?? '3002', 10);
let sseTransport: SSEServerTransport | null = null;

const sseHttpServer = http.createServer(async (req, res) => {
  // Local MCP clients send no Origin; browsers do. No CORS is granted, so web pages cannot
  // read the stream or send JSON tool calls, and a loopback Host check blocks DNS rebinding.
  if (!trustedLocalRequest(req.headers, SSE_PORT, false) || req.headers.origin) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/sse' && req.method === 'GET') {
    sseTransport = new SSEServerTransport('/messages', res);
    await sseServer.connect(sseTransport);
    process.stderr.write('[skaitch-mcp] Cloud client (SSE) connected\n');
    return;
  }

  if (new URL(req.url || '/', 'http://localhost').pathname === '/messages' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 8 * 1024 * 1024) { res.writeHead(413); res.end(); req.destroy(); }
    });
    req.on('end', async () => {
      if (sseTransport) {
        try {
          const json = JSON.parse(body);
          await sseTransport.handlePostMessage(req as any, res as any, json);
        } catch (err) {
          res.writeHead(400);
          res.end('Invalid JSON body');
        }
      } else {
        res.writeHead(400);
        res.end('SSE session not initialized');
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

sseHttpServer.on('error', (err: any) => {
  process.stderr.write(`[skaitch-mcp] SSE server failed to start: ${err.message}. Running in Stdio-only mode.\n`);
});

sseHttpServer.listen(SSE_PORT, '127.0.0.1', () => {
  process.stderr.write(`[skaitch-mcp] SSE MCP server ready on http://localhost:${SSE_PORT}/sse\n`);
});

// ── Graceful Shutdown ────────────────────────────────────────────────────────
const shutdown = () => {
  process.stderr.write('[skaitch-mcp] Shutting down, closing servers...\n');
  wss.close();
  sseHttpServer.close();
  process.exit(0);
};

process.stdin.on('close', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

