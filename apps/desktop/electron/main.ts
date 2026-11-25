import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, shell, type IpcMainInvokeEvent, type WebFrameMain } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isEngineOperation, runBimOperation } from '@skaitch/core/bim/dispatch';
import { ProjectLibrary } from './library';
import { setUiLanguage, tr } from './lang';
import { DEFAULT_MCP_PORT, startMcpServer, type RemoteAccess, type RunningMcpServer } from './mcpServer';
import { RendererCalls, type McpOutcome } from './rendererCalls';
import { AiKeyStore } from './aiKeys';
import { DiagnosticLog } from './diagnosticLog';
import { chat, runAiOperation } from './aiEngine';
import { startSurveyReceiver, surveyInboxOps } from './surveyReceiver';
import { captureChat, checkAiProvider, captureIfcImport, captureProject, captureTour, runSmokeTest } from './smoke';

declare const __APP_VERSION__: string;

const here = dirname(fileURLToPath(import.meta.url));
const rendererDir = join(here, '..', 'renderer');
const APP_ORIGIN = 'app://skaitch';
/** One chat round with the AI provider; the web API is capped by its serverless limit, the desktop is not. */
const AI_CHAT_TIMEOUT_MS = 10 * 60_000;

/** Development only: load the renderer from the Vite dev server instead of the built files. */
const devUrl = process.env.SKAITCH_DEV_URL;

// Test runs and smoke checks must never touch the user's real data.
if (process.env.SKAITCH_USER_DATA) app.setPath('userData', process.env.SKAITCH_USER_DATA);

/** Optional journal, switched on in Settings (electron/diagnosticLog.ts). */
const diagnostics = new DiagnosticLog(app.getPath('userData'));

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
}]);

/** Serves the built renderer; unknown paths fall back to index.html like the web host. */
function serveRenderer(request: Request) {
  const { pathname } = new URL(request.url);
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const file = join(rendererDir, relative);
  if (file !== rendererDir && !file.startsWith(rendererDir + sep)) return new Response('Forbidden', { status: 403 });
  const target = existsSync(file) && statSync(file).isFile() ? file : join(rendererDir, 'index.html');
  return net.fetch(pathToFileURL(target).toString());
}

function trustedSender(frame: WebFrameMain | null) {
  if (!frame) return false;
  const origin = frame.origin;
  return origin === APP_ORIGIN || (!!devUrl && origin === new URL(devUrl).origin);
}

type Result = { ok: true; result: unknown } | { ok: false; error: string };
/** Returns plain JSON like the web API does, and turns errors into messages the UI can show as is. */
function handle(channel: string, run: (...args: any[]) => Promise<unknown>) {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<Result> => {
    if (!trustedSender(event.senderFrame)) return { ok: false, error: tr('Origine non autorisée.', 'Origin not allowed.') };
    try {
      const result = await run(...args);
      return { ok: true, result: result === undefined ? null : JSON.parse(JSON.stringify(result)) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    title: 'skAItch',
    icon: join(here, 'icon.png'),
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_ORIGIN) && !(devUrl && url.startsWith(devUrl))) event.preventDefault();
  });
  void window.loadURL(devUrl ?? `${APP_ORIGIN}/index.html`);
  return window;
}

/** A client that called within this delay still shows as connected. */
const MCP_IDLE_DELAY = 10 * 60_000;

/**
 * Step 6c: MCP clients (Claude Code, Claude Desktop…) reach the open project through a local
 * HTTP server; tool calls run in the editor window, which asks the user to confirm changes.
 */
/**
 * Remote access is opt-in: SKAITCH_MCP_REMOTE_HOST names the tunnel's public host.
 * The secret token is kept in the user data folder, so the client URL survives restarts;
 * delete `mcp-remote-token` to revoke it.
 */
async function remoteAccess(): Promise<RemoteAccess | undefined> {
  const host = process.env.SKAITCH_MCP_REMOTE_HOST?.trim();
  if (!host) return undefined;
  return { host, token: await secretToken('mcp-remote-token') };
}

