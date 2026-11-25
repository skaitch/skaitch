import { describe, it, expect } from 'vitest';
import { translateStorey } from '@skaitch/ui/lib/translateStorey';
import { proposeOpening, STAIR_DEFAULTS, validateStairOpenings } from '@skaitch/core/lib/stairGeometry';
import { exportIFC } from '@skaitch/core/bim/exportIFC';
import type { ItemsMap } from '@skaitch/core/types/ifc';

const base: ItemsMap = {
  p: { id: 'p', GlobalId: 'P000000000000000000001', type: 'Project', ifcType: 'IfcProject', name: 'P', Name: 'P', parentId: null } as any,
  b: { id: 'b', GlobalId: 'B000000000000000000001', type: 'Building', ifcType: 'IfcBuilding', name: 'B', Name: 'B', parentId: 'p' } as any,
  s: { id: 's', GlobalId: 'S000000000000000000001', type: 'Storey', ifcType: 'IfcBuildingStorey', name: 'RDC', Name: 'RDC', parentId: 'b', geom: { elevation: 0, level: 0, thickness: .2, plan: { url: 'x', w: 10, h: 10, opacity: .5, scale: .05, x: 1, y: 2, calibrationPoints: [[0, 0], [1, 1]] } } } as any,
  t: { id: 't', GlobalId: 'T000000000000000000001', type: 'Storey', ifcType: 'IfcBuildingStorey', name: 'Étage', Name: 'Étage', parentId: 'b', geom: { elevation: 3, level: 1, thickness: .2 } } as any,
  slab: { id: 'slab', GlobalId: 'L000000000000000000001', type: 'Slab', ifcType: 'IfcSlab', name: 'Dalle', Name: 'Dalle', parentId: 't', geom: { polygon: [[-5, -5], [15, -5], [15, 15], [-5, 15]], thickness: .2 } } as any,
  w: { id: 'w', GlobalId: 'W000000000000000000001', type: 'Wall', ifcType: 'IfcWall', name: 'Mur', Name: 'Mur', parentId: 's', geom: { x1: 0, y1: 0, x2: 4, y2: 0, thickness: .2, height: 2.7 } } as any,
  d: { id: 'd', GlobalId: 'D000000000000000000001', type: 'Door', ifcType: 'IfcDoor', name: 'Porte', Name: 'Porte', parentId: 's', geom: { wallId: 'w', t: .5, width: .9, height: 2.1, swing: 'left', side: 1, _placementWorld: [2, 0] } } as any,
  dim: { id: 'dim', GlobalId: 'M000000000000000000001', type: 'Dimension', ifcType: 'IfcAnnotation', name: 'Cote', Name: 'Cote', parentId: 's', geom: { x1: 0, y1: 1, x2: 4, y2: 1 } } as any,
  cut: { id: 'cut', GlobalId: 'C000000000000000000001', type: 'Section', ifcType: 'IfcAnnotation', name: 'Coupe', Name: 'Coupe', parentId: 's', geom: { x1: -1, y1: 2, x2: 6, y2: 2 } } as any,
};
const g = { ...STAIR_DEFAULTS, targetId: 't', railLeft: false, railRight: false };
const withStair = (): ItemsMap => ({ ...base, st: { id: 'st', GlobalId: 'A000000000000000000001', type: 'Stair', ifcType: 'IfcStair', name: 'Escalier', Name: 'Escalier', parentId: 's', geom: { ...g, opening: proposeOpening(g, 's', base)! } } as any });

