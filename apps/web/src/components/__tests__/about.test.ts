import { expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import About from '../About';

it('offers an accessible dialog trigger without expanding the header', () => {
  vi.stubGlobal('__BUILD_VERSION__', 'test-build');
  vi.stubGlobal('__RELEASE_VERSION__', '0.1.1');
  const html = renderToStaticMarkup(createElement(About, { lang: 'fr' }));
  expect(html).toContain('À propos');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain('test-build');
  vi.unstubAllGlobals();
});

it('labels each desktop installer by platform', async () => {
  const { installerLabel } = await import('../About');
  expect(installerLabel({ platform: 'windows', arch: 'x64', format: 'exe', url: '' })).toBe('Windows');
  expect(installerLabel({ platform: 'mac', arch: 'arm64', format: 'dmg', url: '' })).toBe('macOS (Apple Silicon)');
  expect(installerLabel({ platform: 'mac', arch: 'x64', format: 'dmg', url: '' })).toBe('macOS (Intel)');
  expect(installerLabel({ platform: 'linux', arch: 'x64', format: 'deb', url: '' })).toBe('Linux (.deb)');
  expect(installerLabel({ platform: 'linux', arch: 'x64', format: 'appimage', url: '' })).toBe('Linux (AppImage)');
});
