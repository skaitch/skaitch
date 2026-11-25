import { expect, it } from 'vitest';
import { RendererCalls } from '../rendererCalls';

it('drops waiting calls when the window reloads, and refuses new ones until it is ready again', async () => {
  const calls = new RendererCalls(10_000);
  calls.ready(() => {});
  const waiting = calls.call('get_ifc_scene_overview', {});
  calls.detach();
  await expect(waiting).rejects.toThrow(/rechargée ou fermée/);
  await expect(calls.call('get_ifc_scene_overview', {})).rejects.toThrow(/pas prêt/);
});

it('ignores replies to unknown calls', () => {
  const calls = new RendererCalls();
  expect(() => calls.reply('nope', { result: 1 })).not.toThrow();
});
