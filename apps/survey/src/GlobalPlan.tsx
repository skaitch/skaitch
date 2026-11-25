import { Crosshair, Move, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { Survey } from '@skaitch/core/survey/surveyFile';
import { roomLabelPoint } from '@skaitch/core/survey/surveyFile';
import { globalPlan } from '@skaitch/core/survey/globalPlan';
import { placeRooms, type PlacementStatus, type SuggestedCote } from '@skaitch/core/survey/placement';
import { getLengthUnit } from '@skaitch/ui/components/survey/lengthUnit';
import { lengthPlaceholder, parseLength, unitLabel } from '@skaitch/core/survey/units';
import { replaceRooms, setLinkOffset, setReferenceRoom, setWallThickness } from '@skaitch/core/survey/edit';
import { surveyLanguage } from '@skaitch/core/survey/lang';
import SurveyFurnitureFootprint from '@skaitch/ui/components/survey/SurveyFurnitureFootprint';

interface Props {
  survey: Survey;
  selectedRoomId: string | null;
  onOpenRoom: (roomId: string) => void;
  /** Applies an edit; a refused edit shows its message. */
  onEdit: (edit: () => Survey) => void;
  tr: (fr: string, en: string) => string;
}

const W = 400, H = 480;
const num = (v: string) => parseLength(v, getLengthUnit());

/**
 * Global plan (spec F-16, ADR 0012): every room of the level as drawn, its placement from the
 * reference room through linked faces, the cote to measure next and the loops that do not close.
 */
export default function GlobalPlan({ survey, selectedRoomId, onOpenRoom, onEdit, tr }: Props) {
  const level = survey.levels[0];
  const plan = globalPlan(level);
  const placement = placeRooms(level);
  const pts = level.rooms.flatMap(r => r.polygon);
  const minX = Math.min(...pts.map(p => p[0])), maxX = Math.max(...pts.map(p => p[0]));
  const minY = Math.min(...pts.map(p => p[1])), maxY = Math.max(...pts.map(p => p[1]));
  const scale = pts.length ? Math.min(335 / Math.max(0.1, maxX - minX), 365 / Math.max(0.1, maxY - minY), 95) : 1;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const to = ([x, y]: [number, number]): [number, number] => [W / 2 + (x - cx) * scale, H / 2 - (y - cy) * scale];
  const flagged = new Set([...plan.discrepancies.flatMap(d => d.wallIds), ...placement.closures.flatMap(c => c.wallIds)]);
  const toReplace = [...placement.rooms.values()].filter(p => p.toReplace && !level.rooms.find(r => r.id === p.roomId)!.frozen);
  const placedCount = [...placement.rooms.values()].filter(p => p.polygon).length;
  const others = placement.suggestions.filter(s => s !== placement.next);
  const selected = level.rooms.find(r => r.id === selectedRoomId);

  const statusLabel: Record<PlacementStatus, string> = {
    reference: tr('Pièce de référence', 'Reference room'),
    placed: tr('Placée', 'Placed'),
    assumed: tr('Placement supposé', 'Assumed placement'),
    unplaced: tr('Non placée', 'Not placed'),
  };

  return (
    <div className="main">
      <div className="global-header">
        <div>
          <div className="eyebrow">{tr('Niveau', 'Level')} · {level.name}</div>
          <h2>{tr('Plan global', 'Global plan')}</h2>
        </div>
        <span className={`statbadge ${placedCount < level.rooms.length || placement.closures.length || plan.discrepancies.length ? 'alert' : ''}`}>
          {placedCount}/{level.rooms.length} {tr('placées', 'placed')}
        </span>
      </div>
      <div className="workspace global-workspace">
        <svg id="globalPlan" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tr('Plan global du niveau', 'Global plan of the level')}>
          <defs><pattern id="gg" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M22 0H0V22" fill="none" stroke="#ebebeb" /></pattern></defs>
          <rect width={W} height={H} fill="url(#gg)" />
          {level.rooms.map((room, k) => {
            const p = room.polygon.map(to);
            const where = placement.rooms.get(room.id)!;
            const placed = where.status === 'placed' || where.status === 'reference';
            const sel = room.id === selectedRoomId;
            const [lx, ly] = to(roomLabelPoint(room.polygon));
            return (
              <g key={room.id} data-global-room={room.id} data-placement={where.status} onClick={() => onOpenRoom(room.id)} role="button" aria-label={room.name}>
                <polygon points={p.map(q => q.join(',')).join(' ')} fillOpacity={0.9}
                  fill={sel ? '#d4d4d4' : !placed ? '#fff7e8' : k % 2 ? '#e4edfb' : '#f4e9d8'}
                  stroke={placed ? '#545454' : '#df9043'} strokeWidth={3.2} strokeLinejoin="round" strokeDasharray={placed ? undefined : '7 5'} />
                {room.furniture?.map(f => <SurveyFurnitureFootprint key={f.id} furniture={f} at={to(f.center)} scale={scale} color="#545454" lang={surveyLanguage()} />)}
                {room.walls.filter(w => flagged.has(w.id)).map(w => {
                  const [a, b] = [to(room.polygon[w.from]), to(room.polygon[w.to])];
                  return <line key={w.id} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#df9043" strokeWidth={6} strokeLinecap="round" />;
                })}
                <text x={lx} y={ly - 4} fontSize={13} fontWeight={800} fill="#404040" textAnchor="middle">{room.name}</text>
                <text x={lx} y={ly + 12} fontSize={10} fill={placed ? '#8c8c8c' : '#9d7843'} textAnchor="middle">
                  {where.toReplace ? `${statusLabel[where.status]} · ${tr('à replacer', 'to replace')}` : statusLabel[where.status]}
                </text>
              </g>
            );
          })}
          {/* Where "Replace" would move the rooms whose drawing no longer matches their cotes. */}
          {toReplace.map(p => (
            <polygon key={`ghost-${p.roomId}`} data-replace-ghost={p.roomId} points={p.polygon!.map(q => to(q).join(',')).join(' ')}
              fill="none" stroke="#0a0a0a" strokeWidth={2} strokeDasharray="4 4" pointerEvents="none" />
          ))}
          {!level.rooms.length && <text x={W / 2} y={H / 2} textAnchor="middle" fill="#919191">{tr('Aucune pièce', 'No room')}</text>}
        </svg>
      </div>
      <div className="global-panel">
        <div className="global-actions">
          {/* Each room is placed against the room it is linked to, from the shared wall's offset and thickness. */}
          {toReplace.map(p => {
            const r = level.rooms.find(x => x.id === p.roomId)!;
            const against = p.via ? level.rooms.find(x => x.id === p.via!.fromRoomId)?.name : undefined;
            return (
              <button key={p.roomId} className="primary-btn" data-place-room={p.roomId} onClick={() => onEdit(() => replaceRooms(survey, level.id, [p.roomId]))}>
                <Move /> {against ? tr(`Placer ${r.name} contre ${against}`, `Place ${r.name} against ${against}`) : tr(`Replacer ${r.name}`, `Replace ${r.name}`)}
              </button>
            );
          })}
          {toReplace.length > 1 && (
            <button className="secondary-btn" onClick={() => onEdit(() => replaceRooms(survey, level.id))}>
              <Move /> {tr(`Tout replacer (${toReplace.length})`, `Replace all (${toReplace.length})`)}
            </button>
          )}
          {selected && selected.id !== placement.referenceId && (
            <button className="secondary-btn" onClick={() => onEdit(() => setReferenceRoom(survey, selected.id))}>
              <Crosshair /> {tr(`${selected.name} comme référence`, `${selected.name} as reference`)}
            </button>
          )}
        </div>
        {placement.next && <SuggestionCard key={suggestionKey(placement.next)} suggestion={placement.next} survey={survey} onOpenRoom={onOpenRoom} onEdit={onEdit} tr={tr} />}
        {placement.closures.map((c, i) => <div key={`c${i}`} className="notice" style={{ margin: '7px 13px' }}><TriangleAlert /> {c.message}</div>)}
        {plan.discrepancies.map((d, i) => <div key={`d${i}`} className="notice" style={{ margin: '7px 13px' }}><TriangleAlert /> {d.message}</div>)}
        {others.length > 0 && (
          <div className="unplaced-list">
            {tr('Ensuite :', 'Then:')}
            {others.map(s => <button key={suggestionKey(s)} title={s.message} onClick={() => onOpenRoom(s.roomId)}>{level.rooms.find(r => r.id === s.roomId)?.name}</button>)}
          </div>
        )}
        {!placement.suggestions.length && !placement.closures.length && level.rooms.length > 0 && (
          <div className="global-summary">{tr('Toutes les pièces sont placées par des mesures.', 'Every room is placed by measurements.')}</div>
        )}
      </div>
    </div>
  );
}

