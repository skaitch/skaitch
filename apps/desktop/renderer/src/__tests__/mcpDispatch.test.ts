import { expect, it, vi } from 'vitest';
import { runDesktopTool, serialQueue, type DesktopToolContext } from '../mcpDispatch';

function context(active: string | null, result: unknown = { success: true }) {
  let current = active;
  const ctx = {
    activeProjectId: () => current,
    openProject: vi.fn(async ({ id }: { id: string }) => { setTimeout(() => { current = id; }, 0); }),
    execute: vi.fn(async () => result),
    flushProject: vi.fn(async () => {}),
    nextRender: () => new Promise<void>(resolve => setTimeout(resolve, 1)),
  } satisfies DesktopToolContext;
  return ctx;
}

it('select_project opens the project and waits until the editor shows it', async () => {
  const ctx = context(null);
  await expect(runDesktopTool(ctx, 'select_project', { project_id: 'p2' })).resolves.toEqual({ success: true, project_id: 'p2' });
  expect(ctx.openProject).toHaveBeenCalledWith({ id: 'p2' });
  expect(ctx.activeProjectId()).toBe('p2');
});

it('does not reopen the project already open', async () => {
  const ctx = context('p1');
  await runDesktopTool(ctx, 'select_project', { project_id: 'p1' });
  expect(ctx.openProject).not.toHaveBeenCalled();
});

it('asks the client to select a project when none is open', async () => {
  const ctx = context(null);
  expect(await runDesktopTool(ctx, 'get_ifc_scene_overview', {})).toEqual({ error: expect.stringMatching(/select_project/) });
  expect(ctx.execute).not.toHaveBeenCalled();
});

it('reads through the shared executor without saving', async () => {
  const ctx = context('p1', { storeys: [] });
  expect(await runDesktopTool(ctx, 'get_ifc_scene_overview', {})).toEqual({ storeys: [] });
  expect(ctx.execute).toHaveBeenCalledWith('get_ifc_scene_overview', {}, undefined);
  expect(ctx.flushProject).not.toHaveBeenCalled();
});

it('saves the project file after a confirmed change, not after a refused or failed one', async () => {
  const ok = context('p1', { success: true, id: 'w1' });
  await runDesktopTool(ok, 'create_wall', { start_point: [0, 0], end_point: [4, 0] });
  expect(ok.flushProject).toHaveBeenCalledOnce();

  const failed = context('p1', { error: 'Mur trop court' });
  await runDesktopTool(failed, 'create_wall', {});
  expect(failed.flushProject).not.toHaveBeenCalled();

  const refused = context('p1');
  refused.execute.mockRejectedValueOnce(new Error('Action refusée par l’utilisateur.'));
  await expect(runDesktopTool(refused, 'create_wall', {})).rejects.toThrow(/refusée/);
  expect(refused.flushProject).not.toHaveBeenCalled();
});

it('does not start a call the main process has already given up on', async () => {
  const ctx = context('p1');
  await expect(runDesktopTool(ctx, 'create_wall', {}, Date.now() - 1)).rejects.toThrow(/expiré/);
  expect(ctx.execute).not.toHaveBeenCalled();
});

it('passes the deadline to the executor', async () => {
  const ctx = context('p1');
  const expiresAt = Date.now() + 60_000;
  await runDesktopTool(ctx, 'create_wall', {}, expiresAt);
  expect(ctx.execute).toHaveBeenCalledWith('create_wall', {}, expiresAt);
});

it('runs a second call only once the first one is settled, even when the first fails', async () => {
  const enqueue = serialQueue();
  const order: string[] = [];
  let confirmFirst!: () => void;
  const first = enqueue(() => new Promise<void>((_resolve, reject) => { order.push('first starts'); confirmFirst = () => reject(new Error('refusée')); }));
  const second = enqueue(async () => { order.push('second starts'); return 2; });
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(order).toEqual(['first starts']);
  confirmFirst();
  await expect(first).rejects.toThrow('refusée');
  await expect(second).resolves.toBe(2);
  expect(order).toEqual(['first starts', 'second starts']);
});
