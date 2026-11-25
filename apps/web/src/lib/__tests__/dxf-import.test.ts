import { describe, expect, it } from 'vitest';
import { aciToHex, decodeDxf, DxfError, parseDxf, plainText } from '@skaitch/core/cad/dxf';
import {
  buildVectorSnapIndex, clipPolyline, initialVectorPlacement, normalizeDxf, snapToVector,
  vectorCompressedBytes, vectorToWorld, worldToVector,
} from '@skaitch/core/cad/vectorPlan';
import { exportToDXF } from '@skaitch/core/bim/exportFormats';

/** Builds an ASCII DXF from group pairs per section. */
function dxf(opts: { header?: (string | number)[]; layers?: (string | number)[][]; blocks?: (string | number)[][]; entities: (string | number)[][] }): string {
  const out: (string | number)[] = [];
  const pairs = (list: (string | number)[]) => out.push(...list);
  if (opts.header) { pairs([0, 'SECTION', 2, 'HEADER']); pairs(opts.header); pairs([0, 'ENDSEC']); }
  if (opts.layers) {
    pairs([0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER']);
    for (const l of opts.layers) pairs([0, 'LAYER', ...l]);
    pairs([0, 'ENDTAB', 0, 'ENDSEC']);
  }
  if (opts.blocks) {
    pairs([0, 'SECTION', 2, 'BLOCKS']);
    for (const b of opts.blocks) pairs(b);
    pairs([0, 'ENDSEC']);
  }
  pairs([0, 'SECTION', 2, 'ENTITIES']);
  for (const e of opts.entities) pairs(e);
  pairs([0, 'ENDSEC', 0, 'EOF']);
  return out.join('\n');
}

const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('parseDxf', () => {
  it('reads lines, the declared unit and layer state', () => {
    const d = parseDxf(dxf({
      header: [9, '$INSUNITS', 70, 6],
      layers: [[2, 'MURS', 70, 0, 62, 1], [2, 'MOBILIER', 70, 1, 62, 3], [2, 'AXES', 70, 0, 62, -5]],
      entities: [
        [0, 'LINE', 8, 'MURS', 10, 0, 20, 0, 11, 4, 21, 0],
        [0, 'LINE', 8, 'MOBILIER', 10, 1, 20, 1, 11, 2, 21, 1],
        [0, 'LINE', 8, 'AXES', 62, 2, 10, 0, 20, 3, 11, 4, 21, 3],
      ],
    }));
    expect(d.unit).toBe('m');
    expect(d.layers).toEqual([
      { name: 'MURS', color: '#ff0000', visible: true },
      { name: 'MOBILIER', color: '#00ff00', visible: false },
      { name: 'AXES', color: '#0000ff', visible: false },
    ]);
    expect(d.polylines[0]).toEqual({ layer: 'MURS', color: '#ff0000', pts: [0, 0, 4, 0] });
    expect(d.polylines[2].color).toBe('#ffff00');
    expect(d.bounds).toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 3 });
  });

  it('leaves the unit undefined when $INSUNITS is unitless', () => {
    expect(parseDxf(dxf({ header: [9, '$INSUNITS', 70, 0], entities: [[0, 'LINE', 10, 0, 20, 0, 11, 1, 21, 0]] })).unit).toBeUndefined();
  });

  it('splits a bulged LWPOLYLINE into an arc through the right side', () => {
    // Semicircle from (0,0) to (2,0) with bulge 1: counter-clockwise, so it passes through (1,-1).
    const d = parseDxf(dxf({ entities: [[0, 'LWPOLYLINE', 90, 2, 70, 0, 10, 0, 20, 0, 42, 1, 10, 2, 20, 0]] }));
    const p = d.polylines[0].pts;
    near(p[0], 0); near(p[1], 0);
    near(p[p.length - 2], 2); near(p[p.length - 1], 0);
    expect(Math.min(...p.filter((_, i) => i % 2 === 1))).toBeCloseTo(-1, 3);
    for (let i = 0; i < p.length; i += 2) near(Math.hypot(p[i] - 1, p[i + 1]), 1, 1e-9);
  });

  it('closes a closed LWPOLYLINE', () => {
    const d = parseDxf(dxf({ entities: [[0, 'LWPOLYLINE', 90, 3, 70, 1, 10, 0, 20, 0, 10, 1, 20, 0, 10, 1, 20, 1]] }));
    expect(d.polylines[0].pts).toEqual([0, 0, 1, 0, 1, 1, 0, 0]);
  });

  it('mirrors arcs whose extrusion is (0, 0, -1)', () => {
    const d = parseDxf(dxf({ entities: [[0, 'ARC', 10, 5, 20, 0, 40, 1, 50, 0, 51, 90, 230, -1]] }));
    const p = d.polylines[0].pts;
    // OCS centre (5,0) maps to world (-5,0); the arc start (6,0) to (-6,0).
    near(p[0], -6); near(p[1], 0);
    expect(d.centers[0]).toEqual({ layer: '0', x: -5, y: 0 });
  });

  it('explodes nested blocks with base point, scale, rotation and BYBLOCK colour', () => {
    const d = parseDxf(dxf({
      layers: [[2, 'PORTES', 62, 4]],
      blocks: [
        [0, 'BLOCK', 2, 'INNER', 10, 0, 20, 0, 0, 'LINE', 8, '0', 62, 0, 10, 0, 20, 0, 11, 1, 21, 0, 0, 'ENDBLK'],
        [0, 'BLOCK', 2, 'OUTER', 10, 1, 20, 1, 0, 'INSERT', 8, '0', 62, 0, 2, 'INNER', 10, 1, 20, 1, 0, 'ENDBLK'],
      ],
      entities: [[0, 'INSERT', 8, 'PORTES', 62, 1, 2, 'OUTER', 10, 10, 20, 0, 41, 2, 42, 2, 50, 90]],
    }));
    const pl = d.polylines[0];
    expect(pl.layer).toBe('PORTES');
    expect(pl.color).toBe('#ff0000');
    // Block-local (0,0)->(1,0), base (1,1) then inner offset (1,1): scale 2, rotate 90°, move to (10,0).
    near(pl.pts[0], 10); near(pl.pts[1], 0);
    near(pl.pts[2], 10); near(pl.pts[3], 2);
  });

  it('repeats MINSERT arrays', () => {
    const d = parseDxf(dxf({
      blocks: [[0, 'BLOCK', 2, 'P', 10, 0, 20, 0, 0, 'LINE', 10, 0, 20, 0, 11, 0.1, 21, 0, 0, 'ENDBLK']],
      entities: [[0, 'INSERT', 2, 'P', 10, 0, 20, 0, 70, 3, 71, 2, 44, 1, 45, 5]],
    }));
    expect(d.polylines).toHaveLength(6);
    expect(d.bounds).toEqual({ minX: 0, minY: 0, maxX: 2.1, maxY: 5 });
  });

  it('draws dimensions through their anonymous block', () => {
    const d = parseDxf(dxf({
      blocks: [[0, 'BLOCK', 2, '*D1', 10, 0, 20, 0, 0, 'LINE', 10, 0, 20, 1, 11, 3, 21, 1, 0, 'MTEXT', 10, 1.5, 20, 1.2, 40, 0.2, 1, '3.00', 0, 'ENDBLK']],
      entities: [[0, 'DIMENSION', 8, 'COTES', 2, '*D1', 10, 0, 20, 1]],
    }));
    expect(d.polylines[0].layer).toBe('COTES');
    expect(d.texts[0]).toMatchObject({ s: '3.00', x: 1.5, y: 1.2, h: 0.2 });
  });

  it('reads texts, MTEXT formatting, and skips paper space and hatches', () => {
    const d = parseDxf(dxf({
      entities: [
        [0, 'TEXT', 8, 'TXT', 10, 1, 20, 2, 40, 0.3, 50, 90, 1, 'S%%dJOUR'],
        [0, 'MTEXT', 8, 'TXT', 10, 0, 20, 0, 40, 0.2, 3, '{\\fArial|b1;Chambre}', 1, '\\P12 m\\U+00B2'],
        [0, 'LINE', 67, 1, 10, 0, 20, 0, 11, 100, 21, 100],
        [0, 'HATCH', 8, 'H', 10, 0, 20, 0],
      ],
    }));
    expect(d.texts.map(t => t.s)).toEqual(['S°JOUR', 'Chambre\n12 m²']);
    expect(d.texts[0].rot).toBeCloseTo(90);
    expect(d.polylines).toHaveLength(0);
  });

  it('evaluates a cubic B-spline through its end control points (clamped)', () => {
    const d = parseDxf(dxf({ entities: [[0, 'SPLINE', 71, 3, 72, 8, 73, 4,
      40, 0, 40, 0, 40, 0, 40, 0, 40, 1, 40, 1, 40, 1, 40, 1,
      10, 0, 20, 0, 10, 1, 20, 2, 10, 2, 20, 2, 10, 3, 20, 0]] }));
    const p = d.polylines[0].pts;
    near(p[0], 0); near(p[1], 0);
    near(p[p.length - 2], 3, 1e-6); near(p[p.length - 1], 0, 1e-6);
    expect(Math.max(...p.filter((_, i) => i % 2 === 1))).toBeCloseTo(1.5, 2);
  });

  it('decodes ANSI_1252 files before AutoCAD 2007', () => {
    const text = dxf({ header: [9, '$ACADVER', 1, 'AC1015', 9, '$DWGCODEPAGE', 3, 'ANSI_1252'], entities: [[0, 'TEXT', 10, 0, 20, 0, 40, 1, 1, 'Entrée']] });
    const bytes = Uint8Array.from(text, c => c.charCodeAt(0));
    expect(decodeDxf(bytes)).toContain('Entrée');
    expect(parseDxf(bytes).texts[0].s).toBe('Entrée');
  });

  it('refuses binary DXF', () => {
    expect(() => parseDxf(new TextEncoder().encode('AutoCAD Binary DXF\r\n\x1a\0'))).toThrow(DxfError);
  });

  it('reads back the app own DXF export', () => {
    const items = {
      w1: { id: 'w1', type: 'Wall', ifcType: 'IfcWall', name: 'W', storeyId: 's', geom: { x1: 0, y1: 0, x2: 5, y2: 0, thickness: 0.2, height: 2.8 } },
    } as any;
    const d = parseDxf(exportToDXF(items, 'Test'));
    expect(d.polylines.length).toBeGreaterThan(0);
  });

  it('maps ACI colours', () => {
    expect(aciToHex(1)).toBe('#ff0000');
    expect(aciToHex(10)).toBe('#ff0000');
    expect(aciToHex(250)).toBe('#333333');
    expect(plainText('A\\~B')).toBe('A B');
  });
});

