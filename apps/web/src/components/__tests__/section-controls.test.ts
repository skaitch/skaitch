import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import FreeSection from '@skaitch/ui/components/canvas/FreeSection';
import SavedSectionsMenu from '@skaitch/ui/components/SavedSectionsMenu';
import ViewSelect from '@skaitch/ui/components/ViewSelect';
import { buildEmpty } from '@skaitch/core/data/starter';

const noop = () => {};
it('leaves no duplicate settings or saved-view buttons over the viewport', () => {
  const html = renderToStaticMarkup(createElement(FreeSection, {
    items: buildEmpty(), storeyId: 'storey', managing: false, ready: 0, loading: false,
    getContext: () => null, selection: [], setSelection: noop, addItem: noop,
  }));
  expect(html).not.toContain('<button');
  expect(html).not.toContain('id="section-settings"');
});

it('opens existing legacy cuts for editing when management is enabled by the toolbar', () => {
  const html = renderToStaticMarkup(createElement(FreeSection, {
    items: { cut: { id: 'cut', type: 'Section', name: 'Coupe existante', geom: { x1: 0, y1: 0, x2: 4, y2: 0 } } } as any,
    storeyId: 'storey', managing: true, ready: 0, loading: false, getContext: () => null,
    selection: ['cut'], setSelection: noop, addItem: noop,
  }));
  expect(html).toContain('id="section-settings"');
  expect(html).toContain('Coupe existante');
  expect(html).toContain('Définir un plan de coupe');
  expect(html).toContain('Enregistrer cette coupe');
  expect(html).not.toContain('Annuler le placement');
});

it('opens the saved section menu directly from the Coupe view button', () => {
  const html = renderToStaticMarkup(createElement(ViewSelect, {
    view: 'section', onChange: noop, lang: 'fr', tabs: true,
    sectionMenu: createElement(SavedSectionsMenu, { items: buildEmpty(), selection: [], active: true, lang: 'fr', onOpen: noop, onDelete: noop }),
  }));
  expect(html.match(/<button/g)).toHaveLength(4);
  expect(html).toContain('aria-label="Coupe" aria-pressed="true"');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html.indexOf('aria-label="Coupe"')).toBeLessThan(html.indexOf('>Feuilles'));
});

it('shows the requested panel while the 3D viewer is initializing', () => {
  const html = renderToStaticMarkup(createElement(FreeSection, {
    items: buildEmpty(), storeyId: 'storey', managing: true, ready: 0, loading: true,
    getContext: () => null, selection: [], setSelection: noop, addItem: noop,
  }));
  expect(html).toContain('id="section-settings"');
  expect(html).toContain('Préparation de la vue 3D');
  expect(html).toContain('<fieldset disabled=""');
});
