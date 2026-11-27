import { readBody } from './_lib/boundedBody.js';
import { InputError } from '@skaitch/core/bim/validation';
import { executeCloudTool } from '../server/bim/mcpSession.js';
import { mcpToolResult } from '@skaitch/core/lib/mcpToolResult';
import { BIM_WIRE_LIMIT } from '@skaitch/core/types/bim';
import buildInfo from '../build-info.json' with { type: 'json' };
import { MCP_TOOLS as TOOLS, MCP_PUBLIC_TOOLS, MCP_INSTRUCTIONS, mcpDiscovery, unwrapMcpTool } from '@skaitch/core/mcp-automation';
import { randomUUID } from 'node:crypto';
import { authenticateKey } from './_lib/apikey.js';
import { unseal, baseUrl } from './_lib/oauth.js';
import { getAdminDb } from './_lib/admin.js';
import { withUsage } from './_lib/usage.js';

export default withUsage('mcp', async function handler(req: any, res: any, usage) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, authorization, mcp-protocol-version');

  res.setHeader('Cache-Control', 'no-store');
  const buildVersion = buildInfo.build;
  res.setHeader('X-Skaitch-Build', buildVersion);
  res.setHeader('X-Skaitch-Release', buildInfo.release);

  // Negotiate and echo MCP protocol version
  const clientVersion = req.headers['mcp-protocol-version'] || '2024-11-05';
  res.setHeader('mcp-protocol-version', clientVersion);

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  console.log(`[mcp-api] Incoming request: ${req.method} ${(req.url || '').split('?')[0]}`);

  const unauthorized = (msg: string) => {
    usage.authRejected = true;
    const meta = `${baseUrl(req)}/.well-known/oauth-protected-resource`;
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${meta}"`,
    });
    res.end(JSON.stringify({ error: msg }));
  };
  res.setHeader('Access-Control-Expose-Headers', 'mcp-protocol-version, WWW-Authenticate, X-Skaitch-Build, X-Skaitch-Release');

  // Credentials: OAuth access token (Bearer) or legacy SKAITCH API key (x-api-key / Bearer).
  // Never read from the URL: query strings end up in access logs and referrers.
  let apiKey = req.headers['x-api-key'] as string;
  if (!apiKey && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts[0] && parts[0].toLowerCase() === 'bearer' && parts[1]) {
      apiKey = parts[1];
    }
  }
  if (typeof apiKey !== 'string' || !apiKey) {
    unauthorized('Unauthorized: credentials missing');
    return;
  }

  // OAuth access token: decrypt to recover the underlying key (re-checked below, so revocation applies).
  if (apiKey.startsWith('access.')) {
    let tok: { k: string; res?: string } | null = null;
    try { tok = unseal<{ k: string; res?: string }>('access', apiKey); } catch (e) { console.error('[mcp-api] OAuth misconfigured:', e); }
    if (!tok || (tok.res && tok.res !== `${baseUrl(req)}/api/mcp`)) {
      unauthorized('Unauthorized: invalid or expired access token');
      return;
    }
    apiKey = tok.k;
  }

  let uid: string | null;
  try {
    uid = await authenticateKey(apiKey);
  } catch {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'MCP authentication service unavailable. Check server Firebase credentials.' }));
    return;
  }
  if (!uid) {
    console.warn(`[mcp-api] Auth failed: invalid credentials`);
    unauthorized('Unauthorized: invalid credentials');
    return;
  }

  usage.uid = uid;
  console.log(`[mcp-api] Auth successful for uid: ${uid}`);

  // Stateless Streamable HTTP: responses are returned only on the POST that owns them.
  // A standalone SSE stream is optional in MCP; explicitly decline it to avoid two
  // consumers racing to delete the same Firestore response.
  if (req.method === 'GET' || req.method === 'DELETE') {
    res.writeHead(405, { Allow: 'POST, OPTIONS' });
    res.end();
    return;
  }

  // ── POST: Handle MCP JSON-RPC messages ──────────────────────────────────────
  if (req.method === 'POST') {
    let body = req.body;
    if (body === undefined) {
      try { body = JSON.parse((await readBody(req)).toString('utf8')); }
      catch (error) {
        res.writeHead(error instanceof InputError ? error.status : 400);
        res.end('Invalid JSON body');
        return;
      }
    }
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        res.writeHead(400);
        res.end('Invalid JSON body');
        return;
      }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      res.writeHead(400);
      res.end('Invalid request body');
      return;
    }

    const { method, params, id } = body;
    // Only tool calls are counted, under the tool's name; protocol exchanges are not.
    if (method === 'tools/call' && typeof params?.name === 'string' && TOOLS.some(t => t.name === params.name)) usage.operation = `tool:${params.name}`;
    console.log(`[mcp-api] Processing JSON-RPC: method=${method}, id=${id}`);

    // 1. Handle initialize and tools/list directly on serverless to speed up
    if (method === 'initialize') {
      const response = {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'].includes(params?.protocolVersion) ? params.protocolVersion : '2025-03-26',
          capabilities: { tools: {} },
          instructions: MCP_INSTRUCTIONS,
          serverInfo: { name: 'skaitch-cloud', version: `${buildInfo.release}+${buildVersion}` }
        }
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
      return;
    }

    if (method === 'notifications/initialized' || method === 'initialized') {
      console.log(`[mcp-api] Client signaled initialization complete.`);
      res.writeHead(202);
      res.end();
      return;
    }

    if (id === undefined || id === null) {
      console.log(`[mcp-api] Received notification: ${method}`);
      res.writeHead(202);
      res.end();
      return;
    }

    if (method === 'tools/list') {
      const response = {
        jsonrpc: '2.0',
        id,
        result: { tools: MCP_PUBLIC_TOOLS }
      };


      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
      return;
    }

    // 2. For tool execution calls (tools/call), forward request to browser client and wait for response
    if (method === 'tools/call') {
      if (!params || typeof params.name !== 'string' || !TOOLS.some(t => t.name === params.name)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } }));
        return;
      }
      const controller = new AbortController();
      const deadline = setTimeout(() => { usage.timedOut = true; controller.abort(); }, 170_000);
      const cancel = () => { if (!res.writableEnded) { if (!usage.timedOut) usage.outcome = 'refused'; controller.abort(); } };
      res.on('close', cancel);
      const sendResult = (result: unknown) => {
        const payload = JSON.stringify({ jsonrpc: '2.0', id, result: mcpToolResult(result) });
        if (Buffer.byteLength(payload) > BIM_WIRE_LIMIT) throw new Error('MCP result exceeds 4 MB. Export a smaller model.');
        if (!res.destroyed) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(payload); }
      };
      try {
        const { name, args } = unwrapMcpTool(params.name, params.arguments ?? {});
        const discovery = mcpDiscovery(name, args);
        if (discovery !== undefined) { sendResult(discovery); return; }
        const cloud = await executeCloudTool(uid, apiKey, name, args, undefined, controller.signal);
        if (cloud.handled === true) { sendResult(cloud.result); return; }
        const requestId = randomUUID();
        const db = getAdminDb();
        const requestRef = db.doc(`users/${uid}/mcp_requests_v2/${requestId}`);
        const responseDocRef = db.doc(`users/${uid}/mcp_responses_v2/${requestId}`);
        try {
          await requestRef.set({
            id: requestId, name, apiKey,
            projectId: cloud.projectId, storeyId: cloud.storeyId, forceConfirm: cloud.forceConfirm,
            ...(cloud.aiPreferences ? { aiPreferences: cloud.aiPreferences } : {}),
            ...(cloud.approvalOnly ? { approvalOnly: true } : {}),
            ...(cloud.batchSummary ? { batchSummary: cloud.batchSummary } : {}),
            arguments: JSON.stringify(args), createdAt: new Date().toISOString(),
          });
          const responsePayload = await new Promise<any>((resolve, reject) => {
            let unsubscribe = () => {};
            const cleanup = () => { clearTimeout(timer); unsubscribe(); controller.signal.removeEventListener('abort', abort); };
            const abort = () => { cleanup(); reject(new Error('MCP request cancelled or timed out.')); };
            const timer = setTimeout(() => { cleanup(); resolve(null); }, 120_000);
            controller.signal.addEventListener('abort', abort, { once: true });
            unsubscribe = responseDocRef.onSnapshot(snap => {
              if (!snap.exists) return;
              cleanup(); resolve(snap.data()!.payload);
            }, error => { cleanup(); reject(error); });
            if (controller.signal.aborted) abort();
          });
          controller.signal.throwIfAborted();
          if (!responsePayload) usage.timedOut = true;
          if (!responsePayload) throw new Error('Browser execution timed out. Please ensure SkAItch is open in your browser.');
          if (cloud.approvalOnly) {
            let approved = false;
            try { approved = !responsePayload.error && !responsePayload.result?.isError && JSON.parse(responsePayload.result.content[0].text).approved === true; } catch {}
            if (!approved || !cloud.confirmationContext) throw new Error('La demande n’a pas été approuvée.');
            const confirmed = await executeCloudTool(uid, apiKey, name, args, cloud.confirmationContext, controller.signal);
            if (confirmed.handled !== true) throw new Error('Le contexte a changé. Relancez la demande.');
            sendResult(confirmed.result);
          } else if (!res.destroyed) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ...responsePayload, id }));
          }
        } finally { await Promise.allSettled([requestRef.delete(), responseDocRef.delete()]); }
      } catch (error) {
        if (usage.timedOut) usage.outcome ??= 'timeout';
        else usage.outcome ??= 'failed';
        if (!res.destroyed) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: (error as Error).message || 'MCP processing failed' } }));
        }
      } finally { clearTimeout(deadline); res.off('close', cancel); }
      return;
    }

    if (method === 'ping') {
      const response = { jsonrpc: '2.0', id, result: {} };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
      return;
    }

    // Default unknown method response
    const unknownResponse = {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` }
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(unknownResponse));
    return;
  }

  res.writeHead(405);
  res.end('Method Not Allowed');
});
