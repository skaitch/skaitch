import { Box3, Group, Vector3 } from 'three';
import type { ItemsMap } from '@skaitch/core/types/ifc';

/** Children use floor-relative heights; their parent supplies the storey altitude once. */
export function createStoreyGroup(items: ItemsMap, parentId: string | null): Group {
  const group = new Group();
  const storey = items[parentId ?? ''];
  if (storey?.type === 'Storey') group.position.y = storey.geom.elevation;
  return group;
}

export function isItemInStoreyScope(item: ItemsMap[string], storeyId: string, allStoreys: boolean): boolean {
  return allStoreys || (item.type === 'Storey' ? item.id === storeyId : item.parentId === storeyId);
}

/** Frame editable walls from their geometry, including drafts absent from the IFC fragments. */
export function selectedWallBounds(items: ItemsMap, selection: string[]): Box3 {
  const box = new Box3();
  for (const id of selection) {
    const wall = items[id];
    if (wall?.type !== 'Wall') continue;
    const g = wall.geom;
    const parent = items[wall.parentId ?? ''];
    const elevation = parent?.type === 'Storey' ? parent.geom.elevation : 0;
    if (![g.x1, g.y1, g.x2, g.y2, g.height, g.thickness, elevation].every(Number.isFinite)) continue;
    const half = g.thickness / 2;
    box.expandByPoint(new Vector3(Math.min(g.x1, g.x2) - half, elevation, -Math.max(g.y1, g.y2) - half));
    box.expandByPoint(new Vector3(Math.max(g.x1, g.x2) + half, elevation + g.height, -Math.min(g.y1, g.y2) + half));
  }
  return box;
}
