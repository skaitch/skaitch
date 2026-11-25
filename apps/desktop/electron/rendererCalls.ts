import { randomUUID } from 'node:crypto';

/** Longer than the editor's own 120 s confirmation window, so the editor's message wins. */
export const RENDERER_CALL_TIMEOUT = 125_000;

/** `expiresAt`: after this time (ms) main has given up, so the editor must not run the call. */
export type McpCall = { id: string; name: string; args: Record<string, unknown>; expiresAt: number };
export type McpOutcome = { result: unknown } | { error: string };

/**
 * Sends MCP tool calls to the editor window and matches its replies.
 * The window says when it listens (`ready`); a reload or a closed window drops every waiting call.
 */
export class RendererCalls {
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private send: ((call: McpCall) => void) | null = null;

  constructor(private timeout = RENDERER_CALL_TIMEOUT) {}

  /** The editor listens for tool calls (MCP turned on in its settings). */
  get listening() {
    return this.send !== null;
  }

  ready(send: (call: McpCall) => void) {
    this.send = send;
  }

  /** The window reloaded, navigated or closed. */
  detach(reason = 'La fenêtre de skAItch a été rechargée ou fermée. Relancez la commande.') {
    this.send = null;
    for (const [id, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject(new Error(reason));
      this.pending.delete(id);
    }
  }

  call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const send = this.send;
    if (!send) return Promise.reject(new Error('L’éditeur skAItch n’est pas prêt. Ouvrez l’application de bureau et réessayez.'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pas de réponse de l’éditeur après ${Math.round(this.timeout / 1000)} s (outil ${name}).`));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      send({ id, name, args, expiresAt: Date.now() + this.timeout - 5_000 });
    });
  }

  reply(id: string, outcome: McpOutcome) {
    const call = this.pending.get(id);
    if (!call) return;
    this.pending.delete(id);
    clearTimeout(call.timer);
    if ('error' in outcome) call.reject(new Error(outcome.error));
    else call.resolve(outcome.result);
  }
}
