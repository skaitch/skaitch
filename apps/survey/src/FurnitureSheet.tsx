import { useState } from 'react';
import { ArrowDownToLine, ArrowLeftToLine, Settings, Sofa, Trash2, X } from 'lucide-react';
import { furniturePlanFrame, pointInPolygon, SURVEY_FURNITURE_MODELS, SURVEY_STRUCTURE_CATEGORY, type SurveyFurniture, type SurveyRoom } from '@skaitch/core/survey/surveyFile';
import { tr } from '@skaitch/core/survey/lang';
import { formatLength, formatLengthValue, parseLength, unitLabel } from '@skaitch/core/survey/units';
import { useLengthUnit } from '@skaitch/ui/components/survey/lengthUnit';
import { renderElementSvg } from '@skaitch/ui/data/elementSvg';
import Sheet from './Sheet';

import { LEROY_MERLIN_CATEGORIES, renderCategoryIcon } from '@skaitch/ui/components/panels/ElementLibraryPanel';

// Same categories, order, icons and names as the skAItch element library.
const present = new Set(SURVEY_FURNITURE_MODELS.map(model => model.category));
const categories = [...LEROY_MERLIN_CATEGORIES.map(c => c.id).filter(id => present.has(id)),
  ...[...present].filter(id => !LEROY_MERLIN_CATEGORIES.some(c => c.id === id))];
const categoryLabel = (id: string) => {
  const known = LEROY_MERLIN_CATEGORIES.find(c => c.id === id);
  if (id === SURVEY_STRUCTURE_CATEGORY) return tr('Structure (poteaux, cheminées, poêles)', 'Structure (columns, chimneys, stoves)');
  return known ? tr(known.labelFr, known.labelEn) : id;
};
const dimensions = ['width_m', 'depth_m', 'height_m'] as const;

export function FurnitureCatalogue({ initial, onPick, onClose }: { initial?: string; onPick: (id: string) => void; onClose: () => void }) {
  const [selected, setSelected] = useState(initial);
  const [category, setCategory] = useState(SURVEY_FURNITURE_MODELS.find(model => model.id === initial)?.category ?? categories[0]);
  return (
    <Sheet title={tr('Meuble ou structure', 'Furniture or structure')} onClose={onClose}>
      <div className="style-choices wall-catalogue-disciplines">
        {categories.map(id => {
          const known = LEROY_MERLIN_CATEGORIES.find(c => c.id === id);
          return <button key={id} type="button" className={`choice${category === id ? ' selected' : ''}`} aria-pressed={category === id} onClick={() => setCategory(id)}>
            <span className="symbol">{renderCategoryIcon(known?.icon ?? 'sofa')}</span><b>{categoryLabel(id)}</b>
          </button>;
        })}
      </div>
      <h4>{categoryLabel(category)}</h4>
      <div className="catalog-grid">
        {SURVEY_FURNITURE_MODELS.filter(model => model.category === category).map(model => (
          <button key={model.id} type="button" aria-pressed={selected === model.id} className={`catalog-choice${selected === model.id ? ' active' : ''}`} onClick={() => setSelected(model.id)}>
            <span className="catalog-glyph wall-catalogue-symbol">
              <svg width="60" height="36" viewBox="0 0 72 44" aria-hidden="true">{renderElementSvg(model.iconKey ?? model.id, 72, 44)}</svg>
            </span>
            <strong>{tr(model.labelFr, model.labelEn)}</strong>
          </button>
        ))}
      </div>
      <div className="sheet-actions wall-catalogue-actions">
        <button type="button" className="primary-btn" disabled={!selected} onClick={() => { if (selected) onPick(selected); }}>{tr('Terminé', 'Done')}</button>
      </div>
    </Sheet>
  );
}