/** A random token kept owner-only in the user data folder; delete the file to revoke it. */
async function secretToken(name: string): Promise<string> {
  const file = join(app.getPath('userData'), name);
  let token = (await readFile(file, 'utf8').catch(() => '')).trim();
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) {
    token = randomBytes(32).toString('base64url');
    await writeFile(file, token, { mode: 0o600 });
    await chmod(file, 0o600).catch(() => {});
  }
  return token;
}

async function startDesktopMcp(window: BrowserWindow, library: ProjectLibrary): Promise<RunningMcpServer | null> {
  const calls = new RendererCalls();
  let lastActivity = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let server: RunningMcpServer | null = null;
  const status = () => ({ listening: !!server, url: server?.url ?? null, remote: !!server?.remoteUrl, connected: !!server && Date.now() - lastActivity < MCP_IDLE_DELAY });
  const pushStatus = () => { if (!window.isDestroyed()) window.webContents.send('mcp:status', status()); };

  handle('mcp:ready', async () => {
    calls.ready(call => { if (!window.isDestroyed()) window.webContents.send('mcp:call', call); });
    return status();
  });
  handle('mcp:status', async () => status());
  handle('mcp:stop', async () => calls.detach('Le serveur MCP est désactivé dans les paramètres de skAItch.'));
  handle('mcp:reply', async (id: string, outcome: McpOutcome) => calls.reply(String(id), outcome));
  window.webContents.on('did-start-navigation', details => { if (details.isMainFrame && !details.isSameDocument) calls.detach(); });
  window.webContents.on('render-process-gone', () => calls.detach());
  window.on('closed', () => calls.detach());

  const port = Number(process.env.SKAITCH_MCP_PORT ?? DEFAULT_MCP_PORT);
  try {
    server = await startMcpServer({
      port, version: __APP_VERSION__,
      remote: await remoteAccess(),
      // Local clients use the URL shown in the settings, which carries this secret
      // (file `mcp-local-token`, delete it to revoke every configured client).
      localToken: await secretToken('mcp-local-token'),
      listProjects: async () => {
        if (!calls.listening) throw new Error('Le serveur MCP est désactivé dans les paramètres de skAItch, ou l’éditeur n’est pas prêt.');
        return library.list();
      },
      callRenderer: (name, args) => calls.call(name, args),
      onActivity: () => {
        lastActivity = Date.now();
        clearTimeout(idleTimer);
        idleTimer = setTimeout(pushStatus, MCP_IDLE_DELAY);
        pushStatus();
      },
      log: message => console.error(message),
    });
    console.error(`[skaitch-mcp] Serveur MCP prêt sur ${server.url}`);
    if (server.remoteUrl) {
      const file = join(app.getPath('userData'), 'mcp-remote-url.txt');
      await writeFile(file, server.remoteUrl + '\n', { mode: 0o600 });
      console.error(`[skaitch-mcp] Accès distant ouvert. URL secrète à donner au client : ${file}`);
    }
  } catch (error) {
    // Another skAItch window or app already uses the port: the editor works without MCP.
    console.error(`[skaitch-mcp] Serveur MCP indisponible sur 127.0.0.1:${port} : ${(error as Error).message}`);
  }
  return server;
}

/**
 * Step 6d: the built-in AI chat. Keys are encrypted with the system keychain and never
 * leave this process; each chat round streams its text to the window that asked.
 */
