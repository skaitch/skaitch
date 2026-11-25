import { catalogueLabel } from '@skaitch/core/lib/defaultNames';
import { SURVEY_FURNITURE_MODELS, type SurveyFurniture } from '@skaitch/core/survey/surveyFile';
import { renderElementSvg } from '../../data/elementSvg';

export default function SurveyFurnitureFootprint({ furniture, at, scale, color, lang, selected = false }: {
  furniture: SurveyFurniture; at: [number, number]; scale: number; color: string; lang: string; selected?: boolean;
}) {
  const model = SURVEY_FURNITURE_MODELS.find(m => m.id === furniture.model);
  const w = furniture.width_m * scale, d = furniture.depth_m * scale;
  return (
    <g transform={`translate(${at.join(' ')}) rotate(${-furniture.rotation * 180 / Math.PI})`} style={{ color }}>
      <title>{model ? catalogueLabel(model, lang) : furniture.model}</title>
      <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={Math.min(2, w / 8, d / 8)}
        fill="currentColor" fillOpacity={selected ? .32 : .16} stroke="currentColor" strokeWidth={selected ? 2 : 1} vectorEffect="non-scaling-stroke" />
      <svg x={-w / 2} y={-d / 2} width={w} height={d} viewBox="0 0 72 44" preserveAspectRatio="none" pointerEvents="none">
        {renderElementSvg(model?.iconKey ?? furniture.model, 72, 44)}
      </svg>
    </g>
  );
}