describe('normalizeDxf', () => {
  const drawing = parseDxf(dxf({
    header: [9, '$INSUNITS', 70, 4],
    entities: [
      [0, 'LINE', 8, 'A', 10, 700000, 20, 6600000, 11, 704000, 21, 6600000],
      [0, 'LINE', 8, 'A', 10, 720000, 20, 6600000, 11, 724000, 21, 6600000],
      [0, 'TEXT', 8, 'B', 10, 701000, 20, 6601000, 40, 300, 1, 'Séjour'],
      [0, 'CIRCLE', 8, 'A', 10, 702000, 20, 6602000, 40, 500],
    ],
  }));

  it('recentres on the extent, keeps the origin offset in metres and quantizes to mm', () => {
    const v = normalizeDxf(drawing, { unit: 'mm' });
    expect(v.origin).toEqual([700, 6600]);
    expect(v.w).toBe(24000);
    expect(v.paths[0].p).toEqual([0, 0, 4000, 0]);
    expect(v.texts[0]).toMatchObject({ x: 1000, y: 1000, h: 300, s: 'Séjour' });
    expect(v.layers.map(l => l.name)).toEqual(['A', 'B']);
  });

  it('applies the chosen unit', () => {
    const v = normalizeDxf(drawing, { unit: 'cm' });
    expect(v.paths[0].p).toEqual([0, 0, 40000, 0]);
    expect(v.origin).toEqual([7000, 66000]);
  });

  it('crops at import, clipping lines at the border', () => {
    const v = normalizeDxf(drawing, { unit: 'mm', crop: { minX: 702000, minY: 6599000, maxX: 710000, maxY: 6605000 } });
    expect(v.origin).toEqual([702, 6600]);
    expect(v.paths.some(p => p.p[0] === 0 && p.p[2] === 2000)).toBe(true);
    expect(v.texts).toHaveLength(0);
    expect(v.paths.every(p => p.p.every(n => n >= 0))).toBe(true);
  });

  it('reuses a given origin offset', () => {
    const v = normalizeDxf(drawing, { unit: 'mm', origin: [699, 6599] });
    expect(v.paths[0].p).toEqual([1000, 1000, 5000, 1000]);
  });

  it('stays small once compressed', () => {
    expect(vectorCompressedBytes(normalizeDxf(drawing, { unit: 'mm' }))).toBeLessThan(2000);
  });
});

