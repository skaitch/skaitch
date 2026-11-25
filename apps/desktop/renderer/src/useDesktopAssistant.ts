import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssistantApi, AssistantContext } from '@skaitch/ui/platform';
import { useMcpExecutor, type McpExecutorHandlers } from '@skaitch/ui/hooks/useMcpExecutor';
import { runDesktopTool, serialQueue } from './mcpDispatch';
import type { DesktopMcpStatus } from './desktop';

/**
 * Step 6c: the main process runs a local MCP server (127.0.0.1) and forwards each tool call here.
 * The shared executor applies it to the open project and asks the user to confirm every change.
 */
export function useDesktopAssistant(context: AssistantContext): AssistantApi {
  const { ai, setAi } = context;
  const contextRef = useRef(context);
  contextRef.current = context;
  const [status, setStatus] = useState<DesktopMcpStatus>({ listening: false, url: null, remote: false, connected: false });

  const handlers: McpExecutorHandlers = {
    ...context,
    uid: context.accountId,
    alwaysValidate: ai.mcpAlwaysValidate ?? true,
    setAlwaysValidate: value => setAi(previous => ({ ...previous, mcpAlwaysValidate: value })),
    requestBim: (operation, data) => window.skaitchDesktop.bim(operation, data),
    listProjects: () => window.skaitchDesktop.library.list(),
  };
  const { pending, renderConfirmDialog, execute } = useMcpExecutor(handlers);
  const executeRef = useRef(execute);
  executeRef.current = execute;
  // One queue for MCP and the built-in chat: a call made while another one previews its
  // change would otherwise skip the confirmation.
  const queueRef = useRef<ReturnType<typeof serialQueue> | null>(null);
  queueRef.current ??= serialQueue();
  const queuedExecute = useCallback<AssistantApi['execute']>((...args) => queueRef.current!(() => executeRef.current(...args)), []);

  const enabled = ai.mcpEnabled !== false;
  useEffect(() => {
    const bridge = window.skaitchDesktop?.mcp;
    if (!bridge || !enabled) return;
    let active = true;
    const enqueue = queueRef.current!;
    const stopStatus = bridge.onStatus(next => { if (active) setStatus(next); });
    const stopCalls = bridge.onCall(({ id, name, args, expiresAt }) => enqueue(async () => {
      let outcome: { result: unknown } | { error: string };
      try {
        const result = await runDesktopTool({
          activeProjectId: () => contextRef.current.activeProjectId,
          openProject: project => contextRef.current.openProject(project),
          execute: (toolName, toolArgs, deadline) => executeRef.current(toolName, toolArgs, false, deadline),
          flushProject: () => contextRef.current.flushProject(),
        }, name, args ?? {}, expiresAt);
        outcome = { result: result ?? null };
      } catch (error) {
        outcome = { error: error instanceof Error ? error.message : String(error) };
      }
      await bridge.reply(id, outcome).catch(() => {});
    }));
    bridge.ready().then(next => {
      if (!active) return;
      setStatus(next);
    }).catch(error => contextRef.current.onError(error));
    return () => { active = false; stopStatus(); stopCalls(); void bridge.stop().catch(() => {}); };
  }, [enabled]);

  return { connected: enabled && status.connected, pending, renderConfirmDialog, execute: queuedExecute };
}
