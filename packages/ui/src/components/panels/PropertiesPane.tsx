import PlanImageUpload, { vectorOriginSources } from './PlanImageUpload';
import VectorPlanSettings from './VectorPlanSettings';
import StairOpeningEditor from './StairOpeningEditor';
import { buildStair, STAIR_FORMS, stairFlightDimensions, stairBaseCount, stairLandingDimensions, stairFlightCount, hasStairWinderStart, canStartWithWinders } from '@skaitch/core/lib/stairGeometry';
import { wallRoofProfile } from '@skaitch/core/lib/wallRoof';
import { openingSwing } from '@skaitch/core/lib/openingOrientation';
import { makeT } from '@skaitch/core/data/i18n';
import { useState } from 'react';
import type { ItemsMap, IfcEntity } from '@skaitch/core/types/ifc';
import type {
  IfcWallEntity, IfcDoorEntity, IfcWindowEntity,
  IfcSpaceEntity, IfcStoreyEntity,
} from '@skaitch/core/types/ifc';
import { polyArea, polyPerimeter, wallLength } from '@skaitch/core/data/query';
import { guid } from '@skaitch/core/data/starter';
import { formatArea, formatDims, formatLength, formatVolume, itemDimensions, shortName } from '../../lib/format';
import { buildRoof, roofEdges, roofPredefinedType, ROOF_TYPES, type RoofType } from '@skaitch/core/lib/roofGeometry';
import type { ElementDef } from '@skaitch/core/data/elementCatalogue';
import { renderElementSvg } from '../../data/elementSvg';
import SurveyTab from '../survey/SurveyTab';
import { photosForElement, reconstructStorey, surveyReliability } from '@skaitch/core/survey/reconstruct';
import { RELIABILITY_COLORS, reliabilityLabel } from '@skaitch/core/survey/reliability';
import SurveyPhotoViewer from './SurveyPhotoViewer';
import { applyAssociation, proposeAssociation } from '@skaitch/core/survey/association';
import { translateStorey, storeyAlignmentOffset, defaultAlignmentReference, type AlignmentAnchor } from '../../lib/translateStorey';
import { markGeomEdit } from '@skaitch/core/lib/geomEdit';
import { chimneyGeom, chimneyHeightThroughRoof, columnGeom, type StructuralInput } from '@skaitch/core/lib/structuralElements';

interface Props {
  surveyInbox?: import('../../platform').SurveyInbox;
  items: ItemsMap;
  selection: string[];
  updateItem: (id: string, patch: Partial<IfcEntity> | ((prev: IfcEntity) => Partial<IfcEntity>)) => void;
  addItem:    (it: IfcEntity) => void;
  deleteItems:(ids: string[]) => void;
  tool: string;
  setTool: (t: any) => void;
  t: (k: string) => string;
  lang: string;
  openSettings: () => void;
  onCollapse: () => void;
  fullCatalogue?: ElementDef[];
  /** Replace the whole model as one undoable change (storey move). */
  replaceItems?: (next: ItemsMap) => void;
}

const IFC_NAMES: Record<string, string> = {
  Project: 'IfcProject', Building: 'IfcBuilding', Storey: 'IfcBuildingStorey',
  Room: 'IfcSpace', Wall: 'IfcWall', Door: 'IfcDoor',
  Window: 'IfcWindow', Furniture: 'IfcFurnishingElement', Dimension: 'IfcAnnotation', Slab: 'IfcSlab', Roof: 'IfcRoof',
  GenericElement: 'IfcBuildingElementProxy', Technical: 'IfcDistributionElement',
};

const TYPE_COLOR: Record<string, string> = {
  Wall: 'var(--c-wall)', Door: 'var(--c-door)', Window: 'var(--c-window)',
  Room: 'var(--c-room)', Furniture: 'var(--c-furniture)', Dimension: 'var(--accent)', Slab: 'var(--ink-3)', Roof: 'oklch(0.55 0.09 30)',
  Storey: 'var(--ink-3)', Building: 'var(--ink-3)', Project: 'var(--ink-3)', GenericElement: '#7f9fbd', Technical: '#f59e0b',
};

const ROOM_FUNCTIONS: [string, string][] = [
  ["Séjour", "Living room"],
  ["Cuisine", "Kitchen"],
  ["Chambre", "Bedroom"],
  ["Salle de bain", "Bathroom"],
  ["WC", "Toilet"],
  ["Bureau", "Office"],
  ["Couloir", "Corridor"],
  ["Hall", "Hall"],
  ["Garage", "Garage"],
  ["Cave", "Cellar"],
  ["Terrasse", "Terrace"],
  ["Balcon", "Balcony"],
  ["Salle à manger", "Dining room"],
  ["Bibliothèque", "Library"],
  ["Dressing", "Dressing room"],
  ["Buanderie", "Laundry room"],
  ["Autre", "Other"],
];

const DOOR_OP_TYPES: [string, string][] = [
  ['SINGLE_SWING_LEFT',         "Single swing"],
  ['DOUBLE_DOOR_SINGLE_SWING',  "Double swing door"],
  ['DOUBLE_SWING',              "Double action"],
  ['SLIDING',                   "Sliding"],
  ['FOLDING',                   "Folding"],
  ['ROLLINGUP',                 "Roll-up garage door"],
  ['SECTIONAL',                 "Sectional garage door"],
  ['TILT_UP',                   "Tilt-up garage door"],
];

const WINDOW_OP_TYPES: [string, string][] = [
  ['FIXEDCASEMENT',        "Fixed"],
  ['SINGLE_PANEL',         "Single sash"],
  ['DOUBLE_PANEL_VERTICAL',"Double sash"],
  ['SLIDINGHORIZONTAL',    "Sliding"],
  ['TILTANDTURNLEFT',      "Tilt and turn"],
  ['TOPHUNG',              "Top hung"],
];

const WALL_MATERIALS: [string, string][] = [
  ["Brique 200mm", "Brick 200mm"],
  ["Béton 200mm", "Concrete 200mm"],
  ["Cloison BA13", "Plasterboard partition BA13"],
  ["Ossature bois", "Timber frame"],
  ["Bloc béton", "Concrete block"],
  ["Pierre", "Stone"],
  ["Autre", "Other"],
];
const STAIR_FORM_LABELS: Record<string, string> = {"straight": "Straight stair", "quarter": "Quarter-turn stair", "doubleQuarter": "Double quarter-turn stair", "half": "Half-turn stair", "spiral": "Spiral stair"};

const FIRE_RATINGS  = ['—', 'EI 30', 'EI 60', 'EI 90', 'EI 120', 'REI 120', 'EI 240'];

// ── UI primitives ──────────────────────────────────────────────────────────────

function CollapseBtn({ onClick, lang }: { onClick: () => void; lang: string }) {
  return (
    <button className="icon-btn" title={makeT(lang)("Collapse")} onClick={onClick}>
      <svg width="13" height="13" viewBox="0 0 14 14">
        <path d="M11 2v10M5 4l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** Survey reliability of an element produced by the survey (ADR 0016). */
function SurveyReliabilityRow({ item, lang }: { item: IfcEntity; lang: string }) {
  const r = surveyReliability(item);
  if (!r) return null;
  return (
    <Section title={lang === 'fr' ? 'Fiabilité relevé' : 'Survey reliability'}>
      <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: RELIABILITY_COLORS[r] }} />
        {reliabilityLabel(r, lang)}
      </div>
    </Section>
  );
}

/** Photos of the surveyed surfaces this element was reconstructed from (spec F-30). */
function SurveyPhotos({ items, id, lang }: { items: ItemsMap; id: string; lang: string }) {
  const [big, setBig] = useState<string | null>(null);
  const photos = photosForElement(items, id);
  if (!photos.length) return null;
  const tr = (fr: string, en: string) => (lang === 'fr' ? fr : en);
  const where = (s: string) => (s === 'floor' ? tr('Sol', 'Floor') : s === 'ceiling' ? tr('Plafond', 'Ceiling') : tr('Mur', 'Wall'));
  return (
    <Section title={tr('Photos du relevé', 'Survey photos')} badge={String(photos.length)}>
      <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        {photos.map(p => (
          <button key={p.id} title={`${p.roomName} · ${where(p.surface)}${p.annotations ? ` · ${p.annotations} annotation(s)` : ''}`} onClick={() => setBig(p.id)}
            style={{ padding: 0, border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', background: 'none', cursor: 'zoom-in' }}>
            <img src={p.url} alt={`${p.roomName} — ${where(p.surface)}`} style={{ display: 'block', width: '100%', aspectRatio: '1', objectFit: 'cover' }} />
          </button>
        ))}
      </div>
      {(() => {
        const shown = photos.find(p => p.id === big);
        return shown && <SurveyPhotoViewer photo={shown} title={`${shown.roomName} — ${where(shown.surface)}`} lang={lang} onClose={() => setBig(null)} />;
      })()}
    </Section>
  );
}

function StoreyTabs({ lang, survey, children }: { lang: string; survey: React.ReactNode; children: React.ReactNode }) {
  const [tab, setTab] = useState<'props' | 'survey'>('props');
  const tabs = [['props', lang === 'fr' ? 'Propriétés' : 'Properties'], ['survey', 'Survey']] as const;
  return (
    <>
      <div role="tablist" style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--panel-2)' }}>
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} style={{
            flex: 1, border: 0, background: 'transparent', cursor: 'pointer', padding: '6px 10px', fontSize: 11,
            fontWeight: tab === id ? 600 : 400, color: tab === id ? 'var(--accent)' : 'var(--ink-3)',
            borderBottom: tab === id ? '2px solid var(--accent)' : '2px solid transparent',
          }}>{label}</button>
        ))}
      </div>
      {tab === 'props' ? children : survey}
    </>
  );
}

/**
 * Displayed value of a cote. An imported cote starts with its measured value; the field shows exactly
 * what was typed, and emptied it stays empty (the plan then shows the drawn length).
 */
function CoteLabelInput({ override, measured, placeholder, onChange }: { override?: string; measured?: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <input type="text" value={override ?? measured ?? ''} placeholder={measured ?? placeholder}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      style={{ flex: 1, fontSize: 11.5, background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--border)', borderRadius: 3, padding: '2px 4px', fontFamily: 'var(--font-mono)' }} />
  );
}

function Section({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className="section">
      <div className="section-head">
        <h4>{title}</h4>
        {badge && <span className="badge">{badge}</span>}
      </div>
      <div className="section-body">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="field-label">{label}</div>
      <div className="field-value">{children}</div>
    </>
  );
}

function Row2({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="field-label">{label}</div>
      <div className="field-value flex2">{children}</div>
    </>
  );
}

function Num({ value, onChange, unit = 'm', step = 0.05, min }: {
  value: number; onChange: (v: number) => void; unit?: string; step?: number; min?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const formatted = Number(value).toFixed(step < 0.001 ? 4 : step < 0.01 ? 3 : 2);
  return (
    <>
      <input className="mono" type="text" inputMode="decimal"
        value={draft ?? formatted}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          const text = e.currentTarget.value;
          const next = Number(text.replace(',', '.'));
          setDraft(null);
          if (text.trim() && Number.isFinite(next) && (min === undefined || next >= min) && next !== value) onChange(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            e.currentTarget.value = formatted;
            setDraft(null);
            e.currentTarget.blur();
          }
        }} />
      <span className="unit">{unit}</span>
    </>
  );
}

function ReadOnly({ value, unit }: { value: string | number; unit?: string }) {
  return (
    <>
      <input className="mono" value={String(value)} readOnly />
      {unit && <span className="unit">{unit}</span>}
    </>
  );
}

