import { describe, expect, it } from 'vitest';
import { buildStarter } from '@skaitch/core/data/starter';
import { renderPlan, toSvg, paperSize, type Primitive } from '@skaitch/core/drawing/index';
import type { ItemsMap } from '@skaitch/core/types/ifc';

const storey = 'sty_A0';
const byId = (prims: Primitive[], id: string) => prims.filter((p) => p.id === id);

/** One 4 m wall along x with a single 1 m door at its middle, side = 1 (left-hand normal, +y). */
function oneDoor(extra: Record<string, unknown> = {}): ItemsMap {
  return {
    st: { id: 'st', type: 'Storey', ifcType: 'IfcBuildingStorey', parentId: null, geom: { elevation: 0 } } as any,
    w: { id: 'w', type: 'Wall', ifcType: 'IfcWall', parentId: 'st', geom: { x1: 0, y1: 0, x2: 4, y2: 0, thickness: 0.2, height: 2.5 } } as any,
    d: { id: 'd', type: 'Door', ifcType: 'IfcDoor', parentId: 'st', OperationType: 'SINGLE_SWING_LEFT',
      geom: { wallId: 'w', t: 0.5, width: 1, height: 2.1, swing: 'left', side: 1 }, ...extra } as any,
  };
}

describe('plan drawing', () => {
  it('draws the demo storey in world metres', () => {
    const items = buildStarter();
    const d = renderPlan(items, storey);
    expect(d.bounds.minX).toBeLessThan(0.01);
    expect(d.bounds.maxX).toBeGreaterThan(11.99);
    expect(d.bounds.maxY).toBeGreaterThan(7.99);
    const rooms = Object.values(items).filter((i) => i.type === 'Room' && i.parentId === storey);
    for (const r of rooms) expect(byId(d.primitives, r.id).some((p) => p.kind === 'text' && p.text === r.name)).toBe(true);
    // Only this storey's walls.
    const otherWalls = Object.values(items).filter((i) => i.type === 'Wall' && i.parentId !== storey).map((w) => w.id);
    expect(d.primitives.some((p) => p.id && otherWalls.includes(p.id))).toBe(false);
  });

  it('cuts the wall at a door and swings the leaf to its side', () => {
    const d = renderPlan(oneDoor(), 'st');
    const wall = byId(d.primitives, 'w').filter((p) => p.kind === 'polygon' && p.fill !== 'none');
    expect(wall).toHaveLength(2);
    const xs = wall.map((p) => (p as any).points.map((q: number[]) => q[0]));
    expect(Math.max(...xs[0])).toBeCloseTo(1.5);
    expect(Math.min(...xs[1])).toBeCloseTo(2.5);
    // Leaf: hinge at the left jamb (x = 1.5), open towards +y by the full width.
    const lines = byId(d.primitives, 'd').filter((p) => p.kind === 'polyline') as Extract<Primitive, { kind: 'polyline' }>[];
    const leaf = lines.find((l) => l.points.length === 2 && Math.abs(l.points[1][1] - 1) < 1e-9);
    expect(leaf?.points[0]).toEqual([1.5, 0]);
    const arc = lines.find((l) => l.points.length > 2)!;
    expect(arc.points[0][0]).toBeCloseTo(2.5);
    expect(arc.points[arc.points.length - 1][0]).toBeCloseTo(1.5);
    expect(arc.points[arc.points.length - 1][1]).toBeCloseTo(1);
    for (const p of arc.points) expect(Math.hypot(p[0] - 1.5, p[1])).toBeCloseTo(1);
  });

  it('swings to the other side and hinge when asked', () => {
    const d = renderPlan(oneDoor({ OperationType: 'SINGLE_SWING_RIGHT', geom: { wallId: 'w', t: 0.5, width: 1, height: 2.1, swing: 'right', side: -1 } }), 'st');
    const arc = byId(d.primitives, 'd').find((p) => p.kind === 'polyline' && p.points.length > 2) as any;
    expect(arc.points[arc.points.length - 1][0]).toBeCloseTo(2.5);
    expect(arc.points[arc.points.length - 1][1]).toBeCloseTo(-1);
  });

  it('honours hidden types', () => {
    const d = renderPlan(oneDoor(), 'st', { hiddenTypes: new Set(['Door']) });
    expect(byId(d.primitives, 'd')).toHaveLength(0);
    expect(byId(d.primitives, 'w').filter((p) => p.kind === 'polygon' && p.fill !== 'none')).toHaveLength(1);
  });

  it('writes an SVG at paper scale', () => {
    const d = renderPlan(oneDoor(), 'st', { showDimensions: false });
    const size = paperSize(d, { scale: 100 });
    expect(size.width).toBeCloseTo(40); // 4 m at 1:100 = 40 mm
    const svg = toSvg(d, { scale: 50, margin: 5 });
    expect(svg).toMatch(/^<svg [^>]*width="90mm"/); // 4 m at 1:50 = 80 mm + 2 × 5 mm
    expect(svg).toContain('stroke-width="1"'); // wall outline at twice the 0.5 mm cut weight
    expect(svg).not.toContain('NaN');
  });

  it('labels dimensions with a decimal comma and escapes text', () => {
    const items = oneDoor();
    items.dim = { id: 'dim', type: 'Dimension', ifcType: 'IfcAnnotation', parentId: 'st', geom: { x1: 0, y1: -1, x2: 4, y2: -1 } } as any;
    items.r = { id: 'r', type: 'Room', ifcType: 'IfcSpace', parentId: 'st', name: 'Salle <A> & B', geom: { polygon: [[0, 0], [4, 0], [4, 3], [0, 3]], height: 2.5 } } as any;
    const svg = toSvg(renderPlan(items, 'st'), { scale: 100 });
    expect(svg).toContain('>4,00<');
    expect(svg).toContain('>12,00 m²<');
    expect(svg).toContain('Salle &lt;A&gt; &amp; B');
  });
});

