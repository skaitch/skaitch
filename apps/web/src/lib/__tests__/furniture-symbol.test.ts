import { createElement } from 'react';
import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderElementSvg } from '@skaitch/ui/data/elementSvg';

it('draws the WC rear at the top of its footprint, not inset like a decorative thumbnail', () => {
  const svg = renderToStaticMarkup(createElement('svg', null, renderElementSvg('sdb-wc', 40, 65)));
  // The full-scale plan symbol must put its rear on y=0 and centre on x=width/2.
  const tank = /<rect[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*width="([^"]+)"/.exec(svg)!;
  expect(Number(tank[2])).toBe(0);
  expect(Number(tank[1]) + Number(tank[3]) / 2).toBe(20);
  expect(svg).not.toContain('translate(');
});
