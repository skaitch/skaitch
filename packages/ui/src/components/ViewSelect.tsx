import type { ReactNode } from 'react';
import { Box, Check, FileText, Grid2X2, Scissors } from 'lucide-react';
import type { ViewType } from '@skaitch/core/types/ifc';
import { makeT } from '@skaitch/core/data/i18n';
import ToolbarMenu from './ToolbarMenu';

const VIEWS = [
  { value: '2d', label: 'plan_2d', icon: Grid2X2 },
  { value: '3d', label: 'view_3d', icon: Box },
  { value: 'section', label: 'Section', icon: Scissors },
  { value: 'sheets', label: 'Sheets', icon: FileText },
] as const;

export default function ViewSelect({ view, onChange, lang, tabs = false, sectionMenu }: {
  view: ViewType; onChange: (view: ViewType) => void; lang: string; tabs?: boolean; sectionMenu?: ReactNode;
}) {
  const t = makeT(lang);
  if (tabs) return <div className="view-buttons" role="group" aria-label={t('View')}>
    {VIEWS.map(({ value, label }) => value === 'section' && sectionMenu ? <span key={value} className="saved-sections-trigger">{sectionMenu}</span> : <button key={value}
      aria-pressed={view === value} onClick={() => onChange(value)}>{t(label)}</button>)}
  </div>;
  const current = VIEWS.find(option => option.value === view) ?? VIEWS[0];
  const Icon = current.icon;
  return <ToolbarMenu label={`${t('View')} · ${t(current.label)}`} lang={lang}
    icon={<><Icon size={22} strokeWidth={1.7}/><span>{t(current.label)}</span></>}>
    <div className="mobile-view-options" role="group" aria-label={t('View')}>
      {VIEWS.map(({ value, label, icon: ViewIcon }) => <button key={value}
        className="toolbar-menu-action mobile-view-option" data-menu-close aria-pressed={view === value}
        onClick={() => onChange(value)}>
        <ViewIcon size={22} strokeWidth={1.7}/><span>{t(label)}</span>{view === value && <Check size={18}/>}
      </button>)}
    </div>
  </ToolbarMenu>;
}