describe('plan drawing joints and options', () => {
  it('draws every wall outline before any wall fill, so joints merge', () => {
    const d = renderPlan(buildStarter(), storey);
    const walls = d.primitives.filter((p) => p.layer === 'wall');
    const lastOutline = walls.map((p) => p.kind === 'polygon' && p.fill === 'none').lastIndexOf(true);
    const firstFill = walls.findIndex((p) => p.kind === 'polygon' && p.fill !== 'none');
    expect(lastOutline).toBeLessThan(firstFill);
    // Openings come after the poché, so they are never hidden by it.
    const lastWall = d.primitives.lastIndexOf(walls[walls.length - 1]);
    expect(d.primitives.findIndex((p) => p.layer === 'opening')).toBeGreaterThan(lastWall);
  });

  it('draws window swings only when asked', () => {
    const items = oneDoor();
    items.wn = { id: 'wn', type: 'Window', ifcType: 'IfcWindow', parentId: 'st', geom: { wallId: 'w', t: 0.15, width: 0.8, height: 1, sillHeight: 1, side: 1 } } as any;
    const arcs = (o: object) => renderPlan(items, 'st', o).primitives.filter((p) => p.id === 'wn' && p.kind === 'polyline' && p.points.length > 2);
    expect(arcs({})).toHaveLength(0);
    expect(arcs({ windowSwings: true })).toHaveLength(1);
  });

  it('lets the caller choose which walls to skip', () => {
    const items = oneDoor();
    expect(renderPlan(items, 'st', { skipWall: (w) => w.id === 'w' }).primitives.some((p) => p.id === 'w')).toBe(false);
  });
});

