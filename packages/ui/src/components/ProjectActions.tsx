import { FileInput, RefreshCw, CircleCheck } from 'lucide-react';
import ToolbarMenu from './ToolbarMenu';
import { makeT } from '@skaitch/core/data/i18n';

export type ExportFormat = 'skaitch' | 'ifc' | 'dxf' | 'json' | 'pdf' | 'sheets' | 'png';
const FORMATS = [
  ['skaitch', 'skAItch project', 'Complete project file (.skaitch)'],
  ['ifc', 'IFC4 BIM Model', 'Standard BIM exchange'],
  ['dxf', 'AutoCAD 2D Drawing', 'DXF vector drawing'],
  ['json', 'BIM JSON Database', 'Complete JSON structure'],
  ['sheets', 'Sheets (PDF)', 'Every sheet at scale, vector'],
  ['pdf', 'PDF Floorplan', 'A4 printable layout'],
  ['png', 'High-Res PNG Image', '2D floorplan capture'],
] as const;

export default function ProjectActions({ lang, onImport, onImportSkaitch, onSync, onVerify, onExport }: {
  lang: string; onImport: () => void; onImportSkaitch: () => void; onSync: () => void; onVerify: () => void;
  onExport: (format: ExportFormat) => void;
}) {
  const t = makeT(lang);
  return <>
    <ToolbarMenu label={t('File')} lang={lang}>
      <button className="toolbar-menu-action" data-menu-close onClick={onImport}><FileInput size={18}/>{t('import_ifc')}</button>
      <button className="toolbar-menu-action" data-menu-close onClick={onImportSkaitch}><FileInput size={18}/>{t('Import skAItch project (.skaitch)')}</button>
      <button className="toolbar-menu-action" data-menu-close onClick={onSync} title={t('Synchronize 3D view immediately with 2D modifications')}><RefreshCw size={18}/>{t('Sync IFC')}</button>
      <button className="toolbar-menu-action" data-menu-close onClick={onVerify} title={t('Check IFC round-trip')}><CircleCheck size={18}/>{t('Verify')}</button>
    </ToolbarMenu>
    <ToolbarMenu label={t('Export')} lang={lang}>
      {FORMATS.map(([format, label, description]) => <button key={format} className="toolbar-menu-action export-format" data-menu-close onClick={() => onExport(format)}>
        <span className="export-format-tag">{format === 'sheets' ? 'PDF' : format.toUpperCase()}</span>
        <span><strong>{t(label)}</strong><small>{t(description)}</small></span>
      </button>)}
    </ToolbarMenu>
  </>;
}
