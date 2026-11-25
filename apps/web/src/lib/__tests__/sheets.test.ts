import { describe, expect, it } from 'vitest';
import { buildStarter } from '@skaitch/core/data/starter';
import { addSheetViewport, createSheet, listSheets, nextSheetNumber, pruneSheetViewports, sheetPaperSize, validateSheet, SheetError } from '@skaitch/core/drawing/sheet';
import { validateItems, InputError } from '@skaitch/core/bim/validation';
import { readSkaitchFile, writeSkaitchFile } from '@skaitch/core/file/skaitchFile';
import { exportIFC } from '@skaitch/core/bim/exportIFC';
import type { ItemsMap } from '@skaitch/core/types/ifc';

const withSection = (): ItemsMap => ({
  ...buildStarter(),
  sec_1: { id: 'sec_1', type: 'Section', ifcType: 'IfcAnnotation', name: 'Coupe AA', Name: 'Coupe AA', GlobalId: 'g', parentId: 'sty_A0', geom: { x1: 0, y1: 2, x2: 12, y2: 2 } } as any,
});

describe('sheets', () => {
  it('creates an A3 landscape sheet under the project, numbered in series', () => {
    const items = buildStarter();
    const first = createSheet(items, { name: 'Plan RDC' });
    expect(first).toMatchObject({ type: 'Sheet', name: 'Plan RDC', parentId: 'proj_main', geom: { number: 'A101', format: 'A3', orientation: 'landscape', viewports: [] } });
    expect(first.geom.titleBlock.project).toBe('Résidence Les Tilleuls');
    items[first.id] = first;
    expect(nextSheetNumber(items)).toBe('A102');
    expect(sheetPaperSize({ format: 'A4', orientation: 'portrait' })).toEqual({ width: 210, height: 297 });
  });

  it('lists sheets in natural number order', () => {
    const items = buildStarter();
    for (const number of ['A110', 'A102', 'A9']) { const s = createSheet(items, { number }); items[s.id] = s; }
    expect(listSheets(items).map((s) => s.geom.number)).toEqual(['A9', 'A102', 'A110']);
  });

  it('centres a new view and validates it against the model', () => {
    const items = withSection();
    let sheet = createSheet(items);
    sheet = addSheetViewport(sheet, { kind: 'plan', sourceId: 'sty_A0', scale: 100 });
    sheet = addSheetViewport(sheet, { kind: 'section', sourceId: 'sec_1', scale: 50, position: [100, 80] });
    expect(sheet.geom.viewports[0].position).toEqual([210, 148.5]);
    expect(() => validateSheet(sheet, items)).not.toThrow();
  });

  it.each([
    ['unknown storey', { kind: 'plan', sourceId: 'nope', scale: 100 }, /Étage/],
    ['plan on a section', { kind: 'plan', sourceId: 'sec_1', scale: 100 }, /Étage/],
    ['odd scale', { kind: 'plan', sourceId: 'sty_A0', scale: 75 }, /Échelle/],
    ['off the paper', { kind: 'plan', sourceId: 'sty_A0', scale: 100, position: [500, 10] }, /hors de la feuille/],
    ['inverted crop', { kind: 'plan', sourceId: 'sty_A0', scale: 100, crop: { min: [5, 5], max: [1, 1] } }, /Recadrage/],
  ])('rejects a view with %s', (_, view, message) => {
    const items = withSection();
    const sheet = addSheetViewport(createSheet(items), view as any);
    expect(() => validateSheet(sheet, items)).toThrow(SheetError);
    expect(() => validateSheet(sheet, items)).toThrow(message);
  });

  it('is checked by the server model validation', () => {
    const items = withSection();
    const bad = createSheet(items);
    (bad.geom as any).format = 'Letter';
    items[bad.id] = bad;
    expect(() => validateItems(items)).toThrow(InputError);
    items[bad.id] = createSheet(items, { id: bad.id });
    expect(() => validateItems(items)).not.toThrow();
  });

  it('drops views whose storey or section was deleted', () => {
    const items = withSection();
    const sheet = addSheetViewport(addSheetViewport(createSheet(items), { kind: 'plan', sourceId: 'sty_A0', scale: 100 }), { kind: 'section', sourceId: 'sec_1', scale: 50 });
    delete items.sec_1;
    expect(pruneSheetViewports(sheet, items).geom.viewports.map((v) => v.kind)).toEqual(['plan']);
  });

  it('travels in the .skaitch file and stays out of IFC', () => {
    const items = withSection();
    const sheet = addSheetViewport(createSheet(items, { name: 'Plan RDC' }), { kind: 'plan', sourceId: 'sty_A0', scale: 50 });
    items[sheet.id] = sheet;
    const back = readSkaitchFile(writeSkaitchFile({ meta: { name: 'P', description: '', createdAt: '', updatedAt: '' }, items }, 'test'));
    expect(back.items[sheet.id]).toEqual(sheet);
    const ifc = exportIFC(items);
    expect(ifc).not.toContain('SkaitchSheet');
    expect(ifc).not.toContain('Plan RDC');
  });
});