function startDesktopAi(window: BrowserWindow) {
  const keys = new AiKeyStore(join(app.getPath('userData'), 'ai-keys.json'), {
    encrypt: plain => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error(tr('Le trousseau du système est indisponible : impossible de protéger la clé IA.', 'The system keychain is unavailable: the AI key cannot be protected.'));
      return safeStorage.encryptString(plain);
    },
    decrypt: sealed => safeStorage.decryptString(sealed),
  });
  const running = new Map<string, AbortController>();
  const abortAll = () => { for (const controller of running.values()) controller.abort(); running.clear(); };
  window.webContents.on('did-start-navigation', details => {
    if (!details.isMainFrame || details.isSameDocument) return;
    diagnostics.write('ui.navigate', { abortedRequests: running.size });
    abortAll();
  });
  window.on('closed', abortAll);
  // A crashed or frozen page would stop the chat with no AI error: record why.
  window.webContents.on('render-process-gone', (_event, details) => { diagnostics.write('ui.renderer-gone', { reason: details.reason, exitCode: details.exitCode, abortedRequests: running.size }); });
  window.on('unresponsive', () => { diagnostics.write('ui.unresponsive', { abortedRequests: running.size }); });

  // The interface language, so that AI and key messages follow it rather than the system's.
  ipcMain.on('ui:lang', (event, lang: unknown) => { if (trustedSender(event.senderFrame)) setUiLanguage(lang); });
  handle('ai:keys', async () => ({ keys: await keys.list(), storage: keyStorage() }));
  handle('ai:set-key', async (provider: string, baseUrl: string | undefined, secret: string) => keys.set(String(provider), baseUrl ? String(baseUrl) : undefined, String(secret ?? '')));
  handle('ai', async (operation: string, data: unknown, requestId?: string) => {
    const controller = new AbortController();
    // With a request id, ai:abort can stop it (the model test's Cancel button).
    const id = requestId ? String(requestId) : '';
    if (id) running.set(id, controller);
    const timer = setTimeout(() => controller.abort(), 170_000);
    const op = String(operation);
    const started = Date.now();
    const target = aiTarget(data);
    try {
      const result = await runAiOperation(op, data, { keys }, controller.signal);
      diagnostics.write('ai.request', { operation: op, ...target, ms: Date.now() - started, ok: true });
      return result;
    } catch (error) {
      diagnostics.write('ai.request', { operation: op, ...target, ms: Date.now() - started, ok: false, aborted: controller.signal.aborted, error: errorText(error) });
      if (id && controller.signal.aborted) throw new Error(tr('Test annulé.', 'Test cancelled.'));
      throw error;
    } finally { clearTimeout(timer); if (id) running.delete(id); }
  });
  handle('ai:chat', async (requestId: string, data: unknown) => {
    const id = String(requestId);
    const controller = new AbortController();
    // No serverless limit here: reasoning models reading a plan image can take several minutes per round.
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, AI_CHAT_TIMEOUT_MS);
    running.set(id, controller);
    const started = Date.now();
    const target = aiTarget(data);
    try {
      const reply = await chat(data, { keys }, (chunk, thinking) => {
        if (!window.isDestroyed()) window.webContents.send('ai:chunk', { requestId: id, chunk, thinking });
      }, controller.signal);
      // A round with no tool call and no next turn is where a creation silently ends: record it.
      // Everything the model answered, and each action it asked for (tool name and arguments).
      diagnostics.write('ai.chat', {
        ...target, ms: Date.now() - started, ok: true,
        text: reply.text ?? '',
        toolUses: (reply.toolUses ?? []).map(use => ({ name: use.name, input: use.input })),
        next: reply.next ? 'continue' : 'end',
        round: reply.next?.round ?? null,
      });
      return reply;
    } catch (error) {
      diagnostics.write('ai.chat', { ...target, ms: Date.now() - started, ok: false, timedOut, aborted: controller.signal.aborted, error: errorText(error) });
      if (timedOut) throw new Error(tr(`Le fournisseur IA n’a pas répondu en ${AI_CHAT_TIMEOUT_MS / 60_000} minutes. Réessayez, ou choisissez un modèle plus rapide.`, `The AI provider did not answer within ${AI_CHAT_TIMEOUT_MS / 60_000} minutes. Try again, or choose a faster model.`));
      if (controller.signal.aborted) throw new Error(tr('Requête IA annulée.', 'AI request cancelled.'));
      throw error;
    } finally { clearTimeout(timer); running.delete(id); }
  });
  handle('ai:abort', async (requestId: string) => { running.get(String(requestId))?.abort(); });
  handle('logs:get', async () => ({ enabled: await diagnostics.isEnabled(), dir: diagnostics.dir }));
  handle('logs:set', async (enabled: unknown) => ({ enabled: await diagnostics.setEnabled(enabled === true), dir: diagnostics.dir }));
  handle('logs:open', async () => { await mkdir(diagnostics.dir, { recursive: true }); await shell.openPath(diagnostics.dir); });
}

