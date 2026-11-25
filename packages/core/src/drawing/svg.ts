import type { Bounds, Drawing, Pen, Point, Primitive } from './plan.js';

export interface SvgOptions {
  /** Scale denominator: 100 → 1:100 (1 m = 10 mm on paper). */
  scale: number;
  /** Blank margin around the drawing, in paper mm. */
  margin?: number;
  /** Model region to draw (crop), in metres; defaults to the drawing's bounds. */
  region?: Bounds;
  fontFamily?: string;
  background?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const num = (v: number) => (Math.round(v * 1000) / 1000).toString();

function penAttrs(pen: Pen | undefined): string {
  if (!pen) return ' stroke="none"';
  let s = ` stroke="${pen.color ?? '#000000'}" stroke-width="${num(pen.weight)}" stroke-linejoin="round" stroke-linecap="round"`;
  if (pen.dash?.length) s += ` stroke-dasharray="${pen.dash.map(num).join(' ')}"`;
  return s;
}

/** Paper size in mm of a drawing at a scale. */
export function paperSize(drawing: Drawing, options: SvgOptions): { width: number; height: number } {
  const r = options.region ?? drawing.bounds, k = 1000 / options.scale, m = options.margin ?? 0;
  return { width: (r.maxX - r.minX) * k + 2 * m, height: (r.maxY - r.minY) * k + 2 * m };
}

/** Standalone SVG whose user unit is one paper millimetre; width/height carry "mm" so it prints to scale. */
export function toSvg(drawing: Drawing, options: SvgOptions): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${svgSizeAttrs(drawing, options)}>${toSvgGroup(drawing, options)}</svg>`;
}

function svgSizeAttrs(drawing: Drawing, options: SvgOptions): string {
  const { width, height } = paperSize(drawing, options);
  return `width="${num(width)}mm" height="${num(height)}mm" viewBox="0 0 ${num(width)} ${num(height)}"`;
}

/**
 * The drawing as an SVG <g> in paper mm, origin at its top-left margin corner.
 * A sheet places it with a translate(); this is the building block for sheet layout.
 */
export function toSvgGroup(drawing: Drawing, options: SvgOptions): string {
  const r = options.region ?? drawing.bounds, k = 1000 / options.scale, m = options.margin ?? 0;
  const font = options.fontFamily ?? 'Helvetica, Arial, sans-serif';
  const X = (p: Point) => (p[0] - r.minX) * k + m;
  const Y = (p: Point) => (r.maxY - p[1]) * k + m;
  const pts = (ps: Point[]) => ps.map((p) => `${num(X(p))},${num(Y(p))}`).join(' ');
  const { width, height } = paperSize(drawing, options);

  const body: string[] = [];
  if (options.background) body.push(`<rect width="${num(width)}" height="${num(height)}" fill="${options.background}"/>`);
  for (const p of drawing.primitives) body.push(primitiveSvg(p, X, Y, pts, font));
  // A cropped region is clipped by the enclosing <svg> viewport (toSvg) or the sheet's view frame.
  return `<g>${body.join('')}</g>`;
}

function primitiveSvg(p: Primitive, X: (p: Point) => number, Y: (p: Point) => number, pts: (ps: Point[]) => string, font: string): string {
  const data = p.id ? ` data-id="${esc(p.id)}"` : '';
  const cls = ` class="${p.layer}"`;
  switch (p.kind) {
    case 'polygon':
      if (p.holes?.length) {
        const d = [p.points, ...p.holes].map((loop) => `M${pts(loop).replace(/ /g, ' L')} Z`).join(' ');
        return `<path${cls}${data} d="${d}" fill-rule="evenodd" fill="${p.fill ?? 'none'}"${penAttrs(p.pen)}/>`;
      }
      return `<polygon${cls}${data} points="${pts(p.points)}" fill="${p.fill ?? 'none'}"${penAttrs(p.pen)}/>`;
    case 'polyline':
      return `<polyline${cls}${data} points="${pts(p.points)}" fill="none"${penAttrs(p.pen)}/>`;
    case 'text': {
      const x = X(p.at), y = Y(p.at), a = p.angle ?? 0;
      const rot = a ? ` transform="rotate(${num(-a)} ${num(x)} ${num(y)})"` : '';
      return `<text${cls}${data} x="${num(x)}" y="${num(y - (p.shift ?? 0))}"${rot} font-family="${esc(font)}" font-size="${num(p.size)}"`
        + `${p.bold ? ' font-weight="bold"' : ''} text-anchor="${p.anchor ?? 'start'}" fill="${p.color ?? '#000000'}">${esc(p.text)}</text>`;
    }
  }
}
