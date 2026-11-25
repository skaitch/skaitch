import type { ItemsMap } from '../types/ifc.js';
export const STAIR_FORMS = { straight: 'Droit', quarter: 'Quart tournant', doubleQuarter: 'Deux quarts tournants', half: 'Demi-tournant', spiral: 'Colimaçon' };
export interface StairGeom {
  opening?: StairOpening;
  startWinders?: boolean;
  flightLengths?: number[];
  landings?: { length: number; width: number }[];
  turnRadius?: number;
  x: number; y: number; rotation: number; width: number; going: number;
  form: keyof typeof STAIR_FORMS; targetId: string; count?: number;
  turn: number; landing: boolean; landingLength?: number; radius: number; railLeft: boolean; railRight: boolean; railHeight: number; railStyle: 'bars' | 'solid';
}
export const STAIR_DEFAULTS: StairGeom = { x: 0, y: 0, rotation: 0, width: 1, going: .27, form: 'straight', targetId: '', turn: 1, landing: true, radius: .3, railLeft: true, railRight: true, railHeight: 1, railStyle: 'bars' };
export type StairPart = { polygon: [number, number][]; z: number; thickness: number; kind: 'step' | 'landing' | 'rail'; flight?: number; going?: number };
export function stairFlightCount(form: StairGeom['form']) {
  return form === 'doubleQuarter' ? 3 : form === 'quarter' || form === 'half' ? 2 : 1;
}
export function canStartWithWinders(g: StairGeom) {
  return !g.landing && (g.form==='quarter'||g.form==='doubleQuarter'||g.form==='half');
}
export function hasStairWinderStart(g: StairGeom) {
  return (g.form==='quarter'||g.form==='doubleQuarter'||g.form==='half') && (g.startWinders===true || (!g.landing&&g.flightLengths?.[0]===0));
}
export function stairBaseCount(g: StairGeom, height: number) {
  return g.count ?? Math.max(2, Math.round(height / .175));
}
export function stairFlightDimensions(g: StairGeom, count: number) {
  const flights = stairFlightCount(g.form);
  const winders = g.landing ? 0 : g.form === 'half' ? 6 : 3;
  const total = count - 1 - (flights - 1) * winders;
  return Array.from({length: flights}, (_, i) => {
    const defaultSteps = Math.floor(total / flights) + (i < total % flights ? 1 : 0);
    // Restore the first flight of stairs saved by the former zero-length start option.
    const requested = i===0&&g.flightLengths?.[i]===0 ? undefined : g.flightLengths?.[i];
    const steps = requested === undefined ? defaultSteps : Math.max(1, Math.round(requested / g.going));
    return { steps, length: steps * g.going, going: g.going };
  });
}
export function stairLandingDimensions(g: StairGeom, index: number) {
  return g.landings?.[index] ?? { length: g.landingLength ?? g.width, width: g.form === 'half' ? 2 * g.width + .1 : g.width };
}
export function buildStair(g: StairGeom, parentId: string | null, items: ItemsMap) {
  const base = Number((items[parentId ?? ''] as any)?.geom?.elevation ?? 0);
  const target = items[g.targetId];
  const height = Number((target as any)?.geom?.elevation) - base;
  const warnings: string[] = [];
  const parts: StairPart[] = [];
  if (target?.type !== 'Storey' || !(height > 0) || ![g.x,g.y,g.rotation,g.width,g.going,g.radius,g.railHeight].every(Number.isFinite) || g.width <= 0 || g.going <= 0 || g.radius < 0 || g.railHeight <= 0 || !(g.form in STAIR_FORMS)) return { parts, warnings: ['Choisir un étage supérieur et des dimensions positives.'], height, count: 0, rise: 0 };
  try { validateStair(g,parentId); } catch(e) { return {parts,warnings:[(e as Error).message],height,count:0,rise:0}; }
  const baseCount = stairBaseCount(g,height);
  const layout = stairFlightDimensions(g,baseCount);
  const windersPerTurn = g.landing ? 0 : g.form==='half' ? 6 : 3;
  const addedStartSteps=hasStairWinderStart(g)&&g.landing?(g.form==='half'?6:3):0;
  const count = addedStartSteps + (g.form!=='spiral' && g.flightLengths?.length ? 1+layout.reduce((n,f)=>n+f.steps,0)+(stairFlightCount(g.form)-1)*windersPerTurn : baseCount);
  if (!Number.isInteger(count) || count < 2 || count > 300) return { parts, warnings: ['Nombre de marches : entier entre 2 et 300.'], height, count, rise: 0 };
  const rise = height / count;
  if (rise < .12 || rise > .22 || 2 * rise + g.going < .55 || 2 * rise + g.going > .7) warnings.push('Proportions de marches à vérifier.');
  const transform = (x: number, y: number): [number, number] => [g.x + x * Math.cos(g.rotation) - y * Math.sin(g.rotation), g.y + x * Math.sin(g.rotation) + y * Math.cos(g.rotation)];
  const add = (p: [number, number][], z: number, thickness: number, kind: StairPart['kind']) => parts.push({ polygon: p.map(([x,y]) => transform(x,y)), z, thickness, kind, flight: flightIndex, going: flightGoing });
  let x = 0, y = 0, angle = 0, flightIndex = 0, flightGoing = g.going;
  const flights = stairFlightCount(g.form);
  const turnAngle = g.form === 'half' ? Math.PI : Math.PI / 2;
  const rect = (cx: number, cy: number, a: number, length: number, width: number): [number,number][] => [[0,-width/2],[length,-width/2],[length,width/2],[0,width/2]].map(([u,v]) => [cx+u*Math.cos(a)-v*Math.sin(a), cy+u*Math.sin(a)+v*Math.cos(a)]);
  let stepIndex = 0;
  const tread = (poly: [number, number][], kind: 'step' | 'landing' = 'step') => {
    if (kind === 'step') stepIndex++;
    const z = stepIndex * rise;
    add(poly,z,Math.min(.06,rise),kind);
    if(kind==='landing') return;
    for (const side of [0,1]) {
      if (!(side ? g.railRight : g.railLeft)) continue;
      rail(poly[side ? 3 : 0],poly[side ? 2 : 1],z);
    }
  };
  const rail=(a:[number,number],b:[number,number],z:number)=>{
    const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
    if(len<.001) return;
    const nx=-dy/len*.025,ny=dx/len*.025;
    add([[a[0]-nx,a[1]-ny],[b[0]-nx,b[1]-ny],[b[0]+nx,b[1]+ny],[a[0]+nx,a[1]+ny]],z+g.railHeight,g.railStyle==='solid'?g.railHeight:.05,'rail');
    if(g.railStyle==='bars') {
      // shortcut: cap posts on oversized treads, use instancing for unusually large stairs.
      const posts=Math.max(1,Math.min(100,Math.ceil(len/.12)));
      for(let k=0;k<=posts;k++) add(rect(a[0]+dx*k/posts,a[1]+dy*k/posts,0,.025,.025),z+g.railHeight,g.railHeight,'rail');
    }
  };
  const addWinder=(a:number,turnAngle:number,winders:number)=>{
    const delta=turnAngle*g.turn;
        // shortcut: equal-angle winders, use a walking-line solver for bespoke balancing.
        const inner=g.turnRadius ?? (turnAngle===Math.PI?.05:0), radius=inner+g.width/2;
        flightGoing=(inner+g.width/2)*turnAngle/winders;
        const cx=x-Math.sin(a)*radius*g.turn,cy=y+Math.cos(a)*radius*g.turn;
        const start=a-g.turn*Math.PI/2;
        const radial=(r:number,t:number):[number,number]=>[cx+r*Math.cos(t),cy+r*Math.sin(t)];
        for(let k=0;k<winders;k++) {
          const t=start+delta*k/winders,u=start+delta*(k+1)/winders;
          tread(g.turn===1 ? [radial(inner,t),radial(inner,u),radial(inner+g.width,u),radial(inner+g.width,t)] : [radial(inner+g.width,t),radial(inner+g.width,u),radial(inner,u),radial(inner,t)]);
        }
        [x,y]=radial(radius,start+delta);
  };
  if(g.form === 'spiral') {
    const da=g.going/(g.radius+g.width/2);
    for(let i=0;i<count-1;i++) {
      const a=i*da*g.turn,b=(i+1)*da*g.turn;
      const radial=(r:number,t:number):[number,number]=>[r*Math.cos(t),r*Math.sin(t)];
      tread(g.turn===1 ? [radial(g.radius,a),radial(g.radius,b),radial(g.radius+g.width,b),radial(g.radius+g.width,a)] : [radial(g.radius+g.width,a),radial(g.radius+g.width,b),radial(g.radius,b),radial(g.radius,a)]);
    }
    if(2*Math.PI/da*rise < 2) warnings.push('Échappée entre les tours du colimaçon à vérifier.');
  } else {
    const turns=flights-1;
    const winders=g.landing?0:(g.form==='half'?6:3);
    const straightSteps=count-1-turns*winders;
    if(layout.some((f,i)=>f.steps<(i===0&&canStartWithWinders(g)?0:1))) return {parts:[],warnings:['Nombre de marches insuffisant pour cette forme.'],height,count,rise};
    const dimensions=layout;
    if(hasStairWinderStart(g)) {
      flightIndex=-1;
      addWinder(angle,turnAngle,g.form==='half'?6:3);
      angle+=turnAngle*g.turn;
    }
    for(let flight=0;flight<flights;flight++) {
      flightIndex=flight;
      const {steps:n,going}=dimensions[flight];
      flightGoing=going;
      if(2*rise+going<.55 || 2*rise+going>.7) warnings.push(`Giron de la volée ${flight+1} à vérifier.`);
      for(let i=0;i<n;i++) {
        tread(rect(x,y,angle,going,g.width));x+=going*Math.cos(angle);y+=going*Math.sin(angle);
      }
      if(flight===flights-1) break;
      // The first turn already occurred at the departure; do not generate it twice.
      if(flight===0 && hasStairWinderStart(g)) continue;
      const a=angle, delta=turnAngle*g.turn;
      if(g.landing) {
        const {width:span,length}=stairLandingDimensions(g,flight);
        const p=rect(x,y,a,length,span);
        const offset=(span-g.width)/2*g.turn;
        tread(p.map(([u,v])=>[u-Math.sin(a)*offset,v+Math.cos(a)*offset]),'landing');
        const local=(u:number,v:number):[number,number]=>[x+u*Math.cos(a)-v*Math.sin(a)*g.turn,y+u*Math.sin(a)+v*Math.cos(a)*g.turn];
        const outer=g.turn===1?g.railRight:g.railLeft,inner=g.turn===1?g.railLeft:g.railRight;
        const edge=(u:number,v:number,r:number,t:number)=>rail(local(u,v),local(r,t),stepIndex*rise);
        if(outer) {
          edge(0,-g.width/2,length,-g.width/2);
          edge(length,-g.width/2,length,span-g.width/2);
          if(g.form==='half') edge(length,span-g.width/2,0,span-g.width/2);
        }
        if(inner) {
          if(g.form==='half') edge(0,g.width/2,0,span-1.5*g.width);
          else {edge(0,g.width/2,0,span-g.width/2);edge(0,span-g.width/2,length-g.width,span-g.width/2);}
        }
        if(g.form==='half') {x-=Math.sin(a)*(span-g.width)*g.turn;y+=Math.cos(a)*(span-g.width)*g.turn;}
        else {x+=Math.cos(a)*(length-g.width/2)-Math.sin(a)*(span-g.width/2)*g.turn;y+=Math.sin(a)*(length-g.width/2)+Math.cos(a)*(span-g.width/2)*g.turn;}
      } else {
        addWinder(a,turnAngle,winders);
      }
      angle+=delta;
    }
  }
  const steps=parts.filter(p=>p.kind!=='rail');
  if(Object.values(items).some(it=>{
    if(it.type!=='Wall'||it.parentId!==parentId) return false;
    const w=it.geom,dx=w.x2-w.x1,dy=w.y2-w.y1,l=Math.hypot(dx,dy)||1,nx=-dy/l*w.thickness/2,ny=dx/l*w.thickness/2;
    const polygon:[number,number][]=[[w.x1+nx,w.y1+ny],[w.x2+nx,w.y2+ny],[w.x2-nx,w.y2-ny],[w.x1-nx,w.y1-ny]];
    return steps.some(p=>p.z-p.thickness<w.height && polygonsOverlap(p.polygon,polygon));
  })) warnings.push('L’escalier rencontre un mur : dimensions conservées, implantation à ajuster.');
  if(g.opening) {
    try {validateOpening(g.opening,g.targetId,items);} catch(e) {warnings.push((e as Error).message);}
    if(steps.some(p=>height-p.z<2 && !p.polygon.every(v=>pointInPolygon(v,openingPolygon(g.opening!))))) warnings.push('Trémie ou échappée à vérifier après modification de l’escalier.');
  }
  return { parts, warnings, height, count, rise };
}

