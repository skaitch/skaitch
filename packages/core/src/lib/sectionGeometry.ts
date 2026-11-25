import type { ItemsMap } from '../types/ifc.js';
import { buildStair, slabOpenings, type StairPart } from './stairGeometry.js';
import { buildRoof, roofFaces } from './roofGeometry.js';
export interface SectionLine { x1:number; y1:number; x2:number; y2:number }
export interface SectionFace { points:[number,number][]; id:string; kind:string }
/** Intervals of a polygon intersected by an infinite vertical section plane. */
export function sectionIntervals(polygon:[number,number][],line:SectionLine):[number,number][] {
  const length=Math.hypot(line.x2-line.x1,line.y2-line.y1);
  if(length<1e-6) return [];
  const ux=(line.x2-line.x1)/length,uy=(line.y2-line.y1)/length;
  const hits:number[]=[];
  for(let i=0;i<polygon.length;i++) {
    const a=polygon[i],b=polygon[(i+1)%polygon.length];
    const da=(a[0]-line.x1)*(-uy)+(a[1]-line.y1)*ux,db=(b[0]-line.x1)*(-uy)+(b[1]-line.y1)*ux;
    if((da<=0&&db>0)||(db<=0&&da>0)) {
      const t=da/(da-db);hits.push((a[0]+(b[0]-a[0])*t-line.x1)*ux+(a[1]+(b[1]-a[1])*t-line.y1)*uy);
    }
  }
  hits.sort((a,b)=>a-b);
  const intervals:[number,number][]=[];
  for(let i=0;i+1<hits.length;i+=2) if(hits[i+1]-hits[i]>1e-6) intervals.push([hits[i],hits[i+1]]);
  return intervals;
}
export function buildSection(items:ItemsMap,line:SectionLine):SectionFace[] {
  const faces:SectionFace[]=[];
  const add=(id:string,kind:string,part:StairPart,base:number,holes:[number,number][][]=[])=>{
    let intervals=sectionIntervals(part.polygon,line);
    for(const hole of holes) for(const [c,d] of sectionIntervals(hole,line)) intervals=intervals.flatMap(([a,b]):[number,number][]=>d<=a||c>=b?[[a,b]]:[[a,Math.max(a,c)],[Math.min(b,d),b]].filter(([x,y])=>y-x>1e-6) as [number,number][]);
    for(const [a,b] of intervals) faces.push({id,kind,points:[[a,base+part.z],[b,base+part.z],[b,base+part.z-part.thickness],[a,base+part.z-part.thickness]]});
  };
  for(const it of Object.values(items)) {
    const g=(it as any).geom;if(!g) continue;
    const base=Number((items[it.parentId??''] as any)?.geom?.elevation??0);
    if(it.type==='Stair') for(const part of buildStair(it.geom,it.parentId,items).parts) add(it.id,'Stair',part,base);
    if(it.type==='Slab') add(it.id,'Slab',{polygon:g.polygon,z:0,thickness:g.thickness,kind:'landing'},base,slabOpenings(it.id,items));
    if(it.type==='Wall') {
      const dx=g.x2-g.x1,dy=g.y2-g.y1,l=Math.hypot(dx,dy)||1,nx=-dy/l*g.thickness/2,ny=dx/l*g.thickness/2;
      const polygon:[number,number][]=[[g.x1+nx,g.y1+ny],[g.x2+nx,g.y2+ny],[g.x2-nx,g.y2-ny],[g.x1-nx,g.y1-ny]];
      const wallStart=faces.length;
      add(it.id,'Wall',{polygon,z:g.height,thickness:g.height,kind:'landing'},base);
      const voids=Object.values(items).filter(o=>(o.type==='Door'||o.type==='Window') && o.geom.wallId===it.id);
      for(const opening of voids) {
        const o=(opening as any).geom,px=g.x1+dx*o.t,py=g.y1+dy*o.t;
        const half=o.width/2;
        const shape:[number,number][]=[[px-dx/l*half+nx,py-dy/l*half+ny],[px+dx/l*half+nx,py+dy/l*half+ny],[px+dx/l*half-nx,py+dy/l*half-ny],[px-dx/l*half-nx,py-dy/l*half-ny]];
        const low=base+(opening.type==='Window'?o.sillHeight??.9:0),high=low+o.height;
        for(const [c,d] of sectionIntervals(shape,line)) {
          const wallFaces=faces.splice(wallStart);
          for(const face of wallFaces) {
            const a=face.points[0][0],b=face.points[1][0],top=face.points[0][1],bottom=face.points[2][1];
            if(d<=a||c>=b||high<=bottom||low>=top) {faces.push(face);continue;}
            const left=Math.max(a,c),right=Math.min(b,d),lo=Math.max(bottom,low),hi=Math.min(top,high);
            for(const [x1,x2,z1,z2] of [[a,left,bottom,top],[right,b,bottom,top],[left,right,bottom,lo],[left,right,hi,top]]) if(x2-x1>1e-6&&z2-z1>1e-6) faces.push({id:it.id,kind:'Wall',points:[[x1,z2],[x2,z2],[x2,z1],[x1,z1]]});
          }
        }
      }
    }
    // shortcut: imported generic elements use their bounds, intersect imported meshes for exact IFC sections.
    if(it.type==='Furniture'||it.type==='GenericElement') {
      const c=Math.cos(g.rotation??0),s=Math.sin(g.rotation??0),cx=g.x+g.w/2,cy=g.y+g.d/2;
      const polygon:[number,number][]=[[-g.w/2,-g.d/2],[g.w/2,-g.d/2],[g.w/2,g.d/2],[-g.w/2,g.d/2]].map(([x,y])=>[cx+x*c-y*s,cy+x*s+y*c]);
      add(it.id,it.type,{polygon,z:g.h,thickness:g.h,kind:'landing'},base);
    }
    if(it.type==='Roof') {
      const roof=buildRoof(g);if(!roof) continue;
      const len=Math.hypot(line.x2-line.x1,line.y2-line.y1);if(!len) continue;
      const ux=(line.x2-line.x1)/len,uy=(line.y2-line.y1)/len;
      for(const face of roofFaces(roof)) {
        const hits:[number,number][]=[];
        for(let i=0;i<face.length;i++) {
          const a=face[i],b=face[(i+1)%face.length];
          const da=-(a[0]-line.x1)*uy+(a[1]-line.y1)*ux,db=-(b[0]-line.x1)*uy+(b[1]-line.y1)*ux;
          if((da<=0&&db>0)||(db<=0&&da>0)) {const t=da/(da-db);hits.push([(a[0]+t*(b[0]-a[0])-line.x1)*ux+(a[1]+t*(b[1]-a[1])-line.y1)*uy,base+a[2]+t*(b[2]-a[2])]);}
        }
        if(hits.length>=2) faces.push({id:it.id,kind:'Roof',points:hits});
      }
    }
  }
  return faces;
}
