import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SettingsModal from '../SettingsModal';
import HomePage from '@skaitch/ui/components/HomePage';
import { makeT } from '@skaitch/core/data/i18n';
import type { AiConfig } from '@skaitch/core/types/ifc';
import type { User } from 'firebase/auth';
vi.mock('../../../hooks/useApiKeys', () => ({ useApiKeys: () => ({ keys: [], loading: false, createKey: vi.fn(), deleteKey: vi.fn(), updatePermissions: vi.fn() }) }));
const noop = () => {};
afterEach(() => vi.unstubAllGlobals());
it('opens application settings from home without exposing project-specific controls', () => {
  vi.stubGlobal('window', { location: { hostname: 'localhost', origin: 'http://localhost:5174' } });
  const html = renderToStaticMarkup(createElement(SettingsModal, {
    applicationOnly: true, open: true, onClose: noop, ai: { provider: 'gemini' } as AiConfig,
    setAi: noop, t: makeT('fr'), lang: 'fr', onLangChange: noop, projects: [], uid: null,
  }));
  expect(html).toContain('role="dialog"');
  expect(html).toContain('aria-label="Réglages"');
  expect(html).toContain('Langue');
  expect(html).toContain('Serveur MCP');
  expect(html).not.toContain('>IFC<');
  expect(html).not.toContain('>Unités<');
  expect(html).not.toContain('Résidence Les Tilleuls');
  expect(html).not.toContain('Atelier Saint-Marc');
  expect(html).not.toContain('lambert93');
});
it('keeps an accessible settings entry on the projects home page', () => {
  vi.stubGlobal('__BUILD_VERSION__', 'test-build');
  vi.stubGlobal('__RELEASE_VERSION__', '0.3.4');
  const html = renderToStaticMarkup(createElement(HomePage, {
    projects: [], loading: false, user: { displayName: 'Test' } as User, lang: 'fr',
    onLogout: noop, onLangChange: noop, onOpen: noop, onCreate: noop, onEdit: noop,
    onDuplicate: noop, onDelete: noop, onArchive: noop, onImportIFC: noop, onImportSkaitch: noop,
    onLoadSample: noop, onSettings: noop,
  }));
  expect(html).toContain('aria-label="Réglages"');
});