export interface StairOpening { slabId: string; x: number; y: number; width: number; depth: number; }
export function openingPolygon(o: StairOpening): [number,number][] {
  return [[o.x,o.y],[o.x+o.width,o.y],[o.x+o.width,o.y+o.depth],[o.x,o.y+o.depth]];
}
export function pointInPolygon(p:[number,number], polygon:[number,number][]) {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i],b=polygon[j];
    if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
  }
  return inside;
}
export function slabOpenings(slabId:string, items:ItemsMap) {
  return Object.values(items).flatMap(i=>{
    if(i.type!=='Stair'||i.geom.opening?.slabId!==slabId) return [];
    try {validateOpening(i.geom.opening,i.geom.targetId,items);return [openingPolygon(i.geom.opening)];} catch {return [];}
  });
}
export function validateStairOpenings(items: ItemsMap) {
  for (const item of Object.values(items)) {
    if (item.type === 'Stair' && item.geom.opening) validateOpening(item.geom.opening, item.geom.targetId, items, item.id);
  }
}
export function proposeOpening(g:StairGeom,parentId:string|null,items:ItemsMap):StairOpening | null {
  const pts=buildStair(g,parentId,items).parts.filter(p=>p.kind!=='rail').flatMap(p=>p.polygon);
  if(!pts.length) return null;
  const x=Math.min(...pts.map(p=>p[0]))-.05,y=Math.min(...pts.map(p=>p[1]))-.05;
  const width=Math.max(...pts.map(p=>p[0]))-x+.05,depth=Math.max(...pts.map(p=>p[1]))-y+.05;
  const o={slabId:'',x,y,width,depth};
  const slab=Object.values(items).find(i=>i.type==='Slab' && i.parentId===g.targetId && openingPolygon(o).every(p=>pointInPolygon(p,i.geom.polygon)));
  if(!slab) return null;
  const proposal={...o,slabId:slab.id};
  try {validateOpening(proposal,g.targetId,items,Object.values(items).find(i=>i.type==='Stair'&&i.geom===g)?.id);return proposal;} catch {return null;}
}
export function validateOpening(o:StairOpening,targetId:string,items:ItemsMap,ownerId?:string) {
  const slab=items[o.slabId];
  if(![o.x,o.y,o.width,o.depth].every(Number.isFinite)||o.width<=0||o.depth<=0||slab?.type!=='Slab'||slab.parentId!==targetId) throw new Error('Trémie : dimensions positives et dalle de l’étage d’arrivée requises.');
  if(!openingPolygon(o).every(p=>pointInPolygon(p,slab.geom.polygon)) || boundariesCross(openingPolygon(o),slab.geom.polygon)) throw new Error('La trémie doit rester à l’intérieur de la dalle.');
  if(Object.values(items).some(i=>{
    if(i.type!=='Stair'||i.id===ownerId||i.geom.opening===o||i.geom.opening?.slabId!==o.slabId) return false;
    const other=i.geom.opening;
    return o.x<other.x+other.width && o.x+o.width>other.x && o.y<other.y+other.depth && o.y+o.depth>other.y;
  })) throw new Error('La trémie chevauche une autre trémie de cette dalle.');
}
export function validateStair(g:StairGeom,parentId:string|null,items?:ItemsMap,ownerId?:string) {
  if(![g.x,g.y,g.rotation,g.width,g.going,g.radius,g.railHeight].every(n=>typeof n==='number'&&Number.isFinite(n))||g.width<=0||g.going<=0||g.radius<0||g.railHeight<=0||!Object.prototype.hasOwnProperty.call(STAIR_FORMS,g.form)||![1,-1].includes(g.turn)||!['bars','solid'].includes(g.railStyle)||[g.landing,g.railLeft,g.railRight].some(v=>typeof v!=='boolean')||typeof g.targetId!=='string'||(g.count!==undefined&&(!Number.isInteger(g.count)||g.count<2||g.count>300))) throw new Error('Paramètres d’escalier invalides.');
  if(g.flightLengths!==undefined && (!Array.isArray(g.flightLengths)||g.flightLengths.length>3||g.flightLengths.some((n,i)=>typeof n!=='number'||!Number.isFinite(n)||n<0||(n===0&&!(i===0&&canStartWithWinders(g)))))) throw new Error('Longueurs de volées positives ; seule la première peut être nulle pour un départ rayonnant.');
  if(g.landings!==undefined && (!Array.isArray(g.landings)||g.landings.length>2||g.landings.some(p=>!p||![p.length,p.width].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0)))) throw new Error('Dimensions des paliers invalides.');
  if(g.landing && g.form!=='spiral' && g.form!=='straight' && g.landings?.slice(0,stairFlightCount(g.form)-1).some(p=>p.length<g.width || p.width<(g.form==='half'?2*g.width:g.width))) throw new Error('Les paliers doivent contenir toute la largeur des volées.');
  if(g.turnRadius!==undefined && (typeof g.turnRadius!=='number'||!Number.isFinite(g.turnRadius)||g.turnRadius<0)) throw new Error('Rayon du tournant invalide.');
  if(g.startWinders!==undefined&&typeof g.startWinders!=='boolean') throw new Error('Départ rayonnant invalide.');
  if(g.landingLength!==undefined && (!Number.isFinite(g.landingLength)||g.landingLength<g.width)) throw new Error('La profondeur du palier doit être au moins égale à la largeur de l’escalier.');
  if(g.opening && (!g.opening.slabId || ![g.opening.x,g.opening.y,g.opening.width,g.opening.depth].every(Number.isFinite) || g.opening.width<=0 || g.opening.depth<=0)) throw new Error('Paramètres de trémie invalides.');
  if(items) {
    if(items[parentId??'']?.type!=='Storey'||items[g.targetId]?.type!=='Storey'||Number((items[g.targetId] as any).geom.elevation)<=Number((items[parentId??''] as any).geom.elevation)) throw new Error('Choisir un étage d’arrivée au-dessus de l’étage de départ.');
    if(g.opening) validateOpening(g.opening,g.targetId,items,ownerId);
  }
}
export function stairComponents(parts:StairPart[]) {
  const groups=new Map<string,StairPart[]>();
  for(const part of parts) {
    const key=part.kind==='rail'?'rail':`${part.kind}_${part.flight??0}_${part.kind==='step'?part.going:0}`;
    const group=groups.get(key)??[];group.push(part);groups.set(key,group);
  }
  return [...groups.values()];
}

