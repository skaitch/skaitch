import { MCP_MODEL_TOOLS } from '@skaitch/core/types/bim';

export interface DesktopToolContext {
  /** The project open in the editor, as the latest render sees it. */
  activeProjectId: () => string | null;
  openProject: (project: { id: string }) => Promise<void>;
  /** The shared executor: confirms changes with the user before applying them. */
  execute: (name: string, args: Record<string, unknown>, expiresAt?: number) => Promise<unknown>;
  /** Writes the open project to its library file. */
  flushProject: () => Promise<void>;
  /** Resolves once React has rendered pending state (tests pass an immediate one). */
  nextRender?: () => Promise<void>;
}

const OPEN_TIMEOUT = 10_000;
const frame = () => new Promise<void>(resolve => setTimeout(resolve, 16));

/**
 * Runs one MCP tool call coming from the main process against the open project.
 * The desktop app has a single local account, so there is nothing to authorize:
 * every tool works on whichever project the user (or `select_project`) opened.
 */
export async function runDesktopTool(context: DesktopToolContext, name: string, args: Record<string, unknown>, expiresAt?: number): Promise<unknown> {
  const nextRender = context.nextRender ?? frame;
  if (expiresAt !== undefined && Date.now() >= expiresAt) throw new Error('La demande MCP a expiré. Relancez la commande.');
  if (name === 'select_project') {
    const projectId = typeof args.project_id === 'string' ? args.project_id : '';
    if (!projectId) return { error: 'project_id est requis.' };
    if (context.activeProjectId() !== projectId) {
      await context.openProject({ id: projectId });
      // The next tool call must see the opened project's items, not the previous screen.
      const deadline = Date.now() + OPEN_TIMEOUT;
      while (context.activeProjectId() !== projectId) {
        if (Date.now() > deadline) throw new Error(`Le projet ${projectId} ne s’est pas ouvert.`);
        await nextRender();
      }
      await nextRender();
    }
    return { success: true, project_id: projectId };
  }
  if (!context.activeProjectId()) {
    return { error: 'Aucun projet ouvert. Appelez list_projects puis select_project(project_id).' };
  }
  const result = await context.execute(name, args, expiresAt);
  if ((name === 'apply_model_batch' || MCP_MODEL_TOOLS.includes(name)) && !(result as { error?: unknown } | null)?.error) {
    // Let React apply the confirmed change, then save it so the file matches what the client was told.
    await nextRender();
    await context.flushProject();
  }
  return result;
}

/**
 * Runs calls one after the other. The shared executor previews a change before asking for
 * confirmation; a second call during that preview would otherwise skip the confirmation,
 * and saving one accepted change would also save another call's unconfirmed preview.
 */
export function serialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.catch(() => {}).then(task);
    tail = run;
    return run;
  };
}
