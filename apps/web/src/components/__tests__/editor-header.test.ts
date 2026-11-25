import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import EditorHeader from '@skaitch/ui/components/EditorHeader';
import ProjectActions from '@skaitch/ui/components/ProjectActions';
import ViewSelect from '@skaitch/ui/components/ViewSelect';

const noop = () => {};
it('keeps history availability and assistant state accessible in the shared header', () => {
  const html = renderToStaticMarkup(createElement(EditorHeader, {
    projectName: 'Maison · niveau principal', lang: 'fr', onHome: noop, undo: noop, redo: noop,
    canUndo: false, canRedo: true, onAssistant: noop, assistantOpen: true,
    options: createElement('button', {}, 'Réglages'),
    actions: createElement(ProjectActions, { lang: 'fr', onImport: noop, onImportBimwiq: noop, onImportSkaitch: noop, onSync: noop, onVerify: noop, onExport: noop }),
  }));
  expect(html).toContain('<header');
  expect(html).toContain('title="Maison · niveau principal"');
  expect(html).toContain('disabled="" title="Annuler · Ctrl+Z" aria-label="Annuler"');
  expect(html).not.toContain('disabled="" title="Rétablir');
  expect(html).toContain('aria-pressed="true" title="Assistant IA"');
  expect(html).toContain('aria-label="Plus"');
  expect(html).toContain('aria-label="Fichier"');
  expect(html).toContain('aria-label="Exporter"');
});

it('makes all desktop views directly accessible without a select menu', () => {
  const html = renderToStaticMarkup(createElement(ViewSelect, { view: 'section', onChange: noop, lang: 'fr', tabs: true }));
  expect(html.match(/<button/g)).toHaveLength(4); // Plan 2D, 3D, Coupe, Feuilles
  expect(html).toContain('>Feuilles<');
  expect(html).toContain('aria-pressed="true">Coupe');
  expect(html).not.toContain('<select');
});
