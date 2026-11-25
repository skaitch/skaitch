import { wallLabel } from '@skaitch/core/survey/edit';
import { setSurveyLanguage, surveyLangOf, surveyLanguage, tr as surveyTr } from '@skaitch/core/survey/lang';
import { useEffect, useRef, useState } from 'react';
import type { ReceivedSurvey, SurveyInbox, SurveyPairingKey } from '../../platform';
import {
  readSurveyArchive, surveyDefaults, surveyWarnings, SurveyFileError, SURVEY_EXTENSION, type StoreySurvey, type Survey,
} from '@skaitch/core/survey/surveyFile';
import { technicalPointChecks } from '@skaitch/core/survey/checks';
import type { LevelAssociation } from '@skaitch/core/survey/association';
import { globalPlan } from '@skaitch/core/survey/globalPlan';
import type { ConflictResolution, ReconstructionConflict } from '@skaitch/core/survey/reconstruct';
import SurveyPlan from './SurveyPlan';
import QRCode from 'qrcode';

interface Props {
  /** Surveys sent from the Survey app to the account (web only, ADR 0011). */
  inbox?: SurveyInbox;
  survey: StoreySurvey | undefined;
  lang: string;
  onChange: (survey: StoreySurvey | undefined) => void;
  /** Rebuilds the storey's walls and spaces; applies nothing while conflicts remain unresolved. */
  onReconstruct?: (resolutions: Record<string, ConflictResolution>) => {
    created: number; updated: number; deleted: number; kept: number; conflicts: ReconstructionConflict[];
  };
  /** Level association: without it, the first survey level is attached to this storey. */
  association?: {
    storeys: { id: string; name: string }[];
    propose: (survey: Survey) => LevelAssociation[];
    apply: (survey: Survey, association: LevelAssociation[], photos: Record<string, string>) => void;
  };
}

