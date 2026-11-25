import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import Canvas2D from '@skaitch/ui/components/canvas/Canvas2D';
import type { ItemsMap } from '@skaitch/core/types/ifc';
it('draws a right-operation door with its hinge at the right jamb even with legacy left geometry', () => {
  const items = {
    w: { id: 'w', type: 'Wall', parentId: 's', geom: { x1: 0, y1: 0, x2: 6, y2: 0, thickness: 0.2 } },
    d: { id: 'd', type: 'Door', name: 'Door', parentId: 's', OperationType: 'SINGLE_SWING_RIGHT', geom: { wallId: 'w', t: 0.5, width: 1, height: 2.1, swing: 'left', side: 1 } },
  } as unknown as ItemsMap;
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(Canvas2D, { items, storeyId: 's', tool: 'select', setTool: noop, selection: [], setSelection: noop, addItem: noop, updateItem: noop, deleteItems: noop, showGrid: false, snapEnabled: false, snapSize: 0.1, t: k => k, lang: 'fr', view: { scale: 100, ox: 0, oy: 400 }, setView: noop, showLabels: false, showDimensions: false }));
  // Hinge at the right jamb (x = 3.5 m → 350 px), leaf open 1 m towards +y (screen up from oy = 400).
  expect(html).toContain('points="350,400 350,300"');
});
