import { Box, FolderOpen, Trash2 } from 'lucide-react';
import type { ItemsMap } from '@skaitch/core/types/ifc';
import { makeT } from '@skaitch/core/data/i18n';
import { sectionPlane } from '@skaitch/core/lib/freeSection';
import ToolbarMenu from './ToolbarMenu';

export default function SavedSectionsMenu({ items, selection, active, lang, onOpen, onDelete }: {
  items: ItemsMap; selection: string[]; active: boolean; lang: string;
  onOpen: (id: string, view: 'section' | '3d') => void; onDelete: (id: string) => void;
}) {
  const t = makeT(lang);
  const sections = Object.values(items).filter(item => item.type === 'Section');
  return <ToolbarMenu label={t('Section')} lang={lang} active={active}>
    {!sections.length && <p className="section-tool-hint">{t('No saved sections.')}</p>}
    {sections.map(section => {
      const geom = (section as any).geom;
      const plane = geom && sectionPlane(geom);
      const vertical = plane && Math.abs(plane.normal.y) < 1e-5;
      return <div className="saved-section-row" key={section.id}>
        <button className="toolbar-menu-action" data-menu-close disabled={!plane} aria-pressed={selection.includes(section.id)}
          onClick={() => onOpen(section.id, vertical ? 'section' : '3d')}>
          <FolderOpen size={16}/><span>{section.name}<small>{items[section.parentId ?? '']?.name}</small></span>
        </button>
        {vertical && <button className="header-command header-command-icon" data-menu-close
          aria-label={`${section.name} · ${t('view_3d')}`} title={t('view_3d')} onClick={() => onOpen(section.id, '3d')}><Box size={16}/></button>}
        <button className="header-command header-command-icon saved-section-delete"
          aria-label={`${t('delete')} ${section.name}`} title={t('delete')} onClick={() => onDelete(section.id)}><Trash2 size={16}/></button>
      </div>;
    })}
  </ToolbarMenu>;
}