describe('sheet rendering', () => {
  it('lays out views at their scale around their centre, with a titled frame and title block', async () => {
    const { sheetLayout, renderSheetSvg } = await import('@skaitch/core/drawing/sheetSvg');
    const items = withSection();
    const sheet = addSheetViewport(addSheetViewport(createSheet(items, { name: 'Plan & coupe' }),
      { kind: 'plan', sourceId: 'sty_A0', scale: 100, position: [100, 100] }),
      { kind: 'section', sourceId: 'sec_1', scale: 50, title: 'Coupe AA' });
    const [plan, section] = sheetLayout(items, sheet);
    expect(plan.x + plan.width / 2).toBeCloseTo(100);
    expect(plan.width).toBeGreaterThan(120); // 12 m building at 1:100 → 120 mm plus wall thickness
    expect(plan.width).toBeLessThan(125);
    expect(plan.title).toBe('Plan RDC — Bâtiment A');
    expect(section.title).toBe('Coupe AA');
    const svg = renderSheetSvg(items, sheet);
    expect(svg).toMatch(/^<svg [^>]*width="420mm" height="297mm"/);
    expect(svg).toContain('data-viewport="' + sheet.geom.viewports[0].id + '"');
    expect(svg).toContain('Plan &amp; coupe');
    expect(svg).toContain('1/50, 1/100');
    expect(svg).toContain('A101');
    expect(svg).not.toContain('NaN');
  });

  it('crops a view to its region', async () => {
    const { sheetLayout } = await import('@skaitch/core/drawing/sheetSvg');
    const items = withSection();
    const sheet = addSheetViewport(createSheet(items), { kind: 'plan', sourceId: 'sty_A0', scale: 50, crop: { min: [0, 0], max: [4, 3] } });
    const [frame] = sheetLayout(items, sheet);
    expect([frame.width, frame.height]).toEqual([80, 60]);
  });

  it('skips views whose source is gone', async () => {
    const { sheetLayout } = await import('@skaitch/core/drawing/sheetSvg');
    const items = withSection();
    const sheet = addSheetViewport(createSheet(items), { kind: 'section', sourceId: 'sec_1', scale: 50 });
    delete items.sec_1;
    expect(sheetLayout(items, sheet)).toHaveLength(0);
  });

  it('renders the sheet editor, and an invitation when there is no sheet', async () => {
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { default: SheetView } = await import('@skaitch/ui/components/canvas/SheetView');
    const noop = () => {};
    const empty = renderToStaticMarkup(createElement(SheetView, { items: buildStarter(), addItem: noop, updateItem: noop, deleteItems: noop, lang: 'fr' }));
    expect(empty).toContain('Nouvelle feuille');
    const items = withSection();
    const sheet = addSheetViewport(createSheet(items), { kind: 'plan', sourceId: 'sty_A0', scale: 100 });
    items[sheet.id] = sheet;
    const html = renderToStaticMarkup(createElement(SheetView, { items, addItem: noop, updateItem: noop, deleteItems: noop, lang: 'fr' }));
    expect(html).toContain('Cartouche');
    expect(html).toContain('data-frame="' + sheet.geom.viewports[0].id + '"');
    expect(html).toContain('Coupe AA');
  });
});

