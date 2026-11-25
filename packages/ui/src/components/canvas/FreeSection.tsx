import { usePanelPosition } from '../../hooks/usePanelPosition';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { PivotControls } from 'three-pivot-controls';
import { Scissors, Plus, X, Eye, EyeOff, MoveUpRight, Rotate3D, FlipHorizontal2, PanelTop, Trash2, ChevronLeft, ChevronRight, Save } from 'lucide-react';
import type { IfcEntity, ItemsMap } from '@skaitch/core/types/ifc';
import { freeSectionDrawing, type FreeSectionInput } from '@skaitch/core/drawing/freeSection';
import { DEFAULT_SECTION_PENS, type SectionPens } from '@skaitch/core/drawing/section';
import type { Drawing as PlanDrawing, Point } from '@skaitch/core/drawing/plan';
import PlanPrimitives from './PlanPrimitives';
import { hasCpuPositions, meshSection, sectionBasis, sectionAngles, sectionNormal, sectionGeom, sectionPlane, sectionShapes, type SectionPlane } from '@skaitch/core/lib/freeSection';

/** Editor colours for the 2D section; weights are the print ones, shown as at 1:50. */
const SECTION_SCREEN_PENS: Partial<SectionPens> = {
  wallCut: { ...DEFAULT_SECTION_PENS.wallCut, color: 'var(--ink)' },
  wallFill: 'var(--panel-2)',
  beyond: { ...DEFAULT_SECTION_PENS.beyond, color: 'var(--ink-3)' },
};
const SECTION_UNITS_PER_MM = 50 / 1000;
const sectionViewBox = (d: PlanDrawing) => d.primitives.length
  ? `${d.bounds.minX - .5} ${-d.bounds.maxY - .5} ${d.bounds.maxX - d.bounds.minX + 1} ${d.bounds.maxY - d.bounds.minY + 1}` : '0 0 10 10';

export interface SectionContext {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  controls: { enabled: boolean };
  pick?: (point: THREE.Vector2) => Promise<{point:THREE.Vector3;normal:THREE.Vector3|null}|null>;
  update?: () => void;
  getMeshes?: () => Promise<THREE.Mesh[]>;
  disposeMeshes?: () => void;
}
interface Props {
  items: ItemsMap; storeyId: string; managing: boolean; ready: number; loading: boolean;
  getContext: () => SectionContext | null;
  toolHost?: HTMLElement | null;
  addItem?: (item: IfcEntity) => void;
  updateItem?: (id: string, patch: any) => void;
  deleteItems?: (ids: string[]) => void;
  onView2D?: () => void;
  selection: string[]; setSelection: (ids:string[])=>void;
  is2D?: boolean;
}