const suggestionKey = (s: SuggestedCote) => `${s.kind}:${s.roomId}:${s.wallId ?? ''}`;

/** The cote to measure next, typed in place when it is a link offset or a wall thickness. */
function SuggestionCard({ suggestion, survey, onOpenRoom, onEdit, tr }: {
  suggestion: SuggestedCote; survey: Survey; onOpenRoom: (roomId: string) => void; onEdit: (edit: () => Survey) => void; tr: (fr: string, en: string) => string;
}) {
  const [value, setValue] = useState('');
  const typed = suggestion.kind === 'offset' || suggestion.kind === 'thickness';
  const v = num(value);
  const valid = suggestion.kind === 'offset' ? v >= 0 : v > 0;
  const submit = () => {
    if (!valid || !suggestion.wallId || (suggestion.kind === 'offset' && !suggestion.other)) return;
    const face = { roomId: suggestion.roomId, wallId: suggestion.wallId };
    onEdit(() => suggestion.kind === 'offset' ? setLinkOffset(survey, face, suggestion.other!, v) : setWallThickness(survey, face.roomId, face.wallId, v, true));
  };
  return (
    <form className="suggestion-card" data-suggestion={suggestion.kind} onSubmit={e => { e.preventDefault(); submit(); }}>
      <div className="eyebrow">{tr('Cote suggérée', 'Suggested cote')}{suggestion.affects.length > 1 ? ` · ${tr(`débloque ${suggestion.affects.length} pièces`, `unblocks ${suggestion.affects.length} rooms`)}` : ''}</div>
      <p>{suggestion.message}</p>
      {typed ? (
        <div className="suggestion-input">
          <label className="field">{suggestion.kind === 'offset' ? tr(`Décalage mesuré (${unitLabel(getLengthUnit())})`, `Measured offset (${unitLabel(getLengthUnit())})`) : tr(`Épaisseur mesurée (${unitLabel(getLengthUnit())})`, `Measured thickness (${unitLabel(getLengthUnit())})`)}
            <input inputMode={getLengthUnit() === 'ft-in' ? 'text' : 'decimal'} value={value} onChange={e => setValue(e.target.value)} placeholder={lengthPlaceholder(getLengthUnit())} />
          </label>
          <button type="submit" className="primary-btn" disabled={!valid}>{tr('Valider', 'Save')}</button>
        </div>
      ) : (
        <button type="button" className="secondary-btn" onClick={() => onOpenRoom(suggestion.roomId)}>{tr('Ouvrir la pièce', 'Open the room')}</button>
      )}
    </form>
  );
}