describe('section drawing', () => {
  const scene = (): ItemsMap => ({
    st: { id: 'st', type: 'Storey', ifcType: 'IfcBuildingStorey', name: 'RDC', parentId: null, geom: { elevation: 0 } } as any,
    up: { id: 'up', type: 'Storey', ifcType: 'IfcBuildingStorey', name: 'R+1', parentId: null, geom: { elevation: 2.8 } } as any,
    w: { id: 'w', type: 'Wall', ifcType: 'IfcWall', parentId: 'st', geom: { x1: 0, y1: 0, x2: 5, y2: 0, thickness: 0.2, height: 2.5 } } as any,
    d: { id: 'd', type: 'Door', ifcType: 'IfcDoor', parentId: 'st', geom: { wallId: 'w', t: 0.5, width: 1, height: 2 } } as any,
  });
  const along = { x1: 0, y1: 0, x2: 5, y2: 0 };

  it('cuts walls in poché around their openings, outlines before fills', async () => {
    const { renderSection } = await import('@skaitch/core/drawing/index');
    const d = renderSection(scene(), along);
    const wall = d.primitives.filter((p) => p.id === 'w');
    expect(wall.filter((p) => p.kind === 'polygon' && p.fill !== 'none')).toHaveLength(3); // left, right, lintel
    const firstFill = wall.findIndex((p) => p.kind === 'polygon' && p.fill !== 'none');
    expect(wall.slice(0, firstFill).every((p) => p.kind === 'polygon' && p.fill === 'none')).toBe(true);
    expect(d.bounds.maxY).toBeGreaterThanOrEqual(2.8);
  });

  it('labels every storey level with its signed elevation', async () => {
    const { renderSection } = await import('@skaitch/core/drawing/index');
    const texts = renderSection(scene(), along).primitives.filter((p) => p.kind === 'text').map((p) => (p as any).text);
    expect(texts).toEqual(expect.arrayContaining(['RDC · +0,00 m', 'R+1 · +2,80 m']));
  });

  it('draws nothing when the cut misses the model', async () => {
    const { renderSection } = await import('@skaitch/core/drawing/index');
    expect(renderSection(scene(), { x1: 0, y1: 10, x2: 5, y2: 10 }).primitives).toHaveLength(0);
  });

  it('prints at scale like the plan', async () => {
    const { renderSection } = await import('@skaitch/core/drawing/index');
    const svg = toSvg(renderSection(scene(), along, { showLevels: false }), { scale: 50 });
    expect(svg).toMatch(/width="100mm"/); // 5 m at 1:50
    expect(svg).not.toContain('NaN');
  });
});

describe('free section drawing', () => {
  it('keeps holes in cut solids and draws edges beyond under the poché', async () => {
    const { freeSectionDrawing } = await import('@skaitch/core/drawing/index');
    const d = freeSectionDrawing({
      fills: [{ outer: [[0, 0], [4, 0], [4, 3], [0, 3]], holes: [[[1, 0.5], [2, 0.5], [2, 2], [1, 2]]] }],
      cut: [[[0, 0], [4, 0]]],
      background: [[[5, 0], [5, 3]]],
    });
    expect(d.primitives.map((p) => p.layer)).toEqual(['beyond', 'cut', 'cut']);
    expect(d.bounds).toEqual({ minX: 0, minY: 0, maxX: 5, maxY: 3 });
    const svg = toSvg(d, { scale: 100 });
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toMatch(/d="M0,30 L40,30 L40,0 L0,0 Z M10,25 L20,25 L20,10 L10,10 Z"/);
  });
});

describe('wall junctions', () => {
  it('paints partitions before exterior walls so a partition never shows inside an exterior wall', () => {
    const items = buildStarter();
    const walls = Object.values(items).filter((i) => i.type === 'Wall');
    const exterior = walls.find((w: any) => w.isExternal || w.IsExternal || w.geom?.isExternal)!;
    const partition = walls.find((w) => w !== exterior)!;
    for (const w of walls) for (const k of ['isExternal', 'IsExternal']) delete (w as any)[k], (w as any).geom && delete (w as any).geom.isExternal;
    (exterior as any).isExternal = true;
    const fills = renderPlan(items, exterior.parentId!).primitives
      .filter((p): p is Extract<Primitive, { kind: 'polygon' }> => p.kind === 'polygon' && p.layer === 'wall' && p.fill !== 'none');
    const lastPartition = fills.map((f) => f.id).lastIndexOf(partition.id);
    const firstExterior = fills.map((f) => f.id).indexOf(exterior.id);
    expect(lastPartition).toBeGreaterThanOrEqual(0);
    expect(firstExterior).toBeGreaterThan(lastPartition);
  });
});
