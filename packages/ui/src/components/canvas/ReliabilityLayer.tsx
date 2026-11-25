import type { ReactElement } from 'react';
import type { ItemsMap } from '@skaitch/core/types/ifc';
import { surveyReliability } from '@skaitch/core/survey/reconstruct';
import { RELIABILITY_COLORS, reliabilityLabel, type SurveyReliability } from '@skaitch/core/survey/reliability';

type W2S = (x: number, y: number) => [number, number];

/**
 * Reliability view mode (ADR 0016): dims the plan and paints the elements produced by the survey
 * with their survey reliability. Display only; never printed on sheets.
 */
export default function ReliabilityLayer({ items, storeyId, w2s, width, height, lang }: {
  items: ItemsMap; storeyId: string; w2s: W2S; width: number; height: number; lang: string;
}) {
  const elements = Object.values(items).filter(i => i.parentId === storeyId);
  const color = (r: SurveyReliability | undefined) => (r ? RELIABILITY_COLORS[r] : undefined);
  const shapes: ReactElement[] = [], openings: ReactElement[] = [];
  for (const it of elements) {
    const c = color(surveyReliability(it));
    if (!c) continue;
    const g = (it as any).geom ?? {};
    if (it.type === 'Room' && Array.isArray(g.polygon)) {
      shapes.push(<polygon key={it.id} points={g.polygon.map(([x, y]: number[]) => w2s(x, y).join(',')).join(' ')} fill={c} fillOpacity={0.18} stroke="none" />);
    } else if (it.type === 'Wall') {
      const [x1, y1] = w2s(g.x1, g.y1), [x2, y2] = w2s(g.x2, g.y2);
      const [ax] = w2s(0, 0), [bx] = w2s(g.thickness ?? 0.2, 0);
      shapes.push(<line key={it.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={Math.max(3, Math.abs(bx - ax))} strokeLinecap="butt" opacity={0.85} />);
    } else if ((it.type === 'Door' || it.type === 'Window') && items[g.wallId]) {
      const w = (items[g.wallId] as any).geom;
      const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) || 1;
      const ux = (w.x2 - w.x1) / len, uy = (w.y2 - w.y1) / len;
      const cx = w.x1 + (w.x2 - w.x1) * g.t, cy = w.y1 + (w.y2 - w.y1) * g.t, h = (g.width ?? 0.9) / 2;
      const [x1, y1] = w2s(cx - ux * h, cy - uy * h), [x2, y2] = w2s(cx + ux * h, cy + uy * h);
      openings.push(<g key={it.id}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--panel, #fff)" strokeWidth={10} strokeLinecap="round" />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={5} strokeLinecap="round" />
      </g>);
    }
  }
  const levels: SurveyReliability[] = ['measured', 'partial', 'assumed', 'modified'];
  return (
    <g pointerEvents="none" data-layer="reliability">
      <rect x={0} y={0} width={width} height={height} fill="var(--panel, #fff)" opacity={0.6} />
      {shapes}
      {openings}
      <g transform={`translate(12, ${height - 12 - levels.length * 16})`}>
        <rect x={-6} y={-6} width={170} height={levels.length * 16 + 8} rx={4} fill="var(--panel, #fff)" stroke="var(--border, #ccc)" />
        {levels.map((r, i) => (
          <g key={r} transform={`translate(0, ${i * 16})`}>
            <rect width={10} height={10} rx={2} fill={RELIABILITY_COLORS[r]} />
            <text x={16} y={9} fontSize={11} fill="var(--ink, #222)">{reliabilityLabel(r, lang)}</text>
          </g>
        ))}
      </g>
    </g>
  );
}