function Seg({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="seg">
      {options.map(([val, label]) => (
        <button key={val} className={value === val ? 'on' : ''} onClick={() => onChange(val)} title={val}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Select({ options, value, onChange, t = (label: string) => label }: { options: (string | [string, string])[]; value: string; onChange: (v: string) => void; t?: (label: string) => string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
>
      {value && !options.some(o => (typeof o === 'string' ? o : o[0]) === value) && <option value={value}>{value}</option>}
      {options.map(o => { const [v, label] = typeof o === 'string' ? [o, o] : o; return <option key={v} value={v}>{t(label)}</option>; })}
    </select>
  );
}

function Toggle({ value, onChange, labelOn, labelOff }: {
  value: boolean; onChange: (v: boolean) => void; labelOn?: string; labelOff?: string;
}) {
  return (
    <div className="seg">
      <button className={!value ? 'on' : ''} onClick={() => onChange(false)}>{labelOff ?? '—'}</button>
      <button className={value ? 'on' : ''} onClick={() => onChange(true)}>{labelOn ?? '✓'}</button>
    </div>
  );
}

function DescriptionRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <div className="field-label" onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, height: 26 }}>
        {label}
        <span style={{ fontSize: 9, opacity: 0.5, transition: 'transform 0.15s', transform: expanded ? 'rotate(90deg)' : 'none' }}>▶</span>
      </div>
      <div className="field-value flex2" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
        {expanded ? (
          <textarea
            autoFocus
            className="mono"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => !value && setExpanded(false)}
            rows={3}
            style={{ width: '100%', resize: 'vertical', padding: '6px 8px', fontSize: 11.5, lineHeight: 1.4, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', outline: 'none', minHeight: 60 }}
          />
        ) : (
          <div
            onClick={() => setExpanded(true)}
            title={value && value.length > 20 ? value : undefined}
            style={{
              fontSize: 12, color: value ? 'var(--ink)' : 'var(--ink-4)', cursor: 'pointer',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              padding: '4px 8px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 4,
              minHeight: 26, width: '100%', display: 'block'
            }}
          >
            {value || '...'}
          </div>
        )}
      </div>
    </>
  );
}

function SwapBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', marginTop: 2, padding: '5px 8px',
      background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4,
      fontSize: 11.5, color: 'var(--ink-2)', cursor: 'pointer', display: 'flex',
      alignItems: 'center', gap: 6,
    }}>
      <svg width="12" height="12" viewBox="0 0 20 20"><path d="M4 7h12M14 4l3 3-3 3M16 13H4M6 10l-3 3 3 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {label}
    </button>
  );
}

