import type { ItemsMap } from '../types/ifc.js';
import type { SectionLine } from '../lib/sectionGeometry.js';
import { renderPlan, type Bounds, type Drawing } from './plan.js';
import { renderSection } from './section.js';
import { paperSize, toSvgGroup } from './svg.js';
import { sheetPaperSize, type SheetEntity, type SheetViewport } from './sheet.js';

/**
 * A whole sheet as SVG in paper millimetres: frame, title block and every view at its scale.
 * Pure: the sheet view shows it, the PDF export (lot 6) prints it, the MCP can render it headless.
 */

export const SHEET_MARGIN = 10;
export const TITLE_BLOCK = { width: 180, height: 36 };
const VIEW_TITLE_GAP = 4;
const FONT = 'Helvetica, Arial, sans-serif';

export interface ViewportFrame {
  viewport: SheetViewport;
  /** Frame on the sheet, in mm from its top-left corner. */
  x: number; y: number; width: number; height: number;
  drawing: Drawing;
  region: Bounds;
  title: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const n = (v: number) => (Math.round(v * 100) / 100).toString();

function viewDrawing(items: ItemsMap, v: SheetViewport): Drawing | null {
  if (v.kind === 'plan') return items[v.sourceId]?.type === 'Storey' ? renderPlan(items, v.sourceId) : null;
  const line = (items[v.sourceId] as any)?.geom as SectionLine | undefined;
  return items[v.sourceId]?.type === 'Section' && line ? renderSection(items, line) : null;
}

function defaultTitle(items: ItemsMap, v: SheetViewport): string {
  const source = items[v.sourceId];
  const name = source?.name || source?.Name || '';
  return v.kind === 'plan' ? `Plan ${name}`.trim() : name || 'Coupe';
}

/** Where each view sits on the sheet; views whose source is gone are skipped. */
export function sheetLayout(items: ItemsMap, sheet: SheetEntity): ViewportFrame[] {
  const frames: ViewportFrame[] = [];
  for (const viewport of sheet.geom.viewports) {
    const drawing = viewDrawing(items, viewport);
    if (!drawing) continue;
    const region: Bounds = viewport.crop
      ? { minX: viewport.crop.min[0], minY: viewport.crop.min[1], maxX: viewport.crop.max[0], maxY: viewport.crop.max[1] }
      : drawing.bounds;
    const { width, height } = paperSize(drawing, { scale: viewport.scale, region });
    frames.push({
      viewport, drawing, region, width, height,
      x: viewport.position[0] - width / 2, y: viewport.position[1] - height / 2,
      title: viewport.title?.trim() || defaultTitle(items, viewport),
    });
  }
  return frames;
}

function titleBlockSvg(sheet: SheetEntity, frames: ViewportFrame[], width: number, height: number): string {
  const { width: w, height: h } = TITLE_BLOCK;
  const x = width - SHEET_MARGIN - w, y = height - SHEET_MARGIN - h;
  const tb = sheet.geom.titleBlock;
  const scales = [...new Set(frames.map((f) => f.viewport.scale))].sort((a, b) => a - b).map((s) => `1/${s}`).join(', ');
  const text = (tx: number, ty: number, s: string, size: number, bold = false) =>
    `<text x="${n(tx)}" y="${n(ty)}" font-family="${FONT}" font-size="${size}"${bold ? ' font-weight="bold"' : ''} fill="#000">${esc(s)}</text>`;
  const label = (tx: number, ty: number, s: string) => text(tx, ty, s, 2);
  const line = (x1: number, y1: number, x2: number, y2: number, wgt = 0.25) =>
    `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="#000" stroke-width="${wgt}"/>`;
  const c1 = x + 120, c2 = x + 150, r1 = y + 12, r2 = y + 24;
  return [
    `<rect class="title-block" x="${n(x)}" y="${n(y)}" width="${w}" height="${h}" fill="#fff" stroke="#000" stroke-width="0.5"/>`,
    line(x, r1, c1, r1), line(c1, y, c1, y + h), line(c2, r1, c2, y + h), line(c1, r1, x + w, r1), line(c1, r2, x + w, r2), line(x, r2, c1, r2),
    label(x + 2, y + 3.5, 'Projet'), text(x + 2, y + 9.5, tb.project ?? '', 4, true),
    label(x + 2, r1 + 3.5, 'Feuille'), text(x + 2, r1 + 9.5, sheet.name, 3.5),
    label(x + 2, r2 + 3.5, 'Auteur'), text(x + 2, r2 + 9, tb.author ?? '', 3),
    label(c1 + 2, y + 3.5, 'N°'), text(c1 + 2, y + 10, sheet.geom.number, 5, true),
    label(c1 + 2, r1 + 3.5, 'Échelle'), text(c1 + 2, r1 + 9.5, scales, 3),
    label(c2 + 2, r1 + 3.5, 'Format'), text(c2 + 2, r1 + 9.5, sheet.geom.format, 3),
    label(c1 + 2, r2 + 3.5, 'Date'), text(c1 + 2, r2 + 9, tb.date ?? '', 3),
    label(c2 + 2, r2 + 3.5, 'Indice'), text(c2 + 2, r2 + 9, tb.revision ?? '', 3),
  ].join('');
}

/** The sheet's own content (no <svg> wrapper), in mm; frames carry data-viewport for the editor. */
export function sheetSvgContent(items: ItemsMap, sheet: SheetEntity, frames = sheetLayout(items, sheet)): string {
  const { width, height } = sheetPaperSize(sheet.geom);
  const parts = [
    `<rect width="${width}" height="${height}" fill="#fff"/>`,
    `<rect class="sheet-border" x="${SHEET_MARGIN}" y="${SHEET_MARGIN}" width="${width - 2 * SHEET_MARGIN}" height="${height - 2 * SHEET_MARGIN}" fill="none" stroke="#000" stroke-width="0.7"/>`,
  ];
  for (const f of frames) {
    // A nested viewport clips the view to its frame (crop) at its exact paper size.
    parts.push(`<svg data-viewport="${esc(f.viewport.id)}" x="${n(f.x)}" y="${n(f.y)}" width="${n(f.width)}" height="${n(f.height)}" viewBox="0 0 ${n(f.width)} ${n(f.height)}" overflow="hidden">`
      + toSvgGroup(f.drawing, { scale: f.viewport.scale, region: f.region, fontFamily: FONT }) + '</svg>');
    const ty = f.y + f.height + VIEW_TITLE_GAP + 3.5;
    parts.push(`<text x="${n(f.x)}" y="${n(ty)}" font-family="${FONT}" font-size="3.5" font-weight="bold" fill="#000">${esc(f.title)}`
      + `<tspan font-weight="normal" font-size="2.5" dx="3">1/${f.viewport.scale}</tspan></text>`,
      `<line x1="${n(f.x)}" y1="${n(ty + 1.2)}" x2="${n(f.x + Math.min(f.width, 70))}" y2="${n(ty + 1.2)}" stroke="#000" stroke-width="0.35"/>`);
  }
  parts.push(titleBlockSvg(sheet, frames, width, height));
  return parts.join('');
}

/** Standalone SVG, sized in millimetres so it prints at the views' scales. */
export function renderSheetSvg(items: ItemsMap, sheet: SheetEntity): string {
  const { width, height } = sheetPaperSize(sheet.geom);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">${sheetSvgContent(items, sheet)}</svg>`;
}

/** Layout problems a reader (or the MCP client) should fix: views overlapping, off the border, or over the title block. */
export function sheetLayoutIssues(sheet: SheetEntity, frames: ViewportFrame[]): string[] {
  const { width, height } = sheetPaperSize(sheet.geom);
  const tb = { x: width - SHEET_MARGIN - TITLE_BLOCK.width, y: height - SHEET_MARGIN - TITLE_BLOCK.height, width: TITLE_BLOCK.width, height: TITLE_BLOCK.height };
  const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const issues: string[] = [];
  frames.forEach((f, i) => {
    const name = `${f.viewport.id} (${f.title})`;
    if (f.x < SHEET_MARGIN || f.y < SHEET_MARGIN || f.x + f.width > width - SHEET_MARGIN || f.y + f.height > height - SHEET_MARGIN) {
      issues.push(`${name} dépasse du cadre de la feuille : réduire l'échelle, recadrer ou déplacer.`);
    }
    if (overlap(f, tb)) issues.push(`${name} recouvre le cartouche.`);
    for (const g of frames.slice(i + 1)) if (overlap(f, g)) issues.push(`${name} chevauche ${g.viewport.id} (${g.title}).`);
  });
  return issues;
}
