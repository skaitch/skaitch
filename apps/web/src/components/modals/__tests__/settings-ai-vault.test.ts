import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../../hooks/useApiKeys', () => ({ useApiKeys: () => ({ keys: [], loading: false }) }));
import SettingsModal from '../SettingsModal';
import { makeT } from '@skaitch/core/data/i18n';
import { LEGACY_AI_KEY } from '../../../lib/aiVaultClient';
afterEach(() => vi.unstubAllGlobals());
it('shows stored-key management and an explicit migration without exposing stored or legacy secrets', () => {
  vi.stubGlobal('window', { location: { hostname: 'app.example', origin: 'https://app.example' } });
  vi.stubGlobal('localStorage', { getItem: (name: string) => name === LEGACY_AI_KEY ? JSON.stringify([{ provider: 'openai', apiKey: 'legacy-secret-not-in-html' }]) : null });
  const html = renderToStaticMarkup(createElement(SettingsModal, {
    open: true, onClose() {}, setAi() {}, t: makeT('fr'), lang: 'fr', onLangChange() {}, uid: 'u', projects: [],
    ai: { provider: 'openai', model: 'm', apiKey: '', temperature: 0, visualizerProvider: 'pollinations', credentials: [{ id: 'a'.repeat(64), role: 'chat', provider: 'openai', origin: 'https://api.openai.com', version: 1 }] },
  }));
  expect(html).toContain('Enregistrer les préférences IA');
  expect(html).toContain('Recharger les préférences IA');
  expect(html).toContain('Clé enregistrée pour ce compte');
  expect(html).toContain('Remplacer la clé');
  expect(html).toContain('Supprimer la clé');
  expect(html).toContain('Transférer les clés cloud vers ce compte');
  expect(html).not.toContain('legacy-secret-not-in-html');
  expect(html).not.toContain('a'.repeat(64));
});
