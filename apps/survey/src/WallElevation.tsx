import { useRef, useState, type CSSProperties } from 'react';
import { ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ChevronDown, Droplet, Fan, FireExtinguisher, Network, Plus, Trash2, X, Zap } from 'lucide-react';
import { disciplineColor, groupTechnicalByCategory, TECHNICAL_CATALOGUE } from '@skaitch/core/data/technicalCatalogue';
import { deleteTechnicalPoint, setTechnicalPoint } from '@skaitch/core/survey/edit';
import { technicalPointProblem } from '@skaitch/core/survey/checks';
import { tr } from '@skaitch/core/survey/lang';
import { faceOpenings, technicalPointOffset, technicalPointReady, type Survey, type SurveyLevel, type SurveyRoom, type SurveyTechnicalPoint, type SurveyWall } from '@skaitch/core/survey/surveyFile';
import { formatLength, formatLengthValue, parseLength, unitLabel } from '@skaitch/core/survey/units';
import { useLengthUnit } from '@skaitch/ui/components/survey/lengthUnit';
import { renderTechnicalSymbol } from '@skaitch/ui/data/technicalSymbols';
import Sheet from './Sheet';
import './wallElevation.css';

const disciplines = [
  { id: 'electrical', label: () => tr('Électricité', 'Electrical'), Icon: Zap },
  { id: 'plumbing', label: () => tr('Plomberie', 'Plumbing'), Icon: Droplet },
  { id: 'hvac', label: () => tr('Génie Climatique', 'HVAC'), Icon: Fan },
  { id: 'data', label: () => tr('Réseau / Telecom', 'Data / Telecom'), Icon: Network },
  { id: 'fire', label: () => tr('Sécurité incendie', 'Fire safety'), Icon: FireExtinguisher },
] as const;
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
type Cote = 'left' | 'right' | 'height';

