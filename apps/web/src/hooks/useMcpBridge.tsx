import { runCodeMode } from '@skaitch/ui/lib/codeMode';
import { aiPreferences } from '../lib/aiPreferences';
import { renderAi } from '../lib/aiClient';
import { claimMcpRequest } from '../lib/mcpMailbox';
import { requestBim } from '../lib/bimClient';
import { BUILTIN_CATALOGUE } from '@skaitch/core/data/elementCatalogue';
import { MCP_MODEL_TOOLS } from '@skaitch/core/types/bim';
import { mcpToolResult } from '@skaitch/core/lib/mcpToolResult';
import { useEffect, useRef, useState } from 'react';
import { useMcpExecutor, type McpExecutorHandlers } from '@skaitch/ui/hooks/useMcpExecutor';
import { db } from '../lib/firebase';
import { authorizeMcpTool } from '@skaitch/core/lib/mcpPermissions';
import { authorizeBridgeCall, filterBridgeProjects, newNonce, verifyBridgeProof, type BridgeGrant } from '../lib/mcpBridgeAuth';
import { doc, getDoc, collection, getDocs, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';

const WS_URL = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_MCP_WS_URL ?? 'ws://localhost:3001';
const RECONNECT_DELAY = 3000;

type ToolCallMsg = { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> };
type ToolResultMsg = { type: 'tool_result'; id: string; result?: unknown; error?: string };

export type McpBridgeHandlers = Omit<McpExecutorHandlers, 'requestBim' | 'listProjects' | 'generateVisualization' | 'aiPreferences'>;

/** The signed-in user's Firestore projects. */
async function listFirestoreProjects(uid: string | null) {
  if (!uid) return { error: "User not authenticated" };
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'projects'));
    return snap.docs.map(d => {
      const data = d.data();
      return { id: d.id, name: data.name || 'Sans titre', description: data.description || '', createdAt: data.createdAt || '', updatedAt: data.updatedAt || '', ...(data.archivedAt ? { archivedAt: data.archivedAt as string } : {}) };
    });
  } catch (e) {
    return { error: String(e) };
  }
}

