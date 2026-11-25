import { memo } from 'react';
import type { Pen, Point, Primitive } from '@skaitch/core/drawing/plan';

/** Screen look of one primitive: colours come from the theme, selection and hover state. */
export interface PrimitiveStyle { stroke?: string; fill?: string; fillOpacity?: number; strokeOpacity?: number }

interface Props {
  primitives: Primitive[];
  /** Drawing metres → the SVG's user units (screen pixels in the plan, metres in the section). */
  w2s: (x: number, y: number) => [number, number];
  /** SVG user units per paper millimetre, for pen weights, dashes and text sizes. */
  unitsPerMm?: number;
  /** Thinnest stroke drawn, in user units, so hairlines stay visible on screen. */
  minStroke?: number;
  styleOf?: (p: Primitive) => PrimitiveStyle | undefined;
  /** When set, shapes with an id are clickable and select it; otherwise the layer ignores the pointer. */
  onSelect?: (id: string) => void;
  /** Tooltip for clickable shapes. */
  titleOf?: (id: string) => string | undefined;
  fontFamily?: string;
}

/** Renders drawing-engine primitives: the same drawing the sheets print, with the editor's colours. */
function PlanPrimitives({ primitives, w2s, unitsPerMm = 3, minStroke = 0.8, styleOf, onSelect, titleOf, fontFamily = 'var(--font-sans)' }: Props) {
  const pts = (ps: Point[]) => ps.map((p) => w2s(p[0], p[1]).join(',')).join(' ');
  const pen = (q: Pen | undefined, s: PrimitiveStyle | undefined) => q
    ? { stroke: s?.stroke ?? q.color ?? 'var(--ink)', strokeWidth: Math.max(minStroke, q.weight * unitsPerMm),
        strokeDasharray: q.dash?.map((d) => d * unitsPerMm).join(' '), strokeOpacity: s?.strokeOpacity,
        strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }
    : { stroke: 'none' };
  const interactive = (p: Primitive) => (onSelect && p.id ? {
    style: { cursor: 'pointer' }, pointerEvents: 'visiblePainted' as const,
    onClick: (e: { stopPropagation(): void }) => { e.stopPropagation(); onSelect(p.id!); },
  } : {});
  const title = (p: Primitive) => {
    const t = onSelect && p.id ? titleOf?.(p.id) : undefined;
    return t ? <title>{t}</title> : null;
  };
  return (
    <g pointerEvents="none">
      {primitives.map((p, i) => {
        const s = styleOf?.(p);
        if (p.kind === 'polygon' && p.holes?.length) {
          const d = [p.points, ...p.holes].map((loop) => `M${pts(loop).replace(/ /g, ' L')} Z`).join(' ');
          return <path key={i} d={d} fillRule="evenodd" fill={s?.fill ?? p.fill ?? 'none'} fillOpacity={s?.fillOpacity} {...pen(p.pen, s)} {...interactive(p)}>{title(p)}</path>;
        }
        if (p.kind === 'polygon') {
          return <polygon key={i} points={pts(p.points)} fill={s?.fill ?? p.fill ?? 'none'} fillOpacity={s?.fillOpacity} {...pen(p.pen, s)} {...interactive(p)}>{title(p)}</polygon>;
        }
        if (p.kind === 'polyline') return <polyline key={i} points={pts(p.points)} fill="none" {...pen(p.pen, s)} {...interactive(p)}>{title(p)}</polyline>;
        const [x, y] = w2s(p.at[0], p.at[1]);
        const shift = (p.shift ?? 0) * unitsPerMm;
        return (
          <text key={i} x={x} y={y - shift} fontSize={p.size * unitsPerMm} fontFamily={fontFamily} fontWeight={p.bold ? 600 : undefined}
            textAnchor={p.anchor ?? 'start'} fill={s?.stroke ?? p.color ?? 'var(--ink)'}
            transform={p.angle ? `rotate(${-p.angle} ${x} ${y})` : undefined}>{p.text}</text>
        );
      })}
    </g>
  );
}

export default memo(PlanPrimitives);
