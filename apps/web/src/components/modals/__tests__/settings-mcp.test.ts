import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SettingsModal from '../SettingsModal';
import { makeT } from '@skaitch/core/data/i18n';
import type { AiConfig } from '@skaitch/core/types/ifc';

const state = vi.hoisted(() => ({ mode: undefined as 'local' | 'cloud' | undefined }));
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return {
    ...react,
    useState: (initial: unknown) => react.useState(
      initial === 'ai' ? 'mcp_api_keys'
        : (initial === 'local' || initial === 'cloud') ? state.mode ?? initial : initial,
    ),
  };
});
vi.mock('../../../hooks/useApiKeys', () => ({
  useApiKeys: () => ({
    keys: [{ id: 'ak_private_test_key', name: 'My assistant', permissions: {} }],
    loading: false, createKey: vi.fn(), deleteKey: vi.fn(), updatePermissions: vi.fn(),
  }),
}));

function render(hostname: string, enabled = true, uid: string | null = 'user') {
  vi.stubGlobal('window', { location: { hostname, origin: `https://${hostname}` } });
  return renderToStaticMarkup(createElement(SettingsModal, {
    open: true, onClose: () => {}, ai: { mcpEnabled: enabled } as AiConfig,
    setAi: () => {}, t: makeT('fr'), lang: 'fr', onLangChange: () => {}, uid,
    projects: [{ id: 'project', name: 'House', description: '', createdAt: '', updatedAt: '' }],
  }));
}

afterEach(() => { vi.unstubAllGlobals(); state.mode = undefined; });

describe('MCP settings', () => {
  it('guides remote users through access and connection without local configuration', () => {
    const html = render('skaitch.example');
    expect(html).toContain('Serveur MCP');
    expect(html.indexOf('1. Autoriser')).toBeLessThan(html.indexOf('2. Connecter'));
    expect(html).toContain('https://skaitch.example/api/mcp');
    expect(html).toContain('mcp-remote');
    expect(html).toContain('<summary>Réglages OAuth avancés</summary>');
    expect(html).not.toContain('Serveur Local');
    expect(html).not.toContain('/ABSOLUTE/PATH');
    expect(html).not.toContain('SKAITCH_API_KEY');
    expect(html).not.toContain('ak_private_test_key');
  });

  it('offers assistant downloads and an explicit server/editor test without exposing keys', () => {
    const html = render('skaitch.example');
    expect(html).toContain('Connecter mon assistant IA');
    expect(html).toContain('Gemini CLI');
    expect(html).toContain('ChatGPT');
    expect(html).toContain('Télécharger la configuration');
    expect(html).toContain('Tester la connexion');
    expect(html).not.toContain('ak_private_test_key');
  });
  it('cannot show local configuration on a remote host even with a stale local selection', () => {
    state.mode = 'local';
    expect(render('skaitch.example')).not.toContain('/ABSOLUTE/PATH');
  });

  for (const hostname of ['localhost', '127.0.0.1', '[::1]', 'app.localhost']) {
    it(`offers local configuration for ${hostname}`, () => {
      const html = render(hostname);
      expect(html).toContain('Serveur Local');
      expect(html).toContain('/ABSOLUTE/PATH/SkAItch/server/mcp-server.ts');
      expect(html).toContain('SKAITCH_API_KEY');
      expect(html).toContain('<details open="">');
      expect(html).not.toContain('ak_private_test_key');
    });
  }

  it('still allows the HTTP configuration when running locally', () => {
    state.mode = 'cloud';
    const html = render('localhost');
    expect(html).toContain('mcp-remote');
    expect(html).not.toContain('/ABSOLUTE/PATH');
  });

  it('does not treat lookalike hostnames as local', () => {
    expect(render('localhost.example')).not.toContain('/ABSOLUTE/PATH');
  });

  it('reflects MCP activation and labels project permissions', () => {
    expect(render('skaitch.example')).toContain('type="checkbox" checked=""');
    const disabled = render('skaitch.example', false, null);
    expect(disabled).not.toContain('type="checkbox" checked=""');
    expect(disabled).toContain('aria-label="Droits d&#x27;accès aux projets — House"');
    expect(disabled).toContain('<option value="none" selected="">');
    expect(disabled).toContain('disabled=""');
  });
});
