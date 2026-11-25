# Printable sheets and PDF export — implementation plan

Status: proposal, to validate. Written on 15 November 2026.

## Goal

Produce, from a skAItch project, **scaled drawings on a sheet with a title block, exported as vector PDF**:
storey plan at 1:100 or 1:50, section, with dimensions and annotations, on A4 to A0. Same result on the web, on the
desktop and through MCP (the AI can compose and export a sheet).

## What already exists

| Building block | Where | Limit for printing |
|---|---|---|
| 2D plan as SVG | `packages/ui/src/components/canvas/Canvas2D.tsx` (2,600 lines, `svg#plan-svg-canvas`) | Drawn **in screen pixels** (`w2s`: `x * view.scale + view.ox`), mixed with handles, hovers and tools |
| View capture | `capture()` in `Canvas2D.tsx` → `captureSvg` | Raster image of the screen, no scale |
| 2D section | `SectionView.tsx` + `core/src/lib/sectionGeometry.ts` / `freeSection.ts` | Already in **world coordinates** (viewBox in metres): reusable almost as is |
| Dimensions, markers, sections | `core/src/bim/annotationIfc.ts` (`Dimension`, `Marker`, `Section`) | Stored in IFC, rendered only in `Canvas2D` |
| DXF export | `core/src/bim/exportFormats.ts` (`exportToDXF`) | Proves the model can already be walked for 2D |
| Project file | ADR 0003: `.skaitch` = ZIP (`manifest`, `model.json`, free sections…) | Good place to store sheets |

## Key decision: a pure plan renderer, in metres

The hard part is that the plan only exists through the interactive component. We extract a **pure drawing engine** into
the core:

```ts
// packages/core/src/drawing/plan.ts
renderPlan(items: ItemsMap, storeyId: string, opts: {
  showDimensions?: boolean; showRooms?: boolean; hiddenTypes?: Set<string>;
  lineWeights: LineWeights;          // strokes in paper mm, independent of zoom
}): Drawing                          // { bounds, primitives: Path | Text | Fill … } in metres
toSvg(drawing, { scale: 100 }): string   // 1:100 → 1 m = 10 paper mm
```

- `Drawing` = list of simple primitives (polylines, fills, texts, dimension arrows) **in world coordinates**,
  without React or DOM: testable, usable by the MCP server without a browser.
- `Canvas2D` gradually switches to this engine for static drawing (walls, openings, rooms, furniture, dimensions) and
  keeps the interactive layer (selection, handles, tools) for itself. A single source of truth: what is on screen =
  what is printed.
- `SectionView` is adapted to also produce a `Drawing` (it is already in metres).

Rejected alternative: print the screen SVG by resetting `view.scale`. Quick, but it would carry handles and hover
states, and stroke widths would follow the zoom instead of being in paper mm.

## Data model

```ts
interface Sheet {
  id: string; number: string; name: string;          // "A101", "Ground floor plan"
  format: 'A4' | 'A3' | 'A2' | 'A1' | 'A0'; orientation: 'landscape' | 'portrait';
  viewports: SheetViewport[];
  titleBlock: { project?: string; author?: string; date?: string; revision?: string }; // complements ProjectMeta
}
interface SheetViewport {
  id: string; kind: 'plan' | 'section';
  sourceId: string;                // storeyId or free section id
  scale: 20 | 50 | 100 | 200;
  position: [number, number];      // mm on the sheet, centre of the frame
  crop?: { min: [number, number]; max: [number, number] }; // world metres
  title?: string;
}
```

Storage: `sheets.json` in the `.skaitch` (new `formatVersion` + migration in the core) and an equivalent field
in the Firestore document. Sheets do **not** go into IFC (same reasoning as free sections, ADR 0003).

## PDF export

- `jspdf` + `svg2pdf.js` on the client: **vector** PDF, works in the browser and in the Electron renderer,
  without a server. Page format natively in mm.
- Fonts: embed a free sans-serif font (title block text and dimensions) for an identical rendering everywhere;
  check Arabic/RTL and Chinese/Japanese (dedicated font loaded on demand, or limit v1 to Latin and say so).
- Several sheets → one multipage PDF.
- Nearly free bonus: SVG export of a sheet.

## Interface

- New "Sheets" entry in `ViewSelect` / the tree (`TreePane`): list, create, rename, delete.
- Sheet view: white page in the chosen format (stays white in dark mode), movable view frames, choice of
  scale and crop in `PropertiesPane`, editable title block.
- "Export to PDF" in `ProjectActions` (current sheet or all).
- Mobile (`MobileShell`): viewing and export only in v1.

## MCP

New tools in `packages/core/src/mcp-tools.ts`:

- `create_sheet { name, number?, format, orientation }`
- `add_sheet_view { sheet_id, kind, source_id, scale, position?, crop? }` (automatic position if missing: centred)
- `export_sheet_pdf { sheet_id | all }` → PDF file (desktop: local path; web: download / Cloud Storage)
- `capture_view` accepts `sheet_id` so the AI can **see** the sheet and check the layout.

