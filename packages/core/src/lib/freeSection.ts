import * as THREE from 'three';
import type { SectionLine } from './sectionGeometry.js';

export interface SectionPlane extends SectionLine {
  origin?: [number, number, number];
  normal?: [number, number, number];
  depth?: number;
}
export function sectionPlane(g: SectionPlane) {
  const normal = g.normal ? new THREE.Vector3(...g.normal) : new THREE.Vector3(g.y2-g.y1, 0, g.x2-g.x1);
  if (!Number.isFinite(normal.lengthSq()) || normal.lengthSq()<1e-12) return null;
  const origin = g.origin ? new THREE.Vector3(...g.origin) : new THREE.Vector3(g.x1,0,-g.y1);
  if (!origin.toArray().every(Number.isFinite)) return null;
  return {normal:normal.normalize(),origin};
}
export function sectionGeom(origin: THREE.Vector3, normal: THREE.Vector3, depth = 10): SectionPlane {
  const tangent = new THREE.Vector3(normal.z,0,-normal.x).normalize();
  return {x1:origin.x,y1:-origin.z,x2:origin.x+tangent.x,y2:-origin.z-tangent.z,
    origin:origin.toArray(),normal:normal.toArray(),depth};
}
export function sectionBasis(normal: THREE.Vector3) {
  const u = new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),normal).normalize();
  if(u.lengthSq()<.5) u.set(1,0,0);
  return {u,v:new THREE.Vector3().crossVectors(normal,u).normalize()};
}
export function hasCpuPositions(mesh: THREE.Mesh) {
  const position=mesh.geometry.getAttribute('position') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
  return (position instanceof THREE.InterleavedBufferAttribute ? position.data.array : position?.array) != null;
}
export type Segment = [THREE.Vector3,THREE.Vector3];
/** Intersect actual mesh triangles; keep open contours as lines rather than inventing a solid. */
export function meshSection(mesh: THREE.Mesh, plane: THREE.Plane): Segment[] {
  const geometry=mesh.geometry,position=geometry.getAttribute('position'),index=geometry.index;
  if(!position || !hasCpuPositions(mesh)) return [];
  const result:Segment[]=[],count=index?.count??position.count;
  mesh.updateWorldMatrix(true,false);
  for(let i=0;i+2<count;i+=3) {
    const vertices=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(position,index?index.getX(i+j):i+j).applyMatrix4(mesh.matrixWorld));
    const hits:THREE.Vector3[]=[];
    for(let j=0;j<3;j++) {
      const a=vertices[j],b=vertices[(j+1)%3],da=plane.distanceToPoint(a),db=plane.distanceToPoint(b);
      if(Math.abs(da)<1e-7) hits.push(a.clone());
      if(da*db<0) hits.push(a.clone().lerp(b,da/(da-db)));
    }
    const unique=hits.filter((p,j)=>hits.findIndex(q=>q.distanceToSquared(p)<1e-12)===j);
    if(unique.length===2 && unique[0].distanceToSquared(unique[1])>1e-12) result.push([unique[0],unique[1]]);
  }
  return result;
}
export function sectionShapes(segments:Segment[],origin:THREE.Vector3,normal:THREE.Vector3) {
  const {u,v}=sectionBasis(normal),key=(p:THREE.Vector3)=>p.toArray().map(n=>Math.round(n/1e-5)).join(',');
  const edges=new Map<string,Segment>();
  for(const edge of segments) edges.set([key(edge[0]),key(edge[1])].sort().join('|'),edge);
  const adjacency=new Map<string,Set<Segment>>();
  for(const edge of edges.values()) for(const p of edge) {const k=key(p);if(!adjacency.has(k)) adjacency.set(k,new Set());adjacency.get(k)!.add(edge);}
  const unused=new Set(edges.values()),loops:THREE.Vector2[][]=[];
  while(unused.size) {
    const first=unused.values().next().value!;unused.delete(first);
    const points=[first[0],first[1]];let end=first[1];
    while(key(end)!==key(points[0])) {
      const next=[...(adjacency.get(key(end))??[])].find(e=>unused.has(e));
      if(!next) break;
      unused.delete(next);end=key(next[0])===key(end)?next[1]:next[0];points.push(end);
    }
    if(key(end)===key(points[0]) && points.length>3) loops.push(points.slice(0,-1).map(p=>{const d=p.clone().sub(origin);return new THREE.Vector2(d.dot(u),d.dot(v));}));
  }
  const paths=loops.map(loop=>new THREE.Path(loop));
  // Even/odd nesting preserves openings and disconnected solids.
  const contains=(loop:THREE.Vector2[],p:THREE.Vector2)=>{
    let inside=false;
    for(let i=0,j=loop.length-1;i<loop.length;j=i++) {const a=loop[i],b=loop[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;}
    return inside;
  };
  const depths=loops.map((loop,i)=>loops.filter((other,j)=>i!==j&&contains(other,loop[0])).length);
  return loops.flatMap((loop,i)=>{
    if(depths[i]%2) return [];
    const shape=new THREE.Shape(loop);
    shape.holes=paths.filter((_,j)=>depths[j]===depths[i]+1&&contains(loop,loops[j][0]));
    return [shape];
  });
}

export function sectionAngles(normal:THREE.Vector3) {
  return {yaw:THREE.MathUtils.radToDeg(Math.atan2(normal.z,normal.x)),tilt:THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(normal.y,-1,1)))};
}
export function sectionNormal(yaw:number,tilt:number) {
  const y=THREE.MathUtils.degToRad(yaw),t=THREE.MathUtils.degToRad(tilt);
  return new THREE.Vector3(Math.cos(t)*Math.cos(y),Math.sin(t),Math.cos(t)*Math.sin(y));
}