/** Survey tab of a storey: imports a survey file and shows the associated level. */
export default function SurveyTab({ inbox, survey, lang, onChange, onReconstruct, association }: Props) {
  // Texts follow the interface language, through the survey language tables (11 languages).
  const tr = (fr: string, en: string) => { if (surveyLanguage() !== surveyLangOf(lang)) setSurveyLanguage(lang); return surveyTr(fr, en); };
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [conflicts, setConflicts] = useState<{ list: ReconstructionConflict[]; choice: Record<string, ConflictResolution> } | null>(null);

  function reconstruct(resolutions: Record<string, ConflictResolution>) {
    setError('');
    try {
      const r = onReconstruct!(resolutions);
      if (r.conflicts.length) {
        setNote('');
        // Untouched elements of a previous survey are deleted by default; anything changed by hand is kept.
        setConflicts({ list: r.conflicts, choice: Object.fromEntries(r.conflicts.map(c => [c.id, c.previousSurvey && !c.previousSurvey.modified ? 'overwrite' as const : 'keep' as const])) });
        return;
      }
      setConflicts(null);
      const result = tr(`Reconstruction : ${r.created} créé(s), ${r.updated} mis à jour, ${r.deleted} supprimé(s)${r.kept ? `, ${r.kept} conservé(s) tel(s) quel(s)` : ''}.`,
        `Reconstruction: ${r.created} created, ${r.updated} updated, ${r.deleted} deleted${r.kept ? `, ${r.kept} kept as is` : ''}.`);
      const incomplete = pointChecks.length;
      setNote(incomplete ? `${result} ${tr(`${incomplete} point(s) technique(s) hors du mur. Corrigez leur position dans Survey.`,
        `${incomplete} technical point(s) are outside their wall. Correct their position in Survey.`)}` : result);
    } catch (e) { setError((e as Error).message); }
  }
  const [pending, setPending] = useState<{ survey: Survey; association: LevelAssociation[]; photos: Record<string, string> } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  function applyPending(p: { survey: Survey; association: LevelAssociation[]; photos: Record<string, string> }) {
    try {
      association!.apply(p.survey, p.association, p.photos);
      setPending(null);
      const n = p.association.filter(a => a.target).length;
      setNote(tr(`${n} niveau(x) relevé(s) associé(s).`, `${n} survey level(s) attached.`));
    } catch (e) { setError((e as Error).message); }
  }

  async function importFile(file: File) {
    await importBytes(new Uint8Array(await file.arrayBuffer()));
  }

  /** A received survey is imported exactly like a file. */
  async function importBytes(bytes: Uint8Array) {
    setError(''); setNote(''); setConflicts(null);
    try {
      const archive = readSurveyArchive(bytes);
      const parsed = archive.survey;
      const photos = await reducePhotos(parsed, archive.photos);
      if (association) {
        const p = { survey: parsed, association: association.propose(parsed), photos };
        if (parsed.levels.length > 1) setPending(p); else applyPending(p);
        return;
      }
      const level = parsed.levels[0];
      if (parsed.levels.length > 1)
        setNote(tr(`Ce relevé contient ${parsed.levels.length} niveaux ; seul « ${level.name} » est associé à cet étage.`,
          `This survey has ${parsed.levels.length} levels; only "${level.name}" is attached to this storey.`));
      const levelPhotos = Object.fromEntries(level.rooms.flatMap(r => (r.photos ?? []).map(p => [p.id, photos[p.id]])).filter(([, u]) => u));
      onChange({ surveyId: parsed.id, surveyName: parsed.name, importedAt: new Date().toISOString(), level, ...(Object.keys(levelPhotos).length ? { photos: levelPhotos } : {}) });
    } catch (e) {
      setError(e instanceof SurveyFileError ? e.message : tr('Impossible de lire ce fichier relevé.', 'Unable to read this survey file.'));
    }
  }

  const plan = survey ? globalPlan(survey.level) : null;
  const warnings = survey ? [...surveyWarnings({ id: survey.surveyId, name: survey.surveyName, createdAt: '', updatedAt: '', levels: [survey.level] }), ...plan!.discrepancies] : [];
  const pointChecks = survey?.level.rooms.flatMap(room => technicalPointChecks(room, room.ceilingHeight_m ?? surveyDefaults(survey).ceilingHeight_m)) ?? [];
  const pointCount = survey?.level.rooms.reduce((sum, room) => sum + (room.technicalPoints?.length ?? 0), 0) ?? 0;
  const assumed = survey?.level.rooms.some(r => r.geometryStatus === 'assumed');

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
      <input ref={input} type="file" accept={`${SURVEY_EXTENSION},application/zip`} hidden
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
      {pending ? (
        <div role="group" aria-label={tr('Association des niveaux', 'Level association')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 600 }}>{pending.survey.name}</div>
          <div style={{ color: 'var(--ink-3)' }}>{tr('Choisissez l’étage de chaque niveau relevé.', 'Choose the storey for each survey level.')}</div>
          {pending.association.map((a, i) => {
            const level = pending.survey.levels.find(l => l.id === a.levelId)!;
            const taken = new Set(pending.association.filter((o, j) => j !== i && o.target && o.target !== 'new').map(o => o.target));
            return (
              <label key={a.levelId} style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 8, alignItems: 'center' }}>
                <span>{level.name} <span style={{ color: 'var(--ink-3)' }}>· {level.rooms.length} {tr('pièce(s)', 'room(s)')}</span></span>
                <select value={a.target ?? ''} onChange={e => {
                  const target = e.target.value === '' ? null : e.target.value;
                  setPending({ ...pending, association: pending.association.map((o, j) => j === i ? { ...o, target } : o) });
                }}>
                  {association!.storeys.map(s => <option key={s.id} value={s.id} disabled={taken.has(s.id)}>{s.name}</option>)}
                  <option value="new">{tr('Nouvel étage', 'New storey')}</option>
                  <option value="">{tr('Ne pas importer', 'Do not import')}</option>
                </select>
              </label>
            );
          })}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" onClick={() => applyPending(pending)}>{tr('Associer', 'Attach')}</button>
            <button className="btn ghost" onClick={() => setPending(null)}>{tr('Annuler', 'Cancel')}</button>
          </div>
        </div>
      ) : survey ? (
        <>
          <div>
            <div style={{ fontWeight: 600 }}>{survey.surveyName}</div>
            <div style={{ color: 'var(--ink-3)' }}>
              {tr('Niveau relevé', 'Survey level')} « {survey.level.name} » · {survey.level.rooms.length} {tr('pièce(s)', 'room(s)')}
            </div>
          </div>
          <SurveyPlan level={survey.level} warnings={warnings} ceilingHeight={surveyDefaults(survey).ceilingHeight_m} lang={lang} />
          {pointCount > 0 && onReconstruct && <div style={{ color: 'var(--ink-3)' }}>
            {tr(`Points techniques : ${pointCount}. « Reconstruire » reprend les positions placées dans Survey.`,
              `Technical points: ${pointCount}. Rebuild uses the positions placed in Survey.`)}
          </div>}
          {assumed && (
            <div style={{ color: 'var(--ink-3)' }}>
              {tr('Géométrie supposée (angles droits) : contour en pointillés.', 'Assumed geometry (right angles): dashed outline.')}
            </div>
          )}
          {survey.photos && Object.keys(survey.photos).length > 0 && (
            <div>
              <div style={{ fontWeight: 600, margin: '4px 0' }}>{tr('Photos', 'Photos')} · {Object.keys(survey.photos).length}</div>
              {survey.level.rooms.filter(r => r.photos?.length).map(r => (
                <div key={r.id} style={{ marginBottom: 6 }}>
                  <div style={{ color: 'var(--ink-3)', fontSize: 11 }}>{r.name}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                    {r.photos!.filter(p => survey.photos![p.id]).map(p => {
                      const label = p.surface.kind === 'floor' ? tr('Sol', 'Floor') : p.surface.kind === 'ceiling' ? tr('Plafond', 'Ceiling')
                        : `${tr('Mur', 'Wall')} ${(w => w ? wallLabel(w) : '?')(r.walls.find(w => w.id === (p.surface as { wallId: string }).wallId))}`;
                      return (
                        <button key={p.id} title={label} onClick={() => setViewing(p.id)} style={{ padding: 0, border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', background: 'none', cursor: 'zoom-in' }}>
                          <img src={survey.photos![p.id]} alt={`${r.name} — ${label}`} style={{ display: 'block', width: '100%', aspectRatio: '1', objectFit: 'cover' }} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          {viewing && survey.photos?.[viewing] && (
            <div role="dialog" aria-label={tr('Photo', 'Photo')} onClick={() => setViewing(null)}
              style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.8)', display: 'grid', placeItems: 'center', cursor: 'zoom-out' }}>
              <img src={survey.photos[viewing]} alt="" style={{ maxWidth: '92vw', maxHeight: '92vh' }} />
            </div>
          )}
          {plan && plan.unplaced.length > 0 && (
            <div style={{ color: 'var(--ink-3)' }}>
              {tr(`Non positionnée(s) par rapport à la pièce de référence : ${plan.unplaced.map(r => r.name).join(', ')} (placée(s) à côté, contour orange).`,
                `Not placed relative to the reference room: ${plan.unplaced.map(r => r.name).join(', ')} (laid alongside, orange outline).`)}
            </div>
          )}
          {[...warnings, ...pointChecks].map((w, i) => (
            <div key={i} role="status" style={{ color: '#b45309', background: 'color-mix(in srgb, #f59e0b 12%, transparent)', padding: '6px 8px', borderRadius: 6 }}>
              ⚠ {w.message}
            </div>
          ))}
          {onReconstruct && !conflicts && (
            <button className="btn primary" onClick={() => reconstruct({})}>{tr('Reconstruire', 'Rebuild')}</button>
          )}
          {conflicts && (
            <div role="group" aria-label={tr('Conflits de reconstruction', 'Reconstruction conflicts')}
              style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: 6, background: 'color-mix(in srgb, #f59e0b 12%, transparent)' }}>
              {(() => {
                const group = conflicts.list.filter(c => c.previousSurvey && !c.previousSurvey.modified);
                if (!group.length) return null;
                const choice = conflicts.choice[group[0].id];
                return (
                  <>
                    <div style={{ fontWeight: 600, color: '#b45309' }}>
                      {tr(`${group.length} élément(s) produit(s) par un relevé précédent de cet étage`,
                        `${group.length} element(s) produced by a previous survey of this storey`)}
                    </div>
                    <div style={{ color: 'var(--ink-3)' }}>{tr('Le relevé actuel est un autre relevé : ces éléments ne seront plus suivis. Les garder risque de doublonner les murs.',
                      'The current survey is a different one: these elements will no longer be followed. Keeping them may duplicate walls.')}</div>
                    <select value={choice} onChange={e => setConflicts({ ...conflicts, choice: { ...conflicts.choice, ...Object.fromEntries(group.map(c => [c.id, e.target.value as ConflictResolution])) } })}>
                      <option value="overwrite">{tr('Les supprimer', 'Delete them')}</option>
                      <option value="keep">{tr('Les garder comme éléments ordinaires', 'Keep them as ordinary elements')}</option>
                    </select>
                  </>
                );
              })()}
              {conflicts.list.some(c => !c.previousSurvey || c.previousSurvey.modified) && (
                <div style={{ fontWeight: 600, color: '#b45309' }}>
                  {tr(`${conflicts.list.filter(c => !c.previousSurvey || c.previousSurvey.modified).length} élément(s) modifié(s) dans skAItch`,
                    `${conflicts.list.filter(c => !c.previousSurvey || c.previousSurvey.modified).length} element(s) modified in skAItch`)}
                </div>
              )}
              {conflicts.list.filter(c => !c.previousSurvey || c.previousSurvey.modified).map(c => (
                <label key={c.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
                  <span>{c.name} <span style={{ color: 'var(--ink-3)' }}>· {c.previousSurvey ? tr('relevé précédent', 'previous survey') : c.action === 'delete' ? tr('à supprimer', 'to delete') : tr('à mettre à jour', 'to update')}</span></span>
                  <select value={conflicts.choice[c.id]} onChange={e => setConflicts({ ...conflicts, choice: { ...conflicts.choice, [c.id]: e.target.value as ConflictResolution } })}>
                    <option value="keep">{tr('Conserver', 'Keep')}</option>
                    <option value="overwrite">{c.action === 'delete' ? tr('Supprimer', 'Delete') : tr('Écraser', 'Overwrite')}</option>
                  </select>
                </label>
              ))}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn primary" onClick={() => reconstruct(conflicts.choice)}>{tr('Reconstruire', 'Rebuild')}</button>
                <button className="btn ghost" onClick={() => setConflicts(null)}>{tr('Annuler', 'Cancel')}</button>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => input.current?.click()}>{tr('Réimporter', 'Re-import')}</button>
            <button className="btn ghost" onClick={() => { setNote(''); onChange(undefined); }}>{tr('Détacher', 'Detach')}</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ color: 'var(--ink-3)' }}>
            {tr("Aucun relevé n'est associé à cet étage. Importez un fichier relevé produit par l'application Survey.",
              'No survey is attached to this storey. Import a survey file from the Survey app.')}
          </div>
          <button className="btn" onClick={() => input.current?.click()}>{tr('Importer un relevé…', 'Import a survey…')}</button>
        </>
      )}
      {note && <div role="status" style={{ color: 'var(--ink-3)' }}>{note}</div>}
      {error && <div role="alert" style={{ color: '#dc2626' }}>{error}</div>}
      {inbox && !pending && <Inbox inbox={inbox} tr={tr} onImport={async s => { try { await importBytes(await inbox.download(s)); } catch (e) { setError((e as Error).message); } }} />}
    </div>
  );
}

/** Surveys received from the Survey app, and the pairing keys that send them (ADR 0011). */
function Inbox({ inbox, tr, onImport }: { inbox: SurveyInbox; tr: (fr: string, en: string) => string; onImport: (s: ReceivedSurvey) => Promise<void> }) {
  const [surveys, setSurveys] = useState<ReceivedSurvey[] | null>(null);
  const [keys, setKeys] = useState<SurveyPairingKey[] | null>(null);
  const [created, setCreated] = useState<SurveyPairingKey | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const refresh = () => { inbox.list().then(setSurveys, e => setError(String(e.message ?? e))); };
  useEffect(refresh, [inbox]);
  const date = (iso: string) => new Date(iso).toLocaleString();
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontWeight: 600, flex: 1 }}>{tr('Relevés reçus', 'Received surveys')}</div>
        <button className="btn ghost" onClick={refresh} aria-label={tr('Actualiser', 'Refresh')}>↻</button>
      </div>
      {surveys?.length === 0 && <div style={{ color: 'var(--ink-3)' }}>{tr('Aucun relevé envoyé depuis l’application Survey.', 'No survey sent from the Survey app yet.')}</div>}
      {surveys?.map(s => (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name} <span style={{ color: 'var(--ink-3)' }}>· r{s.revision}</span></div>
            <div style={{ color: 'var(--ink-3)', fontSize: 11 }}>{date(s.receivedAt)} · {Math.ceil(s.bytes / 1024)} Ko</div>
          </div>
          <button className="btn" disabled={busy === s.id} onClick={async () => { setBusy(s.id); await onImport(s); setBusy(null); }}>{tr('Importer', 'Import')}</button>
          <button className="btn ghost" aria-label={tr('Supprimer', 'Delete')} onClick={async () => { await inbox.remove(s.id); refresh(); }}>🗑</button>
        </div>
      ))}
      <details onToggle={e => { if ((e.target as HTMLDetailsElement).open && !keys) inbox.listKeys().then(setKeys, err => setError(String(err.message ?? err))); }}>
        <summary style={{ cursor: 'pointer' }}>{tr('Appairer un téléphone', 'Pair a phone')}</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          <div style={{ color: 'var(--ink-3)' }}>{tr('La clé ne permet que d’envoyer des relevés. Dans l’application Survey (Exporter › Appairer avec skAItch), scannez le QR code ou collez la clé. Le téléphone et cet ordinateur doivent être sur le même Wi-Fi si skAItch tourne sur ce poste.',
            'The key only allows sending surveys. In the Survey app (Export › Pair with skAItch), scan the QR code or paste the key. The phone and this computer must share the Wi-Fi when skAItch runs on this computer.')}</div>
          {created?.key && (
            <div role="status" style={{ background: 'var(--panel-2)', padding: 8, borderRadius: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{tr('Copiez-la maintenant : elle ne sera plus affichée.', 'Copy it now: it will not be shown again.')}</div>
              <PairingQr uri={created.pairingUri ?? `skaitch-survey:pair?${new URLSearchParams({ servers: window.location.origin, key: created.key })}`} />
              <code style={{ wordBreak: 'break-all', fontSize: 11 }}>{created.key}</code>
              <button className="btn" style={{ marginTop: 6 }} onClick={() => void navigator.clipboard?.writeText(created.key!)}>{tr('Copier', 'Copy')}</button>
            </div>
          )}
          <button className="btn" onClick={async () => {
            try { const k = await inbox.createKey(tr('Téléphone', 'Phone')); setCreated(k); setKeys(await inbox.listKeys()); }
            catch (e) { setError((e as Error).message); }
          }}>{tr('Créer une clé d’appairage', 'Create a pairing key')}</button>
          {keys?.map(k => (
            <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ flex: 1 }}>{k.name} · {date(k.createdAt)}{k.lastUsedAt ? ` · ${tr('utilisée', 'used')} ${date(k.lastUsedAt)}` : ''}</span>
              <button className="btn ghost" onClick={async () => { await inbox.revokeKey(k.id); setKeys(await inbox.listKeys()); if (created?.id === k.id) setCreated(null); }}>{tr('Révoquer', 'Revoke')}</button>
            </div>
          ))}
        </div>
      </details>
      {error && <div role="alert" style={{ color: '#dc2626' }}>{error}</div>}
    </div>
  );
}

/** QR code scanned by the Survey app: the server address(es) and the pairing key. */
function PairingQr({ uri }: { uri: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => { void QRCode.toDataURL(uri, { margin: 2, width: 360, errorCorrectionLevel: 'L' }).then(setSrc, () => setSrc('')); }, [uri]);
  return src ? <img src={src} alt="QR code" width={300} height={300} style={{ display: 'block', margin: '6px auto', imageRendering: 'pixelated', background: '#fff' }} /> : null;
}

/** Reduced copies of the survey photos for the project (1024 px JPEG data URLs), by photo id. */
async function reducePhotos(survey: Survey, files: Record<string, Uint8Array>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const room of survey.levels.flatMap(l => l.rooms)) for (const p of room.photos ?? []) {
    const bytes = files[p.file];
    if (!bytes) continue;
    try {
      const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/jpeg' }));
      const k = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * k); canvas.height = Math.round(bitmap.height * k);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      out[p.id] = canvas.toDataURL('image/jpeg', 0.8);
    } catch { /* an unreadable photo is skipped; the survey itself is valid */ }
  }
  return out;
}
