import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import Canvas2D from '@skaitch/ui/components/canvas/Canvas2D';
import StairTypePicker from '@skaitch/ui/components/canvas/StairTypePicker';
import { STAIR_FORMS, STAIR_DEFAULTS } from '@skaitch/core/lib/stairGeometry';

it('shows all five stair types as soon as the placement tool is active', () => {
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(Canvas2D, {
    items: {}, storeyId: 's', tool: 'Stair', setTool: noop,
    selection: [], setSelection: noop, addItem: noop, updateItem: noop, deleteItems: noop,
    showGrid: false, snapEnabled: false, snapSize: .1, t: k => k, lang: 'fr',
    view: { scale: 40, ox: 0, oy: 0 }, setView: noop,
  }));
  expect(html).toContain('Types d’escalier');
  for (const label of Object.values(STAIR_FORMS)) expect(html).toContain(label);
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
});

it('offers the landing choice for a turning stair before placement', () => {
  const html = renderToStaticMarkup(createElement(StairTypePicker, {
    form: 'quarter', landing: false, onFormChange: () => {}, onLandingChange: () => {}, onClose: () => {}, lang: 'fr',
  }));
  expect(html).toContain('marches balancées');
  expect(html).toContain('type="checkbox"');
  expect(html).not.toContain('checked=""');
});

it('exposes a rotation handle for a selected stair', () => {
  const noop=()=>{};
  const items:any={s:{id:'s',type:'Storey',geom:{elevation:0}},t:{id:'t',type:'Storey',geom:{elevation:3}},st:{id:'st',type:'Stair',parentId:'s',name:'Escalier',geom:{...STAIR_DEFAULTS,targetId:'t'}}};
  const html=renderToStaticMarkup(createElement(Canvas2D,{items,storeyId:'s',tool:'select',setTool:noop,selection:['st'],setSelection:noop,addItem:noop,updateItem:noop,deleteItems:noop,showGrid:false,snapEnabled:false,snapSize:.1,t:k=>k,lang:'fr',view:{scale:40,ox:0,oy:400},setView:noop}));
  expect(html).toContain('Tourner la sélection (Maj : pas de 15°)');
  expect(html).toContain('cy="434"');
  expect(html).toContain('Glisser pour régler la longueur de la volée');
  expect(html).toContain('V1 ·');
  expect(html).toContain('aria-label="Montée"');
  expect(html).toContain('marker-end="url(#arrow-normal)"');
});
