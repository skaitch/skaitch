import { useEffect, useMemo, useRef, useState } from 'react';
import type { IfcEntity, ItemsMap } from '@skaitch/core/types/ifc';
import { makeT } from '@skaitch/core/data/i18n';
import {
  PAPER_FORMATS, SHEET_SCALES, addSheetViewport, createSheet, listSheets, sheetPaperSize, validateSheet,
  type Orientation, type PaperFormat, type SheetEntity, type SheetGeom, type SheetScale, type SheetViewport,
} from '@skaitch/core/drawing/sheet';
import { sheetLayout, sheetSvgContent } from '@skaitch/core/drawing/sheetSvg';
import { sheetPdfName, sheetsToPdf } from '../../lib/sheetPdf';
import { triggerFileDownload } from '../../lib/exportFormats';

interface Props {
  items: ItemsMap;
  addItem: (it: IfcEntity) => void;
  updateItem: (id: string, patch: Partial<IfcEntity>) => void;
  deleteItems: (ids: string[]) => void;
  lang: string;
  projectName?: string;
}

interface Drag { id: string; startX: number; startY: number; dx: number; dy: number }

/** Sheets: plans and sections laid out at scale on a page with a title block (docs/plans/feuilles-pdf.md, lot 5). */
export default function SheetView({ items, addItem, updateItem, deleteItems, lang, projectName = 'export' }: Props) {
  const t = makeT(lang);
  const sheets = useMemo(() => listSheets(items), [items]);
  const [activeId, setActiveId] = useState<string>('');
  const sheet = sheets.find((s) => s.id === activeId) ?? sheets[0];
  const [error, setError] = useState('');
  const [selectedView, setSelectedView] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [exporting, setExporting] = useState(false);
  const exportPdf = async (list: SheetEntity[]) => {
    setExporting(true);
    try { triggerFileDownload(await sheetsToPdf(items, list), sheetPdfName(projectName.replace(/\s+/g, '_'), list), 'application/pdf'); }
    catch (e) { setError((e as Error).message); }
    finally { setExporting(false); }
  };

  const storeys = useMemo(() => Object.values(items).filter((i) => i.type === 'Storey')
    .sort((a, b) => Number((a as any).geom?.elevation ?? 0) - Number((b as any).geom?.elevation ?? 0)), [items]);
  const sections = useMemo(() => Object.values(items).filter((i) => i.type === 'Section'), [items]);
  const [newSource, setNewSource] = useState('');
  const [newScale, setNewScale] = useState<SheetScale>(100);

  const frames = useMemo(() => (sheet ? sheetLayout(items, sheet) : []), [items, sheet]);
  const content = useMemo(() => (sheet ? sheetSvgContent(items, sheet, frames) : ''), [items, sheet, frames]);
  useEffect(() => { setError(''); }, [sheet?.id]);

  /** Applies a change only if the sheet stays valid; otherwise shows why. */
  const save = (next: SheetEntity) => {
    try { validateSheet(next, items); setError(''); updateItem(next.id, { name: next.name, Name: next.name, geom: next.geom } as Partial<IfcEntity>); }
    catch (e) { setError((e as Error).message); }
  };
  const patchGeom = (patch: Partial<SheetGeom>) => sheet && save({ ...sheet, geom: { ...sheet.geom, ...patch } });

  const create = () => {
    const created = createSheet(items);
    addItem(created as unknown as IfcEntity);
    setActiveId(created.id);
  };

  const changePaper = (format: PaperFormat, orientation: Orientation) => {
    if (!sheet) return;
    // Keep every view on the new page: clamp its centre into the paper.
    const { width, height } = sheetPaperSize({ format, orientation });
    const viewports = sheet.geom.viewports.map((v) => ({ ...v, position: [Math.min(v.position[0], width), Math.min(v.position[1], height)] as [number, number] }));
    patchGeom({ format, orientation, viewports });
  };

  const patchView = (id: string, patch: Partial<SheetViewport>) =>
    sheet && patchGeom({ viewports: sheet.geom.viewports.map((v) => (v.id === id ? { ...v, ...patch } : v)) });

  const addView = () => {
    if (!sheet) return;
    const source = newSource || storeys[0]?.id;
    const kind = items[source]?.type === 'Section' ? 'section' : 'plan';
    if (!source) return;
    save(addSheetViewport(sheet, { kind, sourceId: source, scale: newScale }));
  };

  /** Client pixels → sheet millimetres. */
  const toMm = (clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current, ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return [0, 0];
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return [p.x, p.y];
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const [x, y] = toMm(e.clientX, e.clientY);
    setDrag({ ...drag, dx: x - drag.startX, dy: y - drag.startY });
  };
  const onPointerUp = () => {
    if (!drag || !sheet) return;
    const v = sheet.geom.viewports.find((vp) => vp.id === drag.id);
    if (v && (Math.abs(drag.dx) > 0.5 || Math.abs(drag.dy) > 0.5)) {
      const { width, height } = sheetPaperSize(sheet.geom);
      const round = (value: number, max: number) => Math.max(0, Math.min(max, Math.round(value)));
      patchView(v.id, { position: [round(v.position[0] + drag.dx, width), round(v.position[1] + drag.dy, height)] });
    }
    setDrag(null);
  };

  if (!sheet) {
    return (
      <div className="sheet-view sheet-empty">
        <p>{t('No sheet yet. Create one to lay out plans and sections at scale.')}</p>
        <button className="btn primary" onClick={create}>{t('New sheet')}</button>
      </div>
    );
  }

  const { width, height } = sheetPaperSize(sheet.geom);
  const tb = sheet.geom.titleBlock;
  const field = (label: string, value: string | undefined, onChange: (v: string) => void, max = 200) => (
    <label className="sheet-field"><span>{label}</span>
      <input value={value ?? ''} maxLength={max} onChange={(e) => onChange(e.target.value)} />
    </label>
  );

  return (
    <div className="sheet-view">
      <aside className="sheet-panel" aria-label={t('Sheets')}>
        <div className="sheet-row">
          <select aria-label={t('Sheets')} value={sheet.id} onChange={(e) => setActiveId(e.target.value)}>
            {sheets.map((s) => <option key={s.id} value={s.id}>{s.geom.number} · {s.name}</option>)}
          </select>
          <button className="btn" onClick={create}>{t('New sheet')}</button>
        </div>

        {field(t('Name'), sheet.name, (name) => save({ ...sheet, name, Name: name }))}
        {field(t('Number'), sheet.geom.number, (number) => patchGeom({ number }), 20)}
        <div className="sheet-row">
          <label className="sheet-field"><span>{t('Format')}</span>
            <select value={sheet.geom.format} onChange={(e) => changePaper(e.target.value as PaperFormat, sheet.geom.orientation)}>
              {Object.keys(PAPER_FORMATS).map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="sheet-field"><span>{t('Orientation')}</span>
            <select value={sheet.geom.orientation} onChange={(e) => changePaper(sheet.geom.format, e.target.value as Orientation)}>
              <option value="landscape">{t('Landscape')}</option>
              <option value="portrait">{t('Portrait')}</option>
            </select>
          </label>
        </div>

        <h4>{t('Title block')}</h4>
        {field(t('Project'), tb.project, (project) => patchGeom({ titleBlock: { ...tb, project } }))}
        {field(t('Author'), tb.author, (author) => patchGeom({ titleBlock: { ...tb, author } }))}
        <div className="sheet-row">
          {field(t('Date'), tb.date, (date) => patchGeom({ titleBlock: { ...tb, date } }), 40)}
          {field(t('Revision'), tb.revision, (revision) => patchGeom({ titleBlock: { ...tb, revision } }), 20)}
        </div>

        <h4>{t('Views')}</h4>
        {sheet.geom.viewports.map((v) => (
          <div key={v.id} className={`sheet-viewport${selectedView === v.id ? ' on' : ''}`} onClick={() => setSelectedView(v.id)}>
            <input aria-label={t('View title')} placeholder={frames.find((f) => f.viewport.id === v.id)?.title}
              value={v.title ?? ''} maxLength={200} onChange={(e) => patchView(v.id, { title: e.target.value || undefined })} />
            <select aria-label={t('Scale')} value={v.scale} onChange={(e) => patchView(v.id, { scale: Number(e.target.value) as SheetScale })}>
              {SHEET_SCALES.map((s) => <option key={s} value={s}>1/{s}</option>)}
            </select>
            <button className="icon-btn" title={t('Remove view')} aria-label={t('Remove view')}
              onClick={(e) => { e.stopPropagation(); patchGeom({ viewports: sheet.geom.viewports.filter((x) => x.id !== v.id) }); }}>×</button>
          </div>
        ))}
        <div className="sheet-row">
          <select aria-label={t('Add view')} value={newSource || storeys[0]?.id || ''} onChange={(e) => setNewSource(e.target.value)}>
            <optgroup label={t('Floor plan')}>
              {storeys.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
            {sections.length > 0 && <optgroup label={t('Section')}>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>}
          </select>
          <select aria-label={t('Scale')} value={newScale} onChange={(e) => setNewScale(Number(e.target.value) as SheetScale)}>
            {SHEET_SCALES.map((s) => <option key={s} value={s}>1/{s}</option>)}
          </select>
          <button className="btn" onClick={addView} disabled={!storeys.length && !sections.length}>{t('Add view')}</button>
        </div>
        <p className="sheet-hint">{t('Drag a view to move it.')}</p>
        {error && <p className="sheet-error" role="alert">{error}</p>}
        <div className="sheet-row">
          <button className="btn primary" disabled={exporting} onClick={() => exportPdf([sheet])}>{t('Export PDF')}</button>
          {sheets.length > 1 && <button className="btn" disabled={exporting} onClick={() => exportPdf(sheets)}>{t('All sheets (PDF)')}</button>}
        </div>
        <button className="btn danger" onClick={() => { deleteItems([sheet.id]); setActiveId(''); }}>{t('Delete sheet')}</button>
      </aside>

      <div className="sheet-canvas" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
        <svg ref={svgRef} className="sheet-paper" viewBox={`-5 -5 ${width + 10} ${height + 10}`} role="img"
          aria-label={`${sheet.geom.number} · ${sheet.name}`} preserveAspectRatio="xMidYMid meet">
          <rect x={-5} y={-5} width={width + 10} height={height + 10} fill="var(--panel-2)" />
          <g dangerouslySetInnerHTML={{ __html: content }} />
          {frames.map((f) => {
            const moving = drag?.id === f.viewport.id;
            const sel = selectedView === f.viewport.id;
            return (
              <rect key={f.viewport.id} data-frame={f.viewport.id}
                x={f.x + (moving ? drag!.dx : 0)} y={f.y + (moving ? drag!.dy : 0)} width={f.width} height={f.height}
                fill="transparent" stroke={sel || moving ? 'var(--accent)' : 'transparent'} strokeWidth={0.6}
                strokeDasharray={moving ? '3 2' : undefined} style={{ cursor: 'move' }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  setSelectedView(f.viewport.id);
                  const [x, y] = toMm(e.clientX, e.clientY);
                  setDrag({ id: f.viewport.id, startX: x, startY: y, dx: 0, dy: 0 });
                }} />
            );
          })}
        </svg>
      </div>
    </div>
  );
}
