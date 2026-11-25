import { useEffect, useMemo, useRef, useState } from 'react';
import { makeT } from '@skaitch/core/data/i18n';
import type { ItemsMap, TweakValues } from '@skaitch/core/types/ifc';
import { storeyDescendants } from '../../lib/translateStorey';

interface Props {
  items: ItemsMap;
  currentStorey: string;
  selection: string[];
  setSelection: (ids: string[]) => void;
  hiddenTypes: Set<string>;
  onToggleHiddenType: (type: string) => void;
  t: (k: string) => string;
  lang: string;
  tweaks: TweakValues;
  setTweak: <K extends keyof TweakValues>(key: K, value: TweakValues[K]) => void;
}

export const TOOLBAR_TYPES = ['Stair', 'Slab', 'Roof', 'Ceiling', 'Wall', 'Dimension', 'Marker', 'Room', 'Door', 'Window', 'Technical', 'Furniture', 'GenericElement', 'Column', 'Chimney'] as const;
export type ToolbarType = typeof TOOLBAR_TYPES[number];

/** Families shown in the bar; each type belongs to exactly one. */
export const TYPE_FAMILIES: { id: string; label: string; types: ToolbarType[] }[] = [
  { id: 'structure', label: 'Structure', types: ['Wall', 'Column', 'Chimney', 'Slab', 'Roof', 'Ceiling', 'Stair'] },
  { id: 'openings', label: 'Openings', types: ['Door', 'Window'] },
  { id: 'fitout', label: 'Fit-out', types: ['Room', 'Furniture', 'Technical', 'GenericElement'] },
  { id: 'annotations', label: 'Annotations', types: ['Dimension', 'Marker'] },
];

function isCeilingLikeElement(it: any): boolean {
  const label = `${it?.id ?? ''} ${it?.name ?? ''} ${it?.Name ?? ''} ${it?.ifcType ?? ''} ${it?.category ?? ''}`;
  return /compound ceiling|ceiling|plafond|ifccovering/i.test(label);
}

export function toolbarTypeForItem(it: any): ToolbarType | null {
  if (it?.type === 'GenericElement' && isCeilingLikeElement(it)) return 'Ceiling';
  return TOOLBAR_TYPES.includes(it?.type as ToolbarType) ? it.type as ToolbarType : null;
}

function toolbarLabel(typ: ToolbarType, lang: string, t: (k: string) => string): string {
  if (typ === 'Ceiling') return makeT(lang)("Ceilings");
  if (typ === 'GenericElement') return makeT(lang)("Generic IFC");
  if (typ === 'Dimension') return makeT(lang)("Dimensions");
  if (typ === 'Marker') return makeT(lang)("Markers");
  return t(typ.toLowerCase()) || typ;
}

export interface FamilyState {
  id: string;
  label: string;
  /** Types worth showing: present on the storey, or hidden by the user (so they can be shown again). */
  types: { type: ToolbarType; count: number; hidden: boolean }[];
  count: number;
  /** Every listed type is hidden. */
  hidden: boolean;
  /** Some, not all, listed types are hidden. */
  partial: boolean;
}

/** Families for the current storey, without empty types or families. */
export function itemsBarFamilies(items: ItemsMap, storeyId: string, hiddenTypes: Set<string>): FamilyState[] {
  const onStorey = storeyDescendants(items, storeyId);
  const counts = new Map<ToolbarType, number>();
  for (const id of onStorey) {
    const typ = toolbarTypeForItem(items[id]);
    if (typ) counts.set(typ, (counts.get(typ) ?? 0) + 1);
  }
  return TYPE_FAMILIES.map(f => {
    const types = f.types
      .map(type => ({ type, count: counts.get(type) ?? 0, hidden: hiddenTypes.has(type) }))
      .filter(x => x.count > 0 || x.hidden);
    const hiddenCount = types.filter(x => x.hidden).length;
    return {
      id: f.id, label: f.label, types,
      count: types.reduce((n, x) => n + x.count, 0),
      hidden: types.length > 0 && hiddenCount === types.length,
      partial: hiddenCount > 0 && hiddenCount < types.length,
    };
  }).filter(f => f.types.length > 0);
}