export function useMcpBridge(handlers: McpBridgeHandlers, enabled: boolean = true) {
  const [wsConnected, setWsConnected] = useState(false);
  const [dbConnected, setDbConnected] = useState(false);
  const cloudQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const wsRef    = useRef<WebSocket | null>(null);
  const hRef     = useRef(handlers);
  hRef.current   = handlers;           // always fresh without re-subscribing

  // Inherits from `handlers` so the executor always reads the caller's current values.
  const executorHandlers: McpExecutorHandlers = Object.assign(Object.create(handlers), {
    requestBim,
    listProjects: () => listFirestoreProjects(hRef.current.uid),
    generateVisualization: renderAi,
    aiPreferences,
  });
  const { pending, renderConfirmDialog, execute } = useMcpExecutor(executorHandlers);

  // ── WS lifecycle ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) {
      setWsConnected(false);
      return;
    }

    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;
    let dead = false;

    const connect = () => {
      if (dead || !enabled) return;
      try {
        ws = new WebSocket(WS_URL);
        wsRef.current = ws;
        // Whoever listens on the port is untrusted until it proves it holds one of the user's keys.
        const nonce = newNonce();
        let grant: BridgeGrant | null = null;

        ws.onopen = () => {
          if (!dead) ws.send(JSON.stringify({ type: 'hello', nonce }));
        };

        ws.onmessage = async (ev) => {
          try {
            const data = JSON.parse(ev.data as string);
            const myUid = hRef.current.uid;
            if (data.type === 'hello_proof') {
              if (!myUid) { ws.close(); return; }
              const keys = await getDocs(collection(db, 'users', myUid, 'apiKeys'));
              grant = await verifyBridgeProof(keys.docs.map(k => ({ id: k.id, data: k.data() })), nonce, data.keyHash, data.mac);
              if (!grant) { ws.close(); return; }
              setWsConnected(true);
              ws.send(JSON.stringify({ type: 'status', activeProjectId: hRef.current.activeProjectId }));
              return;
            }
            if (!grant) return; // nothing is answered to an unauthenticated peer

            if (data.type === 'verify_key') {
              ws.send(JSON.stringify({ type: 'verify_key_result', id: data.id, result: { uid: myUid, ...grant } }));
              return;
            }

            const msg = data as ToolCallMsg;
            if (msg.type !== 'tool_call') return;
            let result: unknown;
            let error: string | undefined;
            try {
              authorizeBridgeCall(grant, msg.name, msg.args ?? {}, hRef.current.activeProjectId ?? null);
              result = await execute(msg.name, msg.args);
              if (msg.name === 'list_projects' && Array.isArray(result)) result = filterBridgeProjects(grant, result as { id: string }[]);
            } catch (e) {
              error = e instanceof Error ? e.message : String(e);
            }
            const reply: ToolResultMsg = error
              ? { type: 'tool_result', id: msg.id, error }
              : { type: 'tool_result', id: msg.id, result };
            ws.send(JSON.stringify(reply));
          } catch { /* malformed */ }
        };

        ws.onclose = () => {
          setWsConnected(false);
          if (!dead && enabled) retryTimer = setTimeout(connect, RECONNECT_DELAY);
        };

        ws.onerror = () => ws.close();
      } catch { /* WS not available — skip */ }
    };

    connect();
    return () => {
      dead = true;
      clearTimeout(retryTimer);
      ws?.close();
    };
  }, [execute, enabled]);

  useEffect(() => {
    if (wsConnected && wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'status', activeProjectId: handlers.activeProjectId }));
    }
  }, [handlers.activeProjectId, wsConnected]);

  // ── Firestore lifecycle (Cloud SSE Bridge) ──────────────────────────────────
  useEffect(() => {
    if (!enabled) {
      setDbConnected(false);
      return;
    }

    const myUid = hRef.current.uid;
    if (!myUid) {
      setDbConnected(false);
      return;
    }

    const reqCol = collection(db, 'users', myUid, 'mcp_requests_v2');
    const unsub = onSnapshot(reqCol, (snapshot) => {
      setDbConnected(true); // Mark as connected when Firestore listener is active
      
      snapshot.docChanges().forEach((change) => {
        cloudQueueRef.current = cloudQueueRef.current.catch(() => {}).then(async () => {
        if (change.type === 'added' || change.type === 'modified') {
          const reqData = change.doc.data();
          const reqId = change.doc.id;
          const { name, arguments: argsRaw } = reqData as { name: string; arguments: any };

          let args = argsRaw;
          if (typeof argsRaw === 'string') {
            try { args = JSON.parse(argsRaw); } catch(e) {}
          }

          let rawResult: any;
          let error: string | undefined;
          try {
            // Expired mailboxes must never execute after a browser reconnect.
            if (!Number.isFinite(Date.parse(reqData.createdAt)) || Date.now() - Date.parse(reqData.createdAt) > 120_000) {
              await deleteDoc(change.doc.ref);
              return;
            }
            const keyDoc = reqData.apiKey
              ? await getDoc(doc(db, 'users', myUid, 'apiKeys', reqData.apiKey)) : null;
            if (!keyDoc?.exists()) throw new Error('Invalid or revoked API key');
            const permissions = keyDoc.data().permissions || {};
            const accountAccess = keyDoc.data().accountAccess;
            authorizeMcpTool(name, args ?? {}, reqData.projectId || hRef.current.activeProjectId, permissions, accountAccess);
            const claimed = await claimMcpRequest(change.doc.ref);
            if (!claimed) return;
            const expiresAt = Date.parse(reqData.createdAt) + 120_000;
            if (name === 'execute_script') {
              const saved = await requestBim<{ itemsJson: string; catalogue?: McpExecutorHandlers['catalogue'] }>('project-read', { id: reqData.projectId });
              if (Date.now() >= expiresAt) throw new Error('La demande MCP a expiré.');
              rawResult = await runCodeMode(args?.code, JSON.parse(saved.itemsJson), saved.catalogue ?? BUILTIN_CATALOGUE, AbortSignal.timeout(expiresAt - Date.now()));
            } else {
              if (reqData.projectId && hRef.current.activeProjectId !== reqData.projectId) {
                if (!hRef.current.openProject) throw new Error('Open the requested project in the editor.');
                await hRef.current.openProject({ id: reqData.projectId });
                await new Promise(resolve => setTimeout(resolve, 0));
              }
              if (reqData.projectId && hRef.current.activeProjectId !== reqData.projectId) throw new Error('Project selection changed. Retry the command.');
              if (reqData.storeyId) hRef.current.setFocusStorey?.(reqData.storeyId);
              await new Promise(resolve => setTimeout(resolve, 0));
              if (name === 'generate_visualization' && reqData.aiPreferences && !reqData.approvalOnly && JSON.stringify(aiPreferences(hRef.current.ai || {})) !== JSON.stringify(reqData.aiPreferences)) throw new Error('Les préférences IA locales diffèrent des préférences MCP enregistrées. Rechargez-les dans les réglages.');
              if (name === 'apply_model_batch' && reqData.approvalOnly) await hRef.current.flushProject?.();
              const displayArgs = name === 'generate_visualization' && reqData.approvalOnly ? { ...args, fournisseur: reqData.aiPreferences?.visualizerProvider, modèle: reqData.aiPreferences?.visualizerModel || 'Modèle par défaut du fournisseur', source: 'Modèle enregistré du projet' } : name === 'apply_model_batch' ? { ...args, batchSummary: reqData.batchSummary } : args ?? {};
              rawResult = await execute(name, displayArgs, reqData.forceConfirm === true, expiresAt, reqData.approvalOnly === true);
            }
            if (MCP_MODEL_TOOLS.includes(name) && !(rawResult as any)?.error) {
              const freshKey = await getDoc(doc(db, 'users', myUid, 'apiKeys', reqData.apiKey));
              if (!freshKey.exists()) throw new Error('Invalid or revoked API key');
              authorizeMcpTool(name, args ?? {}, hRef.current.activeProjectId, freshKey.data().permissions || {}, freshKey.data().accountAccess);
              if (reqData.projectId && hRef.current.activeProjectId !== reqData.projectId) throw new Error('Project selection changed. Retry the command.');
              await new Promise(resolve => setTimeout(resolve, 0));
              await hRef.current.flushProject?.();
            }
            if (name === 'list_projects' && Array.isArray(rawResult)) {
              rawResult = rawResult.filter(p => ['read', 'write'].includes(accountAccess || permissions[p.id]));
            }
          } catch (e) {
            error = e instanceof Error ? e.message : String(e);
          }

          let result: any = null;
          if (!error) {
            result = mcpToolResult(rawResult);
          }

          const responsePayload = error 
            ? { jsonrpc: '2.0', id: reqId, error: { code: -32603, message: error } }
            : { jsonrpc: '2.0', id: reqId, result };

          try {
            await setDoc(doc(db, 'users', myUid, 'mcp_responses_v2', reqId), {
              payload: responsePayload,
              createdAt: new Date().toISOString()
            });
            await deleteDoc(change.doc.ref);
          } catch (e) {
            console.error('[mcp-bridge] Error writing response or deleting request:', e);
          }
        }
        });
      });
    }, (err) => {
      console.error('[mcp-bridge] Firestore snapshot error:', err);
      setDbConnected(false);
    });

    return () => {
      unsub();
    };
  }, [enabled, execute, hRef.current.uid]);

  const connected = wsConnected || dbConnected;
  return { connected, pending, renderConfirmDialog, execute };
}
