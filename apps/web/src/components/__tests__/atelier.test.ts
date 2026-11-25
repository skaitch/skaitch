import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ViewSelect from '@skaitch/ui/components/ViewSelect';
import ToolHint from '@skaitch/ui/components/ToolHint';
import BottomNav from '@skaitch/ui/components/mobile/BottomNav';
import type { ViewType } from '@skaitch/core/types/ifc';

const noop = () => {};
describe('Atelier navigation and drawing guidance', () => {
  it.each<[ViewType, string]>([['2d', 'Plan 2D'], ['3d', 'Vue 3D'], ['section', 'Coupe']])('shows the current %s view as an accessible menu trigger', (view, label) => {
    const html = renderToStaticMarkup(createElement(ViewSelect, { view, onChange: noop, lang: 'fr' }));
    expect(html).toContain(`aria-label="Vue · ${label}"`);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(`<span>${label}</span>`);
    expect(html).not.toContain('<select');
  });
  it('keeps mobile tree, tools, properties and selection count alongside the view picker', () => {
    const html = renderToStaticMarkup(createElement(BottomNav, {
      treeOpen: true, toolOpen: false, propsOpen: false, view: 'section', selectionCount: 2,
      onTreeToggle: noop, onToolToggle: noop, onViewChange: noop, onPropsToggle: noop, lang: 'fr',
    }));
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Vue · Coupe"');
    expect(html).toContain('>2</span>');
    expect(html.match(/<button/g)).toHaveLength(4);
  });
  it('explains the current wall drawing step and offers an explicit return to selection', () => {
    const props = { tool: 'Wall' as const, lang: 'fr', onSelect: noop };
    const initial = renderToStaticMarkup(createElement(ToolHint, props));
    const drawing = renderToStaticMarkup(createElement(ToolHint, { ...props, drawing: true }));
    expect(initial).toContain('commencer un mur');
    expect(drawing).toContain('terminer le segment');
    expect(drawing).toContain('Échap');
    expect(drawing).toContain('Sélection');
    expect(renderToStaticMarkup(createElement(ToolHint, { ...props, tool: 'select' }))).toBe('');
  });
  it.each(['Door', 'Window'] as const)('explains wall placement for %s', tool => {
    expect(renderToStaticMarkup(createElement(ToolHint, { tool, lang: 'fr', onSelect: noop }))).toContain('Cliquez sur un mur');
  });
});

it('retains the IFC properties inside a keyboard accessible disclosure', async () => {
  const { default: PropertiesPane } = await import('@skaitch/ui/components/panels/PropertiesPane');
  const { buildStarter } = await import('@skaitch/core/data/starter');
  const { makeT } = await import('@skaitch/core/data/i18n');
  const items = buildStarter();
  const wall = Object.values(items).find(item => item.type === 'Wall')!;
  const html = renderToStaticMarkup(createElement(PropertiesPane, {
    items, selection: [wall.id], updateItem: noop, addItem: noop, deleteItems: noop,
    tool: 'select', setTool: noop, t: makeT('fr'), lang: 'fr', openSettings: noop, onCollapse: noop,
  }));
  expect(html).toContain('<details class="section advanced-properties">');
  expect(html).toContain('<summary');
  expect(html).toContain('Pset_WallCommon');
  expect(html).toContain('ThermalTransmittance');
  expect(html).toContain('FireRating');
  expect(html).toContain('LoadBearing');
  expect(html).toContain('Géométrie');
  expect(html).toContain('Métadonnées');
});
