import { CODE_MODE_TOOLS } from '@skaitch/core/ai/tools';
import type { ElementDef } from '@skaitch/core/data/elementCatalogue';
import type { ItemsMap } from '@skaitch/core/types/ifc';
import { requestBim } from './bimService';

export async function runCodeMode(code: unknown, items: ItemsMap, catalogue: ElementDef[], signal: AbortSignal): Promise<unknown> {
  if (typeof code !== 'string' || !code.trim() || code.length > 20_000) {
    throw new Error('Provide a JavaScript script of up to 20,000 characters.');
  }
  signal.throwIfAborted();
  const worker = new Worker(new URL('./codeMode.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    let finished = false;
    let calls = 0;
    let toolQueue = Promise.resolve();
    const abort = () => finish(() => reject(signal.reason));
    const timeout = setTimeout(() => finish(() => reject(new Error('Script timed out.'))), 15_000);
    function finish(settle: () => void) {
      finished = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      worker.terminate();
      settle();
    }
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (finished) return;
      if (data.id === undefined) {
        finish(() => {
          if (data.error !== undefined) reject(new Error(data.error));
          else resolve({ result: data.result });
        });
        return;
      }
      toolQueue = toolQueue.then(async () => {
        if (finished) return;
        let json: string;
        try {
          if (++calls > 100 || !CODE_MODE_TOOLS.some(tool => tool === data.name)) {
            throw new Error('Tool unavailable in Code Mode');
          }
          const result = await requestBim('mcp-read', { name: data.name, args: data.args, items, catalogue });
          json = JSON.stringify(result ?? null);
          if (json.length > 500_000) throw new Error('Tool result is too large; narrow the query');
        } catch (error) {
          json = JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
        }
        if (!finished) worker.postMessage({ id: data.id, json });
      });
    };
    worker.onerror = () => finish(() => reject(new Error('Script runtime could not start.')));
    worker.onmessageerror = () => finish(() => reject(new Error('Script result could not be read.')));
    try {
      worker.postMessage({ code });
    } catch (error) {
      finish(() => reject(error));
    }
  });
}
