import { afterEach, expect, it, vi } from 'vitest';
import type { BimOperation } from '@skaitch/core/types/bim';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function runScript(code: string) {
  const calls: string[] = [];
  const worker = {
    onmessage: (_event: { data: unknown }): unknown => undefined,
    postMessage: vi.fn(),
  };
  worker.postMessage.mockImplementation(({ id, name, args }) => {
    if (id === undefined) return;
    calls.push(name);
    const value = name === 'list_spatial_structure'
      ? { storeys: [{ id: 'ground' }, { id: 'first' }] }
      : [{ id: args.storey_id + '-room' }];
    queueMicrotask(() => worker.onmessage({ data: { id, json: JSON.stringify(value) } }));
  });
  vi.stubGlobal('self', worker);
  await import('../../../../../packages/ui/src/lib/codeMode.worker');
  await worker.onmessage({ data: { code } });
  return { calls, result: worker.postMessage.mock.lastCall?.[0] };
}

it('chains and batches queries while isolating host globals and blocking mutations', async () => {
  const { calls, result } = await runScript(`
    const { storeys } = await callTool('list_spatial_structure');
    const rooms = await Promise.all(storeys.map(({ id }) =>
      callTool('list_ifc_entities', { storey_id: id, ifc_type: 'IfcSpace' })
    ));
    const blocked = await callTool('delete_element', { id: 'ground-room' });
    return { rooms: rooms.flat().map(room => room.id), blocked, fetch: typeof fetch, process: typeof process };
  `);
  expect(calls).toEqual(['list_spatial_structure', 'list_ifc_entities', 'list_ifc_entities']);
  expect(result).toEqual({ result: {
    rooms: ['ground-room', 'first-room'],
    blocked: { error: 'Tool unavailable in Code Mode' },
    fetch: 'undefined',
    process: 'undefined',
  } });
});

it('interrupts a script that loops indefinitely', async () => {
  const { result } = await runScript('while (true) {}');
  expect(result).toEqual({ error: 'Script execution interrupted.' });
});

it('sends only allowlisted queries to the BIM service with the captured project data', async () => {
  const { provideBimService } = await import('../../../../../packages/ui/src/lib/bimService');
  const { runCodeMode } = await import('../../../../../packages/ui/src/lib/codeMode');
  const request = vi.fn((_operation: BimOperation, _data: unknown) => ({ storeys: [] }));
  provideBimService({ request: async <T>(operation: BimOperation, data: unknown) => request(operation, data) as T });
  const items = {};
  const catalogue = [];
  const replies: unknown[] = [];
  const terminate = vi.fn();

  class WorkerDouble {
    onmessage?: (event: { data: unknown }) => void;
    terminate = terminate;
    postMessage(message: { code?: string; id?: number; json?: string }) {
      if (message.code) {
        this.onmessage?.({ data: { id: 1, name: 'delete_element', args: { id: 'x' } } });
        this.onmessage?.({ data: { id: 2, name: 'list_spatial_structure', args: {} } });
      } else {
        replies.push(JSON.parse(message.json!));
        if (message.id === 2) this.onmessage?.({ data: { result: replies } });
      }
    }
  }

  vi.stubGlobal('Worker', WorkerDouble);
  await expect(runCodeMode('return null', items, catalogue, new AbortController().signal)).resolves.toEqual({
    result: [{ error: 'Tool unavailable in Code Mode' }, { storeys: [] }],
  });
  expect(request).toHaveBeenCalledExactlyOnceWith('mcp-read', {
    name: 'list_spatial_structure', args: {}, items, catalogue,
  });
  expect(terminate).toHaveBeenCalledOnce();
});