const Icon = ({ d }: { d: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

export default function ItemsBar({
  items,
  currentStorey,
  selection,
  hiddenTypes,
  onToggleHiddenType,
  t,
  lang,
  tweaks,
  setTweak
}: Props) {
  const tr = makeT(lang);
  const families = useMemo(() => itemsBarFamilies(items, currentStorey, hiddenTypes), [items, currentStorey, hiddenTypes]);
  const [open, setOpen] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const anyHidden = TOOLBAR_TYPES.some(type => hiddenTypes.has(type));

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!barRef.current?.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  /** Hides every listed type of the family, or shows them all when they are all hidden. */
  const toggleFamily = (f: FamilyState) => {
    const show = f.hidden;
    for (const { type, hidden } of f.types) if (hidden === show) onToggleHiddenType(type);
  };

  return (
    <div className="items-bar" ref={barRef}>
      <div className="label">{t('items_by_type')}</div>
      <div className="scroll">
        {anyHidden && (
          <button className="type-chip" onClick={() => TOOLBAR_TYPES.forEach(type => { if (hiddenTypes.has(type)) onToggleHiddenType(type); })}>
            {tr('Show all')}
          </button>
        )}
        {families.length === 0 && <span className="empty">{tr('No element on this storey')}</span>}
        {families.map(f => (
          <div key={f.id} className="family-chip">
            <button
              className={`type-chip type-${f.types[0].type}${f.hidden ? ' hidden' : ''}${f.partial ? ' partial' : ''}`}
              aria-pressed={!f.hidden}
              title={f.types.map(x => `${toolbarLabel(x.type, lang, t)} ${x.count}`).join(' · ')}
              onClick={() => toggleFamily(f)}
            >
              <span className="swatch" />
              <span className="name">{tr(f.label)}</span>
              <span className="count">{f.count}</span>
            </button>
            {f.types.length > 1 && (
              <button className={`family-caret${open === f.id ? ' on' : ''}`} aria-haspopup="true" aria-expanded={open === f.id}
                aria-label={tr('Types')} onClick={e => {
                  const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                  setAnchor({ left: r.left, bottom: window.innerHeight - r.top + 6 });
                  setOpen(open === f.id ? null : f.id);
                }}>
                <Icon d="M6 15l6-6 6 6" />
              </button>
            )}
            {open === f.id && anchor && (
              <div className="family-menu" role="menu" style={{ left: anchor.left, bottom: anchor.bottom }}>
                {f.types.map(x => (
                  <label key={x.type} className={`family-type type-${x.type}`} role="menuitemcheckbox" aria-checked={!x.hidden}>
                    <input type="checkbox" checked={!x.hidden} onChange={() => onToggleHiddenType(x.type)} />
                    <span className="swatch" />
                    <span className="name">{toolbarLabel(x.type, lang, t)}</span>
                    <span className="count">{x.count}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="right">
        <button className={`bar-icon${tweaks.showBgImage ? ' on' : ''}`} aria-pressed={tweaks.showBgImage}
          title={tweaks.showBgImage ? tr('Hide background image') : tr('Show background image')}
          onClick={() => setTweak('showBgImage', !tweaks.showBgImage)}>
          <Icon d="M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6" />
        </button>
        <button className={`bar-icon${tweaks.showLabels ? ' on' : ''}`} aria-pressed={tweaks.showLabels}
          title={tweaks.showLabels ? tr('Hide text labels') : tr('Show text labels')}
          onClick={() => setTweak('showLabels', !tweaks.showLabels)}>
          <Icon d="M4 7V5h16v2M12 5v14M9 19h6" />
        </button>
        <span>{Object.keys(items).length} {t('items')}</span>
        {selection.length > 0 && (
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
            · {selection.length} {t('selected')}
          </span>
        )}
      </div>
    </div>
  );
}