describe('clipPolyline', () => {
  it('splits a polyline leaving and re-entering the rectangle', () => {
    const pieces = clipPolyline([0, 0, 10, 0, 10, 2, 0, 2], { minX: 2, minY: -1, maxX: 8, maxY: 3 });
    expect(pieces).toEqual([[2, 0, 8, 0], [8, 2, 2, 2]]);
  });
});

describe('placement and snapping', () => {
  const v = normalizeDxf(parseDxf(dxf({
    entities: [
      [0, 'LWPOLYLINE', 90, 4, 70, 1, 10, 0, 20, 0, 10, 4000, 20, 0, 10, 4000, 20, 3000, 10, 0, 20, 3000],
      [0, 'CIRCLE', 10, 2000, 20, 1500, 40, 400],
    ],
  })), { unit: 'mm' });

  it('places local millimetres in world metres and back', () => {
    const plan = { ...initialVectorPlacement(v, 2048), x: 10, y: 5 };
    expect(plan.w).toBe(2048);
    const [x, y] = vectorToWorld(plan, v, 4000, 3000);
    near(x, 14); near(y, 8);
    const [lx, ly] = worldToVector(plan, v, x, y);
    near(lx, 4000); near(ly, 3000);
  });

  it('snaps to corners, midpoints, centres, then the nearest point on a line', () => {
    const index = buildVectorSnapIndex(v);
    expect(snapToVector(index, 3990, 20, 50)).toEqual({ x: 4000, y: 0, kind: 'endpoint' });
    expect(snapToVector(index, 2010, 3010, 50)).toEqual({ x: 2000, y: 3000, kind: 'midpoint' });
    expect(snapToVector(index, 2010, 1510, 50)).toEqual({ x: 2000, y: 1500, kind: 'center' });
    expect(snapToVector(index, 1000, 30, 50)).toMatchObject({ x: 1000, y: 0, kind: 'nearest' });
    expect(snapToVector(index, 1000, 800, 50)).toBeNull();
  });

  it('ignores hidden layers', () => {
    const hidden = { ...v, layers: v.layers.map(l => ({ ...l, visible: false })) };
    expect(snapToVector(buildVectorSnapIndex(hidden), 3990, 20, 50)).toBeNull();
  });
});

