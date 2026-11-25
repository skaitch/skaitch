import { describe, expect, it } from 'vitest';
import type { ItemsMap } from '@skaitch/core/types/ifc';
import { exportIFC } from '@skaitch/core/bim/exportIFC';
import {
  connectedWallEndpoints,
  findWallJunctions,
  normalizeWallContinuity,
  wallGeomWithEndpoint,
} from '@skaitch/core/lib/wallContinuity';

function walls(): ItemsMap {
  return {
    a: {
      id: 'a', GlobalId: 'wall-a', type: 'Wall', ifcType: 'IfcWall',
      name: 'A', Name: 'A', parentId: 'storey',
      geom: { x1: 0, y1: 0, x2: 5, y2: 0, thickness: 0.2, height: 2.7 },
    },
    b: {
      id: 'b', GlobalId: 'wall-b', type: 'Wall', ifcType: 'IfcWall',
      name: 'B', Name: 'B', parentId: 'storey',
      geom: { x1: 5.03, y1: 0.02, x2: 5, y2: 4, thickness: 0.2, height: 2.7 },
    },
  } as ItemsMap;
}

describe('wall continuity', () => {
  it('groups connected endpoints and moves a connected endpoint', () => {
    const items = walls();
    const connected = connectedWallEndpoints(items, 'a', 'end');

    expect(connected.map((endpoint) => `${endpoint.wallId}:${endpoint.end}`).sort())
      .toEqual(['a:end', 'b:start']);

    const moved = wallGeomWithEndpoint((items.b as any).geom, 'start', [6, 1]);
    expect([moved.x1, moved.y1]).toEqual([6, 1]);
    expect([moved.x2, moved.y2]).toEqual([5, 4]);
  });

  it('normalizes small IFC endpoint drift to one shared node', () => {
    const items = walls();
    normalizeWallContinuity(items);

    const a = (items.a as any).geom;
    const b = (items.b as any).geom;
    expect([a.x2, a.y2]).toEqual([b.x1, b.y1]);
    expect(findWallJunctions(items)).toHaveLength(1);
  });

  it('exports connected walls as IfcRelConnectsPathElements', () => {
    const output = exportIFC(walls());

    expect(output).toContain('IFCRELCONNECTSPATHELEMENTS');
    expect(output).toContain('.ATSTART.');
    expect(output).toContain('.ATEND.');
  });
});