export function FurnitureSelection({ room, furniture, onEdit, onSave, onDelete, onClose }: {
  room: SurveyRoom; furniture: SurveyFurniture; onEdit: () => void; onSave: (value: SurveyFurniture) => void; onDelete: () => void; onClose: () => void;
}) {
  const unit = useLengthUnit();
  const [cote, setCote] = useState<{ axis: 0 | 1; text: string; error?: boolean }>();
  const model = SURVEY_FURNITURE_MODELS.find(m => m.id === furniture.model)!;
  const frame = furniturePlanFrame(room);
  const coordinates = frame.toPlan(furniture.center);
  const axes = [
    { label: tr('Cote X', 'X dimension'), Icon: ArrowLeftToLine },
    { label: tr('Cote Y', 'Y dimension'), Icon: ArrowDownToLine },
  ] as const;
  return (
    <div className="selection-bar wall-selection-bar" role="toolbar" aria-label={tr('Meuble sélectionné', 'Selected furniture')}>
      <div className="selection-head">
        <span className="selection-ico"><Sofa /></span><b>{tr(model.labelFr, model.labelEn)}</b>
        <button className="selection-close" aria-label={tr('Fermer', 'Close')} onClick={onClose}><X /></button>
      </div>
      {!cote && <div className="selection-tools" dir="ltr">
        {([0, 1] as const).map(axis => {
          const { label, Icon } = axes[axis];
          const value = formatLength(coordinates[axis], unit);
          return <button key={axis} type="button" className="tool wall-elevation-cote" disabled={room.frozen} aria-label={`${label} · ${value}`}
            onClick={() => setCote({ axis, text: formatLengthValue(coordinates[axis], unit) })}>
            <span className="ico"><Icon /></span><b>{value}</b><span className="txt">{label}</span>
          </button>;
        })}
        <button className="tool" disabled={room.frozen} onClick={onEdit}>
          <span className="ico"><Settings /></span><span className="txt">{tr('Dimensions', 'Dimensions')}</span>
        </button>
        <button className="tool danger" disabled={room.frozen} onClick={onDelete}>
          <span className="ico"><Trash2 /></span><span className="txt">{tr('Supprimer', 'Delete')}</span>
        </button>
      </div>}
      {cote && <form className="wall-cote-form" onSubmit={e => {
        e.preventDefault();
        const previous = coordinates[cote.axis];
        coordinates[cote.axis] = cote.text === formatLengthValue(previous, unit) ? previous : parseLength(cote.text, unit);
        const center = frame.fromPlan(coordinates);
        if (!pointInPolygon(center, room.polygon)) { setCote({ ...cote, error: true }); return; }
        onSave({ ...furniture, center });
        setCote(undefined);
      }}>
        <label className="field">{axes[cote.axis].label} ({unitLabel(unit)})
          <input autoFocus inputMode={unit === 'ft-in' ? 'text' : 'decimal'} enterKeyHint="done" required value={cote.text}
            onChange={e => setCote({ axis: cote.axis, text: e.target.value })} />
        </label>
        {cote.error && <p className="notice" role="alert">{tr('La cote doit placer le centre du meuble dans la pièce.', 'The dimension must place the furniture centre inside the room.')}</p>}
        <div className="sheet-actions">
          <button type="button" className="secondary-btn" onClick={() => setCote(undefined)}>{tr('Annuler', 'Cancel')}</button>
          <button className="primary-btn" type="submit">{tr('Enregistrer', 'Save')}</button>
        </div>
      </form>}
    </div>
  );
}

export function FurnitureDetails({ furniture, onSave, onDelete, onClose }: {
  furniture: SurveyFurniture; onSave: (value: SurveyFurniture) => void; onDelete: () => void; onClose: () => void;
}) {
  const unit = useLengthUnit();
  const model = SURVEY_FURNITURE_MODELS.find(m => m.id === furniture.model)!;
  const [error, setError] = useState('');
  const labels = [tr('Largeur', 'Width'), tr('Profondeur', 'Depth'), tr('Hauteur', 'Height')];
  const angle = ((furniture.rotation * 180 / Math.PI % 360) + 360) % 360;
  const angleText = String(+angle.toFixed(2));
  return (
    <Sheet title={tr(model.labelFr, model.labelEn)} onClose={onClose}>
      <form onSubmit={e => {
        e.preventDefault();
        const fields = new FormData(e.currentTarget);
        const updated = { ...furniture };
        for (const key of dimensions) {
          const value = String(fields.get(key));
          updated[key] = value === formatLengthValue(furniture[key], unit) ? furniture[key] : parseLength(value, unit);
        }
        const degrees = String(fields.get('rotation'));
        const value = degrees.trim() ? Number(degrees.replace(',', '.')) : NaN;
        updated.rotation = degrees === angleText ? furniture.rotation : (value % 360) * Math.PI / 180;
        try { onSave(updated); } catch (err) { setError((err as Error).message); }
      }}>
        <div className="fields">
          {dimensions.map((key, i) => <label className="field" key={key}>{labels[i]} ({unitLabel(unit)})
            <input name={key} required inputMode={unit === 'ft-in' ? 'text' : 'decimal'} defaultValue={formatLengthValue(furniture[key], unit)} />
          </label>)}
          <label className="field">{tr('Rotation', 'Rotation')} (°)
            <input name="rotation" required inputMode="decimal" defaultValue={angleText} />
          </label>
        </div>
        {error && <div className="notice" role="alert">{error}</div>}
        <div className="sheet-actions">
          <button type="button" className="secondary-btn" onClick={onDelete}><Trash2 /> {tr('Supprimer', 'Delete')}</button>
          <button type="submit" className="primary-btn">{tr('Enregistrer', 'Save')}</button>
        </div>
      </form>
    </Sheet>
  );
}
