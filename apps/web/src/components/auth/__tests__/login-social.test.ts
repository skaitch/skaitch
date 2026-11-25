import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ updates: [] as unknown[][], google: vi.fn(), apple: vi.fn() }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ signInWithGoogle: state.google, signInWithApple: state.apple }) }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: vi.fn(),
  useState: (initial: unknown) => {
    const updates: unknown[] = [];
    state.updates.push(updates);
    return [typeof initial === 'function' ? initial() : initial, (value: unknown) => updates.push(value)];
  },
}));
import LoginPage from '../LoginPage';
function googleButton(element: any): any {
  if (!element || typeof element !== 'object') return null;
  const children = element.props?.children;
  if (element.type === 'button' && Array.isArray(children) && children.some((child: any) => child?.props?.children === 'Continuer avec Google')) return element;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = googleButton(child);
    if (found) return found;
  }
  return null;
}
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => { state.updates = []; state.google.mockReset(); vi.stubGlobal('window', { innerWidth: 1200 }); });
it('handles a rejected Google popup and clears the loading state', async () => {
  state.google.mockRejectedValue({ code: 'auth/unauthorized-domain' });
  const button = googleButton(LoginPage({ lang: 'fr', onLangChange: vi.fn() }));
  expect(button).not.toBeNull();
  await expect(button.props.onClick()).resolves.toBeUndefined();
  expect(state.updates[3]).toEqual(['', 'auth/unauthorized-domain']);
  expect(state.updates[4]).toEqual([true, false]);
});
it('clears a previous error when Google sign-in succeeds', async () => {
  state.google.mockResolvedValue({ user: { uid: 'u' } });
  await googleButton(LoginPage({ lang: 'fr', onLangChange: vi.fn() })).props.onClick();
  expect(state.updates[3]).toEqual(['']);
  expect(state.updates[4]).toEqual([true, false]);
});
