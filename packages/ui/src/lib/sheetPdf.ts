import type { ItemsMap } from '@skaitch/core/types/ifc';
import { sheetPaperSize, type SheetEntity } from '@skaitch/core/drawing/sheet';
import { renderSheetSvg } from '@skaitch/core/drawing/sheetSvg';

/**
 * Vector PDF of one or more sheets, one page per sheet at its paper size (docs/plans/feuilles-pdf.md, lot 6).
 * Client-side only (browser and Electron renderer): jspdf + svg2pdf.js, loaded on demand.
 * Text uses the PDF base font Helvetica (WinAnsi): Latin scripts print as is; other scripts are a known v1 limit.
 */
export async function sheetsToPdf(items: ItemsMap, sheets: SheetEntity[]): Promise<Blob> {
  if (!sheets.length) throw new Error('Aucune feuille à exporter.');
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const size = (s: SheetEntity) => sheetPaperSize(s.geom);
  const first = size(sheets[0]);
  const pdf = new jsPDF({ unit: 'mm', format: [first.width, first.height], orientation: first.width > first.height ? 'landscape' : 'portrait', compress: true });
  pdf.setProperties({ title: sheets.length === 1 ? `${sheets[0].geom.number} ${sheets[0].name}` : 'Feuilles', creator: 'skAItch' });
  // svg2pdf needs the SVG in a document to resolve styles; keep it off screen.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden';
  document.body.appendChild(host);
  try {
    for (const [i, sheet] of sheets.entries()) {
      const { width, height } = size(sheet);
      if (i > 0) pdf.addPage([width, height], width > height ? 'landscape' : 'portrait');
      host.innerHTML = renderSheetSvg(items, sheet);
      await svg2pdf(host.firstElementChild as SVGSVGElement, pdf, { x: 0, y: 0, width, height });
    }
  } finally {
    host.remove();
  }
  return pdf.output('blob');
}

export function sheetPdfName(projectName: string, sheets: SheetEntity[]): string {
  const base = sheets.length === 1 ? `${projectName}_${sheets[0].geom.number}` : `${projectName}_feuilles`;
  return `${base.replace(/[^\p{L}\p{N}_-]+/gu, '_')}.pdf`;
}
