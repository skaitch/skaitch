import { useMemo, useState } from 'react';
import type { ItemsMap } from '@skaitch/core/types/ifc';
import type { SectionLine } from '@skaitch/core/lib/sectionGeometry';
import { renderSection, DEFAULT_SECTION_PENS, type SectionPens } from '@skaitch/core/drawing/section';
import PlanPrimitives from './PlanPrimitives';

/** Editor colours for the shared section drawing; weights stay the print ones (paper mm). */
const SCREEN_PENS: Partial<SectionPens> = {
  wallCut: { ...DEFAULT_SECTION_PENS.wallCut, color: 'var(--ink)' },
  wallFill: 'var(--panel-2)',
  ink: 'var(--ink)',
  level: { ...DEFAULT_SECTION_PENS.level, color: 'var(--ink-3)' },
  beyond: { ...DEFAULT_SECTION_PENS.beyond, color: 'var(--ink-2)' },
};

/** Shown as if printed at 1:50: one paper millimetre is 5 cm of model. */
const UNITS_PER_MM = 50 / 1000;

export default function SectionView({ items, line, setSelection }: { items: ItemsMap; line?: SectionLine; setSelection: (ids: string[]) => void }) {
  const sections = Object.values(items).filter((i) => i.type === 'Section');
  const [activeId, setActiveId] = useState(sections.find((i) => (i as any).geom === line)?.id ?? sections[0]?.id ?? '');
  const active = (items[activeId] as any)?.geom as SectionLine | undefined;
  const drawing = useMemo(() => (active ? renderSection(items, active, { pens: SCREEN_PENS }) : null), [items, active]);

  if (!active || !drawing) return <p style={{ padding: 24 }}>Tracez une ligne de coupe dans le plan avec l’outil Coupe.</p>;
  if (!drawing.primitives.some((p) => p.layer === 'cut')) return <p style={{ padding: 24 }}>La coupe ne traverse aucun élément.</p>;
  const { minX, minY, maxX, maxY } = drawing.bounds, pad = 0.5;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <label>Coupe <select value={activeId} onChange={(e) => setActiveId(e.target.value)}>
        {sections.map((i) => <option key={i.id} value={i.id}>{i.name} · {items[i.parentId ?? '']?.name}</option>)}
      </select></label>
      <svg style={{ flex: 1, minHeight: 0 }} aria-label="Coupe générale du bâtiment" role="img" width="100%" height="100%"
        viewBox={`${minX - pad} ${-maxY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`}>
        <PlanPrimitives primitives={drawing.primitives} w2s={(x, z) => [x, -z]} unitsPerMm={UNITS_PER_MM} minStroke={0.005}
          onSelect={(id) => { if (items[id]?.type !== 'Storey') setSelection([id]); }} titleOf={(id) => items[id]?.name} />
      </svg>
    </div>
  );
}
