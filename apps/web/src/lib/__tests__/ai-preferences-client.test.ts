import { expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0, effects: [] as (() => void)[] }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.slots[hooks.index++] ??= { current: value },
  useEffect: (effect: () => any, deps: unknown[]) => {
    const slot = hooks.index++, previous = hooks.slots[slot];
    if (previous && deps.every((value, i) => value === previous.deps[i])) return;
    hooks.effects.push(() => { previous?.cleanup?.(); hooks.slots[slot] = { deps, cleanup: effect() }; });
  },
}));
vi.mock('../aiVaultClient', () => ({ getAiPreferences: vi.fn() }));
import { getAiPreferences } from '../aiVaultClient';
import { useAiPreferences } from '../../hooks/useAiPreferences';
import { aiPreferences } from '../aiPreferences';
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
it('preserves edits made during preference loading and ignores responses after an account change', async () => {
  let ai: any = { provider: 'openai', model: 'local', temperature: 0, apiKey: '' };
  const setAi = (update: any) => { ai = update(ai); };
  const fail = vi.fn();
  const pending: ((value: any) => void)[] = [];
  vi.mocked(getAiPreferences).mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  const render = (uid: string) => { hooks.index = 0; useAiPreferences(uid, ai, setAi, fail); hooks.effects.splice(0).forEach(effect => effect()); };
  render('u');
  ai.model = 'edited-while-loading';
  pending[0]({ revision: 1, config: aiPreferences({ provider: 'openai', model: 'remote', temperature: 0 }) });
  await tick();
  expect(ai.model).toBe('edited-while-loading');
  expect(ai.preferencesRevision).toBe(1);
  render('other'); render('third');
  pending[1]({ revision: 50, config: aiPreferences({ provider: 'openai', model: 'wrong-account', temperature: 0 }) });
  pending[2]({ revision: 2, config: aiPreferences({ provider: 'openai', model: 'third-account', temperature: 0 }) });
  await tick();
  expect(ai.model).toBe('third-account');
  expect(ai.preferencesRevision).toBe(2);
  expect(fail).not.toHaveBeenCalled();
});