function boundariesCross(a:[number,number][],b:[number,number][]) {
  const cross=(a:[number,number],b:[number,number],c:[number,number])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  return a.some((p,i)=>b.some((q,j)=>{const r=a[(i+1)%a.length],s=b[(j+1)%b.length];return cross(p,r,q)*cross(p,r,s)<-1e-10 && cross(q,s,p)*cross(q,s,r)<-1e-10;}));
}
function polygonsOverlap(a:[number,number][],b:[number,number][]) {
  return boundariesCross(a,b)||a.some(p=>pointInPolygon(p,b))||b.some(p=>pointInPolygon(p,a));
}

/** Straight-flight endpoints come from the same polygons used for rendering and export. */
export function stairFlightHandles(g: StairGeom, parentId: string | null, items: ItemsMap) {
  if (g.form === 'spiral') return [];
  const model = buildStair(g, parentId, items);
  if (!model.parts.length) return [];
  return stairFlightDimensions(g, stairBaseCount(g,model.height)).flatMap((flight, index) => {
    const steps = model.parts.filter(p => p.kind === 'step' && p.flight === index).slice(0, flight.steps);
    if (!steps.length) return [];
    const first = steps[0].polygon, last = steps[steps.length - 1].polygon;
    const start: [number, number] = [(first[0][0] + first[3][0]) / 2, (first[0][1] + first[3][1]) / 2];
    const end: [number, number] = [(last[1][0] + last[2][0]) / 2, (last[1][1] + last[2][1]) / 2];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const direction: [number, number] = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
    return [{ index, start, end, direction, length }];
  });
}

export function stairFlightLengthAt(start: [number, number], direction: [number, number], point: [number, number], offset = 0, minimum = .01) {
  return Math.max(minimum, (point[0] - start[0]) * direction[0] + (point[1] - start[1]) * direction[1] - offset);
}

export function stairAscentPath(parts: StairPart[]): [number, number][] {
  const treads = parts.filter(p => p.kind !== 'rail');
  if (!treads.length) return [];
  const first = treads[0].polygon, last = treads[treads.length - 1].polygon;
  return [
    [(first[0][0] + first[3][0]) / 2, (first[0][1] + first[3][1]) / 2],
    ...treads.map(({polygon}) => polygon.reduce<[number,number]>((sum,p)=>[sum[0]+p[0]/polygon.length,sum[1]+p[1]/polygon.length],[0,0])),
    [(last[1][0] + last[2][0]) / 2, (last[1][1] + last[2][1]) / 2],
  ];
}
