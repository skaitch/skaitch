import { contextBridge, ipcRenderer } from 'electron';

type Result = { ok: true; result: any } | { ok: false; error: string };

async function call(channel: string, ...args: unknown[]) {
  const response: Result = await ipcRenderer.invoke(channel, ...args);
  if (response.ok === false) throw new Error((response as { error: string }).error);
  return response.result;
}

/** Forwards a main-process message without exposing the IPC event. */
function subscribe(channel: string, listener: (payload: unknown) => void) {
  const handler = (_event: unknown, payload: unknown) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.removeListener(channel, handler); };
}

/** Reports the interface language (the page's lang attribute) so main-process messages follow it. */
function reportLanguage() {
  const send = () => ipcRenderer.send('ui:lang', document.documentElement.lang);
  send();
  new MutationObserver(send).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reportLanguage, { once: true });
else reportLanguage();

/** The only main-process capabilities the renderer gets (see renderer/src/desktop.d.ts). */
contextBridge.exposeInMainWorld('skaitchDesktop', {
  bim: (operation: string, data: unknown) => call('bim', operation, data),
  library: {
    list: () => call('library:list'),
    read: (id: string) => call('library:read', id),
    write: (id: string, patch: unknown) => call('library:write', id, patch),
    delete: (id: string) => call('library:delete', id),
    setArchived: (id: string, archived: boolean) => call('library:archive', id, archived),
  },
  ai: {
    keys: () => call('ai:keys'),
    setKey: (provider: string, baseUrl: string | undefined, secret: string) => call('ai:set-key', provider, baseUrl, secret),
    request: (operation: string, data: unknown, requestId?: string) => call('ai', operation, data, requestId),
    chat: (requestId: string, data: unknown) => call('ai:chat', requestId, data),
    abort: (requestId: string) => call('ai:abort', requestId),
    onChunk: (listener: (event: unknown) => void) => subscribe('ai:chunk', listener),
  },
  /** Optional diagnostic journal (Settings → AI assistant); the file never holds API keys. */
  logs: {
    get: () => call('logs:get'),
    set: (enabled: boolean) => call('logs:set', enabled),
    open: () => call('logs:open'),
  },
  survey: {
    list: () => call('survey:list'),
    readChunk: (id: string, index: number) => call('survey:read-chunk', id, index),
    remove: (id: string) => call('survey:remove', id),
    keys: () => call('survey:keys'),
    createKey: (name: string) => call('survey:create-key', name),
    revokeKey: (id: string) => call('survey:revoke-key', id),
  },
  mcp: {
    /** Starts receiving tool calls from the local MCP server; returns its status. */
    ready: () => call('mcp:ready'),
    status: () => call('mcp:status'),
    /** Stops receiving tool calls; waiting calls fail at once. */
    stop: () => call('mcp:stop'),
    reply: (id: string, outcome: unknown) => call('mcp:reply', id, outcome),
    onCall: (listener: (call: unknown) => void) => subscribe('mcp:call', listener),
    onStatus: (listener: (status: unknown) => void) => subscribe('mcp:status', listener),
  },
});
