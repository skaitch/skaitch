import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { listedProjects } from '@skaitch/core/lib/projectArchive';
import type { AddressInfo } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MCP_TOOLS as TOOLS, MCP_PUBLIC_TOOLS, MCP_INSTRUCTIONS, mcpDiscovery, unwrapMcpTool } from '@skaitch/core/mcp-automation';
import { mcpToolResult } from '@skaitch/core/lib/mcpToolResult';
import type { ProjectMeta } from '@skaitch/core/types/project';

export const DEFAULT_MCP_PORT = 3923;
export const MCP_PATH = '/mcp';
/** Tools that need a host feature the desktop app does not have. */
const UNAVAILABLE_TOOLS = new Set(['generate_visualization']);
export const DESKTOP_TOOLS = TOOLS.filter(tool => !UNAVAILABLE_TOOLS.has(tool.name));
const MAX_BODY = 8 * 1024 * 1024;

export interface McpServerOptions {
  /** 0 picks a free port (tests). */
  port: number;
  version: string;
  listProjects: () => Promise<ProjectMeta[]>;
  /** Runs one tool in the editor window; rejects when no window can answer. */
  callRenderer: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Called on every MCP request, to show the client as connected. */
  onActivity?: () => void;
  log?: (message: string) => void;
  /**
   * Remote access through a tunnel (ChatGPT and other cloud clients). Off unless set:
   * requests for `host` must use the secret path `/mcp/<token>`.
   */
  remote?: RemoteAccess;
  /**
   * Secret for local clients: they must use `/mcp/<localToken>`. Loopback is reachable by every
   * process and OS user of the machine, so the path secret is what identifies the owner's clients.
   */
  localToken?: string;
}

export interface RemoteAccess {
  /** Public host name the tunnel forwards, e.g. `abc.trycloudflare.com`. */
  host: string;
  token: string;
}

export interface RunningMcpServer {
  port: number;
  url: string;
  /** Set when remote access is on: the URL to give the cloud client. Secret. */
  remoteUrl?: string;
  close: () => Promise<void>;
}

/** Projects as MCP clients see them: what the library lists, no file paths. */
function projectSummary(project: ProjectMeta) {
  return { id: project.id, name: project.name || 'Sans titre', description: project.description || '', createdAt: project.createdAt || '', updatedAt: project.updatedAt || '', ...(project.archivedAt ? { archivedAt: project.archivedAt } : {}) };
}

/** Runs one tool call; every failure becomes an MCP error result the client can read. */
export async function callTool(options: Pick<McpServerOptions, 'listProjects' | 'callRenderer'>, name: string, args: Record<string, unknown> = {}) {
  try {
    ({ name, args } = unwrapMcpTool(name, args));
    if (!DESKTOP_TOOLS.some(tool => tool.name === name)) throw new Error(`Outil indisponible dans l’application de bureau : ${name}`);
    const discovery = mcpDiscovery(name, args, DESKTOP_TOOLS);
    if (discovery !== undefined) return mcpToolResult(discovery);
    if (name === 'list_projects') return mcpToolResult(listedProjects(await options.listProjects(), args).map(projectSummary));
    return mcpToolResult(await options.callRenderer(name, args));
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
}

function createMcpServer(options: McpServerOptions) {
  const server = new Server({ name: 'skaitch-desktop', version: options.version }, { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_PUBLIC_TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async request => callTool(options, request.params.name, request.params.arguments) as any);
  return server;
}

/** Constant-time comparison of a request path segment with a secret token. */
function tokenMatches(given: string, token: string) {
  const a = Buffer.from(given), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Local clients reach `/mcp/<localToken>` (or `/mcp` when no token is configured) on loopback;
 * the Host and Origin checks stop web pages from reaching it through DNS rebinding or
 * cross-site requests, and the token keeps other local processes and users out.
 */
export function isLocalRequest(req: IncomingMessage, port: number, localToken?: string) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes(req.headers.host ?? '')) return false;
  const origin = req.headers.origin;
  if (!(origin === undefined || hosts.some(host => origin === `http://${host}`))) return false;
  const path = pathOf(req);
  if (!localToken) return path === MCP_PATH;
  return path.startsWith(`${MCP_PATH}/`) && tokenMatches(path.slice(MCP_PATH.length + 1), localToken);
}

/** Remote clients must come through the tunnel host and know the secret path. */
export function isRemoteRequest(req: IncomingMessage, remote: RemoteAccess | undefined) {
  if (!remote || (req.headers.host ?? '').toLowerCase() !== remote.host.toLowerCase()) return false;
  if (req.headers.origin !== undefined) return false;
  const path = pathOf(req);
  if (!path.startsWith(`${MCP_PATH}/`)) return false;
  return tokenMatches(path.slice(MCP_PATH.length + 1), remote.token);
}

const pathOf = (req: IncomingMessage) => new URL(req.url ?? '/', 'http://127.0.0.1').pathname;

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new Error('Requête trop volumineuse.')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined); }
      catch { reject(new Error('JSON invalide.')); }
    });
    req.on('error', reject);
  });
}

function reply(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

/** Streamable HTTP MCP server on 127.0.0.1, stateless: each request gets its own transport. */
export function startMcpServer(options: McpServerOptions): Promise<RunningMcpServer> {
  let port = options.port;
  const http: HttpServer = createServer(async (req, res) => {
    if (!isLocalRequest(req, port, options.localToken) && !isRemoteRequest(req, options.remote)) { reply(res, 403, 'Accès MCP non autorisé.'); return; }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return; }
    options.onActivity?.();
    let body: unknown;
    try { body = await readBody(req); }
    catch (error) { reply(res, 400, (error as Error).message); return; }
    const server = createMcpServer(options);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      options.log?.(`[skaitch-mcp] ${(error as Error).message}`);
      if (!res.headersSent) reply(res, 500, 'Erreur interne du serveur MCP.');
    }
  });
  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port, '127.0.0.1', () => {
      http.off('error', reject);
      port = (http.address() as AddressInfo).port;
      resolve({
        port,
        url: `http://127.0.0.1:${port}${MCP_PATH}${options.localToken ? `/${options.localToken}` : ''}`,
        remoteUrl: options.remote ? `https://${options.remote.host}${MCP_PATH}/${options.remote.token}` : undefined,
        close: () => new Promise<void>(done => { http.closeAllConnections(); http.close(() => done()); }),
      });
    });
  });
}