describe('get_background_geometry', () => {
  it('returns world metres for visible layers, filtered by bbox', async () => {
    const { readMcpModel } = await import('@skaitch/core/bim/mcpRead');
    const vector = normalizeDxf(parseDxf(dxf({
      layers: [[2, 'MURS', 62, 1], [2, 'MOB', 62, 3, 70, 1]],
      entities: [
        [0, 'LINE', 8, 'MURS', 10, 0, 20, 0, 11, 4000, 21, 0],
        [0, 'LINE', 8, 'MURS', 10, 0, 20, 3000, 11, 4000, 21, 3000],
        [0, 'LINE', 8, 'MOB', 10, 100, 20, 100, 11, 200, 21, 100],
        [0, 'TEXT', 8, 'MURS', 10, 1000, 20, 1000, 40, 250, 1, 'Séjour'],
      ],
    })), { unit: 'mm' });
    const plan = { ...initialVectorPlacement(vector, 2048), x: 10, y: 20, kind: 'vector', vector, url: 'data:image/png;base64,', opacity: 0.5 };
    const items = { s1: { id: 's1', type: 'Storey', name: 'RDC', geom: { level: 0, elevation: 0, thickness: 0.2, plan } } } as any;
    const all = readMcpModel('get_background_geometry', { storey_id: 's1' }, items, []) as any;
    expect(all.layers.map((l: any) => l.name)).toEqual(['MURS']);
    expect(all.layers[0].polylines[0]).toEqual([[10, 20], [14, 20]]);
    expect(all.layers[0].texts[0]).toEqual({ x: 11, y: 21, height: 0.25, rotation: 0, text: 'Séjour' });
    const below = readMcpModel('get_background_geometry', { storey_id: 's1', bbox: [9, 19, 15, 21], layers: ['MURS', 'MOB'] }, items, []) as any;
    expect(below.layers.find((l: any) => l.name === 'MURS').polylines).toHaveLength(1);
    expect(below.layers.find((l: any) => l.name === 'MOB').polylines).toHaveLength(1);
    const floor = readMcpModel('get_storey_floorplan', { storey_id: 's1' }, items, []) as any;
    expect(floor.plan.kind).toBe('vector');
  });
});

describe('plan alignment', () => {
  it('translates an image or vector plan so the picked point lands on the target', async () => {
    const { alignBackgroundPlan, storeyAlignmentPoints } = await import('@skaitch/ui/lib/translateStorey');
    const plan = { x: 1, y: 2, w: 100, h: 50, scale: 0.01, calibrationPoints: [[1, 2], [2, 2]] as [number, number][] };
    expect(alignBackgroundPlan(plan, [1.5, 2.5], [10, 20])).toMatchObject({ x: 9.5, y: 19.5, calibrationPoints: [[9.5, 19.5], [10.5, 19.5]] });
    const items = { w: { id: 'w', type: 'Wall', parentId: 's0', geom: { x1: 0, y1: 0, x2: 4, y2: 0 } } } as any;
    expect(storeyAlignmentPoints(items, 's0')).toEqual([[0, 0], [4, 0]]);
  });
});