describe('sheet PDF export', () => {
  it('names the file after the project and the sheet, and refuses an empty export', async () => {
    const { sheetPdfName, sheetsToPdf } = await import('@skaitch/ui/lib/sheetPdf');
    const items = buildStarter();
    const a = createSheet(items); items[a.id] = a;
    const b = createSheet(items);
    expect(sheetPdfName('Les Tilleuls', [a])).toBe('Les_Tilleuls_A101.pdf');
    expect(sheetPdfName('P', [a, b])).toBe('P_feuilles.pdf');
    await expect(sheetsToPdf(items, [])).rejects.toThrow('Aucune feuille');
  });
});

describe('sheet MCP tools', () => {
  const apply = (items: ItemsMap, changes: any[]) => {
    for (const c of changes) {
      if (c.kind === 'add') items[c.item.id] = c.item;
      if (c.kind === 'update') items[c.id] = { ...items[c.id], ...c.patch } as any;
    }
  };
  it('creates a sheet, places and moves views, reports layout issues and exports the SVG', async () => {
    const { computeMcpModel } = await import('@skaitch/core/bim/mcpModel');
    const { readMcpModel } = await import('@skaitch/core/bim/mcpRead');
    const { TOOLS } = await import('@skaitch/core/mcp-tools');
    for (const name of ['create_sheet', 'add_sheet_view', 'update_sheet_view', 'export_sheet']) expect(TOOLS.some((t: any) => t.name === name)).toBe(true);
    const items = withSection();
    const run = (name: string, args: Record<string, unknown>) => { const r = computeMcpModel(name, args, items, 'sty_A0', []); apply(items, r.changes); return r.result as any; };

    const sheet = run('create_sheet', { name: 'Plans', format: 'A3', author: 'Atelier' });
    expect(sheet).toMatchObject({ success: true, number: 'A101', paper_mm: { width: 420, height: 297 } });
    expect(run('create_sheet', { number: 'A101' }).error).toMatch(/already used/);
    expect(run('create_sheet', { format: 'Letter' }).error).toMatch(/format/);

    const plan = run('add_sheet_view', { sheet_id: sheet.id, source_id: 'sty_A0', scale: 100, position: [100, 100] });
    expect(plan).toMatchObject({ success: true, layout_issues: [] });
    const section = run('add_sheet_view', { sheet_id: sheet.id, source_id: 'sec_1', scale: 50, position: [110, 100] });
    expect(section.layout_issues.join(' ')).toMatch(/chevauche/);
    expect(run('add_sheet_view', { sheet_id: sheet.id, source_id: 'nope' }).error).toMatch(/introuvable/);

    const moved = run('update_sheet_view', { sheet_id: sheet.id, view_id: section.view_id, position: [300, 90], scale: 100 });
    expect(moved.layout_issues).toEqual([]);
    expect(run('update_sheet_view', { sheet_id: sheet.id, view_id: section.view_id, scale: 75 }).error).toMatch(/Échelle/);

    const out = readMcpModel('export_sheet', { sheet_id: sheet.id }, items, []) as any;
    expect(out.views.map((v: any) => v.kind)).toEqual(['plan', 'section']);
    expect(out.content).toMatch(/^<svg [^>]*width="420mm"/);
    expect(out.content).toContain('Atelier');
    expect((readMcpModel('export_sheet', {}, items, []) as any).sheets).toEqual([expect.objectContaining({ id: sheet.id, views: 2 })]);

    const removed = run('update_sheet_view', { sheet_id: sheet.id, view_id: section.view_id, remove: true });
    expect(removed.removed).toBe(true);
    expect((items[sheet.id] as any).geom.viewports).toHaveLength(1);
  });

  it('lets read grants export a sheet but not create one', async () => {
    const { authorizeMcpTool } = await import('@skaitch/core/lib/mcpPermissions');
    expect(() => authorizeMcpTool('export_sheet', {}, 'p', { p: 'read' })).not.toThrow();
    expect(() => authorizeMcpTool('create_sheet', {}, 'p', { p: 'read' })).toThrow('read-only');
  });
});
