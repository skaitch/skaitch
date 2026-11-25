import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildFurnitureModel } from '@skaitch/core/geometry/furniture3d';

const furniture = (model: string, w: number, d: number, h: number) => ({
  type: 'Furniture', category: 'Meubles', model,
  geom: { x: 0, y: 0, w, d, h, rotation: 0 },
}) as any;

const cylinders = (group: THREE.Group) => {
  let count = 0;
  group.traverse(o => { if (o instanceof THREE.Mesh && o.geometry instanceof THREE.CylinderGeometry) count++; });
  return count;
};

describe('furniture 3D models', () => {
  it('builds dining and coffee tables as a top on four legs, not as a sofa', () => {
    expect(cylinders(buildFurnitureModel(furniture('meuble-table-manger', 1.6, 0.9, 0.75)))).toBe(4);
    expect(cylinders(buildFurnitureModel(furniture('meuble-table-basse', 1, 0.6, 0.4)))).toBe(4);
  });

  it('keeps the sofa shape for a sofa', () => {
    expect(cylinders(buildFurnitureModel(furniture('meuble-canape', 2, 0.9, 0.8)))).toBe(0);
  });
});