// ── PSet row ──────────────────────────────────────────────────────────────────
function PRow({ k, v }: { k: string; v: string | number | boolean }) {
  const display = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);
  return <div className="pset-row"><span className="k">{k}</span><span>{display}</span></div>;
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function PropertiesPane({
  items, selection, updateItem, addItem, deleteItems, tool, setTool, t, lang, openSettings, onCollapse, fullCatalogue = [], replaceItems, surveyInbox,
}: Props) {
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [lastItemId, setLastItemId] = useState<string | null>(null);
  const selectedId = selection.length === 1 ? selection[0] : null;
  if (selectedId !== lastItemId) {
    setLastItemId(selectedId);
    setCatalogueOpen(false);
  }
  const collapseBtn = <CollapseBtn onClick={onCollapse} lang={lang} />;
  const fr = lang === 'fr';

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (selection.length === 0) {
    return (
      <div className="props-pane">
        <div className="pane-head">
          <span className="title">{t('properties')}</span>
          <div className="actions">
            <button className="icon-btn" onClick={openSettings} title={t('settings')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-0.44a2 2 0 0 0-2 2v0.18a2 2 0 0 1-1 1.73l-0.43.25a2 2 0 0 1-2 0l-0.15-0.08a2 2 0 0 0-2.73.73l-0.22.38a2 2 0 0 0 .73 2.73l0.15.1a2 2 0 0 1 1 1.72v0.51a2 2 0 0 1-1 1.74l-0.15.09a2 2 0 0 0-.73 2.73l0.22.38a2 2 0 0 0 2.73.73l0.15-0.08a2 2 0 0 1 2 0l0.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h0.44a2 2 0 0 0 2-2v-0.18a2 2 0 0 1 1-1.73l0.43-.25a2 2 0 0 1 2 0l0.15.08a2 2 0 0 0 2.73-.73l0.22-.39a2 2 0 0 0-.73-2.73l-0.15-.08a2 2 0 0 1-1-1.74v-0.5a2 2 0 0 1 1-1.74l0.15-.09a2 2 0 0 0 .73-2.73l-0.22-.38a2 2 0 0 0-2.73-.73l-0.15.08a2 2 0 0 1-2 0l-0.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
            {collapseBtn}
          </div>
        </div>
        <div className="props-empty">
          <div className="ghost-card">
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--border)', display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}>
              <svg width="20" height="20" viewBox="0 0 20 20"><path d="M4 3l13 7-5.5 1.5L9 17 4 3z" fill="currentColor" /></svg>
            </div>
            <div style={{ fontWeight: 500, color: 'var(--ink)' }}>{t('no_selection')}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', textAlign: 'center', maxWidth: 220 }}>{t('click_to_select')}</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Multi-select ─────────────────────────────────────────────────────────────
  if (selection.length > 1) {
    const sels = selection.map((id) => items[id]).filter(Boolean);
    return (
      <div className="props-pane">
        <div className="pane-head">
          <span className="title">{t('properties')}</span>
          <div className="actions">
            <button className="icon-btn" onClick={openSettings} title={t('settings')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-0.44a2 2 0 0 0-2 2v0.18a2 2 0 0 1-1 1.73l-0.43.25a2 2 0 0 1-2 0l-0.15-0.08a2 2 0 0 0-2.73.73l-0.22.38a2 2 0 0 0 .73 2.73l0.15.1a2 2 0 0 1 1 1.72v0.51a2 2 0 0 1-1 1.74l-0.15.09a2 2 0 0 0-.73 2.73l0.22.38a2 2 0 0 0 2.73.73l0.15-0.08a2 2 0 0 1 2 0l0.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h0.44a2 2 0 0 0 2-2v-0.18a2 2 0 0 1 1-1.73l0.43-.25a2 2 0 0 1 2 0l0.15.08a2 2 0 0 0 2.73-.73l0.22-.39a2 2 0 0 0-.73-2.73l-0.15-.08a2 2 0 0 1-1-1.74v-0.5a2 2 0 0 1 1-1.74l0.15-.09a2 2 0 0 0 .73-2.73l-0.22-.38a2 2 0 0 0-2.73-.73l-0.15.08a2 2 0 0 1-2 0l-0.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
            {collapseBtn}
          </div>
        </div>
        <div className="props-head">
          <div className="type"><span className="swatch" style={{ background: 'var(--ink)' }} />{selection.length} {t('selected')}</div>
        </div>
        <div className="props-body">
          <div className="section">
            <div className="section-head"><h4>{makeT(lang)("Selection")}</h4></div>
            <div style={{ padding: '4px 12px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {sels.map((it) => (
                <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11.5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: TYPE_COLOR[it.type] ?? 'var(--ink-3)', flexShrink: 0 }} />
                  <span style={{ flex: 1 }} title={it.name}>{shortName(it, lang)}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>{itemDimensions(it) || it.type}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Single selection ─────────────────────────────────────────────────────────
  const it = items[selection[0]];
  if (!it) return null;

  const g = (it as any).geom;
  // Match logic: find catalogue template
  let matchedCat = fullCatalogue.find((cat) => cat.id === g?.catalogueId || cat.id === (it as any).model);
  if (!matchedCat && g && (it.type === 'Door' || it.type === 'Window')) {
    matchedCat = fullCatalogue.find((cat) => {
      if (cat.type !== it.type) return false;
      const wD = Math.abs(g.width - cat.defaults.width) < 0.01;
      const hD = Math.abs(g.height - cat.defaults.height) < 0.01;
      if (!wD || !hD) return false;
      if (cat.defaults.OperationType === undefined) return true;
      let catOp = cat.defaults.OperationType;
      if (catOp === 'FIXED') catOp = 'FIXEDCASEMENT';
      if (catOp === 'DOUBLE_PANEL') catOp = 'DOUBLE_PANEL_VERTICAL';
      if (catOp === 'SLIDING') catOp = 'SLIDINGHORIZONTAL';
      if (catOp === 'TILT_AND_TURN') catOp = 'TILTANDTURNLEFT';
      
      let itOp = (it as any).OperationType;
      if (itOp === 'FIXED') itOp = 'FIXEDCASEMENT';
      if (itOp === 'DOUBLE_PANEL') itOp = 'DOUBLE_PANEL_VERTICAL';
      if (itOp === 'SLIDING') itOp = 'SLIDINGHORIZONTAL';
      if (itOp === 'TILT_AND_TURN') itOp = 'TILTANDTURNLEFT';
      
      return itOp === catOp;
    });
  }
  const isCustomResized = !!(matchedCat && g && (
    it.type === 'Furniture'
      ? (Math.abs(g.w - matchedCat.defaults.width) > 0.01 || Math.abs(g.d - (matchedCat.defaults.depth ?? matchedCat.defaults.width)) > 0.01)
      : (Math.abs(g.width - matchedCat.defaults.width) > 0.01 || Math.abs(g.height - matchedCat.defaults.height) > 0.01)
  ));

  // Deep path updater
  const upd = (path: string, val: unknown) => {
    updateItem(it.id, (prevItem) => {
      const parts = path.split('.');
      const itemCopy = JSON.parse(JSON.stringify(prevItem));
      let target = itemCopy;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!target[parts[i]]) target[parts[i]] = {};
        target = target[parts[i]];
      }
      target[parts[parts.length - 1]] = val;
      const aliases: Record<string, string> = { material: 'Material', fireRating: 'FireRating', loadBearing: 'LoadBearing', isExternal: 'IsExternal', uValue: 'ThermalTransmittance' };
      if (aliases[path]) itemCopy[aliases[path]] = val;
      if (parts[0] === 'geom' && itemCopy.geom) itemCopy.geom = markGeomEdit(itemCopy.geom, [parts[1]]);
      return itemCopy;
    });
  };

  // Columns and chimneys: every geometry edit goes through the shared validator (invalid input is ignored).
  const updStructural = (input: StructuralInput) => updateItem(it.id, (prev) => {
    const p = prev as any;
    try {
      const next = p.type === 'Column' ? { geom: columnGeom(input, p.geom, p.geom.h) } : chimneyGeom(input, p, p.geom.h);
      return { ...next, geom: markGeomEdit(next.geom, Object.keys(input).map(k => ({ width: 'w', depth: 'd', diameter: 'w', height: 'h' } as Record<string, string>)[k] ?? k)) } as Partial<IfcEntity>;
    } catch { return {}; }
  });

  // Duplicate
  const duplicate = () => {
    // Prefix must stay in Canvas3D's manual-item list (Chimney → chm, not chi).
    const newId = ({ Chimney: 'chm', Column: 'col' } as Record<string, string>)[it.type] ?? it.type.slice(0, 3).toLowerCase();
    const newIdFull = newId + '_dup_' + Date.now();
    const copy: any = JSON.parse(JSON.stringify(it));
    copy.id = newIdFull;
    copy.GlobalId = guid(newIdFull);
    copy.name = (it.name || it.type) + ' (copie)';
    copy.Name = copy.name;
    // Offset geometry slightly
    if (it.type === 'Wall') { copy.geom.x1 += 0.5; copy.geom.y1 += 0.5; copy.geom.x2 += 0.5; copy.geom.y2 += 0.5; }
    else if (it.type === 'Furniture' || it.type === 'Column' || it.type === 'Chimney') { copy.geom.x += 0.5; copy.geom.y += 0.5; }
    else if (it.type === 'GenericElement') { copy.geom.x += 0.5; copy.geom.y += 0.5; }
    else if (it.type === 'Room') { copy.geom.polygon = copy.geom.polygon.map(([x, y]: [number, number]) => [x + 0.5, y + 0.5]); }
    else if (it.type === 'Door' || it.type === 'Window') {
      // Move copy slightly along wall; new item has no original IFC entity
      copy.geom.t = Math.min(0.9, copy.geom.t + 0.1);
      copy.geom._keepOriginalPlacement = false;
      delete copy.geom.openingExpId;
    }
    addItem(copy);
  };

  // Invert wall endpoints and hosted opening positions/sides
  const flipWall = () => {
    if (it.type !== 'Wall' || !g) return;
    const wallCopy = JSON.parse(JSON.stringify(it));
    const { x1, y1, x2, y2 } = wallCopy.geom;
    wallCopy.geom.x1 = x2;
    wallCopy.geom.y1 = y2;
    wallCopy.geom.x2 = x1;
    wallCopy.geom.y2 = y1;
    wallCopy.geom._edited = true;
    updateItem(it.id, wallCopy);

    Object.values(items).forEach((item) => {
      if ((item.type === 'Door' || item.type === 'Window') && (item as any).geom?.wallId === it.id) {
        const hostedCopy = JSON.parse(JSON.stringify(item));
        hostedCopy.geom.t = Math.max(0.01, Math.min(0.99, 1.0 - hostedCopy.geom.t));
        hostedCopy.geom.side = -(hostedCopy.geom.side || 1);
        
        // Flip swing direction to preserve exact physical hinge placement on screen
        const currentSwing = hostedCopy.geom.swing || 'left';
        hostedCopy.geom.swing = currentSwing === 'right' ? 'left' : 'right';
        const op = hostedCopy.OperationType || '';
        if (op.includes('SINGLE_SWING')) {
          hostedCopy.OperationType = hostedCopy.geom.swing === 'right' ? 'SINGLE_SWING_RIGHT' : 'SINGLE_SWING_LEFT';
        }

        hostedCopy.geom._edited = true;
        updateItem(item.id, hostedCopy);
      }
    });
  };

  // Swap door ↔ window
  const swapDoorWindow = () => {
    const newId = (it.type === 'Door' ? 'wn_' : 'd_') + 'swap_' + Date.now();
    if (it.type === 'Door') {
      const d = it as IfcDoorEntity;
      const win: IfcWindowEntity = {
        id: newId, type: 'Window', ifcType: 'IfcWindow',
        name: d.name.replace(/porte/i, 'Fenêtre').replace(/door/i, 'Window') || 'Fenêtre',
        Name: d.Name.replace(/porte/i, 'Fenêtre').replace(/door/i, 'Window') || 'Fenêtre',
        GlobalId: guid(newId), parentId: d.parentId,
        PredefinedType: 'WINDOW',
        OverallWidth: d.OverallWidth, OverallHeight: Math.min(d.OverallHeight, 1.4),
        ThermalTransmittance: 1.4, Material: d.material || '',
        geom: { wallId: d.geom.wallId, t: d.geom.t, width: d.geom.width, height: Math.min(d.geom.height, 1.4), sillHeight: 0.9 },
        material: d.material, uValue: 1.4,
      };
      deleteItems([it.id]);
      addItem(win);
    } else if (it.type === 'Window') {
      const w = it as IfcWindowEntity;
      const door: IfcDoorEntity = {
        id: newId, type: 'Door', ifcType: 'IfcDoor',
        name: w.name.replace(/fenêtre/i, 'Porte').replace(/window/i, 'Door') || 'Porte',
        Name: w.Name.replace(/fenêtre/i, 'Porte').replace(/window/i, 'Door') || 'Porte',
        GlobalId: guid(newId), parentId: w.parentId,
        PredefinedType: 'DOOR', OperationType: 'SINGLE_SWING_LEFT',
        OverallWidth: w.OverallWidth, OverallHeight: 2.1,
        FireRating: '', Material: w.material || '',
        geom: { wallId: w.geom.wallId, t: w.geom.t, width: w.geom.width, height: 2.1, swing: 'left', side: 1 },
        material: w.material, fireRating: '',
      };
      deleteItems([it.id]);
      addItem(door);
    }
  };

  const headActions = (
    <div className="actions">
      {(it.type === 'Wall' || it.type === 'Room' || it.type === 'Furniture' || it.type === 'Door' || it.type === 'Window' || it.type === 'GenericElement' || it.type === 'Column' || it.type === 'Chimney') && (
        <button className="icon-btn" title={makeT(lang)("Duplicate")} onClick={duplicate}>
          <svg width="13" height="13" viewBox="0 0 20 20"><rect x="6" y="6" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M3 13V4a1 1 0 011-1h9" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
        </button>
      )}
      <button className="icon-btn" onClick={openSettings} title={t('settings')}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.22 2h-0.44a2 2 0 0 0-2 2v0.18a2 2 0 0 1-1 1.73l-0.43.25a2 2 0 0 1-2 0l-0.15-0.08a2 2 0 0 0-2.73.73l-0.22.38a2 2 0 0 0 .73 2.73l0.15.1a2 2 0 0 1 1 1.72v0.51a2 2 0 0 1-1 1.74l-0.15.09a2 2 0 0 0-.73 2.73l0.22.38a2 2 0 0 0 2.73.73l0.15-0.08a2 2 0 0 1 2 0l0.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h0.44a2 2 0 0 0 2-2v-0.18a2 2 0 0 1 1-1.73l0.43-.25a2 2 0 0 1 2 0l0.15.08a2 2 0 0 0 2.73-.73l0.22-.39a2 2 0 0 0-.73-2.73l-0.15-.08a2 2 0 0 1-1-1.74v-0.5a2 2 0 0 1 1-1.74l0.15-.09a2 2 0 0 0 .73-2.73l-0.22-.38a2 2 0 0 0-2.73-.73l-0.15.08a2 2 0 0 1-2 0l-0.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      {collapseBtn}
    </div>
  );

  return (
    <div className="props-pane">
      <div className="pane-head">
        <span className="title">{t('properties')}</span>
        {headActions}
      </div>

      {/* Header: type badge + editable name + GUID */}
      <div className={`props-head type-${it.type}`}>
        <div className="type">
          <span className="swatch" style={{ background: TYPE_COLOR[it.type] }} />
          {IFC_NAMES[it.type] || it.type}
        </div>
        <div className="name">
          <input 
            value={it.name ?? it.Name ?? ''}
            placeholder={makeT(lang)("Item name")}
            onChange={(e) => { 
              const v = e.target.value;
              updateItem(it.id, { name: v, Name: v });
            }} 
            style={{ borderBottom: '1px dashed var(--border-strong)' }}
          />
        </div>
        <div className="name" style={{ marginTop: 6 }}>
          <textarea
            value={it.description || ''}
            placeholder={makeT(lang)("Description (AI instructions)")}
            onChange={(e) => updateItem(it.id, { description: e.target.value })}
            style={{ 
              width: '100%', 
              background: 'transparent', 
              border: '1px dashed var(--border-strong)', 
              color: 'var(--ink-2)', 
              fontSize: 11, 
              fontFamily: 'inherit',
              padding: 4,
              resize: 'vertical',
              minHeight: 40
            }}
          />
        </div>
        <div className="guid">
          <svg width="11" height="11" viewBox="0 0 20 20"><rect x="4" y="9" width="12" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M7 9V6a3 3 0 016 0v3" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
          {it.GlobalId}
        </div>
      </div>

      <div className="props-body" key={it.id}>
        <SurveyReliabilityRow item={it} lang={lang} />
        <SurveyPhotos items={items} id={it.id} lang={lang} />

        {/* ── WALL ──────────────────────────────────────────────────────────── */}
        {it.type === 'Wall' && g && (
          <Section title={t('geometry')} badge={formatDims([wallLength(g), g.thickness, g.height])}>
            <Row label={makeT(lang)("Point A (x, y)")}>
              <div className="pair">
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Num value={g.x1} onChange={(v) => upd('geom.x1', v)} /></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Num value={g.y1} onChange={(v) => upd('geom.y1', v)} /></div>
              </div>
            </Row>
            <Row label={makeT(lang)("Point B (x, y)")}>
              <div className="pair">
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Num value={g.x2} onChange={(v) => upd('geom.x2', v)} /></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Num value={g.y2} onChange={(v) => upd('geom.y2', v)} /></div>
              </div>
            </Row>
            <Row label={makeT(lang)("Length")}><ReadOnly value={formatLength(wallLength(g))} /></Row>
            <Row label={t('thickness')}><Num value={g.thickness} onChange={(v) => upd('geom.thickness', v)} step={0.01} min={0.05} /></Row>
            <Row label={t('height')}><Num value={g.height} onChange={(v) => upd('geom.height', v)} /></Row>
            <Row2 label={makeT(lang)("Orientation")}>
              <button
                className="btn-action btn-danger"
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  background: 'var(--panel-active, var(--panel))',
                  border: '1px solid var(--accent)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: 'var(--accent)',
                  fontSize: '11px',
                  fontWeight: 600,
                  transition: 'all 0.2s',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                }}
                onClick={flipWall}
              >
                🔄 {makeT(lang)("Reverse wall direction")}
              </button>
            </Row2>
          </Section>
        )}

        {/* ── DOOR / WINDOW ─────────────────────────────────────────────────── */}
        {(it.type === 'Door' || it.type === 'Window') && g && (
          <Section title={t('geometry')} badge={formatDims([g.width, g.height])}>
            {/* CATALOGUE COLLAPSIBLE SELECTOR */}
            <Row2 label={makeT(lang)("Catalog template")}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', position: 'relative' }}>
                {/* TRIGGER BUTTON */}
                <button
                  onClick={() => setCatalogueOpen(!catalogueOpen)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '6px 8px',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                    outline: 'none',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                    position: 'relative'
                  }}
                  className="catalogue-trigger-btn"
                >
                  <div style={{ width: 40, height: 24, background: 'var(--panel)', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1px solid var(--border)', overflow: 'hidden' }}>
                    <svg width="40" height="24" viewBox="0 0 64 36" style={{ display: 'block', transform: 'scale(0.85)' }}>
                      <g transform="translate(0, 17)">
                        {renderElementSvg(matchedCat ? matchedCat.iconKey : (it.type === 'Door' ? 'door-single-left' : 'win-double'), 64, 36)}
                      </g>
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {matchedCat ? (lang === 'fr' ? matchedCat.labelFr : matchedCat.labelEn) : (makeT(lang)("Custom element"))}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 9.5, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>
                        {Math.round(g.width * 100)}×{Math.round(g.height * 100)} cm
                      </span>
                      {isCustomResized && (
                        <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', background: 'oklch(0.85 0.12 85 / 15%)', color: 'oklch(0.65 0.14 85)', borderRadius: 4, padding: '0 4px', fontWeight: 600 }}>
                          {makeT(lang)("custom-fit")}
                        </span>
                      )}
                    </div>
                  </div>
                  <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform: catalogueOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease', color: 'var(--ink-4)' }}>
                    <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {/* EXPANDABLE COLLAPSIBLE PANEL */}
                {catalogueOpen && (
                  <div
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      background: 'var(--panel)',
                      padding: '8px',
                      marginTop: 4,
                      boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
                      zIndex: 10,
                      animation: 'el-dropdown-in 0.15s ease-out'
                    }}
                  >
                    <style>{`
                      @keyframes el-dropdown-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
                    `}</style>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
                      <span style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-4)' }}>
                        {makeT(lang)("Available templates")}
                      </span>
                      <button
                        onClick={() => setCatalogueOpen(false)}
                        style={{ border: 'none', background: 'transparent', color: 'var(--ink-4)', cursor: 'pointer', fontSize: 10, padding: 2 }}
                      >
                        ✕
                      </button>
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: 6,
                        width: '100%',
                        maxHeight: 180,
                        overflowY: 'auto',
                        padding: 2,
                        scrollbarWidth: 'thin'
                      }}
                    >
                      {fullCatalogue
                        .filter((cat) => cat.type === it.type)
                        .map((cat) => {
                          const label = lang === 'fr' ? cat.labelFr : cat.labelEn;
                          const dimLabel = `${Math.round(cat.defaults.width * 100)}×${Math.round(cat.defaults.height * 100)}`;
                          
                          // We check match using the new catalogueId tracking:
                          const isMatched = g.catalogueId === cat.id;

                          const tileW = 64, tileH = 36;
                          return (
                            <button
                              key={cat.id}
                              onClick={() => {
                                updateItem(it.id, (prev: any) => {
                                  const copy = JSON.parse(JSON.stringify(prev));
                                  copy.name = label;
                                  copy.Name = label;
                                  copy.geom.width = cat.defaults.width;
                                  copy.OverallWidth = cat.defaults.width;
                                  copy.geom.height = cat.defaults.height;
                                  copy.OverallHeight = cat.defaults.height;
                                  copy.geom.catalogueId = cat.id; // Store reference to keep selected!
                                  if (it.type === 'Window') copy.isBayWindow = !!cat.defaults.isBayWindow;
                                  if (cat.defaults.swing !== undefined) {
                                    copy.geom.swing = cat.defaults.swing;
                                  }
                                  if (cat.defaults.sillHeight !== undefined) {
                                    copy.geom.sillHeight = cat.defaults.sillHeight;
                                  }
                                  if (cat.defaults.OperationType !== undefined) {
                                    let opType = cat.defaults.OperationType;
                                    if (opType === 'FIXED') opType = 'FIXEDCASEMENT';
                                    if (opType === 'DOUBLE_PANEL') opType = 'DOUBLE_PANEL_VERTICAL';
                                    if (opType === 'SLIDING') opType = 'SLIDINGHORIZONTAL';
                                    if (opType === 'TILT_AND_TURN') opType = 'TILTANDTURNLEFT';
                                    copy.OperationType = opType;
                                  }
                                  copy.geom._edited = true;
                                  return copy;
                                });
                                setCatalogueOpen(false); // Close dropdown upon selection!
                              }}
                              title={`${label} (${cat.defaults.width.toFixed(2)}x${cat.defaults.height.toFixed(2)}m)`}
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: 2,
                                padding: '4px 3px 3px',
                                border: isMatched ? '2px solid var(--accent)' : '1px solid var(--border)',
                                borderRadius: 6,
                                background: isMatched ? 'color-mix(in oklch, var(--accent) 8%, var(--panel))' : 'var(--panel)',
                                cursor: 'pointer',
                                transition: 'all 0.12s',
                                boxShadow: isMatched ? '0 0 0 2px color-mix(in oklch, var(--accent) 15%, transparent)' : '0 1px 2px rgba(0,0,0,0.05)',
                                outline: 'none',
                                minWidth: 0,
                                position: 'relative'
                              }}
                            >
                              <svg width={tileW} height={tileH} viewBox={`0 0 ${tileW} ${tileH}`} style={{ display: 'block', background: 'var(--bg)', borderRadius: 3 }}>
                                <g transform={`translate(0,${tileH / 2 - 1})`}>{renderElementSvg(cat.iconKey, tileW, tileH)}</g>
                              </svg>
                              <span
                                style={{
                                  fontSize: '8.5px',
                                  fontWeight: isMatched ? 600 : 400,
                                  color: isMatched ? 'var(--accent)' : 'var(--ink)',
                                  textAlign: 'center',
                                  width: '100%',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {label}
                              </span>
                              <span style={{ fontSize: '8px', color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>
                                {dimLabel}
                              </span>
                              {isMatched && (
                                <div style={{ position: 'absolute', top: 2, right: 2, width: 9, height: 9, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <svg width={5} height={5} viewBox="0 0 10 10"><path d="M2 5l2.5 2.5 4-4" stroke='var(--bg)' strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                </div>
                              )}
                              {cat.source !== 'builtin' && (
                                <span style={{ position: 'absolute', top: 2, left: 2, fontSize: 6, fontFamily: 'var(--font-mono)', background: cat.source === 'project' ? 'oklch(0.6 0.15 270)' : 'oklch(0.6 0.15 145)', color: '#fff', borderRadius: 2, padding: '0px 2px' }}>
                                  {cat.source === 'project' ? 'PRJ' : 'USR'}
                                </span>
                              )}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            </Row2>

            <Row label={makeT(lang)("Host wall")}>
              <input className="mono" value={items[g.wallId] ? shortName(items[g.wallId], lang) : g.wallId} readOnly />
            </Row>
            <Row label={makeT(lang)("Position")}>
              <input className="mono" type="range" min="0.05" max="0.95" step="0.01"
                value={g.t} onChange={(e) => upd('geom.t', parseFloat(e.target.value))}
                style={{ flex: 1 }} />
              <span className="unit" style={{ minWidth: 32 }}>{(g.t * 100).toFixed(0)}%</span>
            </Row>
            <Row label={t('width')}><Num value={g.width} onChange={(v) => { upd('geom.width', v); upd('OverallWidth', v); }} /></Row>
            <Row label={t('height')}><Num value={g.height} onChange={(v) => { upd('geom.height', v); upd('OverallHeight', v); }} /></Row>
            {it.type === 'Window' && (
              <Row label={t('sill_height')}><Num value={g.sillHeight ?? 0.9} onChange={(v) => upd('geom.sillHeight', v)} /></Row>
            )}
            {(it.type === 'Door' || it.type === 'Window') && (
              <>
                <Row2 label={makeT(lang)("Swing")}>
                  <Seg
                    options={[["left", makeT(lang)("Toward wall start")], ["right", makeT(lang)("Toward wall end")]]}
                    value={openingSwing((it as any).OperationType ?? '', g.swing)}
                    onChange={(v) => {
                      upd('geom.swing', v);
                      const op = (it as any).OperationType || '';
                      if (op.includes('SINGLE_SWING')) {
                        upd('OperationType', v === 'right' ? 'SINGLE_SWING_RIGHT' : 'SINGLE_SWING_LEFT');
                      }
                    }}
                  />
                </Row2>
                <Row2 label={makeT(lang)("Side")}>
                  <Seg
                    options={[["1", makeT(lang)("Wall side +")], ["-1", makeT(lang)("Wall side −")]]}
                    value={String(g.side ?? 1)}
                    onChange={(v) => upd('geom.side', parseInt(v, 10))}
                  />
                </Row2>
              </>
            )}
            <Row2 label={makeT(lang)("Replace with")}>
              <SwapBtn
                label={it.type === 'Door' ? (makeT(lang)("Convert to window")) : (makeT(lang)("Convert to door"))}
                onClick={swapDoorWindow}
              />
            </Row2>
          </Section>
        )}

        {/* ── MARKER ─────────────────────────────────────────────────────── */}
        {it.type === 'Marker' && g && (
          <Section title={t('geometry')}>
            <Row label={makeT(lang)("Position (x, y)")}>
              <div className="pair">
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Num value={(g as any).x} onChange={(v) => upd('geom.x', v)} /></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Num value={(g as any).y} onChange={(v) => upd('geom.y', v)} /></div>
              </div>
            </Row>
          </Section>
        )}

        {/* ── COLUMN / CHIMNEY ──────────────────────────────────────────────── */}
        {(it.type === 'Column' || it.type === 'Chimney') && g && (() => {
          const T = makeT(lang);
          const isColumn = it.type === 'Column';
          const kind = isColumn ? undefined : it.kind;
          const selectStyle = { width: '100%', padding: '4px 8px', borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' };
          return (
            <Section title={t('geometry')} badge={formatDims([g.w, g.d, g.h])}>
              {isColumn ? (
                <Row label={T("Section shape")}>
                  <select value={g.shape} onChange={(e) => updStructural({ shape: e.target.value })} style={selectStyle}>
                    <option value="rect">{T("Rectangular")}</option>
                    <option value="circle">{T("Circular")}</option>
                  </select>
                </Row>
              ) : (
                <Row label={T("Chimney kind")}>
                  <select value={kind} onChange={(e) => updStructural({ kind: e.target.value })} style={selectStyle}>
                    <option value="flue">{T("Flue")}</option>
                    <option value="fireplace">{T("Fireplace")}</option>
                    <option value="stove">{T("Stove")}</option>
                  </select>
                </Row>
              )}
              <Row label={T("Position")}>
                <div className="pair">
                  <Num value={g.x} onChange={(v) => updStructural({ x: v })} />
                  <Num value={g.y} onChange={(v) => updStructural({ y: v })} />
                </div>
              </Row>
              {isColumn && g.shape === 'circle' ? (
                <Row label={T("Diameter")}><Num value={g.w} min={0.01} onChange={(v) => updStructural({ diameter: v })} /></Row>
              ) : (
                <Row label={T("W × D")}>
                  <div className="pair">
                    <Num value={g.w} min={0.01} onChange={(v) => updStructural({ width: v })} />
                    <Num value={g.d} min={0.01} onChange={(v) => updStructural({ depth: v })} />
                  </div>
                </Row>
              )}
              <Row label={t('height')}><Num value={g.h} min={0.01} onChange={(v) => updStructural({ height: v })} /></Row>
              {!isColumn && (() => {
                const roofH = chimneyHeightThroughRoof(items, it.parentId, g.x, g.y);
                return roofH !== null && (
                  <Row label={t('roof')}>
                    <button className="btn" disabled={Math.abs(roofH - g.h) < 0.005} onClick={() => updStructural({ height: roofH })}>
                      {T("Rise through the roof")} ({roofH.toFixed(2)} m)
                    </button>
                  </Row>
                );
              })()}
              {kind === 'fireplace' && (<>
                <Row label={T("Hearth height")}><Num value={g.hearthH} min={0.01} onChange={(v) => updStructural({ hearth_height: v })} /></Row>
                <Row label={T("Flue width")}><Num value={g.flueW} min={0.01} onChange={(v) => updStructural({ flue_width: v })} /></Row>
                <Row label={T("Flue depth")}><Num value={g.flueD} min={0.01} onChange={(v) => updStructural({ flue_depth: v })} /></Row>
              </>)}
              {kind === 'stove' && (<>
                <Row label={T("Stove height")}><Num value={g.hearthH} min={0.01} onChange={(v) => updStructural({ hearth_height: v })} /></Row>
                <Row label={T("Flue pipe diameter")}><Num value={g.flueW} min={0.01} onChange={(v) => updStructural({ flue_width: v, flue_depth: v })} /></Row>
              </>)}
              <Row label={t('rotation')}><Num value={(g.rotation || 0) * 180 / Math.PI} unit="°" step={15} onChange={(v) => updStructural({ rotation: v * Math.PI / 180 })} /></Row>
              <Row label={t('material')}><input value={(it as any).Material || ''} onChange={(e) => updateItem(it.id, { Material: e.target.value } as Partial<IfcEntity>)} /></Row>
            </Section>
          );
        })()}

        {/* ── TECHNICAL ─────────────────────────────────────────────────────── */}
        {it.type === 'Technical' && g && (() => {
          const disc = (it as any).discipline || 'electrical';
          return (
            <>
              <Section title={makeT(lang)("Technical properties")}>
                <Row label={makeT(lang)("Discipline")}>
                  <select
                    value={disc}
                    onChange={(e) => upd('discipline', e.target.value)}
                    style={{ width: '100%', padding: '4px 8px', borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                  >
                    <option value="electrical">{makeT(lang)("Electrical")}</option>
                    <option value="plumbing">{makeT(lang)("Plumbing")}</option>
                    <option value="hvac">{makeT(lang)("HVAC")}</option>
                    <option value="fire">{makeT(lang)("Fire safety")}</option>
                    <option value="data">{makeT(lang)("Data / Telecom")}</option>
                  </select>
                </Row>
                
                {disc === 'electrical' && (
                  <>
                    <Row label={makeT(lang)("Circuit Ref")}>
                      <input
                        type="text"
                        value={(it as any).circuitRef || ''}
                        onChange={(e) => upd('circuitRef', e.target.value)}
                        placeholder="e.g. C1-P1"
                        style={{ width: '100%', padding: '4px 8px', borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                      />
                    </Row>
                    <Row label={makeT(lang)("Amperage (A)")}>
                      <select
                        value={String((it as any).amperage || '16')}
                        onChange={(e) => upd('amperage', e.target.value)}
                        style={{ width: '100%', padding: '4px 8px', borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                      >
                        <option value="10">10 A</option>
                        <option value="16">16 A</option>
                        <option value="20">20 A</option>
                        <option value="32">32 A</option>
                      </select>
                    </Row>
                  </>
                )}

                {disc === 'plumbing' && (
                  <>
                    <Row label={makeT(lang)("Fluid type")}>
                      <select
                        value={(it as any).fluidType || 'EF'}
                        onChange={(e) => upd('fluidType', e.target.value)}
                        style={{ width: '100%', padding: '4px 8px', borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                      >
                        <option value="EF">{makeT(lang)("Cold Water")}</option>
                        <option value="ECS">{makeT(lang)("Hot Water")}</option>
                        <option value="EU">{makeT(lang)("Drainage")}</option>
                      </select>
                    </Row>
                    <Row label={makeT(lang)("Diameter (mm)")}>
                      <input
                        type="number"
                        value={(it as any).diameter || 12}
                        onChange={(e) => upd('diameter', Number(e.target.value))}
                        style={{ width: '100%', padding: '4px 8px', borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                      />
                    </Row>
                  </>
                )}

                {disc === 'hvac' && (
                  <>
                    <Row label={makeT(lang)("Device type")}>
                      <select
                        value={(it as any).hvacType || 'ventilation'}
                        onChange={(e) => upd('hvacType', e.target.value)}
                        style={{ width: '100%', padding: '4px 8px', borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--ink)' }}
                      >
                        <option value="ventilation">{makeT(lang)("VMC Extraction")}</option>
                        <option value="heating">{makeT(lang)("Radiator / Heating")}</option>
                        <option value="clima">{makeT(lang)("Air Conditioning")}</option>
                      </select>
                    </Row>
                  </>
                )}
              </Section>

              <Section title={t('geometry')}>
                <Row label={makeT(lang)("Position (x, y)")}>
                  <div className="pair">
                    <Num value={(g as any).x} onChange={(v) => upd('geom.x', v)} />
                    <Num value={(g as any).y} onChange={(v) => upd('geom.y', v)} />
                  </div>
                </Row>
                <Row label={makeT(lang)("Mounting height (m)")}>
                  <Num value={(g as any).mountHeight ?? 0.30} onChange={(v) => upd('geom.mountHeight', v)} step={0.05} />
                </Row>
                <Row label={makeT(lang)("Rotation (°)")}>
                  <Num
                    value={Math.round((((g as any).rotation || 0) * 180) / Math.PI)}
                    onChange={(v) => upd('geom.rotation', (v * Math.PI) / 180)}
                    step={15}
                  />
                </Row>
              </Section>
            </>
          );
        })()}

        {/* ── FURNITURE ─────────────────────────────────────────────────────── */}
        {it.type === 'Furniture' && g && (
          <Section title={t('geometry')} badge={formatDims([g.w, g.d, g.h])}>
            {/* CATALOGUE COLLAPSIBLE SELECTOR */}
            <Row2 label={makeT(lang)("Catalog template")}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', position: 'relative' }}>
                {/* TRIGGER BUTTON */}
                <button
                  onClick={() => setCatalogueOpen(!catalogueOpen)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '6px 8px',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                    outline: 'none',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                    position: 'relative'
                  }}
                  className="catalogue-trigger-btn"
                >
                  <div style={{ width: 40, height: 24, background: 'var(--panel)', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1px solid var(--border)', overflow: 'hidden' }}>
                    <svg width="40" height="24" viewBox="0 0 64 36" style={{ display: 'block', transform: 'scale(0.85)' }}>
                      <g>
                        {renderElementSvg(matchedCat ? matchedCat.iconKey : 'meuble-canape', 64, 36)}
                      </g>
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {matchedCat ? (lang === 'fr' ? matchedCat.labelFr : matchedCat.labelEn) : (makeT(lang)("Custom furniture"))}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 9.5, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>
                        {Math.round(g.w * 100)}×{Math.round(g.d * 100)}×{Math.round(g.h * 100)} cm
                      </span>
                      {isCustomResized && (
                        <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', background: 'oklch(0.85 0.12 85 / 15%)', color: 'oklch(0.65 0.14 85)', borderRadius: 4, padding: '0 4px', fontWeight: 600 }}>
                          {makeT(lang)("custom-fit")}
                        </span>
                      )}
                    </div>
                  </div>
                  <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform: catalogueOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease', color: 'var(--ink-4)' }}>
                    <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {/* EXPANDABLE COLLAPSIBLE PANEL */}
                {catalogueOpen && (
                  <div
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      background: 'var(--panel)',
                      padding: '8px',
                      marginTop: 4,
                      boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
                      zIndex: 10,
                      animation: 'el-dropdown-in 0.15s ease-out'
                    }}
                  >
                    <style>{`
                      @keyframes el-dropdown-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
                    `}</style>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
                      <span style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-4)' }}>
                        {makeT(lang)("Available templates")}
                      </span>
                      <button
                        onClick={() => setCatalogueOpen(false)}
                        style={{ border: 'none', background: 'transparent', color: 'var(--ink-4)', cursor: 'pointer', fontSize: 10, padding: 2 }}
                      >
                        ✕
                      </button>
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: 6,
                        width: '100%',
                        maxHeight: 180,
                        overflowY: 'auto',
                        padding: 2,
                        scrollbarWidth: 'thin'
                      }}
                    >
                      {fullCatalogue
                        .filter((cat) => cat.type === 'Furniture')
                        .map((cat) => {
                          const label = lang === 'fr' ? cat.labelFr : cat.labelEn;
                          const dimLabel = `${Math.round(cat.defaults.width * 100)}×${Math.round((cat.defaults.depth ?? cat.defaults.width) * 100)}×${Math.round(cat.defaults.height * 100)}`;
                          const isMatched = g.catalogueId === cat.id || (it as any).model === cat.id;
                          const tileW = 64, tileH = 36;
                          return (
                            <button
                              key={cat.id}
                              onClick={() => {
                                updateItem(it.id, (prev: any) => {
                                  const copy = JSON.parse(JSON.stringify(prev));
                                  copy.name = label;
                                  copy.Name = label;
                                  copy.category = cat.category;
                                  copy.model = cat.id;
                                  copy.geom.w = cat.defaults.width;
                                  copy.geom.d = cat.defaults.depth ?? cat.defaults.width;
                                  copy.geom.h = cat.defaults.height;
                                  copy.geom.catalogueId = cat.id;
                                  copy.geom._edited = true;
                                  return copy;
                                });
                                setCatalogueOpen(false);
                              }}
                              title={`${label} (${cat.defaults.width.toFixed(2)}x${(cat.defaults.depth ?? cat.defaults.width).toFixed(2)}x${cat.defaults.height.toFixed(2)}m)`}
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: 2,
                                padding: '4px 3px 3px',
                                border: isMatched ? '2px solid var(--accent)' : '1px solid var(--border)',
                                borderRadius: 6,
                                background: isMatched ? 'color-mix(in oklch, var(--accent) 8%, var(--panel))' : 'var(--panel)',
                                cursor: 'pointer',
                                transition: 'all 0.12s',
                                boxShadow: isMatched ? '0 0 0 2px color-mix(in oklch, var(--accent) 15%, transparent)' : '0 1px 2px rgba(0,0,0,0.05)',
                                outline: 'none',
                                minWidth: 0,
                                position: 'relative'
                              }}
                            >
                              <svg width={tileW} height={tileH} viewBox={`0 0 ${tileW} ${tileH}`} style={{ display: 'block', background: 'var(--bg)', borderRadius: 3 }}>
                                <g transform={`translate(0,${tileH / 2 - 1})`}>{renderElementSvg(cat.iconKey, tileW, tileH)}</g>
                              </svg>
                              <span
                                style={{
                                  fontSize: '8.5px',
                                  fontWeight: isMatched ? 600 : 400,
                                  color: isMatched ? 'var(--accent)' : 'var(--ink)',
                                  textAlign: 'center',
                                  width: '100%',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {label}
                              </span>
                              <span style={{ fontSize: '7.5px', color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>
                                {dimLabel}
                              </span>
                              {isMatched && (
                                <div style={{ position: 'absolute', top: 2, right: 2, width: 9, height: 9, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <svg width={5} height={5} viewBox="0 0 10 10"><path d="M2 5l2.5 2.5 4-4" stroke='var(--bg)' strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                </div>
                              )}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            </Row2>

            <Row label={makeT(lang)("Position")}>
              <div className="pair">
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Num value={g.x} onChange={(v) => upd('geom.x', v)} /></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Num value={g.y} onChange={(v) => upd('geom.y', v)} /></div>
              </div>
            </Row>
            <Row label={makeT(lang)("W × D")}>
              <div className="pair">
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Num value={g.w} onChange={(v) => upd('geom.w', v)} /></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Num value={g.d} onChange={(v) => upd('geom.d', v)} /></div>
              </div>
            </Row>
            <Row label={t('height')}><Num value={g.h} onChange={(v) => upd('geom.h', v)} /></Row>
            <Row label={t('rotation')}>
              <input className="mono" type="number" step="15"
                value={Math.round(g.rotation * 180 / Math.PI)}
                onChange={(e) => upd('geom.rotation', (parseFloat(e.target.value) || 0) * Math.PI / 180)} />
              <span className="unit">°</span>
              <button style={{ marginLeft: 4, padding: '2px 6px', fontSize: 10, border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg)', cursor: 'pointer', color: 'var(--ink-3)' }}
                onClick={() => upd('geom.rotation', 0)}>↺</button>
            </Row>
          </Section>
        )}
        {it.type === 'Furniture' && g && (() => {
          const isCuisine = (it as any).category === 'Cuisine' || ((it as any).model || '').startsWith('cuisine-');
          const finish: string = g.furnitureFinish || '';
          const color: string = g.furnitureColor || '';
          const worktopFinish: string = g.worktopFinish || '';

          // Kitchen cabinet finish presets
          const cabinetPresets: { id: string; label: string; hex: string }[] = [
            { id: 'blanc-brillant',   label: 'Glossy white',  hex: '#f5f5f5' },
            { id: 'blanc-mat',        label: 'Matte white',       hex: '#ececec' },
            { id: 'gris-anthracite',  label: 'Anthracite grey', hex: '#3a3a3a' },
            { id: 'gris-clair',       label: 'Light grey',      hex: '#b8b8b8' },
            { id: 'chene-naturel',    label: 'Natural oak',   hex: '#c8a06e' },
            { id: 'noyer',            label: 'Walnut',           hex: '#6b3a2a' },
            { id: 'bleu-nuit',        label: 'Midnight blue',       hex: '#1e3a5f' },
            { id: 'vert-sauge',       label: 'Sage green',      hex: '#7e9e7e' },
            { id: 'noir-mat',         label: 'Matte black',        hex: '#1a1a1a' },
            { id: 'beton-cire',       label: 'Polished concrete',      hex: '#8a8a80' },
            { id: 'rouge-bordeaux',   label: 'Burgundy',        hex: '#7b2040' },
            { id: 'creme',            label: 'Cream',           hex: '#f0e8d8' },
          ];

          // Worktop presets (only shown for kitchen category)
          const worktopPresets: { id: string; label: string; hex: string }[] = [
            { id: 'marbre-blanc',     label: 'White marble',    hex: '#f4f0eb' },
            { id: 'marbre-noir',      label: 'Black marble',     hex: '#2a2a2a' },
            { id: 'granit-gris',      label: 'Grey granite',     hex: '#7a7878' },
            { id: 'quartz-blanc',     label: 'White quartz',    hex: '#efefef' },
            { id: 'bois-chene',       label: 'Oak wood',      hex: '#c09050' },
            { id: 'inox',             label: 'Stainless steel',            hex: '#c0c0c0' },
            { id: 'stratifie-noir',   label: 'Black laminate',  hex: '#1c1c1c' },
            { id: 'beton',            label: 'Concrete',           hex: '#a0a098' },
          ];

          // Generic finish presets for non-kitchen
          const genericPresets = [
            { id: 'blanc',     label: 'White',    hex: '#f5f5f5' },
            { id: 'gris',      label: 'Grey',     hex: '#888888' },
            { id: 'chene',     label: 'Oak',    hex: '#c8a06e' },
            { id: 'noyer',     label: 'Walnut',    hex: '#6b3a2a' },
            { id: 'noir',      label: 'Black',     hex: '#1a1a1a' },
            { id: 'bleu',      label: 'Blue',     hex: '#1e3a5f' },
          ];

          const activePaletteLabel = cabinetPresets.find(p => p.id === finish)?.label
            || genericPresets.find(p => p.id === finish)?.label
            || (finish || (makeT(lang)("Choose…")));

          return (
            <Section title={makeT(lang)("Materials & Colors")}>
              {/* Cabinet / Body finish */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                  {isCuisine ? (makeT(lang)("Cabinet doors")) : (makeT(lang)("Finish"))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
                  {(isCuisine ? cabinetPresets : genericPresets).map(p => (
                    <button key={p.id}
                      title={makeT(lang)(p.label)}
                      onClick={() => { upd('geom.furnitureFinish', p.id); upd('geom.furnitureColor', p.hex); }}
                      style={{
                        width: '100%', aspectRatio: '1', borderRadius: 5, border: finish === p.id ? '2.5px solid var(--accent)' : '1.5px solid var(--border)',
                        background: p.hex, cursor: 'pointer', transition: 'transform 0.1s',
                        boxShadow: finish === p.id ? '0 0 0 2px color-mix(in oklch, var(--accent) 30%, transparent)' : 'inset 0 1px 2px rgba(0,0,0,0.15)',
                        outline: 'none', transform: finish === p.id ? 'scale(1.12)' : 'scale(1)',
                      }}
                    />
                  ))}
                </div>
                <div style={{ fontSize: 9, color: 'var(--ink-4)', marginTop: 4, fontStyle: 'italic' }}>
                  {makeT(lang)(activePaletteLabel)}
                </div>
                {/* Custom hex color */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>{makeT(lang)("Custom")}</span>
                  <input type="color" value={color || '#f5f5f5'}
                    onChange={(e) => { upd('geom.furnitureColor', e.target.value); upd('geom.furnitureFinish', 'custom'); }}
                    style={{ width: 28, height: 20, border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', padding: 1 }}
                  />
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--ink-4)' }}>{color || '#f5f5f5'}</span>
                </div>
              </div>

              {/* Worktop finish — cuisine only */}
              {isCuisine && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                    {makeT(lang)("Worktop")}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                    {worktopPresets.map(p => (
                      <button key={p.id}
                        title={makeT(lang)(p.label)}
                        onClick={() => upd('geom.worktopFinish', p.id === worktopFinish ? '' : p.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 4, padding: '4px 5px',
                          border: worktopFinish === p.id ? '2px solid var(--accent)' : '1px solid var(--border)',
                          borderRadius: 5, background: worktopFinish === p.id ? 'color-mix(in oklch, var(--accent) 8%, var(--panel))' : 'var(--panel)',
                          cursor: 'pointer', transition: 'all 0.1s', outline: 'none',
                        }}
                      >
                        <div style={{ width: 12, height: 12, borderRadius: 2, background: p.hex, border: '1px solid rgba(0,0,0,0.1)', flexShrink: 0 }} />
                        <span style={{ fontSize: 8.5, color: worktopFinish === p.id ? 'var(--accent)' : 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {makeT(lang)(p.label)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Section>
          );
        })()}



        {/* ── ROOM ──────────────────────────────────────────────────────────── */}
        {it.type === 'Room' && g && (() => {
          const area = polyArea(g.polygon);
          const peri = polyPerimeter(g.polygon);
          return (
            <Section title={t('geometry')}>
              <Row label={t('area')}><ReadOnly value={formatArea(area)} /></Row>
              <Row label={t('perimeter')}><ReadOnly value={formatLength(peri)} /></Row>
              <Row label={t('volume')}><ReadOnly value={formatVolume(area * (g.height || 2.7))} /></Row>
              <Row label={t('height')}><Num value={g.height} onChange={(v) => upd('geom.height', v)} /></Row>
              <Row label={makeT(lang)("Vertices")}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                  <ReadOnly value={g.polygon.length} />
                  <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                    {makeT(lang)("(dbl-click edge = +)")}
                  </span>
                </div>
              </Row>
              <div style={{ gridColumn: '1 / -1', marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {g.polygon.map((p: [number, number], i: number) => (
                  <div key={i} className="pair" style={{ background: 'var(--panel-2)', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span className="unit" style={{ width: 14, textAlign: 'left' }}>X{i+1}</span><Num value={p[0]} onChange={(v) => { const n = [...g.polygon]; n[i] = [v, p[1]]; upd('geom.polygon', n); }} /></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span className="unit" style={{ width: 14, textAlign: 'left' }}>Y{i+1}</span><Num value={p[1]} onChange={(v) => { const n = [...g.polygon]; n[i] = [p[0], v]; upd('geom.polygon', n); }} /></div>
                  </div>
                ))}
              </div>
            </Section>
          );
        })()}

        {/* ── SLAB ──────────────────────────────────────────────────────────── */}
        {it.type === 'Slab' && g && (() => {
          const area = polyArea(g.polygon);
          return (
            <Section title={t('geometry')}>
              <Row label={t('area')}><ReadOnly value={formatArea(area)} /></Row>
              <Row label={t('thickness')}><Num value={g.thickness} onChange={(v) => upd('geom.thickness', v)} step={0.01} /></Row>
              <Row label={makeT(lang)("Vertices")}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                  <ReadOnly value={g.polygon.length} />
                  <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                    {makeT(lang)("(dbl-click edge = +)")}
                  </span>
                </div>
              </Row>
              <div style={{ gridColumn: '1 / -1', marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {g.polygon.map((p: [number, number], i: number) => (
                  <div key={i} className="pair" style={{ background: 'var(--panel-2)', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span className="unit" style={{ width: 14, textAlign: 'left' }}>X{i+1}</span><Num value={p[0]} onChange={(v) => { const n = [...g.polygon]; n[i] = [v, p[1]]; upd('geom.polygon', n); }} /></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span className="unit" style={{ width: 14, textAlign: 'left' }}>Y{i+1}</span><Num value={p[1]} onChange={(v) => { const n = [...g.polygon]; n[i] = [p[0], v]; upd('geom.polygon', n); }} /></div>
                  </div>
                ))}
              </div>
            </Section>
          );
        })()}

        {it.type === 'Section' && g && <Section title="Coupe générale">{g.origin ? <p>Positionnez et orientez cette coupe avec les poignées dans la vue 3D.</p> : ['x1','y1','x2','y2'].map(k=><Row key={k} label={k.toUpperCase()}><Num value={g[k]} onChange={v=>upd('geom.'+k,v)}/></Row>)}</Section>}
        {it.type === 'Stair' && g && (() => {
          const model=buildStair(g,it.parentId,items);
          const flights=stairFlightDimensions(g,stairBaseCount(g,model.height));
          const landings=Array.from({length:stairFlightCount(g.form)-1},(_,i)=>stairLandingDimensions(g,i));
          return <Section title="Escalier">
          <Row label="Forme"><select value={g.form} onChange={e=>updateItem(it.id,{geom:{...g,form:e.target.value,...(['straight','spiral'].includes(e.target.value)&&g.flightLengths?.[0]===0?{flightLengths:g.flightLengths.map((v,i)=>i===0?g.going:v)}:{}),_edited:true}} as any)}>{Object.keys(STAIR_FORMS).map(v=><option key={v} value={v}>{makeT(lang)(STAIR_FORM_LABELS[v])}</option>)}</select></Row>
          <Row label="Étage d’arrivée"><select value={g.targetId} onChange={e=>upd('geom.targetId',e.target.value)}><option value="">{makeT(lang)("Choose…")}</option>{Object.values(items).filter(i=>i.type==='Storey' && i.id!==it.parentId).map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></Row>
          {['x','y','width','going','railHeight'].map(k=><Row key={k} label={({x:'X',y:'Y',width:'Largeur',going:'Giron par défaut',radius:'Rayon intérieur',railHeight:'Hauteur garde-corps'} as any)[k]}><Num value={g[k]} min={k==='x'||k==='y'?undefined:0.01} onChange={v=>upd('geom.'+k,v)}/></Row>)}
          <Row label="Rotation (°)"><Num value={g.rotation*180/Math.PI} unit="°" onChange={v=>upd('geom.rotation',v*Math.PI/180)}/></Row>
          <Row label="Calcul automatique"><input type="checkbox" checked={g.count==null} onChange={e=>updateItem(it.id,{geom:{...g,count:e.target.checked?undefined:model.count,flightLengths:undefined,_edited:true}} as any)}/></Row>
          <Row label="Nombre de marches"><Num value={model.count} min={2} step={1} onChange={v=>updateItem(it.id,{geom:{...g,count:Math.round(v),flightLengths:undefined,_edited:true}} as any)}/></Row>
          {g.form!=='straight' && g.form!=='spiral' && <Row label="Départ sur marches rayonnantes">
            <input type="checkbox" checked={hasStairWinderStart(g)} onChange={e=>updateItem(it.id,{geom:{...g,startWinders:e.target.checked,count:undefined,flightLengths:flights.map(f=>f.length),_edited:true}} as any)}/>
          </Row>}
          {g.form!=='spiral' && model.count>0 && flights.map((flight,i)=><Row key={'flight'+i} label={`Volée ${i+1} — longueur`}>
            <Num value={flight.length} min={.01} onChange={v=>updateItem(it.id,{geom:{...g,flightLengths:flights.map((f,k)=>k===i?v:f.length),count:undefined,_edited:true}} as any)}/>
            <span className="unit">Giron : {flight.going.toFixed(3)} m</span>
          </Row>)}
          {g.flightLengths && <Row label="Longueurs"><button className="btn ghost" onClick={()=>upd('geom.flightLengths',undefined)}>Recalculer avec le giron</button></Row>}
          {g.landing && g.form!=='spiral' && landings.map((palier,i)=><div key={'landing'+i} style={{display:'contents'}}>
            <Row label={`Palier ${i+1} — profondeur`}><Num value={palier.length} min={g.width} onChange={v=>upd('geom.landings',landings.map((p,k)=>k===i?{...p,length:v}:p))}/></Row>
            <Row label={`Palier ${i+1} — largeur`}><Num value={palier.width} min={g.form==='half'?2*g.width:g.width} onChange={v=>upd('geom.landings',landings.map((p,k)=>k===i?{...p,width:v}:p))}/></Row>
          </div>)}
          {(g.form==='spiral'||(!g.landing&&g.form!=='straight')) && <Row label="Diamètre extérieur">
            <Num value={2*(g.width+(g.form==='spiral'?g.radius:g.turnRadius??(g.form==='half'?.05:0)))} min={2*g.width} onChange={v=>upd(g.form==='spiral'?'geom.radius':'geom.turnRadius',Math.max(0,v/2-g.width))}/>
          </Row>}
          <Row label="Sens"><select value={g.turn} onChange={e=>upd('geom.turn',Number(e.target.value))}><option value={1}>{makeT(lang)("Left")}</option><option value={-1}>{makeT(lang)("Right")}</option></select></Row>
          {[['landing','Palier'],['railLeft','Garde-corps gauche'],['railRight','Garde-corps droit']].map(([k,l])=><Row key={k} label={l}><input type="checkbox" checked={g[k]} onChange={e=>updateItem(it.id,{geom:{...g,[k]:e.target.checked,...(k==='landing'&&e.target.checked&&g.flightLengths?.[0]===0?{flightLengths:g.flightLengths.map((v,i)=>i===0?g.going:v)}:{}),_edited:true}} as any)}/></Row>)}
          <Row label="Garde-corps"><select value={g.railStyle} onChange={e=>upd('geom.railStyle',e.target.value)}><option value="bars">{makeT(lang)("Balusters")}</option><option value="solid">{makeT(lang)("Solid panels")}</option></select></Row>
          <StairOpeningEditor ownerId={it.id} key={it.id} g={g} parentId={it.parentId} items={items} onChange={o=>upd('geom.opening',o)}/>
          {model.warnings.map(w=><p key={w} role="alert">{w}</p>)}
        </Section>;})()}
        {/* ── ROOF ──────────────────────────────────────────────────────────── */}
        {it.type === 'Roof' && g && (() => {
          const tr = makeT(lang);
          const labels: Record<RoofType, string> = { flat: tr('Flat'), shed: tr('Shed'), gable: tr('Gable'), hip: tr('Hip'), custom: tr('Custom') };
          const edges = roofEdges(g);
          // Editing one edge freezes the current preset into per-edge settings
          const setEdge = (i: number, patch: { gable?: boolean; pitch?: number }) => updateItem(it.id, (prev: any) => ({
            ...prev,
            PredefinedType: 'FREEFORM',
            geom: { ...prev.geom, roofType: 'custom', edges: roofEdges(prev.geom).map((e, k) => (k === i ? { ...e, ...patch } : e)), _edited: true, _shapeEdited: true },
          }));
          const solid = buildRoof(g);
          const setType = (v: RoofType) => updateItem(it.id, (prev: any) => ({
            ...prev,
            PredefinedType: roofPredefinedType(v),
            geom: { ...prev.geom, roofType: v, edges: v === 'custom' ? roofEdges(prev.geom) : undefined, _edited: true, _shapeEdited: true },
          }));
          return (
            <Section title={t('geometry')} badge={formatArea(polyArea(g.polygon))}>
              <Row label={lang === 'fr' ? 'Murs sous toiture' : 'Walls below roof'}>
                <button className="btn ghost" onClick={() => {
                  for (const wall of Object.values(items)) {
                    if (wall.type !== 'Wall' || wall.parentId !== it.parentId) continue;
                    const roofIds = Object.values(items).filter(r => r.type === 'Roof' && r.parentId === it.parentId).map(r => r.id);
                    const attached = { ...wall, geom: { ...wall.geom, roofId: it.id, roofIds } };
                    if (wallRoofProfile(attached, items)) updateItem(wall.id, attached);
                  }
                }}>{lang === 'fr' ? 'Raccorder les murs au toit' : 'Attach walls to roof'}</button>
                <button className="btn ghost" onClick={() => {
                  for (const wall of Object.values(items)) {
                    if (wall.type === 'Wall' && wall.geom.roofId === it.id) updateItem(wall.id, { geom: { ...wall.geom, roofId: undefined, roofIds: undefined } });
                  }
                }}>{lang === 'fr' ? 'Détacher' : 'Detach'}</button>
              </Row>
              <div style={{ gridColumn: '1 / -1', fontSize: 10.5, color: 'var(--ink-3)', margin: '4px 0' }}>
                {lang === 'fr'
                  ? 'Raccorde les murs couverts par les toits de cet étage, si leurs ouvertures restent en dessous. Les murs-rideaux sont exclus.'
                  : 'Attaches walls fully covered by the roof when openings remain below it. Curtain walls are excluded.'}
              </div>
              <Row label={lang === 'fr' ? 'Murs raccordés' : 'Attached walls'}>
                <ReadOnly value={Object.values(items).filter(w => w.type === 'Wall' && w.geom.roofId === it.id && wallRoofProfile(w, items)).length} />
              </Row>
              <Row label={tr('Roof type')}>
                <select value={g.roofType ?? 'gable'} onChange={(e) => setType(e.target.value as RoofType)}
            >
                  {ROOF_TYPES.map((rt) => <option key={rt} value={rt}>{labels[rt]}</option>)}
                </select>
              </Row>
              {g.roofType !== 'flat' && (
                <Row label={tr('Pitch (°)')}><Num value={g.pitch ?? 30} unit="°" step={1} min={0} onChange={(v) => upd('geom.pitch', Math.max(0, Math.min(75, v)))} /></Row>
              )}
              <Row label={tr('Eave height')}><Num value={g.elevation ?? 2.7} onChange={(v) => upd('geom.elevation', v)} /></Row>
              <Row label={tr('Overhang')}><Num value={g.overhang ?? 0} min={0} onChange={(v) => upd('geom.overhang', Math.max(0, v))} /></Row>
              <Row label={t('thickness')}><Num value={g.thickness ?? 0.25} step={0.01} min={0.01} onChange={(v) => upd('geom.thickness', Math.max(0.01, v))} /></Row>
              {(g.roofType === 'gable' || g.roofType === 'shed') && (
                <Row label={tr('Rotate ridge')}>
                  <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => upd('geom.ridgeSwap', !g.ridgeSwap)}>↻ 90°</button>
                </Row>
              )}
              {solid && <Row label={tr('Ridge height')}><ReadOnly value={((g.elevation ?? 2.7) + solid.ridgeHeight).toFixed(2)} unit="m" /></Row>}
              {solid?.approximate && (
                <div style={{ gridColumn: '1 / -1', fontSize: 10.5, color: 'var(--danger, #c0392b)', margin: '4px 0' }}>{tr('This combination of edges cannot be built: shown as a flat roof.')}</div>
              )}
              <Row label={tr("Vertices")}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                  <ReadOnly value={g.polygon.length} />
                  <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>{tr("(dbl-click edge = +)")}</span>
                </div>
              </Row>
              {g.polygon.flatMap((p: [number, number], i: number) => [
                <Row key={`x${i}`} label={`X${i + 1}`}><Num value={p[0]} onChange={(v) => { const polygon = [...g.polygon]; polygon[i] = [v, p[1]]; upd('geom.polygon', polygon); }} /></Row>,
                <Row key={`y${i}`} label={`Y${i + 1}`}><Num value={p[1]} onChange={(v) => { const polygon = [...g.polygon]; polygon[i] = [p[0], v]; upd('geom.polygon', polygon); }} /></Row>,
              ])}
              {g.roofType !== 'flat' && (
                <div style={{ gridColumn: '1 / -1', marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{tr('Roof edges')}</div>
                  {edges.map((e, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--panel-2)', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--border)' }}>
                      <span className="unit" style={{ width: 16, textAlign: 'left' }}>{i + 1}</span>
                      <select value={e.gable ? 'gable' : 'eave'} onChange={(ev) => setEdge(i, { gable: ev.target.value === 'gable' })}
                        style={{ flex: 1, minWidth: 0, fontSize: 11.5, background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--border)', borderRadius: 3, padding: '2px 4px' }}>
                        <option value="eave">{tr('Eave edge')}</option>
                        <option value="gable">{tr('Gable edge')}</option>
                      </select>
                      {!e.gable && <div style={{ width: 70 }}><Num value={Math.round(e.pitch * 10) / 10} unit="°" step={1} min={1} onChange={(v) => setEdge(i, { pitch: Math.max(1, Math.min(80, v)) })} /></div>}
                    </div>
                  ))}
                </div>
              )}
            </Section>
          );
        })()}

        {/* ── GENERIC ELEMENT ───────────────────────────────────────────────── */}
        {it.type === 'GenericElement' && g && (
          <Section title={t('geometry')} badge={formatDims([g.w, g.d, g.h])}>
            <Row label={makeT(lang)("IFC Type")}>
              <ReadOnly value={(it as any).ifcType || 'Unknown'} />
            </Row>
            <Row label={makeT(lang)("Position (x, y)")}>
              <div className="pair">
                <div><Num value={g.x} onChange={(v) => upd('geom.x', v)} /></div>
                <div><Num value={g.y} onChange={(v) => upd('geom.y', v)} /></div>
              </div>
            </Row>
            <Row label={makeT(lang)("W × D")}>
              <div className="pair">
                <div><Num value={g.w} onChange={(v) => upd('geom.w', v)} /></div>
                <div><Num value={g.d} onChange={(v) => upd('geom.d', v)} /></div>
              </div>
            </Row>
            <Row label={t('height')}><Num value={g.h} onChange={(v) => upd('geom.h', v)} /></Row>
          </Section>
        )}

        {/* ── DIMENSION ─────────────────────────────────────────────────────── */}
        {it.type === 'Dimension' && g && (() => {
          const currentLength = Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
          const handleLengthChange = (newLen: number) => {
            if (newLen <= 0 || currentLength === 0) return;
            const dx = (g.x2 - g.x1) / currentLength;
            const dy = (g.y2 - g.y1) / currentLength;
            const itemCopy = JSON.parse(JSON.stringify(it));
            itemCopy.geom.x2 = g.x1 + dx * newLen;
            itemCopy.geom.y2 = g.y1 + dy * newLen;
            itemCopy.geom._edited = true;
            updateItem(it.id, itemCopy);
          };
          return (
            <Section title={t('geometry')}>
              <Row label={makeT(lang)("Point A (x, y)")}>
                <div className="pair">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Num value={g.x1} onChange={(v) => upd('geom.x1', v)} /></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Num value={g.y1} onChange={(v) => upd('geom.y1', v)} /></div>
                </div>
              </Row>
              <Row label={makeT(lang)("Point B (x, y)")}>
                <div className="pair">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Num value={g.x2} onChange={(v) => upd('geom.x2', v)} /></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Num value={g.y2} onChange={(v) => upd('geom.y2', v)} /></div>
                </div>
              </Row>
              <Row label={makeT(lang)("Physical length")}>
                <Num value={currentLength} onChange={handleLengthChange} unit="m" step={0.05} min={0.01} />
              </Row>
              <Row label={makeT(lang)("Displayed value (override)")}>
                <CoteLabelInput override={g.valueOverride} measured={g.value !== undefined ? formatLength(g.value, '').trim() : undefined}
                  placeholder={makeT(lang)("e.g. 4.50 m, Clear...")} onChange={(v) => upd('geom.valueOverride', v)} />
              </Row>
            </Section>
          );
        })()}

        {/* ── STOREY ────────────────────────────────────────────────────────── */}
        {it.type === 'Storey' && g && (
          <StoreyTabs lang={lang} survey={
            <SurveyTab inbox={surveyInbox} survey={(it as IfcStoreyEntity).survey} lang={lang} onChange={(v) => upd('survey', v)}
              onReconstruct={replaceItems ? (resolutions) => {
                const r = reconstructStorey(items, it.id, Date.now(), resolutions);
                if (!r.conflicts.length) replaceItems(r.items);
                return { created: r.created.length, updated: r.updated.length, deleted: r.deleted.length, kept: r.kept.length, conflicts: r.conflicts };
              } : undefined}
              association={replaceItems && it.parentId ? {
                storeys: Object.values(items).filter(s => s.type === 'Storey' && s.parentId === it.parentId).map(s => ({ id: s.id, name: s.name })),
                propose: (survey) => proposeAssociation(items, survey, it.id),
                apply: (survey, association, photos) => replaceItems(applyAssociation(items, survey, it.parentId!, association, Date.now(), photos).items),
              } : undefined} />
          }>
            <Section title={t('geometry')}>
              <Row label={t('level')}>
                <input className="mono" type="number" value={g.level}
                  onChange={(e) => upd('geom.level', parseInt(e.target.value) || 0)} />
              </Row>
              <Row label={t('elevation')}><Num value={g.elevation} onChange={(v) => upd('geom.elevation', v)} /></Row>
              <Row label={t('thickness')}><Num value={g.thickness} onChange={(v) => upd('geom.thickness', v)} step={0.01} /></Row>
              <Row label={t('area')}><ReadOnly value={formatArea((it as IfcStoreyEntity).grossArea || 0)} /></Row>
            </Section>

            {replaceItems && (
              <Section title={makeT(lang)("Move storey")}>
                <StoreyMoveEditor key={it.id} storeyId={it.id} items={items} replaceItems={replaceItems} lang={lang} />
              </Section>
            )}

            <Section title={makeT(lang)("Background Plan")}>
              <Row2 label={g.plan?.kind === 'vector' ? 'DXF' : makeT(lang)("Image")}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <PlanImageUpload key={it.id} hasPlan={!!g.plan} lang={lang} vectorOrigins={vectorOriginSources(items, it.id)} onApply={image => {
                    upd('geom.plan', { opacity: 0.5, scale: 0.05, x: 0, y: 0, rotation: 0, ...image });
                  }} />
                  {g.plan && (
                    <button className="btn icon" onClick={() => upd('geom.plan', undefined)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>
              </Row2>
              {g.plan && (
                <>
                  <Row label={makeT(lang)("Opacity")}>
                    <input type="range" min="0" max="1" step="0.05" value={g.plan.opacity} onChange={(e) => upd('geom.plan.opacity', parseFloat(e.target.value))} />
                  </Row>
                  <Row label={makeT(lang)("Scale")}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <Num value={g.plan.scale} onChange={(v) => upd('geom.plan.scale', v)} step={0.0001} unit="" />
                      <button 
                        className={`btn ghost ${tool === 'calibrate' ? 'on' : ''}`}
                        title={makeT(lang)("Calibrate")}
                        onClick={() => setTool(tool === 'calibrate' ? 'select' : 'calibrate')}
                        style={{ padding: '0 8px', height: 26, fontSize: 11, background: tool === 'calibrate' ? 'var(--ink)' : 'transparent', color: tool === 'calibrate' ? 'var(--bg)' : 'inherit' }}
                      >
                        📏
                      </button>
                    </div>
                  </Row>
                  <div className="pair">
                    <Row label="X"><Num value={g.plan.x} onChange={(v) => upd('geom.plan.x', v)} unit="m" /></Row>
                    <Row label="Y"><Num value={g.plan.y} onChange={(v) => upd('geom.plan.y', v)} unit="m" /></Row>
                  </div>
                  <button className={`btn ghost ${tool === 'alignPlan' ? 'on' : ''}`} style={{ width: '100%', fontSize: 11 }}
                    disabled={!defaultAlignmentReference(items, it.id)}
                    onClick={() => setTool(tool === 'alignPlan' ? 'select' : 'alignPlan')}>
                    {makeT(lang)("Align on the reference storey")}
                  </button>
                  {g.plan.kind === 'vector' && g.plan.vector && (
                    <VectorPlanSettings plan={g.plan as any} lang={lang}
                      onChange={patch => upd('geom.plan', { ...g.plan, ...patch })} />
                  )}
                </>
              )}
            </Section>
          </StoreyTabs>
        )}



        <Section title={t('metadata')}>
          <DescriptionRow
            label={makeT(lang)("Description")}
            value={it.description || ''}
            onChange={(v) => { updateItem(it.id, { description: v }); }}
          />
          {it.type === 'Wall' && (<>
            <Row label={t('material')}>
              <Select t={makeT(lang)} options={WALL_MATERIALS} value={(it as any).material || WALL_MATERIALS[0][0]} onChange={(v) => upd('material', v)} />
            </Row>
            <Row label={t('fire_rating')}>
              <Select options={FIRE_RATINGS} value={(it as any).fireRating || '—'} onChange={(v) => upd('fireRating', v === '—' ? '' : v)} />
            </Row>
            <Row2 label={makeT(lang)("Load-bearing")}>
              <Toggle value={(it as any).loadBearing} onChange={(v) => upd('loadBearing', v)}
                labelOn={makeT(lang)("Yes")} labelOff={makeT(lang)("No")} />
            </Row2>
            <Row2 label={makeT(lang)("External")}>
              <Toggle value={(it as any).isExternal} onChange={(v) => upd('isExternal', v)}
                labelOn={makeT(lang)("Yes")} labelOff={makeT(lang)("No")} />
            </Row2>
            <Row label={makeT(lang)("U-value")}>
              <Num value={(it as any).ThermalTransmittance ?? 0.24} onChange={(v) => upd('ThermalTransmittance', v)} unit="W/m²K" step={0.01} />
            </Row>
          </>)}

          {(it.type === 'Door' || it.type === 'Window') && (<>
            <Row label={t('material')}><input value={(it as any).material || ''} onChange={(e) => upd('material', e.target.value)} /></Row>
            {it.type === 'Door' && (<>
              <Row2 label={makeT(lang)("Operation")}>
                <select value={(it as IfcDoorEntity).OperationType?.includes('SINGLE_SWING') ? 'SINGLE_SWING_LEFT' : (it as IfcDoorEntity).OperationType}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'SINGLE_SWING_LEFT') {
                      const swing = (it as any).geom.swing || 'left';
                      upd('OperationType', swing === 'right' ? 'SINGLE_SWING_RIGHT' : 'SINGLE_SWING_LEFT');
                    } else {
                      upd('OperationType', val);
                    }
                  }}
            >
                  {DOOR_OP_TYPES.map(([v, l]) => <option key={v} value={v}>{makeT(lang)(l)}</option>)}
                </select>
              </Row2>
              <Row label={t('fire_rating')}>
                <Select options={FIRE_RATINGS} value={(it as any).fireRating || '—'} onChange={(v) => upd('fireRating', v === '—' ? '' : v)} />
              </Row>
            </>)}
            {it.type === 'Window' && (<>
              <Row2 label={makeT(lang)("Operation")}>
                <select value={(() => {
                  const op = (it as any).OperationType || 'SINGLE_PANEL';
                  if (op === 'FIXED') return 'FIXEDCASEMENT';
                  if (op === 'DOUBLE_PANEL') return 'DOUBLE_PANEL_VERTICAL';
                  if (op === 'SLIDING') return 'SLIDINGHORIZONTAL';
                  if (op === 'TILT_AND_TURN') return 'TILTANDTURNLEFT';
                  return op;
                })()}
                  onChange={(e) => upd('OperationType', e.target.value)}
            >
                  {WINDOW_OP_TYPES.map(([v, l]) => <option key={v} value={v}>{makeT(lang)(l)}</option>)}
                </select>
              </Row2>
              <Row label={makeT(lang)("U-value")}>
                <Num value={(it as any).uValue ?? 1.4} onChange={(v) => upd('uValue', v)} unit="W/m²K" step={0.1} />
              </Row>
            </>)}
          </>)}

          {it.type === 'Room' && (<>
            <Row2 label={makeT(lang)("Function")}>
              <select value={(it as any).function || ROOM_FUNCTIONS[0][0]}
                onChange={(e) => upd('function', e.target.value)}
          >
                {ROOM_FUNCTIONS.map(([value, label]) => <option key={value} value={value}>{makeT(lang)(label)}</option>)}
                {!ROOM_FUNCTIONS.some(([value]) => value === (it as any).function) && (it as any).function && (
                  <option value={(it as any).function}>{(it as any).function}</option>
                )}
              </select>
            </Row2>
            <Row label={makeT(lang)("Occupancy")}>
              <input className="mono" type="number" min={0} value={(it as any).occupancy}
                onChange={(e) => upd('occupancy', parseInt(e.target.value) || 0)} />
              <span className="unit">{makeT(lang)("ppl")}</span>
            </Row>
          </>)}

          {it.type === 'Furniture' && (<>
            <Row label={makeT(lang)("Category")}><input value={(it as any).category || ''} onChange={(e) => upd('category', e.target.value)} /></Row>
            <Row label={makeT(lang)("Model")}><input value={(it as any).model || ''} onChange={(e) => upd('model', e.target.value)} /></Row>
          </>)}

          {it.type === 'Technical' && (<>
            <Row label={makeT(lang)("Category")}><input value={(it as any).category || ''} onChange={(e) => upd('category', e.target.value)} /></Row>
            <Row label={makeT(lang)("Model")}><input value={(it as any).model || ''} onChange={(e) => upd('model', e.target.value)} /></Row>
          </>)}

          {it.type === 'Building' && (() => {
            // Geographic data lives on the Project entity (→ IfcSite in IFC).
            // We find it here and edit it directly so the Building panel is the
            // natural place to set site coordinates for a blank project.
            const proj = Object.values(items).find((e) => e.type === 'Project') as import('@skaitch/core/types/ifc').IfcProjectEntity | undefined;
            const updProj = (key: string, val: unknown) => {
              if (proj) updateItem(proj.id, { [key]: val } as any);
            };
            return (<>
              <Row2 label={makeT(lang)("Address")}><input value={(it as any).address || ''} onChange={(e) => upd('address', e.target.value)} /></Row2>
              <Row label={t('area')}><ReadOnly value={formatArea((it as any).grossArea || 0)} /></Row>
              <Row label={makeT(lang)("Latitude")}>
                <input className="mono" type="number" step="0.000001" value={proj?.lat ?? ''} placeholder="ex: 48.8566" onChange={(e) => updProj('lat', e.target.value === '' ? undefined : parseFloat(e.target.value))} />
                <span className="unit">°N</span>
              </Row>
              <Row label={makeT(lang)("Longitude")}>
                <input className="mono" type="number" step="0.000001" value={proj?.lon ?? ''} placeholder="ex: 2.3522" onChange={(e) => updProj('lon', e.target.value === '' ? undefined : parseFloat(e.target.value))} />
                <span className="unit">°E</span>
              </Row>
              <Row label={makeT(lang)("Elevation (m)")}>
                <input className="mono" type="number" step="0.1" value={proj?.siteElevation ?? ''} placeholder="ex: 35.5" onChange={(e) => updProj('siteElevation', e.target.value === '' ? undefined : parseFloat(e.target.value))} />
                <span className="unit">m</span>
              </Row>
              <Row2 label={makeT(lang)("Site address")}><input value={proj?.siteAddress || ''} placeholder="ex: 1 rue de la Paix, Paris" onChange={(e) => updProj('siteAddress', e.target.value)} /></Row2>
              <Row label={makeT(lang)("North (°)")}>
                <input className="mono" type="number" value={proj?.northAngle ?? 0} onChange={(e) => updProj('northAngle', parseFloat(e.target.value) || 0)} />
                <span className="unit">°</span>
              </Row>
            </>);
          })()}

          {it.type === 'Project' && (<>
            <Row2 label={makeT(lang)("Long name")}><input value={(it as any).longName || ''} onChange={(e) => upd('longName', e.target.value)} /></Row2>
            <Row label={makeT(lang)("Phase")}><input value={(it as any).phase || ''} onChange={(e) => upd('phase', e.target.value)} /></Row>
          </>)}
        </Section>

        {/* ── PSETS ─────────────────────────────────────────────────────────── */}
        <details className="section advanced-properties">
          <summary className="section-head">
            <h4>{t('psets')}</h4>
            <span className="badge">
              {it.type === 'Wall' ? 'Pset_WallCommon' : it.type === 'Room' ? 'Pset_SpaceCommon'
               : it.type === 'Door' ? 'Pset_DoorCommon' : it.type === 'Window' ? 'Pset_WindowCommon' : 'Pset_Common'}
            </span>
          </summary>
          <div className="psets">
            <div className="pset">
              {it.type === 'Wall' && (<>
                <PRow k="Reference"           v={(it as any).material} />
                <PRow k="FireRating"          v={(it as any).fireRating || '—'} />
                <PRow k="LoadBearing"         v={(it as any).loadBearing} />
                <PRow k="IsExternal"          v={(it as any).isExternal} />
                <PRow k="ThermalTransmittance" v={`${((it as any).ThermalTransmittance ?? 0.24).toFixed(2)} W/m²K`} />
              </>)}
              {it.type === 'Room' && (() => {
                const area = polyArea(g.polygon);
                return (<>
                  <PRow k="Category"       v={(it as any).function} />
                  <PRow k="GrossFloorArea" v={`${area.toFixed(2)} m²`} />
                  <PRow k="NetVolume"      v={`${(area * g.height).toFixed(2)} m³`} />
                  <PRow k="OccupancyNumber" v={(it as any).occupancy} />
                </>);
              })()}
              {it.type === 'Door' && (<>
                <PRow k="OperationType" v={(it as IfcDoorEntity).OperationType} />
                <PRow k="FireRating"    v={(it as any).fireRating || '—'} />
                <PRow k="SelfClosing"   v={false} />
              </>)}
              {it.type === 'Window' && (<>
                <PRow k="OperationType"        v={(it as any).OperationType || 'SINGLE_PANEL'} />
                <PRow k="ThermalTransmittance" v={`${(it as any).uValue ?? 1.4} W/m²K`} />
                <PRow k="GlazingAreaFraction"  v="0.78" />
              </>)}
              {it.type === 'Furniture' && (<>
                <PRow k="Category"  v={(it as any).category} />
                <PRow k="Reference" v={(it as any).model} />
              </>)}
              {it.type === 'Column' && (<>
                <PRow k="Reference" v={it.geom.shape === 'circle' ? `Ø${Math.round(it.geom.w * 1000)}` : `${Math.round(it.geom.w * 1000)}x${Math.round(it.geom.d * 1000)}`} />
                <PRow k="LoadBearing" v="TRUE" />
              </>)}
              {it.type === 'Chimney' && <PRow k="Reference" v={({ fireplace: 'Fireplace', stove: 'Stove', flue: 'Flue' } as const)[it.kind]} />}
              {it.type === 'Technical' && (<>
                <PRow k="Category"  v={(it as any).category} />
                <PRow k="Reference" v={(it as any).model} />
                <PRow k="Discipline" v={(it as any).discipline} />
                <PRow k="MountingHeight" v={`${(it as any).geom?.mountHeight ?? 0.3} m`} />
              </>)}
              {it.type === 'Storey' && (() => {
                const sg = (it as any).geom;
                return (<>
                  <PRow k="AboveGround" v={sg.level >= 0} />
                  <PRow k="Elevation"   v={`${sg.elevation.toFixed(2)} m`} />
                </>);
              })()}
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}

function StoreyMoveEditor({ storeyId, items, replaceItems, lang }: { storeyId: string; items: ItemsMap; replaceItems: (next: ItemsMap) => void; lang: string }) {
  const tr = makeT(lang);
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const storeys = Object.values(items).filter(i => i.type === 'Storey' && i.id !== storeyId);
  const [referenceId, setReferenceId] = useState(() => defaultAlignmentReference(items, storeyId) ?? storeys[0]?.id ?? '');
  const [anchor, setAnchor] = useState<AlignmentAnchor>('corner');
  const align = () => {
    try {
      const [ax, ay] = storeyAlignmentOffset(items, storeyId, referenceId, anchor);
      setDx(ax); setDy(ay);
      setMessage(ax || ay ? null : { error: false, text: tr('Already aligned.') });
    } catch (e) {
      setMessage({ error: true, text: (e as Error).message });
    }
  };
  const apply = () => {
    try {
      const result = translateStorey(items, storeyId, dx, dy);
      if (result.items !== items) replaceItems(result.items);
      setMessage(result.warnings.length ? { error: false, text: result.warnings.join('\n') } : null);
      setDx(0); setDy(0);
    } catch (e) {
      setMessage({ error: true, text: (e as Error).message });
    }
  };
  return (
    <>
      {storeys.length > 0 && (
        <>
          <Row label={tr('Align on')}>
            <select value={referenceId} onChange={e => setReferenceId(e.target.value)}>
              {storeys.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Row>
          <Row label={tr('Reference')}>
            <select value={anchor} onChange={e => setAnchor(e.target.value as AlignmentAnchor)}>
              <option value="corner">{tr('Lower-left corner')}</option>
              <option value="center">{tr('Centre')}</option>
            </select>
          </Row>
          <Row2 label="">
            <button className="btn ghost" disabled={!referenceId} onClick={align} title={tr('Computes ΔX/ΔY from the wall axes of both storeys.')}>{tr('Compute alignment')}</button>
          </Row2>
        </>
      )}
      <div className="pair">
        <Row label="ΔX"><Num value={dx} onChange={setDx} unit="m" step={0.005} /></Row>
        <Row label="ΔY"><Num value={dy} onChange={setDy} unit="m" step={0.005} /></Row>
      </div>
      <Row2 label="">
        <button className="btn" disabled={!dx && !dy} onClick={apply} title={tr("Moves every element of this storey, its background plan and the trémies cut in its slabs.")}>
          {tr("Apply move")}
        </button>
      </Row2>
      {message && <div role={message.error ? 'alert' : 'status'} style={{ whiteSpace: 'pre-line', fontSize: 11, color: message.error ? 'var(--danger, #c0392b)' : 'var(--ink-3)', padding: '4px 0' }}>{message.text}</div>}
    </>
  );
}
