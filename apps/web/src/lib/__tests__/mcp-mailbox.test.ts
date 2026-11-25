import { expect, it, vi } from 'vitest';
const memory = vi.hoisted(() => ({ data: {} as any, queue: Promise.resolve() }));
vi.mock('../firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ runTransaction: (_db: unknown, callback: any) => {
  const pending = memory.queue.then(() => callback({
    get: async () => ({ exists: () => true, data: () => memory.data }),
    update: (_ref: unknown, patch: any) => { memory.data = { ...memory.data, ...patch }; },
  }));
  memory.queue = pending.then(() => undefined);
  return pending;
} }));
import { claimMcpRequest } from '../mcpMailbox';
it('allows one browser to claim a request and rejects stale or invalid timestamps', async () => {
  memory.data = { createdAt: new Date().toISOString() };
  expect(await Promise.all([claimMcpRequest({} as any), claimMcpRequest({} as any)])).toEqual([true, false]);
  for (const createdAt of ['invalid', new Date(Date.now() - 120_001).toISOString(), new Date(Date.now() + 60_000).toISOString()]) {
    memory.data = { createdAt };
    expect(await claimMcpRequest({} as any)).toBe(false);
    expect(memory.data.claimed).toBeUndefined();
  }
});
