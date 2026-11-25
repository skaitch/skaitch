import { useState } from 'react';
import type { ItemsMap } from '@skaitch/core/types/ifc';
import { proposeOpening, validateOpening, type StairGeom, type StairOpening } from '@skaitch/core/lib/stairGeometry';
export default function StairOpeningEditor({g,parentId,items,onChange,ownerId}:{g:StairGeom;parentId:string|null;items:ItemsMap;onChange:(opening:StairOpening|undefined)=>void;ownerId:string}) {
  const [draft,setDraft]=useState<StairOpening|null>(null),[error,setError]=useState('');
  return <div className="stair-opening-editor">
    <button className="btn ghost" onClick={()=>{const o=proposeOpening(g,parentId,items);setDraft(o);setError(o?'':'Aucune dalle à l’étage d’arrivée ne contient la trémie proposée.');}}>Proposer une trémie</button>
    {g.opening && <button className="btn ghost" onClick={()=>{setDraft({...g.opening!});setError('');}}>Modifier la trémie</button>}
    {draft && <fieldset><legend>Trémie proposée</legend>
      {(['x','y','width','depth'] as const).map(k=><label key={k}>{{x:'X',y:'Y',width:'Largeur',depth:'Profondeur'}[k]} <span className="field-value"><input type="number" step="0.05" value={draft[k]} onChange={e=>setDraft({...draft,[k]:Number(e.target.value)})}/><span className="unit">m</span></span></label>)}
      <button className="btn ghost" onClick={()=>{try{validateOpening(draft,g.targetId,items,ownerId);onChange(draft);setDraft(null);setError('');}catch(e){setError((e as Error).message);}}}>Valider la trémie</button>
      <button className="btn ghost" onClick={()=>setDraft(null)}>Annuler</button>
    </fieldset>}
    {g.opening && <button className="btn ghost" onClick={()=>{onChange(undefined);setDraft(null);}}>Supprimer la trémie</button>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