## Work packages

1. **Plan drawing engine** (`core/src/drawing`): walls with poché, openings and leaf swings, rooms (name + area),
   dimensions; scaled `toSvg` with thicknesses in mm. Unit tests on the demo building
   (SVG snapshots). *The largest package.*
2. **Plug `Canvas2D`** into this engine for the static layer; check in the browser that no rendering regresses.
3. **Section**: `SectionView` → `Drawing`.
4. **`Sheet` model** + `.skaitch` persistence (format migration) and Firestore.
5. **Sheet view** + title block + frame editing.
6. **PDF export** (jspdf + svg2pdf.js, fonts, multipage).
7. **MCP tools** + `capture_view` on a sheet.

Packages 1 to 3 already bring value on their own (SVG/PDF export of a scaled plan, without a sheet).

## Progress

- **Package 1** (done): `packages/core/src/drawing` — `renderPlan()`, `toSvg()`, `toSvgGroup()`, `paperSize()`.
- **Package 2** (done for walls, doors and windows): `Canvas2D` draws these elements through the engine
  (`PlanPrimitives.tsx`, theme colours and selection state via `styleOf`). Merged wall joins: outlines
  stroked at double width before all fills. Rooms, stairs, dimensions, furniture and slabs are still drawn
  by `Canvas2D` (own click handlers and labels); to migrate next.
  Accepted visual difference: the real thickness of partitions (previously 75 %) and a single outline instead of the double
  inner/outer line.

- **Package 3** (done): two section sources, one rendering.
  - `renderSection()` (`drawing/section.ts`): building section computed from the model (`buildSection`), without a
    browser, with dimensioned level lines; usable by MCP and sheets. `SectionView` uses it, but this
    component is not mounted anywhere in the app today.
  - `freeSectionDrawing()` (`drawing/freeSection.ts`): the free section actually displayed ("View the section in 2D"),
    computed by the 3D view from the meshes (imported IFC included), becomes a `Drawing`; `FreeSection` shows it
    through `PlanPrimitives`. It requires the 3D scene, hence an open browser, to be exported.
  - Polygons accept holes (`holes`, even-odd) in the SVG as on screen.

- **Package 4** (done): `drawing/sheet.ts`. Difference from the initial plan: no `sheets.json` nor separate Firestore
  field. A sheet is a model element (`type: 'Sheet'`, `ifcType: 'SkaitchSheet'`, child of the project), like
  saved sections: it therefore follows the model everywhere (Firestore via `itemsJson`, `model.json` of the `.skaitch`,
  desktop library, undo/redo, MCP changes) without a format migration or server change.
  IFC export and patch ignore it; the tree's IFC tab hides it. `validateItems` checks it on the server
  (format, scale, views pointing to an existing storey or section, position on the sheet, crop).
  Section views point to a saved section (`Section` element) and will be rendered by `renderSection()`.

- **Package 5** (done): "Sheets" view (`SheetView.tsx`): list, creation, format, title block, movable views.

- **Package 6** (done): `packages/ui/src/lib/sheetPdf.ts`, `sheetsToPdf()`: vector PDF (jspdf + svg2pdf.js, loaded
  on demand), one page per sheet at its exact format, from `renderSheetSvg()`. "Export to PDF" buttons
  (current sheet) and "All sheets (PDF)" in the Sheets view, "Sheets (PDF)" entry in the Export
  menu. Fonts: the PDF's base Helvetica (WinAnsi encoding); Latin scripts work, Arabic,
  Chinese, Japanese and Cyrillic do not print in the PDF yet (embedded font to add). The previous
  "Plan PDF" export (screen capture) remains available.

- **Package 7** (done): MCP tools, computed without a browser (`mcpModel.ts`, `mcpRead.ts`), hence available in the cloud
  as on the desktop. `create_sheet`, `add_sheet_view`, `update_sheet_view` (move, change scale, crop,
  remove) change the model and ask for confirmation like other creations; `export_sheet` (read) lists the
  sheets or returns a sheet's SVG in mm with the position of each frame. Difference from the initial plan: instead of
  `export_sheet_pdf` (PDF requires the browser) and `capture_view` on a sheet, each tool returns
  `layout_issues` (`sheetLayoutIssues`): views that overlap, cover the title block or go beyond the frame.
  The AI thus checks the layout by computation; the PDF is exported from the app.

## Out of v1 scope

Hatching per material, schedules on sheets, custom title block imported from DXF, automatic elevations,
ceiling plans, numbered door/window tags, full hidden-line removal in sections.

## Open questions

1. Scales to offer: are 1:50 and 1:100 enough for v1?
2. Title block: a single skAItch template, or a logo and configurable fields from v1?
3. Non-Latin fonts in the PDF: embed them in v1 or limit the PDF to Latin at first?
4. Web: is the PDF only downloaded, or also stored with the project (Cloud Storage)?
