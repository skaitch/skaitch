import { expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0, effects: [] as (() => void)[] }));
vi.mock('react', () => ({
  useRef: (value: unknown) => {
    const slot = hooks.index++;
    return hooks.slots[slot] ??= { current: value };
  },
  useState: (value: unknown) => {
    const slot = hooks.index++;
    hooks.slots[slot] ??= { value, set: (next: unknown) => { hooks.slots[slot].value = next; } };
    return [hooks.slots[slot].value, hooks.slots[slot].set];
  },
  useEffect: (effect: () => any, deps: unknown[]) => {
    const slot = hooks.index++;
    const previous = hooks.slots[slot];
    if (previous && deps.every((value, i) => value === previous.deps[i])) return;
    hooks.effects.push(() => { previous?.cleanup?.(); hooks.slots[slot] = { deps, cleanup: effect() }; });
  },
}));
vi.mock('../bimClient', () => ({ requestBim: vi.fn() }));
import { requestBim } from '../bimClient';
import { useCloudMcpSettings } from '../../hooks/useCloudMcpSettings';
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

it('serializes rapid toggles so confirmation cannot remain disabled behind an enabled UI', async () => {
  let ai: any = { mcpEnabled: true, mcpAlwaysValidate: true };
  const setAi = (update: any) => { ai = typeof update === 'function' ? update(ai) : update; };
  const fail = vi.fn();
  const render = () => {
    hooks.index = 0;
    const ready = useCloudMcpSettings('u', ai, setAi, fail);
    hooks.effects.splice(0).forEach(effect => effect());
    return ready;
  };
  let complete!: (settings: unknown) => void;
  vi.mocked(requestBim).mockImplementation(async (_operation, data: any) => {
    if (data.action === 'get') return { enabled: true, alwaysValidate: true, revision: 0 } as any;
    if (data.expectedRevision === 0) return new Promise(resolve => { complete = resolve; });
    return { enabled: data.enabled, alwaysValidate: data.alwaysValidate, revision: data.expectedRevision + 1 } as any;
  });
  expect(render()).toBe(false);
  await tick(); expect(render()).toBe(true);
  ai = { ...ai, mcpAlwaysValidate: false }; render(); await tick();
  ai = { ...ai, mcpAlwaysValidate: true }; render(); await tick();
  complete({ enabled: true, alwaysValidate: false, revision: 1 });
  await tick();
  const writes = vi.mocked(requestBim).mock.calls.map(call => call[1] as any).filter(data => data.action === 'set');
  expect(writes.map(data => [data.alwaysValidate, data.expectedRevision])).toEqual([[false, 0], [true, 1]]);
  expect(ai.mcpAlwaysValidate).toBe(true);
  expect(fail).not.toHaveBeenCalled();
});
