import { useState } from 'react';
import type { VectorPlanData } from '@skaitch/core/cad/vectorPlan';
import { rasterizeVectorPlan } from '../../lib/vectorPlanRaster';

interface Plan { w: number; h: number; vector: VectorPlanData; snap?: boolean }

/**
 * Layers, monochrome and snapping of a vector background plan. Changing what is drawn also
 * refreshes the raster preview, which the 3D view, the chat and get_storey_floorplan read.
 */
export default function VectorPlanSettings({ plan, lang, onChange }: {
  plan: Plan;
  lang: string;
  onChange: (patch: Partial<Plan> & { url?: string }) => void;
}) {
  const tr = (fr: string, en: string) => lang === 'fr' ? fr : en;
  const [filter, setFilter] = useState('');
  const data = plan.vector;
  const redraw = (vector: VectorPlanData) => {
    let url: string | undefined;
    try { url = rasterizeVectorPlan(vector, plan.w, plan.h); } catch { url = undefined; }
    onChange(url ? { vector, url } : { vector });
  };
  const setLayers = (visible: (i: number) => boolean) =>
    redraw({ ...data, layers: data.layers.map((l, i) => ({ ...l, visible: visible(i) })) });
  const shown = data.layers.map((l, i) => ({ l, i })).filter(({ l }) => l.name.toLowerCase().includes(filter.toLowerCase()));
  const visibleCount = data.layers.filter(l => l.visible).length;

  return <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
    <div style={{ color: 'var(--ink-3)' }}>
      {tr('Unité', 'Unit')} : {data.unit} · {tr('décalage d’origine', 'origin offset')} : {data.origin.map(v => v.toLocaleString(lang, { maximumFractionDigits: 3 })).join(' ; ')} m
    </div>
    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="checkbox" checked={!!data.monochrome} onChange={e => redraw({ ...data, monochrome: e.target.checked })} />
      {tr('Monochrome', 'Monochrome')}
    </label>
    <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="checkbox" checked={plan.snap !== false} onChange={e => onChange({ snap: e.target.checked })} />
      {tr('Accrocher au fond de plan', 'Snap to the background plan')}
    </label>
    <details>
      <summary>{tr(`Calques (${visibleCount}/${data.layers.length} visibles)`, `Layers (${visibleCount}/${data.layers.length} visible)`)}</summary>
      <div style={{ display: 'flex', gap: 6, margin: '6px 0' }}>
        <input type="search" value={filter} placeholder={tr('Filtrer', 'Filter')} onChange={e => setFilter(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
        <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => setLayers(() => true)}>{tr('Tous', 'All')}</button>
        <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => setLayers(() => false)}>{tr('Aucun', 'None')}</button>
      </div>
      <div style={{ maxHeight: 220, overflow: 'auto' }}>
        {shown.map(({ l, i }) => <label key={l.name} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={l.visible} onChange={e => setLayers(k => k === i ? e.target.checked : data.layers[k].visible)} />
          <span style={{ width: 8, height: 8, background: l.color, border: '1px solid var(--border)', flex: 'none' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
        </label>)}
      </div>
    </details>
  </div>;
}
