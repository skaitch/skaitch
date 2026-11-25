import { memo, useMemo } from 'react';
import { vectorMetresPerUnit, type PlanPlacement, type VectorPlanData } from '@skaitch/core/cad/vectorPlan';
import { VECTOR_INK } from '../../lib/vectorPlanRaster';

/** CAD white (ACI 7) is "contrast with the background": the theme ink in the editor. */
const strokeOf = (data: VectorPlanData, color: string) =>
  data.monochrome ? 'var(--ink-3, ' + VECTOR_INK + ')' : color.toLowerCase() === '#ffffff' ? 'var(--ink, ' + VECTOR_INK + ')' : color;

/** One `<path>` per layer and colour, built once per geometry: pan and zoom only change the transform. */
const VectorGeometry = memo(function VectorGeometry({ data }: { data: VectorPlanData }) {
  const groups = useMemo(() => {
    const map = new Map<string, { stroke: string; d: string[] }>();
    for (const path of data.paths) {
      if (!data.layers[path.l]?.visible) continue;
      const stroke = strokeOf(data, path.c);
      const key = `${path.l}|${stroke}`;
      let g = map.get(key);
      if (!g) map.set(key, g = { stroke, d: [] });
      const p = path.p;
      let d = `M${p[0]} ${p[1]}`;
      for (let i = 2; i < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
      g.d.push(d);
    }
    return [...map.entries()].map(([key, g]) => ({ key, stroke: g.stroke, d: g.d.join('') }));
  }, [data]);
  const texts = useMemo(() => data.texts.filter(t => data.layers[t.l]?.visible), [data]);
  return <>
    {groups.map(g => <path key={g.key} d={g.d} fill="none" stroke={g.stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
    {texts.map((t, i) => (
      <text key={i} transform={`translate(${t.x} ${t.y}) scale(1 -1) rotate(${-t.r})`} fontSize={t.h}
        fill={strokeOf(data, t.c)} style={{ whiteSpace: 'pre' }}>
        {t.s.split('\n').map((line, k) => <tspan key={k} x={0} dy={k ? t.h * 1.25 : 0}>{line}</tspan>)}
      </text>
    ))}
  </>;
});

/** Draws a vector background plan in the 2D editor's screen space. */
export default function VectorPlanLayer({ plan, data, view, opacity }: {
  plan: PlanPlacement;
  data: VectorPlanData;
  view: { scale: number; ox: number; oy: number };
  opacity: number;
}) {
  const s = vectorMetresPerUnit(plan, data) * view.scale;
  const tx = plan.x * view.scale + view.ox, ty = -plan.y * view.scale + view.oy;
  return (
    <g className="vector-background-plan" transform={`translate(${tx} ${ty}) scale(${s} ${-s})`}
      style={{ opacity, pointerEvents: 'none' }} fontFamily="var(--font-sans)">
      <VectorGeometry data={data} />
    </g>
  );
}