export default function WallElevation({ level, room, wall, height, initialPoint, onEdit }: {
  level: SurveyLevel; room: SurveyRoom; wall: SurveyWall; height: number; initialPoint?: string;
  onEdit: (edit: (survey: Survey) => Survey) => void;
}) {
  const width = wall.length_m;
  const unit = useLengthUnit();
  const stage = useRef<HTMLDivElement>(null);
  const modelButton = useRef<HTMLButtonElement>(null);
  const [model, setModel] = useState(TECHNICAL_CATALOGUE[0].id);
  const [catalogue, setCatalogue] = useState<(typeof disciplines)[number]['id']>();
  const [placing, setPlacing] = useState(false);
  const [selected, setSelected] = useState(initialPoint);
  const [cote, setCote] = useState<{ axis: Cote; text: string; error?: boolean }>();
  const drag = useRef<{ point: SurveyTechnicalPoint; x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<SurveyTechnicalPoint>();
  const points = (room.technicalPoints ?? []).filter(p => p.wallId === wall.id);
  const point = preview ?? points.find(p => p.id === selected);
  const problem = point && technicalPointProblem(point, room, wall, height);
  const selectedModel = point && TECHNICAL_CATALOGUE.find(m => m.id === point.model);
  const placementModel = TECHNICAL_CATALOGUE.find(m => m.id === model)!;
  const models = catalogue ? Object.entries(groupTechnicalByCategory(TECHNICAL_CATALOGUE.filter(m => m.discipline === catalogue))) : [];
  const closeCatalogue = () => { setCatalogue(undefined); modelButton.current?.focus(); };
  const ready = (p: SurveyTechnicalPoint) => technicalPointReady(p, room, wall, height);
  const leftOf = (p: SurveyTechnicalPoint) => clamp(technicalPointOffset(p, width), width) / width * 100;
  const topOf = (p: SurveyTechnicalPoint) => 100 - clamp(p.height_m, height) / height * 100;
  const save = (p: SurveyTechnicalPoint) => onEdit(s => setTechnicalPoint(s, room.id, p));
  const label = (axis: Cote) => axis === 'left' ? tr('Du bord gauche', 'From the left edge')
    : axis === 'right' ? tr('Du bord droit', 'From the right edge') : tr('Du sol fini', 'From the finished floor');

  function add(clientX?: number, clientY?: number) {
    if (!placing || room.frozen) return;
    const rect = stage.current!.getBoundingClientRect();
    const id = crypto.randomUUID();
    const x = clientX === undefined ? width / 2 : clamp((clientX - rect.left) / rect.width * width, width);
    const z = clientY === undefined ? height / 2 : clamp((rect.bottom - clientY) / rect.height * height, height);
    save({ id, wallId: wall.id, model, edge: 'left', distance_m: x, height_m: z });
    setSelected(id);
    setCote(undefined);
    setPlacing(false);
  }

  function dragged(clientX: number, clientY: number) {
    const start = drag.current;
    if (!start) return;
    const rect = stage.current!.getBoundingClientRect();
    const dx = clientX - start.x, dy = start.y - clientY;
    const p = start.point;
    const distance = clamp(p.distance_m + dx / rect.width * width * (p.edge === 'left' ? 1 : -1), width);
    const elevation = clamp(p.height_m + dy / rect.height * height, height);
    const movedX = Math.abs(dx) >= 3 && distance !== p.distance_m;
    const movedY = Math.abs(dy) >= 3 && elevation !== p.height_m;
    if (!movedX && !movedY) return;
    return { ...p,
      ...(movedX ? { distance_m: distance, distanceMeasured: undefined } : {}),
      ...(movedY ? { height_m: elevation, heightMeasured: undefined } : {}),
    };
  }

  function editCote(axis: Cote, value: number, measured: boolean) {
    if (room.frozen) return;
    setCote({ axis, text: measured ? formatLengthValue(value, unit) : '' });
  }

  function coteButton(p: SurveyTechnicalPoint, axis: Cote, Icon: typeof ArrowLeftToLine) {
    const horizontal = axis !== 'height';
    const measured = horizontal ? p.distanceMeasured === true && p.edge === axis : p.heightMeasured === true;
    const value = horizontal ? axis === p.edge ? p.distance_m : Math.max(0, width - p.distance_m) : p.height_m;
    const formatted = formatLength(value, unit);
    return <button type="button" className="tool wall-elevation-cote" disabled={room.frozen}
      aria-label={`${label(axis)} · ${formatted}`} onClick={() => editCote(axis, value, measured)}>
      <span className="ico"><Icon /></span>
      <b>{measured ? formatted : `≈ ${formatted}`}</b>
      <span className="txt">{label(axis)}</span>
    </button>;
  }

  return (
    <div className="wall-elevation">
      <div className="wall-elevation-workspace" data-placing={placing}>
        {placing && <div className="floating-mode"><span className="mode-label drawinfo">{tr('Touchez le mur pour placer le point.', 'Tap the wall to place the point.')}</span></div>}
        <div className="wall-elevation-stage" dir="ltr" ref={stage} style={{ '--wall-ratio': width / height } as CSSProperties}>
        <span className="wall-size" aria-hidden="true">{formatLength(width, unit)} × {formatLength(height, unit)}</span>
        <button type="button" className="wall-elevation-place" disabled={!placing || room.frozen}
          aria-label={tr('Placer le point au centre du mur', 'Place the point at the centre of the wall')}
          onClick={e => e.detail ? add(e.clientX, e.clientY) : add()} />
        <div className="wall-elevation-openings" aria-hidden="true">
          {faceOpenings(level, room).filter(o => o.wallId === wall.id).map(({ opening, offset_m, owner }) => {
            const sill = opening.kind === 'window' ? opening.sill_m ?? 0.9 : 0;
            return <div className="wall-elevation-opening" data-kind={opening.kind} key={`${owner}/${opening.id}`}
              style={{ left: `${(1 - (offset_m + opening.width_m) / width) * 100}%`, width: `${opening.width_m / width * 100}%`,
                bottom: `${sill / height * 100}%`, height: `${opening.height_m / height * 100}%` }} />;
          })}
        </div>
        {points.map(saved => {
          const p = preview?.id === saved.id ? preview : saved;
          const def = TECHNICAL_CATALOGUE.find(m => m.id === p.model)!;
          return <button type="button" key={p.id} className="wall-elevation-point"
            aria-label={tr(def.labelFr, def.labelEn)} aria-pressed={selected === p.id} data-incomplete={!ready(p)}
            style={{ left: `${leftOf(p)}%`, top: `${topOf(p)}%` }}
            onClick={() => { setSelected(p.id); setCote(undefined); }}
            onPointerDown={e => {
          if (room.frozen || placing || e.button !== 0 || !e.isPrimary) return;
              setSelected(p.id);
              setCote(undefined);
              drag.current = { point: p, x: e.clientX, y: e.clientY };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setPreview(dragged(e.clientX, e.clientY)); }}
            onPointerCancel={() => { drag.current = null; setPreview(undefined); }}
            onPointerUp={e => {
              if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
              const moved = dragged(e.clientX, e.clientY);
              drag.current = null;
              setPreview(undefined);
              if (moved) save(moved);
            }}>
            <svg width="30" height="30" viewBox="0 0 40 40" aria-hidden="true">{renderTechnicalSymbol(def.symbolKey, 40, 40, disciplineColor(def.discipline))}</svg>
          </button>;
        })}
        {point && !placing && (
          <svg className="wall-elevation-cotes" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path vectorEffect="non-scaling-stroke" d={`M0 ${topOf(point)} H100 M${leftOf(point)} ${topOf(point)} V100`} />
          </svg>
        )}
        </div>
      </div>
      <div className="wall-elevation-dock">
        {point && selectedModel && !placing && <div className="selection-bar wall-selection-bar">
          <div className="selection-head">
            <span className="selection-ico" aria-hidden="true"><svg width="21" height="21" viewBox="0 0 40 40">{renderTechnicalSymbol(selectedModel.symbolKey, 40, 40, 'currentColor')}</svg></span>
            <b>{tr(selectedModel.labelFr, selectedModel.labelEn)}</b>
            {problem && <span className="tag">{tr('À compléter', 'Incomplete')}</span>}
            <button type="button" className="selection-close" aria-label={tr('Fermer', 'Close')} onClick={() => { setSelected(undefined); setCote(undefined); }}><X /></button>
          </div>
          {problem && !cote && <p className="wall-point-problem">{problem}</p>}
          {!cote && <div className="selection-tools" dir="ltr">
            {coteButton(point, 'left', ArrowLeftToLine)}
            {coteButton(point, 'right', ArrowRightToLine)}
            {coteButton(point, 'height', ArrowDownToLine)}
            {!room.frozen && <button type="button" className="tool danger" aria-label={tr('Supprimer le point technique', 'Delete the technical point')} onClick={() => {
              onEdit(s => deleteTechnicalPoint(s, room.id, point.id));
              setSelected(undefined);
              setCote(undefined);
            }}><span className="ico"><Trash2 /></span><span className="txt">{tr('Supprimer', 'Delete')}</span></button>}
          </div>}
          {cote && <form className="wall-cote-form" onSubmit={e => {
        e.preventDefault();
        const value = parseLength(cote.text, unit);
        const axis = cote.axis;
        const limit = axis === 'height' ? height : width;
        const stored = axis === 'height' ? point.height_m : point.distance_m;
        const exact = cote.text === formatLengthValue(stored, unit) && (axis === 'height' ? point.heightMeasured : point.distanceMeasured && point.edge === axis) ? stored : value;
        if (!Number.isFinite(exact) || exact < 0 || exact > limit) { setCote({ ...cote, error: true }); return; }
        save(axis === 'height' ? { ...point, height_m: exact, heightMeasured: true } : { ...point, edge: axis, distance_m: exact, distanceMeasured: true });
        setCote(undefined);
      }}>
        <label className="field">{label(cote.axis)} ({unitLabel(unit)})
          <input key={cote.axis} autoFocus inputMode={unit === 'ft-in' ? 'text' : 'decimal'} enterKeyHint="done" value={cote.text}
            onKeyDown={e => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }}
            onChange={e => setCote({ axis: cote.axis, text: e.target.value })} />
        </label>
        {cote.error && <p className="notice" role="alert">{tr('Saisissez une cote comprise dans les dimensions du mur.', 'Enter a dimension within the wall bounds.')}</p>}
        <div className="sheet-actions">
          <button type="button" className="secondary-btn" onClick={() => setCote(undefined)}>{tr('Annuler', 'Cancel')}</button>
          <button type="submit" className="primary-btn">{tr('Enregistrer', 'Save')}</button>
        </div>
          </form>}
        </div>}
        {!room.frozen && !cote && <div className="tools-bar wall-point-tools">
          <button ref={modelButton} type="button" className="wall-model-button" aria-haspopup="dialog" aria-expanded={!!catalogue}
            aria-label={`${tr('Point technique', 'Technical point')} · ${tr(placementModel.labelFr, placementModel.labelEn)}`}
            onClick={() => setCatalogue(placementModel.discipline)}>
            <svg width="26" height="26" viewBox="0 0 40 40" aria-hidden="true">{renderTechnicalSymbol(placementModel.symbolKey, 40, 40, disciplineColor(placementModel.discipline))}</svg>
            <span>{tr(placementModel.labelFr, placementModel.labelEn)}</span>
            <ChevronDown aria-hidden="true" />
          </button>
          <button className={placing ? 'secondary-btn' : 'primary-btn'} type="button" onClick={() => setPlacing(!placing)}>
            {placing ? <X /> : <Plus />} {placing ? tr('Annuler', 'Cancel') : tr('Placer', 'Place')}
          </button>
        </div>}
      </div>
      {catalogue && <Sheet title={tr('Point technique', 'Technical point')} onClose={closeCatalogue}>
        <div className="style-choices wall-catalogue-disciplines">
          {disciplines.map(({ id, label, Icon }) => (
            <button key={id} type="button" className={`choice${catalogue === id ? ' selected' : ''}`} aria-pressed={catalogue === id}
              autoFocus={placementModel.discipline === id} onClick={() => setCatalogue(id)}>
              <span className="symbol"><Icon /></span><b>{label()}</b>
            </button>
          ))}
        </div>
        {models.map(([category, options]) => (
          <section key={category}>
            {models.length > 1 && <h4>{category}</h4>}
            <div className="catalog-grid">
              {options.map(option => (
                <button key={option.id} type="button" className={`catalog-choice${model === option.id ? ' active' : ''}`} aria-pressed={model === option.id} onClick={() => setModel(option.id)}>
                  <span className="catalog-glyph wall-catalogue-symbol">
                    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">{renderTechnicalSymbol(option.symbolKey, 40, 40, 'currentColor')}</svg>
                  </span>
                  <strong>{tr(option.labelFr, option.labelEn)}</strong>
                </button>
              ))}
            </div>
          </section>
        ))}
        <div className="sheet-actions wall-catalogue-actions">
          <button type="button" className="primary-btn" onClick={closeCatalogue}>{tr('Terminé', 'Done')}</button>
        </div>
      </Sheet>}
    </div>
  );
}