/** Provider and model only: never the key. */
function aiTarget(data: unknown): { provider?: string; model?: string } {
  const ai = (data as { ai?: { provider?: unknown; model?: unknown } } | null)?.ai;
  return { provider: typeof ai?.provider === 'string' ? ai.provider : undefined, model: typeof ai?.model === 'string' ? ai.model : undefined };
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** How the keys are protected; on Linux without a keychain Electron falls back to plain text. */
function keyStorage() {
  if (!safeStorage.isEncryptionAvailable()) return 'unavailable';
  const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'system';
  return backend === 'basic_text' ? 'basic_text' : 'keychain';
}

app.whenReady().then(async () => {
  protocol.handle('app', serveRenderer);
  const libraryDir = process.env.SKAITCH_LIBRARY_DIR ?? join(app.getPath('documents'), 'skAItch');
  const library = new ProjectLibrary(libraryDir, __APP_VERSION__, path => shell.trashItem(path));

  // BIM engine: runs in this process. A very large IFC import blocks it; move to a utilityProcess if that hurts.
  handle('bim', async (operation: string, data: unknown) => {
    if (!isEngineOperation(operation)) throw new Error('Opération BIM indisponible dans l’application de bureau.');
    return runBimOperation(operation, operation === 'import-ifc' ? new Uint8Array(data as ArrayBuffer) : data);
  });
  handle('library:list', () => library.list());
  handle('library:read', (id: string) => library.read(id));
  handle('library:write', (id: string, patch: any) => library.write(id, patch));
  handle('library:delete', (id: string) => library.delete(id));
  handle('library:archive', (id: string, archived: boolean) => library.setArchived(id, archived));

  // Surveys sent from the phone on the local network (QR code pairing).
  const receiver = await startSurveyReceiver(join(app.getPath('userData'), 'survey-inbox')).catch(error => { console.error('[survey receiver]', error); return null; });
  const inbox = receiver && surveyInboxOps(receiver);
  const needInbox = () => { if (!inbox) throw new Error('Réception des relevés indisponible sur cet ordinateur.'); return inbox; };
  handle('survey:list', async () => needInbox().list());
  // Bytes cross the IPC bridge as base64 (results are passed as JSON).
  handle('survey:read-chunk', async (id: string, index: number) => Buffer.from(await needInbox().readChunk(String(id), Number(index))).toString('base64'));
  handle('survey:remove', async (id: string) => needInbox().remove(String(id)));
  handle('survey:keys', async () => needInbox().listKeys());
  handle('survey:create-key', async (name: string) => needInbox().createKey(String(name ?? '')));
  handle('survey:revoke-key', async (id: string) => needInbox().revokeKey(String(id)));
  app.on('will-quit', () => { void receiver?.close(); });

  const window = createWindow();
  startDesktopAi(window);
  const mcp = await startDesktopMcp(window, library);
  app.on('will-quit', () => { void mcp?.close(); });
  const smokeOut = process.env.SKAITCH_SMOKE_OUT;
  if (smokeOut) {
    await mkdir(smokeOut, { recursive: true });
    try {
      const report = process.env.SKAITCH_SMOKE_AI ? await checkAiProvider(window, process.env.SKAITCH_SMOKE_AI, process.env.SKAITCH_SMOKE_MODEL ?? '') : process.env.SKAITCH_SMOKE_IFC ? await captureIfcImport(window, smokeOut, process.env.SKAITCH_SMOKE_IFC) : process.env.SKAITCH_SMOKE_CHAT ? await captureChat(window, smokeOut, process.env.SKAITCH_SMOKE_CHAT, process.env.SKAITCH_SMOKE_PROMPT ?? '') : process.env.SKAITCH_SMOKE_TOUR ? await captureTour(window, smokeOut, process.env.SKAITCH_SMOKE_TOUR) : process.env.SKAITCH_SMOKE_PROJECT ? await captureProject(window, smokeOut, process.env.SKAITCH_SMOKE_PROJECT) : await runSmokeTest(window, smokeOut);
      await writeFile(join(smokeOut, 'report.json'), JSON.stringify(report, null, 2));
    } catch (error) {
      await writeFile(join(smokeOut, 'report.json'), JSON.stringify({ ok: false, error: String(error) }, null, 2));
    }
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
