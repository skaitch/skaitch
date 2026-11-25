import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SectionView from '@skaitch/ui/components/canvas/SectionView';
import { describe,it,expect } from 'vitest';
import * as WebIFC from 'web-ifc';
import { buildStair, validateOpening, stairAscentPath, stairFlightHandles, stairFlightLengthAt, stairFlightDimensions, STAIR_DEFAULTS, STAIR_FORMS, validateStair, proposeOpening, slabOpenings } from '@skaitch/core/lib/stairGeometry';
import { buildSection, sectionIntervals } from '@skaitch/core/lib/sectionGeometry';
import { exportIFC } from '@skaitch/core/bim/exportIFC';
import { patchIFC } from '@skaitch/core/bim/patchIFC';
import { buildElementPatch } from '@skaitch/core/lib/mcpElementUpdate';
import type { ItemsMap } from '@skaitch/core/types/ifc';
const items:ItemsMap={
 p:{id:'p',GlobalId:'P000000000000000000001',type:'Project',ifcType:'IfcProject',name:'P',Name:'P',parentId:null} as any,
 b:{id:'b',GlobalId:'B000000000000000000001',type:'Building',ifcType:'IfcBuilding',name:'B',Name:'B',parentId:'p'} as any,
 s:{id:'s',GlobalId:'S000000000000000000001',type:'Storey',ifcType:'IfcBuildingStorey',name:'RDC',Name:'RDC',parentId:'b',geom:{elevation:0,level:0,thickness:.2}} as any,
 t:{id:'t',GlobalId:'T000000000000000000001',type:'Storey',ifcType:'IfcBuildingStorey',name:'Étage',Name:'Étage',parentId:'b',geom:{elevation:3,level:1,thickness:.2}} as any,
 slab:{id:'slab',GlobalId:'L000000000000000000001',type:'Slab',ifcType:'IfcSlab',name:'Dalle',Name:'Dalle',parentId:'t',geom:{polygon:[[-5,-5],[15,-5],[15,15],[-5,15]],thickness:.2}} as any,
};
const g={...STAIR_DEFAULTS,targetId:'t',railLeft:false,railRight:false};
const stair={id:'st_new',GlobalId:'A000000000000000000001',type:'Stair',ifcType:'IfcStair',name:'Escalier',Name:'Escalier',parentId:'s',geom:g} as const;
it('preserves an existing IFC stair without duplicating it and rejects unsupported edits', async () => {
  const original = exportIFC({...items, [stair.id]: stair} as ItemsMap);
  const id = original.match(/#(\d+)\s*=\s*IFCSTAIR\(/)?.[1];
  expect(id).toBeDefined();
  const existing = {...stair, id: `st_${id}`};
  const scene = {...items, [existing.id]: existing} as ItemsMap;
  const buffer = new TextEncoder().encode(original).buffer;
  const output = await patchIFC(scene, buffer);
  expect(output.match(/=\s*IFCSTAIR\(/g)).toHaveLength(1);
  await expect(patchIFC({...scene, [existing.id]: {...existing, geom: {...g, _edited: true}}} as ItemsMap, buffer)).rejects.toThrow('Editing an existing IFC stair');
});
it('rejects IFC export when a moved slab no longer contains its stair opening', async () => {
  const opening = proposeOpening(g, 's', items)!;
  const valid = {...items, [stair.id]: {...stair, geom: {...g, opening}}} as ItemsMap;
  const original = exportIFC(valid);
  const slab = items.slab as any;
  const invalid = {...valid, slab: {...slab, geom: {...slab.geom, polygon: slab.geom.polygon.map(([x, y]: number[]) => [x + 100, y])}}} as ItemsMap;
  expect(() => exportIFC(invalid)).toThrow('trémie');
  await expect(patchIFC(invalid, new TextEncoder().encode(original).buffer)).rejects.toThrow('trémie');
});
describe('stairs',()=>{
 it.each(Object.keys(STAIR_FORMS))('builds %s with positive finite solids and equal rises',form=>{
  for(const landing of [true,false]) {
   const result=buildStair({...g,form:form as any,landing},'s',items);
   expect(result.parts.length).toBeGreaterThan(0);
   expect(result.parts.filter(p=>p.kind==='step')).toHaveLength(result.count-1);
   for(const p of result.parts){expect(p.thickness).toBeGreaterThan(0);expect(p.polygon.flat().every(Number.isFinite)).toBe(true);}
   expect(Math.max(...result.parts.map(p=>p.z))).toBeCloseTo(result.height-result.rise);
  }
 });
 it('recalculates unless count is manual and rejects invalid geometry',()=>{
  const changed={...items,t:{...items.t,geom:{...(items.t as any).geom,elevation:4}}} as ItemsMap;
  expect(buildStair(g,'s',changed).count).not.toBe(buildStair(g,'s',items).count);
  expect(buildStair({...g,count:17},'s',changed).count).toBe(17);
  expect(()=>validateStair({...g,width:-1},'s',items)).toThrow();
  expect(()=>validateStair({...g,targetId:'s'},'s',items)).toThrow();
  expect(()=>buildElementPatch(stair as any,undefined,{turn:0})).toThrow();
  expect(buildElementPatch(stair as any,undefined,{form:'spiral',count:20})).toHaveProperty('geom.form','spiral');
 });
 it('proposes an opening only on a containing upper slab and cuts the section',()=>{
  const opening=proposeOpening(g,'s',items)!;expect(opening.slabId).toBe('slab');
  const scene={...items,st_new:{...stair,geom:{...g,opening}}} as ItemsMap;
  expect(slabOpenings('slab',scene)).toHaveLength(1);
  const cut={x1:0,y1:0,x2:10,y2:0};
  const faces=buildSection(scene,cut).filter(f=>f.id==='slab');expect(faces).toHaveLength(2);
  expect(buildSection(scene,cut).some(f=>f.kind==='Stair')).toBe(true);
  expect(sectionIntervals([[0,0],[1,0],[1,1],[0,1]],{x1:0,y1:.5,x2:1,y2:.5})).toEqual([[0,1]]);
 });
 it('warns about wall collisions without changing the requested dimensions',()=>{
  const scene={...items,w:{id:'w',type:'Wall',parentId:'s',geom:{x1:1,y1:-2,x2:1,y2:2,thickness:.2,height:3}}} as any;
  const before=JSON.stringify(g),result=buildStair(g,'s',scene);
  expect(result.warnings.join(' ')).toContain('mur');expect(result.parts.length).toBeGreaterThan(0);expect(JSON.stringify(g)).toBe(before);
 });
 it('accepts automatic mode and rejects an invalid opening update',()=>{
  expect((buildElementPatch({...stair,geom:{...g,count:19}} as any,undefined,{count:null}).geom as any).count).toBeUndefined();
  expect(()=>buildElementPatch(stair as any,undefined,{opening:{slabId:'slab',x:0,y:0,width:-1,depth:1}})).toThrow();
  expect(()=>validateOpening({slabId:'slab',x:14,y:0,width:2,depth:1},'t',items)).toThrow();
 });
 it('subtracts doors and windows from the wall section',()=>{
  const scene={...items,w:{id:'w',type:'Wall',parentId:'s',geom:{x1:0,y1:0,x2:5,y2:0,thickness:.2,height:3}},d:{id:'d',type:'Door',parentId:'s',geom:{wallId:'w',t:.5,width:1,height:2}}} as any;
  const walls=buildSection(scene,{x1:0,y1:0,x2:5,y2:0}).filter(f=>f.id==='w');
  expect(walls).toHaveLength(3);
  const area=walls.reduce((sum,f)=>sum+(f.points[1][0]-f.points[0][0])*(f.points[0][1]-f.points[2][1]),0);
  expect(area).toBeCloseTo(13);
 });
 it('renders the complete section including both storey elevations',()=>{
  const section={id:'section',name:'Coupe A',type:'Section',parentId:'s',geom:{x1:0,y1:0,x2:10,y2:0}};
  const scene={...items,st_new:stair,section} as unknown as ItemsMap;
  const html=renderToStaticMarkup(createElement(SectionView,{items:scene,line:section.geom,setSelection:()=>{}}));
  expect(html).toContain('Coupe générale du bâtiment');expect(html).toContain('RDC');expect(html).toContain('+3,00 m');expect(html).not.toContain('NaN');
 });
 it('sets each flight length independently and keeps the total rise',()=>{
  const geom={...g,form:'doubleQuarter' as const,flightLengths:[3,2,4]};
  const result=buildStair(geom,'s',items);
  for(const [i,length] of geom.flightLengths.entries()) {
    const parts=result.parts.filter(p=>p.kind==='step' && p.flight===i);
    const points=parts.flatMap(p=>p.polygon),axis=i===1?1:0;
    expect(Math.max(...points.map(p=>p[axis]))-Math.min(...points.map(p=>p[axis]))).toBeCloseTo(Math.round(length/g.going)*g.going);
    expect(parts[0].going).toBeCloseTo(g.going);
  }
  expect(result.parts.filter(p=>p.kind==='step')).toHaveLength(result.count-1);
  expect(Math.max(...result.parts.map(p=>p.z))).toBeCloseTo(3-result.rise);
  expect(stairFlightDimensions(g,17)[0].length).toBeCloseTo(16*g.going);
 });
 it('resizes each landing and keeps the following flight attached',()=>{
  for(const turn of [1,-1]) {
    const geom={...g,form:'doubleQuarter' as const,turn,landings:[{length:2,width:1.5},{length:1.7,width:1.3}]};
    const result=buildStair(geom,'s',items);
    const landings=result.parts.filter(p=>p.kind==='landing');
    expect(landings).toHaveLength(2);
    for(let i=0;i<landings.length;i++) {
      const p=landings[i].polygon;
      expect(Math.hypot(p[1][0]-p[0][0],p[1][1]-p[0][1])).toBeCloseTo(geom.landings[i].length);
      expect(Math.hypot(p[2][0]-p[1][0],p[2][1]-p[1][1])).toBeCloseTo(geom.landings[i].width);
      const next=result.parts.find(p=>p.kind==='step'&&p.flight===i+1)!;
      const entry=[(next.polygon[0][0]+next.polygon[3][0])/2,(next.polygon[0][1]+next.polygon[3][1])/2];
      const edge=turn===1?[landings[i].polygon[2],landings[i].polygon[3]]:[landings[i].polygon[0],landings[i].polygon[1]];
      const a=edge[0],b=edge[1];
      expect((entry[0]-a[0])*(b[1]-a[1])-(entry[1]-a[1])*(b[0]-a[0])).toBeCloseTo(0);
    }
  }
 });
 it('uses the spiral diameter and rotates all stair components around the placement point',()=>{
  const geom={...g,form:'spiral' as const,radius:1.25,width:.8};
  const parts=buildStair(geom,'s',items).parts;
  expect(Math.max(...parts.flatMap(p=>p.polygon).map(([x,y])=>Math.hypot(x,y)))).toBeCloseTo(2.05);
  const rotated=buildStair({...geom,x:5,y:7,rotation:Math.PI/2},'s',items).parts;
  expect(rotated).toHaveLength(parts.length);
  parts.forEach((p,i)=>p.polygon.forEach(([x,y],j)=>{
    expect(rotated[i].polygon[j][0]).toBeCloseTo(5-y);
    expect(rotated[i].polygon[j][1]).toBeCloseTo(7+x);
  }));
  expect(buildStair({...g,form:'quarter',landing:false,turnRadius:.6},'s',items).parts.length).toBeGreaterThan(0);
 });
 it('validates the new dimensions through the shared assistant update path',()=>{
  expect(()=>buildElementPatch(stair as any,undefined,{flightLengths:[-1]})).toThrow();
  expect(()=>buildElementPatch({...stair,geom:{...g,form:'half'}} as any,undefined,{landings:[{length:1,width:1}]})).toThrow();
  expect(()=>buildElementPatch(stair as any,undefined,{turnRadius:-1})).toThrow();
  expect((buildElementPatch(stair as any,undefined,{flightLengths:[5],turnRadius:.3}).geom as any).flightLengths).toEqual([5]);
 });
 it.each(['straight','quarter','doubleQuarter','half'] as const)('resizes %s flights along their axes after rotation',form=>{
  for(const landing of [true,false]) {
    const geom={...g,form,landing,rotation:1.1,x:5,y:-2};
    const handles=stairFlightHandles(geom,'s',items);
    expect(handles).toHaveLength(form==='doubleQuarter'?3:form==='straight'?1:2);
    const chosen=handles[handles.length-1];
    const point:[number,number]=[chosen.start[0]+chosen.direction[0]*5-chosen.direction[1]*2,chosen.start[1]+chosen.direction[1]*5+chosen.direction[0]*2];
    expect(stairFlightLengthAt(chosen.start,chosen.direction,point)).toBeCloseTo(5);
    const lengths=handles.map(h=>h.index===chosen.index?5:h.length);
    const resized=stairFlightHandles({...geom,flightLengths:lengths},'s',items);
    resized.forEach((h,i)=>expect(h.length).toBeCloseTo(Math.round(lengths[i]/g.going)*g.going));
    expect(resized[chosen.index].start[0]).toBeCloseTo(chosen.start[0]);
    expect(resized[chosen.index].start[1]).toBeCloseTo(chosen.start[1]);
  }
 });
 it('keeps the grab offset and a positive length when dragging past the start',()=>{
  expect(stairFlightLengthAt([1,2],[0,1],[1,5.1],.1)).toBeCloseTo(3);
  expect(stairFlightLengthAt([1,2],[0,1],[1,0])).toBe(.01);
  expect(stairFlightHandles({...g,form:'spiral'},'s',items)).toEqual([]);
 });
 it('adds and removes steps only in the resized flight while keeping the going',()=>{
  const geom={...g,form:'quarter' as const,flightLengths:[8*g.going,8*g.going]};
  const initial=buildStair(geom,'s',items);
  const longer=buildStair({...geom,flightLengths:[12*g.going,8*g.going]},'s',items);
  const shorter=buildStair({...geom,flightLengths:[4*g.going,8*g.going]},'s',items);
  expect(initial.count).toBe(17);expect(longer.count).toBe(21);expect(shorter.count).toBe(13);
  for(const model of [initial,longer,shorter]) {
    expect(model.parts.filter(p=>p.kind==='step'&&p.flight===1)).toHaveLength(8);
    expect(model.parts.filter(p=>p.kind==='step').every(p=>Math.abs(p.going!-g.going)<1e-8)).toBe(true);
    expect(model.rise*model.count).toBeCloseTo(3);
  }
 });
 it.each(['quarter','doubleQuarter','half'] as const)('moves the first turn of %s to the departure without duplicating it',form=>{
  for(const turn of [1,-1]) for(const landing of [true,false]) {
    const lengths=form==='doubleQuarter'?[1.89,2.16,2.43]:[1.89,2.16];
    const original={...g,form,turn,landing,flightLengths:lengths};
    const before=buildStair(original,'s',items);
    const after=buildStair({...original,startWinders:true},'s',items);
    const turnSteps=form==='half'?6:3;
    expect(after.count).toBe(before.count+(landing?turnSteps:0));
    expect(after.parts.filter(p=>p.kind==='step'&&p.flight===-1)).toHaveLength(turnSteps);
    for(let i=0;i<lengths.length;i++) {
      const removed=(!landing&&i===0)?turnSteps:0;
      expect(after.parts.filter(p=>p.kind==='step'&&p.flight===i)).toHaveLength(before.parts.filter(p=>p.kind==='step'&&p.flight===i).length-removed);
    }
    expect(after.parts.filter(p=>p.kind==='landing')).toHaveLength(before.parts.filter(p=>p.kind==='landing').length-(landing?1:0));
    expect(after.parts.filter(p=>p.kind==='step'&&p.flight===0&&p.going!==g.going)).toHaveLength(0);
    stairFlightHandles({...original,startWinders:true},'s',items).forEach((h,i)=>expect(h.length).toBeCloseTo(lengths[i]));
  }
 });
 it('repairs the old zero-length departure without losing the following flight',()=>{
  const legacy={...g,form:'quarter' as const,landing:false,flightLengths:[0,2.16]};
  const model=buildStair(legacy,'s',items);
  expect(model.parts.filter(p=>p.kind==='step'&&p.flight===-1)).toHaveLength(3);
  expect(model.parts.filter(p=>p.kind==='step'&&p.flight===0).length).toBeGreaterThan(3);
  expect(stairFlightHandles(legacy,'s',items).map(h=>h.index)).toEqual([0,1]);
  expect(stairFlightHandles(legacy,'s',items)[1].length).toBeCloseTo(2.16);
 });
 it('limits zero length to a first flight leading into winders',()=>{
  expect(()=>validateStair({...g,form:'quarter',landing:true,flightLengths:[0,2]},'s',items)).toThrow();
  expect(()=>validateStair({...g,flightLengths:[0]},'s',items)).toThrow();
  expect(()=>validateStair({...g,form:'quarter',landing:false,flightLengths:[2,0]},'s',items)).toThrow();
  expect(stairFlightLengthAt([1,2],[0,1],[1,0],0,0)).toBe(0);
 });
 it('draws the ascent from the bottom entrance to the top exit, excluding railings',()=>{
  const model=buildStair({...g,railLeft:true},'s',items),path=stairAscentPath(model.parts);
  expect(path[0]).toEqual([0,0]);
  expect(path[path.length-1][0]).toBeCloseTo((model.count-1)*g.going);
  expect(path[path.length-1][1]).toBeCloseTo(0);
  expect(path.every((p,i)=>i===0||p[0]>=path[i-1][0])).toBe(true);
  expect(path).toEqual(stairAscentPath(model.parts.filter(p=>p.kind!=='rail')));
  expect(stairAscentPath([])).toEqual([]);
 });
 it.each(['quarter','half','doubleQuarter','spiral'] as const)('keeps ascent direction through %s turns after rotation',form=>{
  const geom={...g,form,landing:false,startWinders:form!=='spiral'};
  const before=stairAscentPath(buildStair(geom,'s',items).parts);
  const rotated=stairAscentPath(buildStair({...geom,rotation:Math.PI/2,x:3,y:4},'s',items).parts);
  expect(before.length).toBeGreaterThan(2);
  before.forEach(([x,y],i)=>{expect(rotated[i][0]).toBeCloseTo(3-y);expect(rotated[i][1]).toBeCloseTo(4+x);});
 });
 it('exports structured IFC with readable stair meshes, including patch export',async()=>{
  const configured={...g,form:'half' as const,flightLengths:[3,4],landings:[{length:1.5,width:2.4}],railLeft:true,railStyle:'solid' as const};
  const scene={...items,st_new:{...stair,geom:{...configured,opening:proposeOpening(configured,'s',items)!}}} as ItemsMap;
  const text=exportIFC(scene);expect(text).toContain('IFCSTAIR(');expect(text).toContain('IFCARBITRARYPROFILEDEFWITHVOIDS');
  const api=new WebIFC.IfcAPI();await api.Init();
  for(const content of [text,await patchIFC(scene,new TextEncoder().encode(exportIFC(items)).buffer)]) {
   const mid=api.OpenModel(new TextEncoder().encode(content));
   expect(api.GetLineIDsWithType(mid,WebIFC.IFCSTAIR).size()).toBe(1);
   expect(api.GetLineIDsWithType(mid,WebIFC.IFCSTAIRFLIGHT).size()).toBe(2);
   expect(api.GetLineIDsWithType(mid,WebIFC.IFCRAILING).size()).toBe(1);
   let triangles=0;
   api.StreamAllMeshesWithTypes(mid,[WebIFC.IFCSTAIRFLIGHT],mesh=>{for(let i=0;i<mesh.geometries.size();i++){const pg=mesh.geometries.get(i),geometry=api.GetGeometry(mid,pg.geometryExpressID);triangles+=geometry.GetIndexDataSize()/3;geometry.delete();}});
   expect(triangles).toBeGreaterThan(0);api.CloseModel(mid);
  }
  api.Dispose();
 });
});
