import { describe, expect, it } from 'vitest';
import { buildElementPatch } from '@skaitch/core/lib/mcpElementUpdate';
import type { IfcEntity } from '@skaitch/core/types/ifc';

const furniture = { id: 'f', type: 'Furniture', ifcType: 'IfcFurnishingElement', GlobalId: 'g', name: 'Chair', Name: 'Chair', parentId: 's', category: 'Office', model: 'chair', geom: { x: 1, y: 2, w: 1, d: 1, h: 1, rotation: 0 } } as IfcEntity;

describe('MCP element updates', () => {
  it('merges partial furniture geometry and keeps names synchronized', () => {
    expect(buildElementPatch(furniture, { name: 'Desk', model: 'desk' }, { x: 4, rotation: Math.PI })).toEqual({ name: 'Desk', Name: 'Desk', model: 'desk', geom: { x: 4, y: 2, w: 1, d: 1, h: 1, rotation: Math.PI, _edited: true } });
    expect((furniture as any).geom.x).toBe(1);
  });
  it('rejects invalid values, identity changes and unsupported geometry', () => {
    expect(() => buildElementPatch(furniture, { id: 'other' }, {})).toThrow();
    expect(() => buildElementPatch(furniture, {}, { w: -1 })).toThrow();
    expect(() => buildElementPatch(furniture, {}, { polygon: [] })).toThrow();
  });
  it('validates polygons before accepting a room update', () => {
    const room = { ...furniture, type: 'Room', geom: { polygon: [[0, 0], [1, 0], [0, 1]], height: 2.5 } } as unknown as IfcEntity;
    expect(() => buildElementPatch(room, {}, { polygon: [[0, 0], [1, 0]] })).toThrow();
    expect((buildElementPatch(room, { function: 'OFFICE' }, { height: 3 }).geom as any).height).toBe(3);
  });
  it('accepts the fire safety discipline and rejects unknown disciplines', () => {
    const technical = { ...furniture, type: 'Technical', discipline: 'fire' } as unknown as IfcEntity;
    expect(buildElementPatch(technical, { discipline: 'fire' }, {})).toEqual({ discipline: 'fire' });
    expect(() => buildElementPatch(technical, { discipline: 'unknown' }, {})).toThrow('Invalid discipline.');
  });
});
