import { layoutRooms } from '@skaitch/core/survey/reconstruct';
import { globalPlan } from '@skaitch/core/survey/globalPlan';
import { roomLabelPoint, surveyDefaults, technicalPointPlanPosition, technicalPointReady, type SurveyLevel, type SurveyWarning } from '@skaitch/core/survey/surveyFile';
import { catalogueLabel } from '@skaitch/core/lib/defaultNames';
import { disciplineColor, TECHNICAL_CATALOGUE } from '../../data/technicalCatalogue';
import { renderTechnicalSymbol } from '../../data/technicalSymbols';
import SurveyFurnitureFootprint from './SurveyFurnitureFootprint';

interface Props {
  level: SurveyLevel;
  warnings?: SurveyWarning[];
  /** Displayed width in CSS pixels; the plan keeps its aspect ratio. */
  width?: number;
  ceilingHeight?: number;
  lang?: string;
}

const fmt = (m: number) => m.toFixed(2).replace('.', ',') + ' m';

/**
 * Read-only plan of a survey level: inner-face polygons with their face length.
 * Shared by the Survey tab of the editor and the Survey app (ADR 0007).
 * Rooms joined by linked faces stay together; other groups are laid side by side (#55).
 */
export default function SurveyPlan({ level, warnings = [], width = 260, ceilingHeight = surveyDefaults({}).ceilingHeight_m, lang = 'fr' }: Props) {
  const flagged = new Set(warnings.flatMap(w => w.wallIds));
  // Same placement as the reconstruction: linked rooms stay together, groups side by side.
  const offsets = layoutRooms(level);
  const anchored = globalPlan(level).anchored;
  const placed = level.rooms.map(room => {
    const [ox, oy] = offsets.get(room.id)!;
    return { room, offset: ox, minY: -oy };
  });
  const world = level.rooms.flatMap(r => r.polygon.map(([x, y]) => [x + offsets.get(r.id)![0], y + offsets.get(r.id)![1]]));
  const totalW = Math.max(1, ...world.map(p => p[0]));
  const totalH = Math.max(1, ...world.map(p => p[1]));
  const pad = 0.9;
  const vbW = totalW + pad * 2, vbH = totalH + pad * 2;
  const symbolSize = 14 * vbW / width;
  // SVG y grows downward; survey y grows upward.
  const X = (x: number, offset: number) => x + offset + pad;
  const Y = (y: number, minY: number) => vbH - (y - minY + pad);

  return (
    <svg role="img" aria-label={`Plan relevé ${level.name}`} viewBox={`0 0 ${vbW} ${vbH}`} width={width} height={(width * vbH) / vbW}
      style={{ display: 'block', background: 'var(--panel-2)', borderRadius: 6 }}>
      {placed.map(({ room, offset, minY }) => {
        const pts = room.polygon.map(([x, y]) => `${X(x, offset)},${Y(y, minY)}`).join(' ');
        const [cx, cy] = roomLabelPoint(room.polygon);
        return (
          <g key={room.id}>
            <polygon points={pts} fill="color-mix(in srgb, var(--accent) 10%, transparent)" stroke={anchored.has(room.id) ? 'var(--ink)' : '#df9043'} strokeWidth={0.04}
              strokeDasharray={room.geometryStatus === 'assumed' ? '0.12 0.08' : undefined} />
            {room.furniture?.map(f => <g key={f.id} data-survey-furniture={f.id}>
              <SurveyFurnitureFootprint furniture={f} at={[X(f.center[0], offset), Y(f.center[1], minY)]} scale={1} color="var(--c-furniture, var(--ink-2))" lang={lang} />
            </g>)}
            <text x={X(cx, offset)} y={Y(cy, minY)} fontSize={0.32} textAnchor="middle" dominantBaseline="middle" fill="var(--ink)" fontWeight={600}>{room.name}</text>
            {room.walls.map(wall => {
              const [x1, y1] = room.polygon[wall.from], [x2, y2] = room.polygon[wall.to];
              const len = Math.hypot(x2 - x1, y2 - y1) || 1;
              // Counter-clockwise polygon: the outward normal is on the right of each edge.
              const nx = (y2 - y1) / len, ny = -(x2 - x1) / len;
              const lx = (x1 + x2) / 2 + nx * 0.35, ly = (y1 + y2) / 2 + ny * 0.35;
              const bad = flagged.has(wall.id);
              // Text follows the wall, kept upright.
              let angle = (Math.atan2(-(y2 - y1), x2 - x1) * 180) / Math.PI;
              if (angle > 90) angle -= 180; else if (angle < -90) angle += 180;
              const tx = X(lx, offset), ty = Y(ly, minY);
              return (
                <text key={wall.id} x={tx} y={ty} transform={`rotate(${angle} ${tx} ${ty})`} fontSize={0.24} textAnchor="middle" dominantBaseline="middle"
                  fill={bad ? '#d97706' : 'var(--ink-2)'} fontFamily="var(--font-mono, 'Geist Mono', ui-monospace, monospace)">
                  <title>{`${wall.id} · ${wall.source}${wall.locked ? ' · verrouillée' : ''} · ép. ${fmt(wall.thickness_m)} (${wall.thicknessStatus === 'measured' ? 'mesurée' : 'estimée'})`}</title>
                  {!wall.locked && wall.source === 'computed' ? '= ' : ''}{fmt(wall.length_m)}{wall.locked ? ' 🔒' : ''}
                </text>
              );
            })}
            {(room.openings ?? []).map(o => {
              const wall = room.walls.find(w => w.id === o.wallId)!;
              const [ax, ay] = room.polygon[wall.from], [bx, by] = room.polygon[wall.to];
              const len = Math.hypot(bx - ax, by - ay) || 1, k = len / wall.length_m;
              const at = (d: number) => [ax + ((bx - ax) / len) * d * k, ay + ((by - ay) / len) * d * k];
              const [x1, y1] = at(o.offset_m), [x2, y2] = at(o.offset_m + o.width_m);
              return (
                <line key={o.id} x1={X(x1, offset)} y1={Y(y1, minY)} x2={X(x2, offset)} y2={Y(y2, minY)}
                  stroke={o.kind === 'door' ? '#b45309' : '#2563eb'} strokeWidth={0.12} strokeLinecap="butt">
                  <title>{`${o.kind === 'door' ? 'Porte' : 'Fenêtre'} ${fmt(o.width_m)} · avant ${fmt(o.offset_m)}`}</title>
                </line>
              );
            })}
          </g>
        );
      })}
      {placed.flatMap(({ room, offset, minY }) => (room.technicalPoints ?? []).map(point => {
        const wall = room.walls.find(w => w.id === point.wallId);
        const model = TECHNICAL_CATALOGUE.find(m => m.id === point.model);
        if (!wall || !model) return null;
        const position = technicalPointPlanPosition(point, room, wall);
        if (!position) return null;
        const x = X(position.x, offset), y = Y(position.y, minY);
        const color = disciplineColor(model.discipline);
        const ready = technicalPointReady(point, room, wall, room.ceilingHeight_m ?? ceilingHeight);
        const measured = point.distanceMeasured && point.heightMeasured;
        // Offset the symbol into the room so the two faces of a shared wall stay distinguishable.
        const sx = x + Math.sin(position.rotation) * symbolSize * 0.85;
        const sy = y + Math.cos(position.rotation) * symbolSize * 0.85;
        return <g key={`${room.id}/${point.id}`} data-survey-technical-point={ready ? measured ? 'measured' : 'estimated' : 'incomplete'}>
          <title>{`${catalogueLabel(model, lang)} · ${point.heightMeasured ? '' : '≈ '}${fmt(point.height_m)}`}</title>
          <line x1={x} y1={y} x2={sx} y2={sy} stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <circle cx={sx} cy={sy} r={symbolSize / 2} fill="var(--panel)" stroke={color} strokeWidth={1}
            strokeDasharray={ready && measured ? undefined : '2 2'} vectorEffect="non-scaling-stroke" />
          <g transform={`translate(${sx - symbolSize / 2} ${sy - symbolSize / 2})`}>
            {renderTechnicalSymbol(model.symbolKey, symbolSize, symbolSize, color)}
          </g>
        </g>;
      }))}
    </svg>
  );
}
