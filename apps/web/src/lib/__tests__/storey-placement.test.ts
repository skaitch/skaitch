import { selectedWallBounds } from '@skaitch/ui/lib/storeyPlacement';
import { expect, it } from 'vitest';
import { Mesh, BoxGeometry, MeshBasicMaterial, Vector3 } from 'three';
import { createStoreyGroup, isItemInStoreyScope } from '@skaitch/ui/lib/storeyPlacement';
import type { ItemsMap } from '@skaitch/core/types/ifc';

const items = { ground: { type: 'Storey', geom: { elevation: 0 } }, first: { type: 'Storey', geom: { elevation: 3 } }, basement: { type: 'Storey', geom: { elevation: -2.5 } } } as unknown as ItemsMap;
it.each(['ground','first','basement'])('applies the %s storey elevation once to all local heights', id => {
  const group = createStoreyGroup(items,id);
  const elevation=(items[id] as any).geom.elevation;
  // Wall base, window sill, furniture centre, stair tread and slab underside.
  for(const localY of [0,.9,.5,1.75,-.2]) {
    const mesh=new Mesh(new BoxGeometry(1,1,1),new MeshBasicMaterial());
    mesh.position.set(2,localY,-4);group.add(mesh);
    const position=mesh.getWorldPosition(new Vector3());
    expect(position.toArray()).toEqual([2,elevation+localY,-4]);
    expect(mesh.position.y).toBe(localY);
    mesh.geometry.dispose();(mesh.material as MeshBasicMaterial).dispose();
  }
});
it('uses the latest storey altitude without changing child geometry',()=>{
  const changed={...items,first:{...items.first,geom:{elevation:4.2}}} as unknown as ItemsMap;
  expect(createStoreyGroup(changed,'first').position.y).toBe(4.2);
  expect(createStoreyGroup(items,null).position.y).toBe(0);
});

it('switches from the current storey to the complete building without mixing altitudes',()=>{
  const elements:any[]=[{id:'wall0',type:'Wall',parentId:'ground'},{id:'wall1',type:'Wall',parentId:'first'},{id:'ground',type:'Storey'},{id:'first',type:'Storey'}];
  expect(elements.filter(i=>isItemInStoreyScope(i,'first',false)).map(i=>i.id)).toEqual(['wall1','first']);
  expect(elements.filter(i=>isItemInStoreyScope(i,'first',true))).toHaveLength(4);
  expect(elements.filter(i=>isItemInStoreyScope(i,'ground',true))).toHaveLength(4);
  const first=createStoreyGroup(items,'first'),ground=createStoreyGroup(items,'ground');
  expect(first.position.y-ground.position.y).toBe(3);
});

it('frames an unsaved MCP wall using its geometry and storey elevation', () => {
  const model = {
    floor: { id: 'floor', type: 'Storey', geom: { elevation: 9 } },
    w_mcp_1794682160378: { id: 'w_mcp_1794682160378', type: 'Wall', parentId: 'floor', geom: { x1: 50, y1: 50, x2: 54, y2: 50, height: 2.8, thickness: 0.2 } },
  } as any;
  const box = selectedWallBounds(model, ['w_mcp_1794682160378']);
  expect(box.min.toArray()).toEqual([49.9, 9, -50.1]);
  expect(box.max.toArray()).toEqual([54.1, 11.8, -49.9]);
  expect(selectedWallBounds(model, ['missing', 'floor']).isEmpty()).toBe(true);
});