export default function FreeSection({toolHost,items,storeyId,managing,ready,loading,getContext,addItem,updateItem,deleteItems,onView2D,selection,setSelection,is2D=false}:Props) {
  const [draft,setDraft]=useState<IfcEntity|null>(null);
  const panelPosition=usePanelPosition(!!addItem&&managing,toolHost);
  const sections=Object.values(items).filter(i=>i.type==='Section');
  const [activeId,setActiveId]=useState(selection.find(id=>items[id]?.type==='Section')??'');
  const [placing,setPlacing]=useState(false),[enabled,setEnabled]=useState(true),[mode,setMode]=useState<'translate'|'rotate'>('translate');
  const [drawing,setDrawing]=useState<PlanDrawing|null>(null),[error,setError]=useState('');
  const saved=sections.find(i=>i.id===(draft?.id??activeId))??(!draft&&is2D?sections[0]:undefined);
  const active=draft??saved;
  const geom=active?(active as any).geom as SectionPlane:undefined;
  const runtime=useRef<{setOffset:(value:number)=>void;orient:(yaw:number,tilt:number)=>void;commit:()=>void}|null>(null);
  const [offset,setOffset]=useState(0),[offsetRange,setOffsetRange]=useState({min:-20,max:20});
  const [angles,setAngles]=useState({yaw:0,tilt:0});
  useEffect(()=>{const data=geom&&sectionPlane(geom);if(data){setOffset(data.normal.dot(data.origin));setAngles(sectionAngles(data.normal));}},[geom]);
  const latest=useRef({items,active,storeyId,setSelection});
  latest.current={items,active,storeyId,setSelection};
  useEffect(()=>{const id=selection.find(id=>items[id]?.type==='Section');if(id){setActiveId(id);setDraft(null);}else if(!selection.length&&!items[activeId])setActiveId('');},[selection]);
  useEffect(()=>{if(!managing)setPlacing(false);},[managing]);
  useEffect(()=>{
    if(loading) return;
    const context=getContext();if(!context) return;
    const {renderer,scene,camera}=context,canvas=renderer.domElement;
    let cancelled=false;
    const place=async(e:MouseEvent)=>{
      if(e.button!==0) return;
      e.preventDefault();e.stopImmediatePropagation();
      const rect=canvas.getBoundingClientRect(),point=new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2);
      try {
        let hit=!context.getMeshes&&context.pick?await context.pick(point):null;
        if(!hit?.normal) {
          const ray=new THREE.Raycaster();ray.setFromCamera(point,camera);
          const pickable:THREE.Mesh[]=await context.getMeshes?.()??[];
          if(cancelled)return;
          scene.traverseVisible(o=>{if(o instanceof THREE.Mesh&&hasCpuPositions(o)&&!o.userData.sectionHelper&&!o.name.startsWith('background-plan-'))pickable.push(o);});
          const hits=ray.intersectObjects(pickable,false);
          const h=hits.find(h=>!h.object.userData.sectionHelper);
          if(h?.face) hit={point:h.point,normal:h.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld))};
        }
        if(cancelled) return;
        if(!hit?.normal){setError('Cliquez sur une face du bâtiment.');return;}
        const id=`preview_${crypto.randomUUID()}`,name=`Coupe ${Object.values(latest.current.items).filter(i=>i.type==='Section').length+1}`;
        setDraft({id,GlobalId:crypto.randomUUID(),ifcType:'IfcAnnotation',type:'Section',Name:name,name,parentId:latest.current.storeyId,geom:sectionGeom(hit.point,hit.normal.clone().negate())} as IfcEntity);
        setActiveId('');latest.current.setSelection([]);setPlacing(false);setEnabled(true);setError('');
      } catch(err) {if(!cancelled)setError(`Placement impossible : ${String(err)}`);}
    };
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setPlacing(false);};
    if(placing){canvas.addEventListener('click',place,true);window.addEventListener('keydown',escape);canvas.style.cursor='crosshair';}
    return()=>{cancelled=true;context.disposeMeshes?.();canvas.removeEventListener('click',place,true);window.removeEventListener('keydown',escape);canvas.style.cursor='';};
  },[placing,ready,loading,getContext]);

  useEffect(()=>{
    if(loading||!enabled||!geom||placing) {setDrawing(null);return;}
    const context=getContext(),data=sectionPlane(geom);if(!context||!data)return;
    const {scene,camera,renderer,controls}=context,{origin,normal}=data;
    const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal,origin);
    const previous=renderer.clippingPlanes;
    renderer.clippingPlanes=[...previous,plane];renderer.localClippingEnabled=true;
    const helper=new THREE.Object3D();helper.position.copy(origin);helper.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);
    scene.add(helper);
    const control=new PivotControls(camera,renderer.domElement,{
      translate:managing&&!is2D&&mode==='translate',rotate:managing&&!is2D&&mode==='rotate',scale:false,
      activeAxes:mode==='translate'?[false,false,true]:[true,true,false],disableSliders:true,
      fixed:true,size:.32,thickness:1,depthTest:false,annotations:true,
      axisColors:{x:0xd27d48,y:0x6b9487,z:0x408eb5},
    });control.attach(helper);
    const gizmo=control.getHelper();gizmo.traverse(o=>{o.userData.sectionHelper=true;});scene.add(gizmo);
    const caps=new THREE.Group();caps.userData.sectionHelper=true;scene.add(caps);
    const planeSurface=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:0x408eb5,transparent:true,opacity:.06,side:THREE.DoubleSide,depthWrite:false}));
    const planeBorder=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.5,-.5,0),new THREE.Vector3(.5,-.5,0),new THREE.Vector3(.5,.5,0),new THREE.Vector3(-.5,.5,0)]),new THREE.LineBasicMaterial({color:0x408eb5,transparent:true,opacity:.65,depthTest:false}));
    planeSurface.position.z=.002;planeBorder.position.z=.003;
    for(const object of [planeSurface,planeBorder]){object.userData.sectionHelper=true;helper.add(object);object.visible=managing&&!is2D;}
    let dragging=false,wasEnabled=controls.enabled,centered=false;
    let frame=0;
    const updateGizmo=()=>{control.update();frame=requestAnimationFrame(updateGizmo);};updateGizmo();
    const clear=()=>{for(const child of [...caps.children]){caps.remove(child);if(child instanceof THREE.Mesh||child instanceof THREE.LineSegments){child.geometry.dispose();const materials=Array.isArray(child.material)?child.material:[child.material];materials.forEach(m=>m.dispose());}}};
    let lastGeometrySignature='',rebuilding=false,disposed=false;
    const rebuild=async()=>{
      if(dragging||rebuilding||disposed)return;
      rebuilding=true;
      try {
      const imported=await context.getMeshes?.()??[];
      if(disposed)return;
      scene.updateMatrixWorld(true);
      const n=new THREE.Vector3(0,0,1).applyQuaternion(helper.quaternion).normalize(),p=helper.position;
      const {u,v}=sectionBasis(n),cut:[Point,Point][]=[],fills:FreeSectionInput['fills']=[],background:[Point,Point][]=[];
      const project=(q:THREE.Vector3):Point=>{const d=q.clone().sub(p);return [d.dot(u),d.dot(v)];};
      const segment=(s:THREE.Vector3[]):[Point,Point]=>[project(s[0]),project(s[1])];
      const depth=typeof geom.depth==='number'&&Number.isFinite(geom.depth)&&geom.depth>0?geom.depth:10;
      const meshes:THREE.Mesh[]=[...imported];
      scene.traverseVisible(o=>{if(o instanceof THREE.Mesh&&hasCpuPositions(o)&&!o.userData.sectionHelper&&!o.name.startsWith('background-plan-')){let parent:THREE.Object3D|null=o;while(parent){if(parent===caps||parent===gizmo||parent===helper)return;parent=parent.parent;}meshes.push(o);}});
      if(!centered&&meshes.length){
        const box=new THREE.Box3();for(const mesh of meshes)box.union(new THREE.Box3().setFromObject(mesh));
        if(!box.isEmpty()){
          const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
          plane.projectPoint(center,helper.position);
          const span=Math.max(size.length()*.8,2);planeSurface.scale.set(span,span,1);planeBorder.scale.set(span,span,1);
          const mid=n.dot(center),radius=(Math.abs(n.x)*size.x+Math.abs(n.y)*size.y+Math.abs(n.z)*size.z)/2;
          setOffsetRange({min:Math.min(mid-radius,n.dot(p))-.5,max:Math.max(mid+radius,n.dot(p))+.5});
          centered=true;control.update();
        }
      }
      const signature=meshes.map(mesh=>`${mesh.uuid}:${mesh.geometry.uuid}:${(mesh.geometry.getAttribute('position') as THREE.BufferAttribute)?.version}:${mesh.matrixWorld.elements.join(',')}`).join('|');
      if(signature===lastGeometrySignature)return;
      lastGeometrySignature=signature;clear();
      for(const mesh of meshes) {
        const segments=meshSection(mesh,plane),shapes=sectionShapes(segments,p,n);
        for(const shape of shapes){
          const geometry=new THREE.ShapeGeometry(shape),material=new THREE.MeshBasicMaterial({color:0xc7b89d,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
          // Caps sit just inside the visible half-space to avoid self-clipping.
          const cap=new THREE.Mesh(geometry,material);cap.position.copy(p).addScaledVector(n,1e-5);cap.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u,v,n));cap.userData.sectionHelper=true;caps.add(cap);
          const loops=[shape.getPoints(),...shape.holes.map(h=>h.getPoints())];
          const [outer,...holes]=loops.map(loop=>loop.map(q=>[q.x,q.y] as Point));fills.push({outer,holes});
        }
        if(segments.length){const geometry=new THREE.BufferGeometry().setFromPoints(segments.flat());const line=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0x282522}));line.position.addScaledVector(n,2e-5);line.userData.sectionHelper=true;caps.add(line);cut.push(...segments.map(segment));}
        // shortcut: rear edges are projected without full hidden-line removal; use a depth pass for publication drawings.
        if(is2D) {
          const edges=new THREE.EdgesGeometry(mesh.geometry,25),positions=edges.getAttribute('position');
          for(let i=0;i+1<positions.count;i+=2){
            let a=new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld),b=new THREE.Vector3().fromBufferAttribute(positions,i+1).applyMatrix4(mesh.matrixWorld);
            let da=plane.distanceToPoint(a),db=plane.distanceToPoint(b);
            if(Math.max(da,db)<0||Math.min(da,db)>depth)continue;
            const start=a.clone(),delta=b.clone().sub(a);let lo=0,hi=1;
            if(Math.abs(db-da)>1e-10){const t0=-da/(db-da),t1=(depth-da)/(db-da);lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));}
            if(lo>hi)continue;a=start.clone().addScaledVector(delta,lo);b=start.addScaledVector(delta,hi);background.push(segment([a,b]));
          }edges.dispose();
        }
      }
      if(is2D)setDrawing(freeSectionDrawing({cut,fills,background},SECTION_SCREEN_PENS));
      } catch(err) {if(!disposed)setError(`Calcul de coupe impossible : ${String(err)}`);}
      finally {rebuilding=false;}
    };
    const change=()=>{lastGeometrySignature='';const n=new THREE.Vector3(0,0,1).applyQuaternion(helper.quaternion).normalize();plane.setFromNormalAndCoplanarPoint(n,helper.position);context.update?.();};
    const commit=()=>{
      const current=latest.current.active;if(!current)return;
      const n=new THREE.Vector3(0,0,1).applyQuaternion(helper.quaternion).normalize();
      const before=sectionPlane((current as any).geom);
      if(before&&before.normal.distanceToSquared(n)<1e-12&&Math.abs(n.dot(helper.position.clone().sub(before.origin)))<1e-8)return;
      setDraft({...current,geom:sectionGeom(helper.position,n,(current as any).geom.depth)} as IfcEntity);
    };
    const reflect=()=>{const n=new THREE.Vector3(0,0,1).applyQuaternion(helper.quaternion).normalize();setOffset(n.dot(helper.position));setAngles(sectionAngles(n));};
    control.addEventListener('dragstart',()=>{dragging=true;wasEnabled=controls.enabled;controls.enabled=false;clear();});
    control.addEventListener('drag',()=>{change();reflect();});
    control.addEventListener('dragend',()=>{dragging=false;controls.enabled=wasEnabled;commit();rebuild();});
    runtime.current={
      setOffset:value=>{const n=new THREE.Vector3(0,0,1).applyQuaternion(helper.quaternion);helper.position.addScaledVector(n,value-n.dot(helper.position));clear();change();setOffset(value);},
      orient:(yaw,tilt)=>{helper.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),sectionNormal(yaw,tilt));clear();change();reflect();},
      commit,
    };
    gizmo.visible=managing&&!is2D;rebuild();
    // Fragment LOD geometry can arrive after the initial scene; refresh its cut contours.
    const timer=window.setInterval(rebuild,1500);
    return()=>{disposed=true;cancelAnimationFrame(frame);runtime.current=null;planeSurface.geometry.dispose();planeSurface.material.dispose();planeBorder.geometry.dispose();planeBorder.material.dispose();context.disposeMeshes?.();clearInterval(timer);renderer.clippingPlanes=previous;controls.enabled=wasEnabled;control.dispose();scene.remove(gizmo,helper,caps);clear();context.update?.();};
  },[geom,enabled,placing,ready,loading,getContext,is2D,items,mode,managing]);
  const vertical=geom&&sectionPlane(geom)&&Math.abs(sectionPlane(geom)!.normal.y)<1e-5;
  if(!addItem)return null;
  const panel = (
    <section id="section-settings" ref={panelPosition.panelRef} style={panelPosition.style} className={`section-tool${toolHost ? ' section-tool--docked' : ''}`} aria-label="Outil de coupe">
      <header className="section-tool-header" {...panelPosition.headerProps}><span><Scissors size={14}/> Réglages de coupe</span></header>
      {loading&&<p className="section-tool-hint" role="status">Préparation de la vue 3D…</p>}
      <fieldset disabled={loading} className="section-tool-fields">
      {!is2D&&<button className={`btn section-tool-create ${placing?'':'primary'}`} onClick={()=>{setPlacing(!placing);setError('');}}>{placing?<X size={14}/>:<Plus size={14}/>} {placing?'Annuler le placement':'Définir un plan de coupe'}</button>}
      {placing&&<p className="section-tool-hint" role="status">Cliquez sur une face du bâtiment.<br/>Échap pour annuler.</p>}
      {active&&<>
        <p className="section-tool-hint" role="status">{draft?(saved?`Modifications de ${saved.name} non enregistrées`:'Aperçu non enregistré'):saved?.name}</p>
        {!is2D&&<>
          <div className="section-tool-divider"/>
          <div className="field-value"><div className="seg" role="group" aria-label="Manipulation du plan"><button className={mode==='translate'?'on':''} aria-pressed={mode==='translate'} onClick={()=>setMode('translate')}><MoveUpRight size={13}/> Déplacer</button><button className={mode==='rotate'?'on':''} aria-pressed={mode==='rotate'} onClick={()=>setMode('rotate')}><Rotate3D size={13}/> Orienter</button></div></div>
          <p className="section-tool-hint">{mode==='translate'?'Glissez la poignée bleue ou réglez la position ci-dessous.':'Glissez un anneau ou saisissez un angle.'}</p>
          <div className="section-tool-row"><label className="field-label" htmlFor="section-position">Position</label><div className="field-value"><input id="section-position" disabled={!enabled||placing} type="number" step="0.1" value={Number(offset.toFixed(3))} onChange={e=>{if(e.target.value!==''&&Number.isFinite(e.target.valueAsNumber))runtime.current?.setOffset(e.target.valueAsNumber);}} onBlur={()=>runtime.current?.commit()} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/><span className="unit">m</span></div></div>
          <div className="section-tool-slider"><button className="btn icon" disabled={!enabled||placing} aria-label="Reculer la coupe de 10 cm" onClick={()=>{runtime.current?.setOffset(offset-.1);runtime.current?.commit();}}><ChevronLeft size={15}/></button><input aria-label="Position du plan de coupe" type="range" min={Math.min(offsetRange.min,offset)} max={Math.max(offsetRange.max,offset)} step="0.01" value={offset} disabled={!enabled||placing} onChange={e=>runtime.current?.setOffset(e.target.valueAsNumber)} onPointerUp={()=>runtime.current?.commit()} onKeyUp={()=>runtime.current?.commit()}/><button className="btn icon" disabled={!enabled||placing} aria-label="Avancer la coupe de 10 cm" onClick={()=>{runtime.current?.setOffset(offset+.1);runtime.current?.commit();}}><ChevronRight size={15}/></button></div>
          {mode==='rotate'&&(['yaw','tilt'] as const).map(key=><div className="section-tool-row" key={key}><label className="field-label" htmlFor={`section-${key}`}>{key==='yaw'?'Direction':'Inclinaison'}</label><div className="field-value"><input id={`section-${key}`} disabled={!enabled||placing} type="number" step="1" min={key==='tilt'?-90:undefined} max={key==='tilt'?90:undefined} value={Number(angles[key].toFixed(1))} onChange={e=>{const value=e.target.valueAsNumber;if(Number.isFinite(value)){const next={...angles,[key]:key==='tilt'?Math.max(-90,Math.min(90,value)):value};runtime.current?.orient(next.yaw,next.tilt);}}} onBlur={()=>runtime.current?.commit()} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/><span className="unit">°</span></div></div>)}
          <div className="section-tool-actions"><button className="btn" aria-pressed={enabled} onClick={()=>setEnabled(!enabled)}>{enabled?<Eye size={14}/>:<EyeOff size={14}/>} {enabled?'Visible':'Masquée'}</button><button className="btn" disabled={placing} onClick={()=>{const data=sectionPlane(geom!);if(data)setDraft({...active,geom:sectionGeom(data.origin,data.normal.negate(),geom?.depth)} as IfcEntity);}}><FlipHorizontal2 size={14}/> Inverser</button></div>
          <button className="btn section-tool-view" disabled={!vertical||placing} title={!vertical?'Disponible pour les coupes verticales':undefined} onClick={onView2D}><PanelTop size={14}/> Voir la coupe en 2D</button>
        </>}
        {is2D&&<div className="section-tool-row"><label className="field-label" htmlFor="section-depth">Profondeur</label><div className="field-value"><input id="section-depth" type="number" min="0.01" step="0.5" value={geom?.depth??10} onChange={e=>{const depth=e.target.valueAsNumber;if(Number.isFinite(depth)&&depth>0)setDraft({...active,geom:{...geom,depth}} as IfcEntity);}}/><span className="unit">m</span></div></div>}
        <details className="section-save">
          <summary><Save size={14}/> Enregistrer cette coupe</summary>
        <div className="section-tool-row"><label className="field-label" htmlFor="section-name">Nom</label><div className="field-value"><input id="section-name" key={active.id+active.name} defaultValue={active.name} onBlur={e=>{const name=e.target.value.trim();if(name&&name!==active.name)setDraft({...active,name,Name:name});}}/></div></div>
          <button className="btn" disabled={!draft||(!!saved&&!updateItem)} onClick={()=>{
            if(!active)return;
            const source=saved&&items[saved.id];
            const id=source?.id??`section_${crypto.randomUUID()}`;
            const item={...active,id,GlobalId:source?.GlobalId??crypto.randomUUID()};
            if(source)updateItem?.(id,{name:item.name,Name:item.name,geom:(item as any).geom});
            else addItem?.(item);
            setActiveId(id);setDraft(null);setSelection([id]);
          }}><Save size={14}/>{saved?'Mettre à jour la coupe':'Enregistrer'}</button>
        </details>
        <footer className="section-tool-footer">
          {draft&&<button className="btn ghost" onClick={()=>setDraft(null)}>Annuler les réglages</button>}
          {saved&&<button className="btn ghost" onClick={()=>{deleteItems?.([saved.id]);setActiveId('');setDraft(null);setSelection([]);}}><Trash2 size={13}/> Supprimer l’enregistrement</button>}
        </footer>
      </>}
      {error&&<p className="section-tool-hint section-tool-error" role="alert">{error}</p>}
      </fieldset>
    </section>
  );
  return <div ref={panelPosition.viewportRef} className="section-tool-layer">
    {is2D&&<div style={{position:'absolute',inset:0,background:'var(--bg)',zIndex:5}}>{vertical&&drawing?<svg aria-label="Coupe du bâtiment" role="img" width="100%" height="100%" viewBox={sectionViewBox(drawing)}>
      <PlanPrimitives primitives={drawing.primitives} w2s={(x,y)=>[x,-y]} unitsPerMm={SECTION_UNITS_PER_MM} minStroke={0.004}/>
    </svg>:<p style={{padding:24}}>Choisissez une coupe verticale pour afficher sa vue 2D.</p>}</div>}
    {managing&&(toolHost ? createPortal(panel, toolHost) : <div className="section-workspace">{panel}</div>)}
  </div>;
}