describe('translateStorey', () => {
  it('moves the storey contents and background plan, leaves other storeys and sections alone', () => {
    const { items, warnings } = translateStorey(base, 's', 1, -2);
    expect(warnings).toEqual([]);
    expect((items.w as any).geom).toMatchObject({ x1: 1, y1: -2, x2: 5, y2: -2, _edited: true });
    expect((items.w as any).geom._shapeEdited).toBeUndefined();
    expect((items.d as any).geom).toMatchObject({ wallId: 'w', t: .5, _placementWorld: [3, -2] });
    expect((items.dim as any).geom).toMatchObject({ x1: 1, y1: -1, x2: 5, y2: -1 });
    expect((items.s as any).geom.plan).toMatchObject({ x: 2, y: 0, calibrationPoints: [[1, -2], [2, -1]] });
    expect(items.cut).toBe(base.cut);
    expect(items.slab).toBe(base.slab);
    expect(items.t).toBe(base.t);
    expect((base.w as any).geom).toMatchObject({ x1: 0, y1: 0 });
  });

  it('rejects invalid input and treats a zero offset as no change', () => {
    expect(() => translateStorey(base, 'w', 1, 1)).toThrow();
    expect(() => translateStorey(base, 's', NaN, 1)).toThrow();
    expect(translateStorey(base, 's', 0, 0).items).toBe(base);
  });

  it('moves the trémie with its slab when the arrival storey moves', () => {
    const before = withStair();
    const { items, warnings } = translateStorey(before, 't', 3, 1);
    const o0 = (before.st as any).geom.opening, o1 = (items.st as any).geom.opening;
    expect(o1).toMatchObject({ slabId: 'slab', x: o0.x + 3, y: o0.y + 1, width: o0.width, depth: o0.depth });
    expect((items.st as any).geom.x).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(() => validateStairOpenings(items)).not.toThrow();
    const ifc = exportIFC(items);
    expect(ifc).toMatch(/IFCSTAIR\(/);
  });

  it('keeps the trémie in its slab when the departure storey moves, with a warning', () => {
    const before = withStair();
    const { items, warnings } = translateStorey(before, 's', 3, 1);
    expect((items.st as any).geom.opening).toEqual((before.st as any).geom.opening);
    expect((items.st as any).geom).toMatchObject({ x: 3, y: 1 });
    expect(warnings[0]).toContain('trémie');
    expect(() => exportIFC(items)).not.toThrow();
  });

  it('realigns stair and trémie when both storeys get the same offset', () => {
    const first = translateStorey(withStair(), 's', 3, 1).items;
    const { items, warnings } = translateStorey(first, 't', 3, 1);
    expect(warnings).toHaveLength(1);
    const st = (items.st as any).geom, o0 = (withStair().st as any).geom.opening;
    expect(st.opening.x - o0.x).toBe(3);
    expect(st.x).toBe(3);
  });
});

describe('IFC edit flags', () => {
  it('marks size and contour edits as shape edits, moves as placement edits', async () => {
    const { markGeomEdit } = await import('@skaitch/core/lib/geomEdit');
    const { buildElementPatch } = await import('@skaitch/core/lib/mcpElementUpdate');
    expect(markGeomEdit({ x: 0 }, ['x'])).toEqual({ x: 0, _edited: true });
    expect((markGeomEdit({ height: 2 }, ['height']) as any)._shapeEdited).toBe(true);
    const room = { id: 'r', type: 'Room', geom: { polygon: [[0, 0], [1, 0], [1, 1]], height: 2.5 } } as any;
    expect((buildElementPatch(room, undefined, { height: 3 }).geom as any)._shapeEdited).toBe(true);
    expect((buildElementPatch(room, undefined, { polygon: [[0, 0], [2, 0], [2, 2]] }).geom as any)._shapeEdited).toBe(true);
  });
});

describe('storeyAlignmentOffset', () => {
  it('lines up the lower-left wall corner (or centre) with the storey below', async () => {
    const { storeyAlignmentOffset, defaultAlignmentReference } = await import('@skaitch/ui/lib/translateStorey');
    const wall = (id: string, parentId: string, x1: number, y1: number, x2: number, y2: number) =>
      ({ id, GlobalId: id, type: 'Wall', ifcType: 'IfcWall', name: id, Name: id, parentId, geom: { x1, y1, x2, y2, thickness: .3, height: 3 } } as any);
    const model: ItemsMap = {
      ...base,
      w: wall('w', 's', 1.33, 0.56, 15.63, 0.56), w2: wall('w2', 's', 1.33, 0.56, 1.33, 5.24),
      u1: wall('u1', 't', 1.31, 0.34, 15.71, 0.34), u2: wall('u2', 't', 1.31, 0.34, 1.31, 5.03),
    };
    expect(defaultAlignmentReference(model, 't')).toBe('s');
    expect(defaultAlignmentReference(model, 's')).toBe('t');
    expect(storeyAlignmentOffset(model, 't', 's')).toEqual([0.02, 0.22]);
    const [cx, cy] = storeyAlignmentOffset(model, 't', 's', 'center');
    expect(cx).toBeCloseTo(-0.03, 3);
    expect(cy).toBeCloseTo(0.215, 3);
    const moved = translateStorey(model, 't', 0.02, 0.22).items;
    expect(storeyAlignmentOffset(moved, 't', 's')).toEqual([0, 0]);
  });
});
