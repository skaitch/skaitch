import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { hasCpuPositions, sectionAngles, sectionNormal, meshSection, sectionGeom, sectionPlane, sectionShapes } from '@skaitch/core/lib/freeSection';

describe('free section geometry',()=>{
  it('keeps exact section normals when editing direction and inclination',()=>{
    for(const [yaw,tilt] of [[0,0],[90,0],[-45,30],[180,-90]]) {
      const normal=sectionNormal(yaw,tilt),angles=sectionAngles(normal);
      expect(normal.length()).toBeCloseTo(1);
      expect(sectionNormal(angles.yaw,angles.tilt).distanceTo(normal)).toBeLessThan(1e-10);
      expect(normal.y).toBeCloseTo(Math.sin(THREE.MathUtils.degToRad(tilt)));
    }
  });
  it('keeps legacy vertical cuts and rejects degenerate cuts',()=>{
    expect(sectionPlane({x1:0,y1:0,x2:4,y2:0})!.normal.toArray()).toEqual([0,0,1]);
    expect(sectionPlane({x1:1,y1:1,x2:1,y2:1})).toBeNull();
    expect(sectionPlane({x1:0,y1:0,x2:1,y2:0,origin:[NaN,0,0]})).toBeNull();
  });
  it('round trips inclined and horizontal planes',()=>{
    for(const normal of [new THREE.Vector3(1,2,3).normalize(),new THREE.Vector3(0,1,0)]) {
      const origin=new THREE.Vector3(2,3,4),result=sectionPlane(sectionGeom(origin,normal,7))!;
      expect(result.origin.distanceTo(origin)).toBeLessThan(1e-10);
      expect(result.normal.distanceTo(normal)).toBeLessThan(1e-10);
    }
  });
  it('intersects transformed meshes and closes their contours',()=>{
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2));mesh.position.set(5,3,2);
    const origin=new THREE.Vector3(5,3,2),normal=new THREE.Vector3(0,0,1);
    const segments=meshSection(mesh,new THREE.Plane().setFromNormalAndCoplanarPoint(normal,origin));
    const shapes=sectionShapes(segments,origin,normal);
    expect(shapes).toHaveLength(1);
    expect(Math.abs(THREE.ShapeUtils.area(shapes[0].getPoints()))).toBeCloseTo(4);
    expect(meshSection(mesh,new THREE.Plane(normal,-20))).toHaveLength(0);
    mesh.geometry.dispose();
  });
  it('preserves holes and disconnected solids in caps',()=>{
    const origin=new THREE.Vector3(),normal=new THREE.Vector3(0,0,1);
    const ring=(size:number,x=0)=>{const points=[[-size,-size],[size,-size],[size,size],[-size,size]].map(([a,b])=>new THREE.Vector3(a+x,b,0));return points.map((p,i)=>[p,points[(i+1)%4]] as [THREE.Vector3,THREE.Vector3]);};
    const shapes=sectionShapes([...ring(3),...ring(1),...ring(.5,10)],origin,normal);
    expect(shapes).toHaveLength(2);expect(shapes.map(s=>s.holes.length).sort()).toEqual([0,1]);
  });
  it('ignores GPU-only fragment buffers instead of reading missing arrays',()=>{
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.GLBufferAttribute({} as WebGLBuffer,5126,3,4,3) as unknown as THREE.BufferAttribute);
    const mesh=new THREE.Mesh(geometry);
    expect(hasCpuPositions(mesh)).toBe(false);
    expect(meshSection(mesh,new THREE.Plane(new THREE.Vector3(0,0,1),0))).toEqual([]);
    geometry.dispose();
  });
  it('does not fill an open mesh contour',()=>{
    expect(sectionShapes([[new THREE.Vector3(),new THREE.Vector3(1,0,0)]],new THREE.Vector3(),new THREE.Vector3(0,0,1))).toHaveLength(0);
  });
});
