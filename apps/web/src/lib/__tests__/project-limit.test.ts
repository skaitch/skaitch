import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { canAddProject, WEB_PROJECT_LIMIT } from '@skaitch/core/lib/projectLimit';
import HomePage from '@skaitch/ui/components/HomePage';
import BetaBanner from '../../components/BetaBanner';
import { webPlatform } from '../../platform';

const meta = (id: string) => ({ id, name: id, description: '', createdAt: '2026-11-15', updatedAt: '2026-11-15' });
const noop = () => {};
const home = (count: number, projectLimit?: number, archived = 0) => renderToStaticMarkup(createElement(HomePage, {
  projects: Array.from({ length: count }, (_, i) => ({ ...meta(`p${i}`), ...(i < archived ? { archivedAt: '2026-11-20' } : {}) })), user: null, lang: 'fr', onLangChange: noop,
  onOpen: noop, onCreate: noop, onEdit: noop, onDuplicate: noop, onDelete: noop, onArchive: noop, onImportIFC: noop,
  onImportBimwiq: noop, onImportSkaitch: noop, onSettings: noop, onLoadSample: noop, projectLimit,
}));

it('caps web accounts at three projects and leaves unlimited hosts alone', () => {
  expect(WEB_PROJECT_LIMIT).toBe(3);
  expect(webPlatform.projectLimit).toBe(3);
  expect([0, 2, 3, 5].map(n => canAddProject(n, 3))).toEqual([true, true, false, false]);
  expect(canAddProject(1000, undefined)).toBe(true);
});

it('disables creation and imports on the home page once the limit is reached', () => {
  const full = home(3, 3);
  expect(full).toContain('3/3 projets');
  expect(full).toContain('Limite atteinte (3 projets pendant la bêta, archivés compris)');
  expect(full.match(/<button[^>]*disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
  const open = home(2, 3);
  expect(open).toContain('2/3 projets');
  expect(open).not.toContain('Limite atteinte');
  expect(open).not.toMatch(/<button[^>]*disabled=""/);
  expect(home(5)).not.toContain('Limite atteinte');
});

it('counts archived projects toward the limit', () => {
  const full = home(3, 3, 2);
  expect(full).toContain('3/3 projets');
  expect(full).toContain('Limite atteinte');
  expect(full).toContain('Actifs · 1');
  expect(full).toContain('Archivés · 2');
});

it('renders the beta badge in French and English', () => {
  expect(renderToStaticMarkup(createElement(BetaBanner, { lang: 'fr', projectLimit: 3 }))).toContain('Bêta');
  expect(renderToStaticMarkup(createElement(BetaBanner, { lang: 'en', projectLimit: 3 }))).toContain('up to 3 projects');
});
