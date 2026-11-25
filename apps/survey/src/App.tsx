import { DraftingCompass, X, Building, Building2, Castle, Church, Factory, Home, Hotel, House, Plus, School, Store, Tent, Warehouse, Archive, ArchiveRestore, ChevronLeft, ArrowDownToLine, ArrowLeftRight, ArrowRight, ArrowUpFromLine, Camera, Check, ChevronDown, ChevronUp, CloudUpload, Columns2, DoorClosed, DoorOpen, Ellipsis, FlipHorizontal2, Info, Link, Link2, List, Lock, LockOpen, Map as MapIcon, MousePointer2, Move, MoveHorizontal, OctagonX, PenLine, RectangleHorizontal, Redo2, RotateCcwSquare, Ruler, Scaling, Settings, Slash, Square, StickyNote, Trash2, TriangleAlert, TriangleRight, Undo2, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { OPENING_OPERATIONS, SURVEY_FORMAT_VERSION, alignedFaces, isLinked, linkedFaces, surveyDefaults, surveyWarnings, type OpeningKind, type OpeningOperation, type Survey, type SurveySurface } from '@skaitch/core/survey/surveyFile';
import { addAdjacentRoom, addDiagonal, makeRectangle, setRightAngles, fitRoomToCotes, setRoomFrozen, wallLabel, setSurveyDefaults, setLinkOffset, setWallThickness, replaceRooms, setAlignmentStep, unalignFaces, unlinkFaces, addPhoto, addPhotoMeasure, addPhotoNote, updatePhotoMeasure, deletePhoto, deletePhotoAnnotation, updatePhotoNote, deleteControl, setAngle, deleteOpening, deleteRoom, newSurvey, renameRoom, setCeilingHeight, updateOpening } from '@skaitch/core/survey/edit';
import SurveyEditor, { reopenHints, type SurveyTool } from '@skaitch/ui/components/survey/SurveyEditor';
import { getLengthUnit, setLengthUnit, useLengthUnit } from '@skaitch/ui/components/survey/lengthUnit';
import { formatLength, formatLengthValue, LENGTH_UNITS, parseLength, unitLabel, type LengthUnit } from '@skaitch/core/survey/units';
import { historyOf, record, redo, undo, type History } from '@skaitch/core/survey/history';
import { archiveSurvey, deleteAvatar, loadAvatar, saveAvatar, deleteSurvey, listArchivedIds, listSurveys, unarchiveSurvey, loadPhoto, purgeUnusedPhotos, savePhoto, saveSurvey, loadLastRoom, rememberRoom, loadLocks, saveLocks, type PlanLocks } from './storage';
import { reencodePhoto } from './image';
import { APP_VERSION, exportSurvey } from './exportFile';
import { DEFAULT_SERVER, forgetPairing, loadPairing, pairFromQr, savePairing, sendSurvey, type Pairing } from './send';
import { readQrFromImage, scanLive } from './scanQr';
import { applyTheme, setTheme, THEMES, useTheme, type ThemeId } from './theme';
import GlobalPlan from './GlobalPlan';
import WallElevation from './WallElevation';
import Sheet from './Sheet';
import PhotoNoteMarker from './PhotoNoteMarker';
import { Sofa } from 'lucide-react';
import { SURVEY_FURNITURE_MODELS } from '@skaitch/core/survey/surveyFile';
import { deleteSurveyFurniture, setSurveyFurniture } from '@skaitch/core/survey/edit';
import { FurnitureCatalogue, FurnitureDetails, FurnitureSelection } from './FurnitureSheet';
import { globalPlan } from '@skaitch/core/survey/globalPlan';
import { solveRoom } from '@skaitch/core/survey/solve';
import { placeRooms } from '@skaitch/core/survey/placement';
import { surveyChecks } from '@skaitch/core/survey/checks';
import { SURVEY_LANGUAGES, SURVEY_LANGUAGE_NAMES, setSurveyLanguage, surveyLangOf, tr } from '@skaitch/core/survey/lang';

applyTheme();
/** Interface language: the one chosen in the settings, else the phone's (English when skAItch has not got it). */
const LANG_KEY = 'skaitch-survey:lang';
const lang = surveyLangOf((() => { try { return localStorage.getItem(LANG_KEY); } catch { return null; } })() ?? navigator.language);
// The interface, checks and errors from the shared engine all follow this language.
setSurveyLanguage(lang);
document.documentElement.lang = lang;
document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
// Lengths follow the unit chosen in the settings (display and input only; surveys stay in metres).
const fmt = (m: number) => formatLength(m, getLengthUnit());
const fmtValue = (m: number) => formatLengthValue(m, getLengthUnit());
const num = (v: string) => parseLength(v, getLengthUnit());
const U = () => unitLabel(getLengthUnit());
const lengthInput = () => (getLengthUnit() === 'ft-in' ? 'text' : 'decimal');

/** Bottom sheet, as in the prototype: scrim, handle, eyebrow, title. */
/** The room's drawing differs from the shape its cotes give: « Ajuster aux cotes » would redraw it. */
function drawingOff(survey: Survey, roomId: string): boolean {
  try {
    const before = survey.levels.flatMap(l => l.rooms).find(r => r.id === roomId)!.polygon;
    const after = fitRoomToCotes(survey, roomId).levels.flatMap(l => l.rooms).find(r => r.id === roomId)!.polygon;
    return before.some((p, i) => Math.hypot(p[0] - after[i][0], p[1] - after[i][1]) > 0.005);
  } catch { return false; }
}

function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => { if (!text) return; const t = setTimeout(onDone, 2600); return () => clearTimeout(t); }, [text, onDone]);
  return <div className={`toast ${text ? 'show' : ''}`} role="status">{text}</div>;
}

export default function App() {
  const [surveys, setSurveys] = useState<Survey[] | null>(null);
  const [current, setCurrent] = useState<Survey | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Survey | null>(null);
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [showArchives, setShowArchives] = useState(false);
  const [appSettings, setAppSettings] = useState(false);
  const refresh = async () => { const [all, ids] = await Promise.all([listSurveys(), listArchivedIds()]); setArchived(ids); setSurveys(all); };
  useEffect(() => { if (!current) void refresh(); }, [current]);
  const shown = surveys?.filter(s => archived.has(s.id) === showArchives);

  if (current) return <SurveyScreen initial={current} onClose={() => setCurrent(null)} />;
  return (
    <div className="app gallery-screen">
      <header className="app-header">
        <span className="brandmark" aria-hidden><svg width="26" height="26" viewBox="6 7 52 52"><path d="M14 9H50Q56 9 56 15V41Q56 47 50 47H26L14 57V47Q8 47 8 41V15Q8 9 14 9Z" fill="#FFB000" /><path d="M17 17H47V39H17Z M32 17V27 M17 29H25" fill="none" stroke="#2c2c2c" strokeWidth="3.6" strokeLinecap="square" /></svg></span>
        <div className="head-middle">
          <div className="head-title">SkAItch Survey</div>
        </div>
        <button className="iconbtn dark" aria-label={tr('Réglages de l’application', 'App settings')} onClick={() => setAppSettings(true)}><Ellipsis /></button>
      </header>
      <main className="secondary-page">
        <div className="gallery-title">
          {showArchives && <button className="iconbtn" aria-label={tr('Retour à mes relevés', 'Back to my surveys')} onClick={() => setShowArchives(false)}><ChevronLeft /></button>}
          <h2>{showArchives ? tr('Archives', 'Archives') : tr('Mes relevés', 'My surveys')}</h2>
          {!showArchives && <button className="compact-btn" onClick={() => setShowArchives(true)}><Archive /> {tr('Archives', 'Archives')}{archived.size ? ` (${archived.size})` : ''}</button>}
        </div>
        {showArchives && shown?.length === 0 && <p className="hint">{tr('Aucun relevé archivé. Glissez un relevé vers la gauche pour l’archiver.', 'No archived survey. Swipe a survey left to archive it.')}</p>}
        {!showArchives && shown?.length === 0 && (
          <div className="empty-state">
            <div className="big"><Ruler /></div>
            <h3>{tr('Aucun relevé', 'No survey yet')}</h3>
            <p>{tr('Créez un relevé, tracez les pièces au doigt et saisissez les cotes mesurées.', 'Create a survey, draw rooms with a finger and type the measured lengths.')}</p>
          </div>
        )}
        {shown?.map(s => {
          const rooms = s.levels.reduce((n, l) => n + l.rooms.length, 0);
          return (
            <SwipeAction key={s.id} {...(showArchives
              ? { label: tr('Supprimer', 'Delete'), icon: <Trash2 />, tone: 'delete' as const, onAction: () => setToDelete(s) }
              : { label: tr('Archiver', 'Archive'), icon: <Archive />, tone: 'archive' as const, onAction: async () => { await archiveSurvey(s.id); await refresh(); } })}>
            <div className="room-card">
              <SurveyAvatar surveyId={s.id} />
              <div style={{ minWidth: 0 }}>
                <b>{s.name}</b>
                <small>{rooms} {tr('pièce(s)', 'room(s)')} · {new Date(s.updatedAt).toLocaleDateString(lang)}</small>
              </div>
              {showArchives && <button aria-label={tr(`Restaurer ${s.name}`, `Restore ${s.name}`)} onClick={async () => { await unarchiveSurvey(s.id); await refresh(); }}><ArchiveRestore /></button>}
              <button style={showArchives ? { marginLeft: 0 } : undefined} onClick={() => setCurrent(s)}>{showArchives ? tr('Voir', 'View') : tr('Ouvrir', 'Open')}</button>
            </div>
            </SwipeAction>
          );
        })}
      </main>
      {!showArchives && <div className="footer-cta">
        <button className="primary-btn" onClick={() => setNaming(tr('Nouveau relevé', 'New survey'))}>＋ {tr('Nouveau relevé', 'New survey')}</button>
      </div>}
      {naming !== null && (
        <Sheet eyebrow={tr('Nouveau', 'New')} title={tr('Nom du relevé', 'Survey name')} onClose={() => setNaming(null)}>
          <form onSubmit={async e => {
            e.preventDefault();
            if (!naming.trim()) return;
            const s = newSurvey(naming.trim());
            await saveSurvey(s);
            setNaming(null);
            setCurrent(s);
          }}>
            <div className="fields">
              <label className="field wide">{tr('Nom', 'Name')}<input autoFocus value={naming} onChange={e => setNaming(e.target.value)} onFocus={e => e.target.select()} /></label>
            </div>
            <div className="sheet-actions">
              <button type="button" className="secondary-btn" onClick={() => setNaming(null)}>{tr('Annuler', 'Cancel')}</button>
              <button type="submit" className="primary-btn">{tr('Créer', 'Create')}</button>
            </div>
          </form>
        </Sheet>
      )}
      {appSettings && (
        <Sheet eyebrow={tr('Application', 'App')} title={tr('Réglages', 'Settings')} onClose={() => setAppSettings(false)}>
          <h4>{tr('Langue', 'Language')}</h4>
          <LanguageField />
          <ThemePicker />
          <h4>{tr('Cotes', 'Lengths')}</h4>
          <UnitField />
          <button className="secondary-btn" style={{ width: '100%' }} onClick={() => { reopenHints(); setAppSettings(false); }}>
            {tr('Réafficher toutes les aides', 'Show all help messages again')}
          </button>
          <div className="sheet-actions"><button className="primary-btn" onClick={() => setAppSettings(false)}>{tr('Terminé', 'Done')}</button></div>
        </Sheet>
      )}
      {toDelete && (
        <Sheet eyebrow={tr('Suppression', 'Delete')} title={toDelete.name} onClose={() => setToDelete(null)}>
          <div className="notice">{tr('Le relevé sera supprimé définitivement de cet appareil. Exportez-le d’abord si vous voulez le conserver.', 'The survey will be permanently deleted from this device. Export it first to keep it.')}</div>
          <div className="sheet-actions">
            <button className="secondary-btn" onClick={() => setToDelete(null)}>{tr('Annuler', 'Cancel')}</button>
            <button className="primary-btn" style={{ background: '#b0523a' }} onClick={async () => { await deleteSurvey(toDelete.id); setToDelete(null); await refresh(); }}>
              {tr('Supprimer', 'Delete')}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** A house window (frame, cross bars, sill), drawn in Lucide's stroke style. */
function WindowIcon() {
  return (
    <svg className="lucide" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="3" width="16" height="15" rx="1" /><path d="M12 3v15M4 10.5h16M2 21h20" />
    </svg>
  );
}

/** Floating toolbar with two pages, the drawing tools and the export, swiped sideways. */
function ToolDock({ page, onPage, canSwipe, tools, actions }: { page: number; onPage: (p: number) => void; canSwipe: boolean; tools: ReactNode; actions: ReactNode }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const [dx, setDx] = useState(0);
  return (
    <div className="tools-bar" role="toolbar" aria-label={tr('Outils de relevé', 'Survey tools')}
      onPointerDown={e => { if (!canSwipe) return; start.current = { x: e.clientX, y: e.clientY }; swiped.current = false; }}
      onPointerMove={e => {
        if (!start.current) return;
        const d = e.clientX - start.current.x;
        if (Math.abs(d) > 8 && Math.abs(d) > Math.abs(e.clientY - start.current.y)) { swiped.current = true; setDx(d); }
      }}
      onPointerUp={() => {
        if (start.current && swiped.current && Math.abs(dx) > 40) onPage(dx < 0 ? 1 : 0);
        start.current = null; setDx(0);
      }}
      onPointerCancel={() => { start.current = null; setDx(0); }}
      onClickCapture={e => { if (swiped.current) { e.stopPropagation(); e.preventDefault(); swiped.current = false; } }}>
      <div className="dock-track" style={{ transform: `translateX(calc(${-page * 50}% + ${page === 0 ? Math.min(0, dx) : Math.max(0, dx)}px))`, transition: dx ? 'none' : undefined }}>
        <div className="dock-page dock-tools">{tools}</div>
        <div className="dock-page dock-actions">{actions}</div>
      </div>
      {canSwipe && <div className="dock-dots">{[0, 1].map(i => <button key={i} className={i === page ? 'on' : ''} aria-label={i ? tr('Exporter', 'Export') : tr('Outils', 'Tools')} onClick={() => onPage(i)} />)}</div>}
    </div>
  );
}

/** A card swiped to the left reveals its action (archive or delete); past the threshold it runs it. */
function SwipeAction({ label, icon, tone, onAction, children }: { label: string; icon: ReactNode; tone: 'archive' | 'delete'; onAction: () => void; children: ReactNode }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const [dx, setDx] = useState(0);
  const THRESHOLD = 96;
  const end = () => {
    if (start.current && -dx > THRESHOLD) onAction();
    start.current = null; setDx(0);
  };
  return (
    <div className="swipe-row">
      <div className={`swipe-under ${tone} ${-dx > THRESHOLD ? 'armed' : ''}`} aria-hidden>{icon} {label}</div>
      <div className="swipe-front" style={{ transform: `translateX(${dx}px)`, transition: start.current ? 'none' : undefined }}
        onPointerDown={e => { start.current = { x: e.clientX, y: e.clientY }; swiped.current = false; }}
        onPointerMove={e => {
          if (!start.current) return;
          const d = e.clientX - start.current.x;
          if (!swiped.current && Math.abs(e.clientY - start.current.y) > Math.abs(d)) { start.current = null; return; }
          if (d < -8) { swiped.current = true; setDx(Math.max(d, -180)); }
        }}
        onPointerUp={end} onPointerCancel={() => { start.current = null; setDx(0); }}
        onClickCapture={e => { if (swiped.current) { e.stopPropagation(); e.preventDefault(); swiped.current = false; } }}>
        {children}
      </div>
    </div>
  );
}

/** Preset avatars: kinds of buildings a survey is made in. */
const AVATAR_ICONS: Record<string, ReactNode> = {
  house: <House />, home: <Home />, building: <Building />, building2: <Building2 />, warehouse: <Warehouse />, store: <Store />,
  school: <School />, hotel: <Hotel />, factory: <Factory />, castle: <Castle />, church: <Church />, tent: <Tent />,
};

/** The survey's avatar (photo or preset icon), or a neutral glyph when it has none. `version` reloads it after a change. */
function SurveyAvatar({ surveyId, version = 0 }: { surveyId: string; version?: number }) {
  const [avatar, setAvatar] = useState<{ url?: string; icon?: string } | null>(null);
  useEffect(() => {
    let u: string | null = null, live = true;
    void loadAvatar(surveyId).then(a => {
      if (!live) return;
      if (a instanceof Blob) { u = URL.createObjectURL(a); setAvatar({ url: u }); }
      else setAvatar(a ? { icon: a.icon } : null);
    });
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [surveyId, version]);
  return <div className={`room-glyph avatar ${avatar?.icon ? 'icon' : ''}`}>{avatar?.url ? <img src={avatar.url} alt="" /> : (avatar?.icon && AVATAR_ICONS[avatar.icon]) || <Square />}</div>;
}

/** Choose the survey's avatar: a preset icon, or « + » for a photo or an image. */
function AvatarField({ surveyId }: { surveyId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(0);
  const [current, setCurrent] = useState<string | 'photo' | null>(null);
  const [toCrop, setToCrop] = useState<Blob | null>(null);
  useEffect(() => { void loadAvatar(surveyId).then(a => setCurrent(a instanceof Blob ? 'photo' : a?.icon ?? null)); }, [surveyId, version]);
  const pick = async (icon: string) => { await saveAvatar(surveyId, { icon }); setVersion(v => v + 1); };
  return (
    <div className="avatar-field">
            {!toCrop && <div className="avatar-grid">
        {current === 'photo' && <button className="avatar-choice active" aria-pressed><SurveyAvatar surveyId={surveyId} version={version} /></button>}
        {Object.entries(AVATAR_ICONS).map(([name, icon]) => (
          <button key={name} className={`avatar-choice ${current === name ? 'active' : ''}`} aria-pressed={current === name} aria-label={name} onClick={() => void pick(name)}>{icon}</button>
        ))}
        <button className="avatar-choice add" aria-label={tr('Photo ou image', 'Photo or image')} onClick={() => input.current?.click()}><Plus /></button>
      </div>}
      <input ref={input} type="file" accept="image/*" hidden onChange={async e => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (f) setToCrop(f);
      }} />
      {toCrop && <AvatarCropper file={toCrop} onCancel={() => setToCrop(null)}
        onDone={async blob => { setToCrop(null); await saveAvatar(surveyId, blob); setVersion(v => v + 1); }} />}
      {current && !toCrop && <button className="compact-btn" onClick={async () => { await deleteAvatar(surveyId); setVersion(v => v + 1); }}><Trash2 /> {tr('Retirer l’avatar', 'Remove avatar')}</button>}
    </div>
  );
}

/** Square crop of an image for the avatar: drag to frame it, slider (or pinch) to zoom, inside a round mask. */
function AvatarCropper({ file, onCancel, onDone }: { file: Blob; onCancel: () => void; onDone: (jpeg: Blob) => void }) {
  const BOX = 260, OUT = 256;
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; zoom: number } | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const i = new Image(); i.onload = () => setImg(i); i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // Scale at zoom 1: the image just covers the square.
  const base = img ? BOX / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const k = base * zoom;
  const clamp = (o: { x: number; y: number }, z = zoom) => {
    if (!img) return o;
    const mx = Math.max(0, (img.naturalWidth * base * z - BOX) / 2), my = Math.max(0, (img.naturalHeight * base * z - BOX) / 2);
    return { x: Math.max(-mx, Math.min(mx, o.x)), y: Math.max(-my, Math.min(my, o.y)) };
  };
  const setZ = (z: number) => { const v = Math.max(1, Math.min(5, z)); setZoom(v); setOff(o => clamp(o, v)); };
  const save = () => {
    if (!img) return;
    const c = document.createElement('canvas'); c.width = c.height = OUT;
    const ctx = c.getContext('2d')!;
    const r = OUT / BOX, w = img.naturalWidth * k * r, h = img.naturalHeight * k * r;
    ctx.drawImage(img, OUT / 2 - w / 2 + off.x * r, OUT / 2 - h / 2 + off.y * r, w, h);
    c.toBlob(b => { if (b) onDone(b); }, 'image/jpeg', 0.88);
  };
  return (
    <div className="cropper">
      <div className="crop-box" style={{ width: BOX, height: BOX }}
        onPointerDown={e => { (e.target as Element).setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom }; } }}
        onPointerMove={e => {
          const prev = pointers.current.get(e.pointerId); if (!prev) return;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2 && pinch.current) { const [a, b] = [...pointers.current.values()]; setZ(pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d); }
          else if (pointers.current.size === 1) setOff(o => clamp({ x: o.x + e.clientX - prev.x, y: o.y + e.clientY - prev.y }));
        }}
        onPointerUp={e => { pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null; }}
        onPointerCancel={e => { pointers.current.delete(e.pointerId); pinch.current = null; }}
        onWheel={e => setZ(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}>
        {img && <img src={img.src} alt="" draggable={false} style={{ width: img.naturalWidth * k, height: img.naturalHeight * k, transform: `translate(calc(-50% + ${off.x}px), calc(-50% + ${off.y}px))` }} />}
        <div className="crop-mask" />
      </div>
      <input type="range" min={1} max={5} step={0.01} value={zoom} onChange={e => setZ(Number(e.target.value))} aria-label={tr('Zoom', 'Zoom')} />
      <div className="sheet-actions">
        <button className="secondary-btn" onClick={onCancel}>{tr('Annuler', 'Cancel')}</button>
        <button className="primary-btn" disabled={!img} onClick={save}><Check /> {tr('Utiliser', 'Use')}</button>
      </div>
    </div>
  );
}

/** Theme choice: the colour of selected pills, plan strokes and the help banner. */
function ThemePicker() {
  const theme = useTheme();
  return <>
    <h4>{tr('Thème', 'Theme')}</h4>
    <div className="theme-choices">
      {(Object.keys(THEMES) as ThemeId[]).map(id => (
        <button key={id} className={`theme-choice ${theme === id ? 'active' : ''}`} aria-pressed={theme === id} onClick={() => setTheme(id)}>
          <span className="theme-swatch" style={{ background: THEMES[id].swatch }}>{theme === id && <Check />}</span>
          {tr(THEMES[id].fr, THEMES[id].en)}
        </button>
      ))}
    </div>
  </>;
}

/** Unit of the lengths, shared by the app settings and the survey settings. */
function UnitField() {
  useLengthUnit();
  return (
    <label className="field" style={{ marginBottom: 10 }}>{tr('Unité des cotes', 'Length unit')}
            <select value={getLengthUnit()} onChange={e => setLengthUnit(e.target.value as LengthUnit)}>
              {LENGTH_UNITS.map(u => <option key={u} value={u}>{{ m: tr('Mètres (3,25 m)', 'Metres (3,25 m)'), cm: tr('Centimètres (325 cm)', 'Centimetres (325 cm)'), mm: tr('Millimètres (3250 mm)', 'Millimetres (3250 mm)'), 'ft-in': tr('Pieds et pouces (10′ 8 1/2″)', 'Feet and inches (10′ 8 1/2″)') }[u]}</option>)}
            </select>
          </label>
  );
}

/** Interface language, as in skAItch; the app reloads to apply it everywhere. */
function LanguageField() {
  return (
    <label className="field" style={{ marginBottom: 10 }}>
      <select aria-label={tr('Langue', 'Language')} value={lang} onChange={e => { try { localStorage.setItem(LANG_KEY, e.target.value); } catch { /* private mode */ } location.reload(); }}>
        {SURVEY_LANGUAGES.map(code => <option key={code} value={code} lang={code}>{SURVEY_LANGUAGE_NAMES[code]}</option>)}
      </select>
    </label>
  );
}

const TOOLS: { tool: SurveyTool; icon: ReactNode; fr: string; en: string }[] = [
  { tool: 'select', icon: <MousePointer2 />, fr: 'Sélection', en: 'Select' },
  { tool: 'rect', icon: <RectangleHorizontal />, fr: 'Rectangle', en: 'Rectangle' },
  { tool: 'polygon', icon: <PenLine />, fr: 'Tracer', en: 'Outline' },
  { tool: 'door', icon: <DoorOpen />, fr: 'Porte', en: 'Door' },
  { tool: 'window', icon: <WindowIcon />, fr: 'Fenêtre', en: 'Window' },
  { tool: 'furniture', icon: <Sofa />, fr: 'Meubles & structure', en: 'Furniture & structure' },
];

const OPERATION_LABELS: Record<OpeningOperation, [ReactNode, string, string]> = {
  single_swing: [<DoorOpen />, tr('1 battant', 'Single'), tr('Ouvrant à la française', 'Side-hung')],
  double_swing: [<Columns2 />, tr('2 battants', 'Double'), tr('Deux ouvrants', 'Two leaves')],
  sliding: [<ArrowLeftRight />, tr('Coulissant', 'Sliding'), tr('Vantaux coulissants', 'Sliding leaves')],
  fixed: [<Square />, tr('Fixe', 'Fixed'), tr('Sans ouvrant', 'No opening leaf')],
  tilt_turn: [<RotateCcwSquare />, tr('Oscillo-battant', 'Tilt & turn'), tr('Battant et entrebâillement', 'Side-hung and tilt')],
  none: [<DoorClosed />, tr('Sans porte', 'No door'), tr('Ouverture sans vantail', 'Opening without a leaf')],
};

function SurveyScreen({ initial, onClose }: { initial: Survey; onClose: () => void }) {
  const [history, setHistory] = useState<History<Survey>>(() => historyOf(initial));
  const survey = history.present;
  const [selected, setSelected] = useState<string | null>(() => {
    const rooms = initial.levels[0].rooms;
    const remembered = loadLastRoom(initial.id);
    return rooms.find(r => r.id === remembered)?.id ?? rooms[0]?.id ?? null;
  });
  const [selectedOpening, setSelectedOpening] = useState<string | null>(null);
  const [selectedFurniture, setSelectedFurniture] = useState<string | null>(null);
  const [furnitureModel, setFurnitureModel] = useState<string>();
  const [placingFurniture, setPlacingFurniture] = useState(false);
  /** Element types locked on the plan, to focus on one kind of edit. */
  const [locked, setLocked] = useState<PlanLocks>(() => loadLocks(initial.id));
  const [tool, setTool] = useState<SurveyTool>(initial.levels[0].rooms.length ? 'select' : 'rect');
  const [sheet, setSheet] = useState<null | 'room' | 'opening' | 'menu' | 'link' | 'controls' | 'photos' | 'furniture-catalogue' | 'furniture-details' | 'locks'>(null);
  const [pointToComplete, setPointToComplete] = useState<string>();
  /** The two faces just linked, for the link sheet. */
  const [linked, setLinked] = useState<{ a: { roomId: string; wallId: string }; b: { roomId: string; wallId: string }; kind: 'link' | 'alignment' } | null>(null);
  const [toast, setToast] = useState('');
  const [statusOpen, setStatusOpen] = useState(false);
  const theme = useTheme();
  /** Page of the floating toolbar: 0 the drawing tools, 1 the export. */
  const [dockPage, setDockPage] = useState(0);
  /** The « Room » item's choice: draw a rectangle or an outline. */
  const [roomMenu, setRoomMenu] = useState(false);
  /** Last way of drawing a room, picked again when « Room » is tapped. */
  const [lastRoomTool, setLastRoomTool] = useState<'rect' | 'polygon'>('rect');
  useEffect(() => { if (tool === 'rect' || tool === 'polygon') setLastRoomTool(tool); }, [tool]);
  const [view, setView] = useState<'room' | 'global'>('room');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuPage, setMenuPage] = useState<'main' | 'avatar' | 'properties' | 'checks' | 'export' | 'settings' | 'about'>('main');
  useLengthUnit(); // re-renders the screen when the unit changes
  const saving = useRef<Promise<void>>(Promise.resolve());
  const level = survey.levels[0];
  const room = level.rooms.find(r => r.id === selected) ?? null;
  const activeRoomId = room?.id;
  useEffect(() => { if (activeRoomId) rememberRoom(survey.id, activeRoomId); }, [survey.id, activeRoomId]);
  useEffect(() => saveLocks(survey.id, locked), [survey.id, locked]);
  /** Geometry status of the current room, shown in a line that can be hidden. */
  const roomStatus = room ? solveRoom(room).status : null;
  const [statusHidden, setStatusHidden] = useState(() => { try { return localStorage.getItem('skaitch-survey:status-hidden') === '1'; } catch { return false; } });
  const hideStatus = (h: boolean) => { setStatusHidden(h); setStatusChanged(false); try { localStorage.setItem('skaitch-survey:status-hidden', h ? '1' : '0'); } catch { /* private mode */ } };
  /** Set when the status changed while hidden: a toast tells it, a dot stays on the button. */
  const [statusChanged, setStatusChanged] = useState(false);
  const lastStatus = useRef<{ roomId: string | null; status: string | null }>({ roomId: room?.id ?? null, status: roomStatus });
  useEffect(() => {
    const prev = lastStatus.current;
    lastStatus.current = { roomId: room?.id ?? null, status: roomStatus };
    if (!statusHidden || !roomStatus || prev.roomId !== room?.id || prev.status === roomStatus) return;
    setStatusChanged(true);
    setToast(roomStatus === 'resolved' ? tr('Géométrie résolue par les mesures', 'Geometry resolved from measurements')
      : roomStatus === 'inconsistent' ? tr('Mesures incompatibles', 'Inconsistent measurements') : tr('Géométrie non résolue', 'Geometry not resolved'));
  }, [room?.id, roomStatus, statusHidden]);
  const opening = room?.openings?.find(o => o.id === selectedOpening) ?? null;
  const furniture = room?.furniture?.find(f => f.id === selectedFurniture);
  const furnitureToPlace = SURVEY_FURNITURE_MODELS.find(model => model.id === furnitureModel);
  const furnitureDock = view === 'room' && tool === 'furniture' && !!room && !room.frozen && !!furnitureToPlace;
  const walls = level.rooms.flatMap(r => r.walls);
  // Deduced lengths count as known: they follow from measured ones.
  const measured = walls.filter(w => w.locked || w.source === 'computed').length;
  const openings = level.rooms.reduce((n, r) => n + (r.openings?.length ?? 0), 0);
  const photoCount = level.rooms.reduce((n, r) => n + (r.photos?.length ?? 0), 0);
  const warnings = surveyWarnings(survey).length + globalPlan(level).discrepancies.length;

  function persist(next: Survey) {
    // Saved on every edit, in order, so closing the app never loses a measurement.
    saving.current = saving.current.then(() => saveSurvey(next)).catch(e => setToast(String(e)));
  }
  function change(next: Survey, gesture = false) {
    setHistory(h => record(h, next, gesture));
    persist(next);
  }
  function travel(direction: 'undo' | 'redo') {
    const h = direction === 'undo' ? undo(history) : redo(history);
    if (h === history) return;
    setHistory(h);
    persist(h.present);
    // The selection may point at something the step removed.
    const lvl = h.present.levels[0];
    if (selected && !lvl.rooms.some(r => r.id === selected)) setSelected(null);
    if (selectedOpening && !lvl.rooms.some(r => r.openings?.some(o => o.id === selectedOpening))) setSelectedOpening(null);
    if (selectedFurniture && !lvl.rooms.some(r => r.furniture?.some(f => f.id === selectedFurniture))) setSelectedFurniture(null);
  }
  function safe(f: () => Survey) {
    try { change(f()); } catch (e) { setToast((e as Error).message); }
  }

  return (
    <div className="app survey-screen">
      <header className="app-header">
        <button className="iconbtn dark" aria-label={tr('Retour', 'Back')} onClick={async () => { await saving.current; await purgeUnusedPhotos(survey); onClose(); }}>‹</button>
        <div className="head-middle">
          <div className="head-title">{survey.name}</div>
        </div>
        <button className="iconbtn dark" aria-label={tr('Menu', 'Menu')} onClick={() => { setMenuPage('main'); setSheet('menu'); }}><Ellipsis /></button>
      </header>

      <nav className="rooms-bar" aria-label={tr('Pièces', 'Rooms')}>
        <button className={`room-pill ${view === 'global' ? 'active' : ''}`} aria-pressed={view === 'global'} onClick={() => setView('global')}><MapIcon /> {tr('Plan global', 'Global plan')}</button>
        {level.rooms.map(r => (
          <button key={r.id} className={`room-pill ${view === 'room' && r.id === selected ? 'active' : ''}`}
            aria-label={view === 'room' && r.id === selected ? tr(`Propriétés de ${r.name}`, `${r.name} properties`) : undefined}
            onClick={() => {
              // Tapping the current room again opens its properties.
              if (view === 'room' && r.id === selected) { setConfirmDelete(false); setSheet('room'); return; }
              setSelected(r.id); setSelectedOpening(null); setTool('select'); setView('room');
            }}>{r.frozen ? <Lock /> : null}{r.name}{view === 'room' && r.id === selected && <Settings className="pill-gear" />}</button>
        ))}
        <button className="room-plus" disabled={!!locked.walls} onClick={() => { setTool('rect'); setSelectedOpening(null); setView('room'); }}>＋ {tr('Pièce', 'Room')}</button>
      </nav>

      {view === 'global' ? (
        <GlobalPlan survey={survey} selectedRoomId={selected} tr={tr} onEdit={safe}
          onOpenRoom={id => { setSelected(id); setSelectedOpening(null); setTool('select'); setView('room'); }} />
      ) : (
      <div className="main">
        <div className="plan-heading">
          <div className="plan-actions">
            {room && level.rooms.length > 1 && (
              // One action for every room (ADR 0013): a room not connected yet is moved against the wall.
              <button className={`compact-btn ${tool === 'link' ? 'primary' : globalPlan(level).anchored.has(room.id) ? '' : 'details-reopen'}`}
                aria-label={tr('Lier un mur', 'Link a wall')} title={tr('Lier un mur', 'Link a wall')}
                onClick={() => setTool(tool === 'link' ? 'select' : 'link')}>
                {room.walls.reduce((n, w) => n + linkedFaces(level, w).length + alignedFaces(level, w).length, 0) || ''} <Link2 />
              </button>
            )}
            {room && <button className="compact-btn" aria-label={tr('Contrôles : diagonales et angles', 'Checks: diagonals and angles')} title={tr('Contrôles', 'Checks')} onClick={() => setSheet('controls')}>
              {(room.diagonals?.length ?? 0) + (room.angles?.length ?? 0) || ''} <DraftingCompass />
            </button>}
            {room && <button className="compact-btn" aria-label={tr('Vue de face et photos', 'Wall elevation and photos')} title={tr('Vue de face et photos', 'Wall elevation and photos')} onClick={() => { setPointToComplete(undefined); setSheet('photos'); }}><RectangleHorizontal /></button>}
            {room?.frozen && <button className="compact-btn frozen-on" title={tr('Pièce figée : touchez pour la défiger', 'Frozen room: tap to unfreeze')} onClick={() => safe(() => setRoomFrozen(survey, room.id, false))}><Lock /></button>}
            {room && drawingOff(survey, room.id) && (
              <button className="compact-btn details-reopen fit-cotes" title={tr('Redessiner la pièce selon ses cotes', 'Redraw the room from its cotes')} aria-label={tr('Ajuster aux cotes', 'Fit to cotes')}
                onClick={() => { try { change(fitRoomToCotes(survey, room.id)); setToast(tr('Tracé ajusté aux cotes', 'Drawing fitted to the cotes')); } catch (e) { setToast((e as Error).message); } }}>
                <Scaling /> {tr('Ajuster', 'Fit')}
              </button>
            )}
            {opening && <button className="compact-btn primary" onClick={() => setSheet('opening')}>{opening.kind === 'door' ? <DoorOpen /> : <WindowIcon />} {tr('Ouverture', 'Opening')}</button>}
          </div>
          {/* Undo and redo stay in place; after the other actions, which scroll. */}
          <div className="history-btns">
            <button className={`compact-btn${Object.values(locked).some(Boolean) ? ' frozen-on' : ''}`} aria-label={tr('Verrouiller des éléments', 'Lock elements')} title={tr('Verrouiller des éléments', 'Lock elements')} onClick={() => setSheet('locks')}>
              {Object.values(locked).some(Boolean) ? <Lock /> : <LockOpen />}
            </button>
            <button className="compact-btn" aria-label={tr('Annuler', 'Undo')} disabled={!history.past.length} onClick={() => travel('undo')}><Undo2 /></button>
            <button className="compact-btn" aria-label={tr('Rétablir', 'Redo')} disabled={!history.future.length} onClick={() => travel('redo')}><Redo2 /></button>
          </div>
        </div>
        <div className="workspace">
          <SurveyEditor palette={THEMES[theme].editor} survey={survey} levelId={level.id} onChange={change} selectedRoomId={selected} onSelectRoom={setSelected} onLinked={(a, b, kind) => { setLinked({ a, b, kind }); setSheet('link'); }}
            selectedOpeningId={selectedOpening} onSelectOpening={setSelectedOpening} locked={locked} furnitureModel={furnitureDock && placingFurniture ? furnitureModel : undefined}
            selectedFurnitureId={selectedFurniture} onSelectFurniture={id => { setSelectedFurniture(id); if (id) setTool('select'); }}
            tool={tool === 'furniture' && !(furnitureDock && placingFurniture) ? 'select' : tool}
            onToolChange={next => { setTool(next); if (next !== 'furniture') setPlacingFurniture(false); }} lang={lang} />
        </div>
      </div>

      )}

      {/* Floating like the toolbar; the plan keeps room for it at the bottom (--plan-inset). */}
      {view === 'room' && opening && room && !sheet && (
            <div className="dock"><div className="selection-bar" role="toolbar" aria-label={tr('Ouverture sélectionnée', 'Selected opening')}>
              <div className="selection-head">
                <span className="selection-ico">{opening.kind === 'door' ? <DoorOpen /> : <WindowIcon />}</span>
                <b>{opening.kind === 'door' ? tr('Porte', 'Door') : tr('Fenêtre', 'Window')} · {OPERATION_LABELS[opening.operation][1]}</b>
                <small>{fmt(opening.width_m)} × {fmt(opening.height_m)}</small>
                <button className="selection-close" aria-label={tr('Fermer', 'Close')} onClick={() => setSelectedOpening(null)}><X /></button>
              </div>
              <div className="selection-tools">
                <button className="tool" onClick={() => setSheet('opening')}><span className="ico"><Settings /></span><span className="txt">{tr('Modèle', 'Model')}</span></button>
                {/* A passage without a door has no hinge nor swing. */}
                {opening.operation !== 'none' && <>
                <button className="tool" onClick={() => safe(() => updateOpening(survey, room.id, opening.id, { hinge: opening.hinge === 'start' ? 'end' : 'start' }))}><span className="ico"><FlipHorizontal2 /></span><span className="txt">{tr('Charnière', 'Hinge')}</span></button>
                <button className="tool" onClick={() => safe(() => updateOpening(survey, room.id, opening.id, { swing: opening.swing === 'in' ? 'out' : 'in' }))}>
                  <span className="ico">{opening.swing === 'in' ? <ArrowDownToLine /> : <ArrowUpFromLine />}</span><span className="txt">{opening.swing === 'in' ? tr('Intérieur', 'Inward') : tr('Extérieur', 'Outward')}</span>
                </button>
                </>}
                {opening.kind === 'door' && !isLinked(room.walls.find(w => w.id === opening.wallId)!) && (
                  <button className="tool" onClick={() => {
                    try {
                      const r = addAdjacentRoom(survey, room.id, opening.id, `${tr('Pièce', 'Room')} ${level.rooms.length + 1}`);
                      change(r.survey);
                      setSelected(r.roomId);
                      setSelectedOpening(null);
                      setToast(tr('Pièce adjacente créée : la porte et le mur sont partagés', 'Adjacent room created: door and wall are shared'));
                    } catch (e) { setToast((e as Error).message); }
                  }}><span className="ico"><Plus /></span><span className="txt">{tr('Pièce', 'Room')}</span></button>
                )}
                <button className="tool danger" onClick={() => { try { change(deleteOpening(survey, room.id, opening.id)); setSelectedOpening(null); } catch (e) { setToast((e as Error).message); } }}><span className="ico"><Trash2 /></span><span className="txt">{tr('Supprimer', 'Delete')}</span></button>
              </div>
            </div></div>
          )}
      {view === 'room' && room && furniture && !opening && !furnitureDock && !sheet && (
        <div className="dock"><FurnitureSelection key={furniture.id} room={room} furniture={furniture}
          onEdit={() => setSheet('furniture-details')}
          onSave={value => safe(() => setSurveyFurniture(survey, room.id, value))}
          onDelete={() => { safe(() => deleteSurveyFurniture(survey, room.id, furniture.id)); setSelectedFurniture(null); }}
          onClose={() => setSelectedFurniture(null)}
        /></div>
      )}
      {furnitureDock && furnitureToPlace && !sheet && (
        <div className="dock">
          <div className="tools-bar wall-point-tools furniture-tools">
            <button type="button" className="wall-model-button" aria-haspopup="dialog" onClick={() => { setPlacingFurniture(false); setSheet('furniture-catalogue'); }}>
              <Sofa /><span>{tr(furnitureToPlace.labelFr, furnitureToPlace.labelEn)}</span><ChevronDown />
            </button>
            <button className={placingFurniture ? 'secondary-btn' : 'primary-btn'} onClick={() => setPlacingFurniture(on => !on)}>
              {placingFurniture ? <X /> : <Plus />} {placingFurniture ? tr('Annuler', 'Cancel') : tr('Placer', 'Place')}
            </button>
            <button className="iconbtn" aria-label={tr('Fermer', 'Close')} onClick={() => { setTool('select'); setPlacingFurniture(false); }}><X /></button>
          </div>
        </div>
      )}
      {!(view === 'room' && (opening || furniture)) && !furnitureDock && !sheet && (
        <div className="dock">
          {view === 'room' && room && statusHidden && (
            <button className={`status-chip ${roomStatus}`} aria-label={tr('Afficher l’état de la géométrie', 'Show the geometry status')} onClick={() => hideStatus(false)}>
              {roomStatus === 'resolved' ? <Check /> : roomStatus === 'inconsistent' ? <TriangleAlert /> : <Info />}
              {statusChanged && <span className="status-dot" />}
            </button>
          )}
          {view === 'room' && room && !statusHidden && (() => {
        const r = solveRoom(room);
        return (
          <div className={`notice survey-status ${r.status === 'resolved' ? 'good' : ''}`} role="status" style={{ margin: 0, borderRadius: 0, borderWidth: '1px 0 0', padding: '7px 15px' }}>
            {r.status === 'resolved' ? <><Check /> {tr('Géométrie résolue par les mesures', 'Geometry resolved from measurements')}</> : <>
              {/* One short line on the plan; the full explanation only on demand. */}
              <button type="button" onClick={() => setStatusOpen(o => !o)} aria-expanded={statusOpen}
                style={{ border: 0, background: 'transparent', color: 'inherit', font: 'inherit', fontWeight: 800, padding: 0 }}>
                {r.status === 'inconsistent' ? <><TriangleAlert /> {tr('Mesures incompatibles', 'Inconsistent measurements')}</> : <><Info /> {tr('Géométrie non résolue', 'Geometry not resolved')}</>} {statusOpen ? <ChevronUp /> : <ChevronDown />}
              </button>
              <button className="compact-btn" style={{ marginLeft: 8 }} onClick={() => setSheet('controls')}>＋ {tr('Mesure', 'Measure')}</button>
              {statusOpen && <div style={{ marginTop: 4, maxHeight: '30vh', overflowY: 'auto' }}>
                {r.status === 'inconsistent' ? r.message : `${room.shape === 'rectangle' ? tr('Rectangle supposé. ', 'Assumed rectangle. ') : ''}${r.hint}`}
              </div>}
            </>}
            <button className="status-hide" aria-label={tr('Masquer', 'Hide')} onClick={() => hideStatus(true)}><X /></button>
          </div>
        );
      })()}
          {roomMenu && view === 'room' && (
            <div className="room-menu" role="menu">
              {TOOLS.filter(t => t.tool === 'rect' || t.tool === 'polygon').map(t => (
                <button key={t.tool} role="menuitem" className={tool === t.tool ? 'active' : ''} onClick={() => { setTool(t.tool); setSelectedOpening(null); setRoomMenu(false); }}>
                  {t.icon} {tr(t.fr, t.en)}
                </button>
              ))}
            </div>
          )}
          <ToolDock page={view === 'global' ? 1 : dockPage} onPage={setDockPage} canSwipe={view === 'room'}
            tools={TOOLS.filter(t => t.tool !== 'polygon').map(t => {
              // Rectangle and outline share one « Room » item, which asks which way to draw.
              if (t.tool === 'rect') {
                const on = tool === 'rect' || tool === 'polygon';
                return (
                  <button key="room" className={`tool ${on ? 'active' : ''}`} aria-pressed={on} aria-expanded={roomMenu} disabled={!!locked.walls} onClick={() => {
                    if (on) { setRoomMenu(m => !m); return; }
                    setTool(lastRoomTool); setSelectedOpening(null); setRoomMenu(true);
                  }}>
                    <span className="ico">{(on ? tool : lastRoomTool) === 'polygon' ? <PenLine /> : <RectangleHorizontal />}</span><span className="txt">{tr('Pièce', 'Room')}</span>
                  </button>
                );
              }
              return (
                <button key={t.tool} className={`tool ${tool === t.tool ? 'active' : ''}`} aria-pressed={tool === t.tool}
                  disabled={t.tool === 'furniture' ? !room || !!room.frozen || !!locked.furniture : (t.tool === 'door' || t.tool === 'window') && (level.rooms.length === 0 || !!locked.openings)}
                  onClick={() => {
                    setRoomMenu(false);
                    if (t.tool === 'furniture') {
                      setSelectedFurniture(null);
                      setSelectedOpening(null);
                      setPlacingFurniture(false);
                      setTool('furniture');
                      setSheet('furniture-catalogue');
                      return;
                    }
                    setTool(t.tool);
                    if (t.tool !== 'select') { setSelectedOpening(null); setSelectedFurniture(null); }
                  }}>
                  <span className="ico">{t.icon}</span><span className="txt">{tr(t.fr, t.en)}</span>
                </button>
              );
            })}
            actions={<>
              <span className="dock-stats">{walls.length} {tr('murs', 'walls')} · {openings} {tr('ouv.', 'open.')}<br /><b>{measured}/{walls.length}</b> {tr('cotés', 'measured')}{warnings ? ` · ${warnings} ${tr('écart(s)', 'gap(s)')}` : ''}</span>
              <button className="primary-btn" onClick={() => { setMenuPage('export'); setSheet('menu'); }}><Upload /> {tr('Exporter', 'Export')}</button>
            </>} />
        </div>
      )}

      {sheet === 'locks' && (
        <Sheet eyebrow={tr('Plan', 'Plan')} title={tr('Verrouiller', 'Lock')} onClose={() => setSheet(null)}>
          <p>{tr('Un type verrouillé ne peut plus être déplacé ni modifié sur le plan : touchez-le, le plan se déplace.', 'A locked type can no longer be moved or changed on the plan: touching it pans the plan.')}</p>
          <div className="style-choices wall-catalogue-disciplines">
            {([['walls', <Square />, tr('Murs et pièces', 'Walls and rooms')], ['openings', <DoorOpen />, tr('Ouvertures', 'Openings')], ['furniture', <Sofa />, tr('Meubles', 'Furniture')]] as const).map(([key, icon, label]) => (
              <button key={key} type="button" className={`choice${locked[key] ? ' selected' : ''}`} aria-pressed={!!locked[key]}
                onClick={() => {
                  setLocked(l => ({ ...l, [key]: !l[key] }));
                  // Locking a type also leaves its creation tool.
                  if (!locked[key] && ((key === 'walls' && (tool === 'rect' || tool === 'polygon')) || (key === 'openings' && (tool === 'door' || tool === 'window')) || (key === 'furniture' && tool === 'furniture'))) { setTool('select'); setPlacingFurniture(false); setRoomMenu(false); } if (key === 'furniture') setSelectedFurniture(null); if (key === 'openings') setSelectedOpening(null); }}>
                <span className="symbol">{locked[key] ? <Lock /> : icon}</span><b>{label}</b>
              </button>
            ))}
          </div>
          <div className="sheet-actions"><button type="button" className="primary-btn" onClick={() => setSheet(null)}>{tr('Terminé', 'Done')}</button></div>
        </Sheet>
      )}
      {sheet === 'furniture-catalogue' && <FurnitureCatalogue
        initial={furnitureModel}
        onClose={() => { setSheet(null); if (!furnitureToPlace) setTool('select'); }}
        onPick={id => { setFurnitureModel(id); setTool('furniture'); setSheet(null); }}
      />}
      {sheet === 'furniture-details' && room && furniture && <FurnitureDetails key={furniture.id} furniture={furniture}
        onClose={() => setSheet(null)}
        onSave={value => { change(setSurveyFurniture(survey, room.id, value)); setSheet(null); }}
        onDelete={() => {
          safe(() => deleteSurveyFurniture(survey, room.id, furniture.id));
          setSelectedFurniture(null);
          setSheet(null);
        }}
      />}
      {sheet === 'room' && room && (
        <Sheet eyebrow={tr('Pièce', 'Room')} title={room.name} onClose={() => setSheet(null)}>
          <div className="fields">
            <label className="field wide">{tr('Nom', 'Name')}
              <input value={room.name} onChange={e => safe(() => renameRoom(survey, room.id, e.target.value))} />
            </label>
            <label className="field">{tr(`Hauteur sous plafond (${U()})`, `Ceiling height (${U()})`)}
              <input inputMode={lengthInput()} placeholder={fmtValue(surveyDefaults(survey).ceilingHeight_m)} key={`${room.id}-${U()}`} defaultValue={room.ceilingHeight_m !== undefined ? fmtValue(room.ceilingHeight_m) : ''}
                onBlur={e => { if (e.target.value === e.target.defaultValue) return; const v = num(e.target.value); safe(() => setCeilingHeight(survey, room.id, v > 0 ? v : undefined)); }} />
            </label>
            <div className="field">{tr('Géométrie', 'Geometry')}
              <span className="tag" style={{ alignSelf: 'flex-start' }}>{room.geometryStatus === 'assumed' ? tr('Supposée', 'Assumed') : tr('Résolue', 'Resolved')}</span>
            </div>
          </div>
          {(room.shape === 'polygon' || room.polygon.length !== 4 || !room.polygon.every((_, i) => room.angles?.some(a => a.vertex === i && a.deg === 90))) && (
            <>
              <p className="hint">{tr('Remet la pièce en rectangle autour de son dessin et confirme ses 4 angles droits (90°) : avec deux murs voisins mesurés, la géométrie est résolue. Portes, fenêtres et photos restent sur leur côté, les liens avec les pièces voisines sont refaits ; les diagonales saisies sont retirées.',
                'Turns the room into a rectangle around its drawing and confirms its 4 right angles (90°): with two adjacent measured walls, the geometry is resolved. Doors, windows and photos stay on their side, links with neighbouring rooms are made again; typed diagonals are removed.')}</p>
              <button className="secondary-btn" style={{ width: '100%' }} onClick={() => {
                try {
                  const r = makeRectangle(survey, room.id);
                  change(r.survey);
                  setSheet(null);
                  setToast(r.lostLinks ? tr(`Rectangle confirmé ; ${r.lostLinks} lien(s) avec une pièce voisine à refaire (Lier un mur)`, `Rectangle restored; ${r.lostLinks} link(s) to redo (Link a wall)`) : tr('Rectangle confirmé : angles à 90°', 'Rectangle confirmed: 90° angles'));
                } catch (e) { setToast((e as Error).message); }
              }}><RectangleHorizontal /> {room.shape === 'polygon' || room.polygon.length !== 4 ? tr('Redevenir rectangle', 'Back to a rectangle') : tr('Confirmer le rectangle (angles à 90°)', 'Confirm the rectangle (90° angles)')}</button>
            </>
          )}
          {(() => {
            // Every link and alignment of the room: tapped to edit, 🗑 to remove.
            const rows = room.walls.flatMap(w => [
              ...linkedFaces(level, w).map(f => ({ kind: 'link' as const, w, room: f.room, wall: f.wall })),
              ...alignedFaces(level, w).map(f => ({ kind: 'alignment' as const, w, room: f.room, wall: f.wall })),
            ]);
            if (!rows.length) return null;
            return <>
              <h4>{tr('Murs liés et prolongés', 'Linked and aligned walls')}</h4>
              {rows.map(x => {
                const a = { roomId: room.id, wallId: x.w.id }, b = { roomId: x.room.id, wallId: x.wall.id };
                return (
                  <div key={`${x.kind}-${x.w.id}-${x.wall.id}`} className="opening-line">
                    <button className="link-row" onClick={() => { setLinked({ a, b, kind: x.kind }); setSheet('link'); }}>
                      {x.kind === 'link' ? <Link2 /> : <ArrowRight />} {wallLabel(x.w)} {x.kind === 'link' ? tr('lié à', 'linked to') : tr('prolongé par', 'continued by')} {x.room.name.trim()} · {wallLabel(x.wall)}
                    </button>
                    <button className="compact-btn" aria-label={tr('Supprimer', 'Remove')} onClick={() => safe(() => (x.kind === 'link' ? unlinkFaces(survey, a, b) : unalignFaces(survey, a, b)))}><Trash2 /></button>
                  </div>
                );
              })}
            </>;
          })()}
          <button className={`secondary-btn ${room.frozen ? 'frozen-on' : ''}`} style={{ width: '100%', marginTop: 12 }} onClick={() => safe(() => setRoomFrozen(survey, room.id, !room.frozen))}>
            {room.frozen ? <><LockOpen /> {tr('Défiger la pièce', 'Unfreeze the room')}</> : <><Lock /> {tr('Figer la pièce', 'Freeze the room')}</>}
          </button>
          <p className="hint">{room.frozen
            ? tr('Pièce figée : ses cotes, son tracé, ses ouvertures et sa position ne peuvent plus être modifiés, ni la pièce supprimée.', 'Frozen room: its cotes, drawing, openings and position can no longer be changed, nor the room deleted.')
            : tr('Figer la pièce empêche de la modifier ou de la supprimer par erreur.', 'Freezing the room prevents changing or deleting it by mistake.')}</p>
          {confirmDelete ? (
            <div className="notice" style={{ marginTop: 12 }}>
              {tr(`Supprimer « ${room.name} », ses ouvertures et ses photos ? « Annuler » (↶) la rétablit.`, `Delete “${room.name}”, its openings and photos? Undo (↶) brings it back.`)}
              <div className="sheet-actions" style={{ marginTop: 10 }}>
                <button className="secondary-btn" onClick={() => setConfirmDelete(false)}>{tr('Garder', 'Keep')}</button>
                <button className="primary-btn" style={{ background: '#b0523a' }} onClick={() => {
                  try { change(deleteRoom(survey, room.id)); setSelected(null); setSheet(null); setToast(tr(`« ${room.name} » supprimée`, `“${room.name}” deleted`)); }
                  catch (e) { setToast((e as Error).message); }
                  setConfirmDelete(false);
                }}><Trash2 /> {tr('Supprimer', 'Delete')}</button>
              </div>
            </div>
          ) : (
          <div className="sheet-actions">
            <button className="secondary-btn" style={{ color: '#b0523a' }} disabled={room.frozen} onClick={() => setConfirmDelete(true)}><Trash2 /> {tr('Supprimer la pièce', 'Delete room')}</button>
            <button className="primary-btn" onClick={() => setSheet(null)}>{tr('Terminé', 'Done')}</button>
          </div>
          )}
        </Sheet>
      )}

      {sheet === 'opening' && opening && room && (
        <Sheet eyebrow={opening.kind === 'door' ? tr('Porte', 'Door') : tr('Fenêtre', 'Window')} title={tr('Modèle d’ouverture', 'Opening model')} onClose={() => setSheet(null)}>
          <div className="style-choices" style={{ marginBottom: 8 }}>
            {(['door', 'window'] as OpeningKind[]).map(k => (
              <button key={k} className={`choice ${opening.kind === k ? 'selected' : ''}`} onClick={() => safe(() => updateOpening(survey, room.id, opening.id, { kind: k }))}>
                <span className="symbol">{k === 'door' ? <DoorOpen /> : <WindowIcon />}</span><b>{k === 'door' ? tr('Porte', 'Door') : tr('Fenêtre', 'Window')}</b>
              </button>
            ))}
          </div>
          <div className="catalog-grid">
            {OPENING_OPERATIONS[opening.kind].map(op => (
              <button key={op} className={`catalog-choice ${opening.operation === op ? 'active' : ''}`} onClick={() => safe(() => updateOpening(survey, room.id, opening.id, { operation: op }))}>
                <span className="catalog-glyph">{OPERATION_LABELS[op][0]}</span><strong>{OPERATION_LABELS[op][1]}</strong><small>{OPERATION_LABELS[op][2]}</small>
              </button>
            ))}
          </div>
          <div className="fields" style={{ marginTop: 12 }}>
            <label className="field">{tr(`Hauteur (${U()})`, `Height (${U()})`)}
              <input key={`h-${opening.id}-${U()}`} inputMode={lengthInput()} defaultValue={fmtValue(opening.height_m)}
                onBlur={e => { if (e.target.value === e.target.defaultValue) return; const v = num(e.target.value); if (v > 0) safe(() => updateOpening(survey, room.id, opening.id, { height_m: v })); }} />
            </label>
            {opening.kind === 'window' && (
              <label className="field">{tr(`Allège (${U()})`, `Sill (${U()})`)}
                <input key={`s-${opening.id}-${U()}`} inputMode={lengthInput()} defaultValue={fmtValue(opening.sill_m ?? 0.9)}
                  onBlur={e => { if (e.target.value === e.target.defaultValue) return; const v = num(e.target.value); if (v >= 0) safe(() => updateOpening(survey, room.id, opening.id, { sill_m: v })); }} />
              </label>
            )}
          </div>
          <div className="sheet-actions">
            <button className="primary-btn" onClick={() => setSheet(null)}>{tr('Terminé', 'Done')}</button>
          </div>
        </Sheet>
      )}

      {sheet === 'controls' && room && (
        <ControlsSheet room={room} onClose={() => setSheet(null)}
          onDiagonal={(a, b, l) => safe(() => addDiagonal(survey, room.id, a, b, l))}
          onAngle={(v, deg) => safe(() => setAngle(survey, room.id, v, deg))}
          onRightAngles={() => safe(() => setRightAngles(survey, room.id))}
          onDelete={id => safe(() => deleteControl(survey, room.id, id))} />
      )}

      {sheet === 'photos' && room && (
        <PhotosSheet key={room.id} survey={survey} level={level} room={room} initialPoint={pointToComplete} onClose={() => setSheet(null)} onError={setToast}
          onAdd={async (surface, file) => {
            const img = await reencodePhoto(file);
            const id = `ph_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
            await savePhoto(survey.id, id, img.blob);
            safe(() => addPhoto(survey, room.id, surface, { id, width: img.width, height: img.height }));
          }}
          onDelete={async id => { safe(() => deletePhoto(survey, room.id, id)); }}
          onEdit={(f, gesture) => { try { change(f(survey), gesture); } catch (e) { setToast((e as Error).message); } }} />
      )}

      {sheet === 'link' && linked && (
        linked.kind === 'alignment'
          ? <AlignSheet survey={survey} a={linked.a} b={linked.b} onClose={() => setSheet(null)} onEdit={safe} />
          : <LinkSheet survey={survey} a={linked.a} b={linked.b} onClose={() => setSheet(null)} onEdit={safe} />
      )}

      {sheet === 'menu' && (() => {
        const checks = surveyChecks(survey);
        const errors = checks.filter(c => c.severity === 'error').length;
        const titles = { main: survey.name, avatar: tr('Avatar', 'Avatar'), properties: tr('Propriétés du relevé', 'Survey properties'), checks: tr('Contrôle du relevé', 'Survey check'), export: tr('Exporter et envoyer', 'Export and send'), settings: tr('Réglages', 'Settings'), about: tr('À propos', 'About') };
        const item = (page: typeof menuPage, icon: ReactNode, label: string, detail: string) => (
          <button key={page} className="menu-item" onClick={() => setMenuPage(page)}>
            <span className="menu-icon" aria-hidden>{icon}</span>
            <span className="menu-text"><b>{label}</b><small>{detail}</small></span>
            <span aria-hidden>›</span>
          </button>
        );
        return (
        <Sheet eyebrow={menuPage === 'main' ? tr('Relevé', 'Survey') : survey.name} title={titles[menuPage]} onClose={() => { setSheet(null); setMenuPage('main'); }}
          aside={menuPage === 'main' && <button className="head-avatar" aria-label={tr('Changer l’avatar', 'Change avatar')} onClick={() => setMenuPage('avatar')}><SurveyAvatar surveyId={survey.id} /></button>}>
          {menuPage !== 'main' && <button className="menu-back" onClick={() => setMenuPage('main')}>‹ {tr('Menu', 'Menu')}</button>}
          {menuPage === 'main' && <>
          <div className="stat-row">
            <div className="stat-card"><b>{level.rooms.length}</b><small>{tr('pièces', 'rooms')}</small></div>
            <div className="stat-card"><b>{measured}/{walls.length}</b><small>{tr('murs cotés', 'measured')}</small></div>
            <div className="stat-card"><b>{openings}</b><small>{tr('ouvertures', 'openings')}</small></div>
          </div>
          {warnings > 0 && <div className="notice">{tr(`${warnings} écart(s) entre cotes mesurées et dessin : rien n’est corrigé automatiquement.`, `${warnings} discrepancy(ies) between measured lengths and drawing: nothing is corrected automatically.`)}</div>}
            {item('properties', <MapIcon />, tr('Propriétés du relevé', 'Survey properties'), tr(`Hauteur ${fmt(surveyDefaults(survey).ceilingHeight_m)} · murs ${fmt(surveyDefaults(survey).interiorThickness_m)} / ${fmt(surveyDefaults(survey).exteriorThickness_m)}`, `Height ${fmt(surveyDefaults(survey).ceilingHeight_m)} · walls ${fmt(surveyDefaults(survey).interiorThickness_m)} / ${fmt(surveyDefaults(survey).exteriorThickness_m)}`))}
            {item('checks', checks.length ? (errors ? <OctagonX /> : <TriangleAlert />) : <Check />, tr('Contrôle du relevé', 'Survey check'), checks.length ? tr(`${checks.length} point(s) à vérifier`, `${checks.length} point(s) to check`) : tr('Relevé complet', 'Complete survey'))}
            {item('export', <Upload />, tr('Exporter et envoyer', 'Export and send'), tr('Fichier relevé, envoi au compte', 'Survey file, send to the account'))}
            {item('settings', <Settings />, tr('Réglages', 'Settings'), tr(`Unité : ${U()} · aides`, `Unit: ${U()} · help`))}
            {item('about', 'ℹ', tr('À propos', 'About'), `skAItch Survey ${APP_VERSION}`)}
          </>}
          {menuPage === 'avatar' && <AvatarField surveyId={survey.id} />}
          {menuPage === 'properties' && (() => {
            const d = surveyDefaults(survey);
            const field = (key: 'ceilingHeight_m' | 'interiorThickness_m' | 'exteriorThickness_m', label: string) => (
              <label className="field" key={`${key}-${U()}`}>{label} ({U()})
                <input inputMode={lengthInput()} defaultValue={fmtValue(d[key])}
                  onBlur={e => { if (e.target.value === e.target.defaultValue) return; const v = num(e.target.value); if (v > 0) safe(() => setSurveyDefaults(survey, { [key]: v })); else setToast(tr('Valeur attendue strictement positive.', 'A value greater than zero is expected.')); }} />
              </label>
            );
            return <>
              <p className="hint">{tr('Valeurs utilisées là où rien n’a été mesuré. Les épaisseurs estimées encore à l’ancienne valeur suivent la nouvelle ; les valeurs mesurées ne changent pas.',
                'Values used where nothing was measured. Estimated thicknesses still at the old value follow the new one; measured values do not change.')}</p>
              <div className="fields">
                <div className="wide">{field('ceilingHeight_m', tr('Hauteur sous plafond par défaut', 'Default ceiling height'))}</div>
                {field('interiorThickness_m', tr('Murs intérieurs', 'Interior walls'))}
                {field('exteriorThickness_m', tr('Murs extérieurs', 'Exterior walls'))}
              </div>
              <p className="hint">{tr('Mur intérieur : mur lié à une autre pièce. Mur extérieur : mur sans pièce liée.', 'Interior wall: a wall linked to another room. Exterior wall: a wall with no linked room.')}</p>
            </>;
          })()}
          {menuPage === 'checks' && <>
          {(() => {
            // Survey check (spec F-29): each point leads to the room to fix; export stays possible.
            const checks = surveyChecks(survey);
            if (!checks.length) return <div className="notice good"><Check /> {tr('Relevé complet : aucune donnée manquante.', 'Complete survey: nothing missing.')}</div>;
            const icon = { error: <OctagonX />, warning: <TriangleAlert />, info: <Info /> };
            return (
              <>
                                {checks.map((c, i) => (
                  <button key={i} className="photo-annotation-row" style={{ width: '100%', textAlign: 'left', cursor: c.roomId ? 'pointer' : 'default' }}
                    onClick={() => {
                      if (!c.roomId) return;
                      const r = level.rooms.find(x => x.id === c.roomId);
                      setSelected(c.roomId);
                      setSelectedOpening(r?.openings?.some(o => o.id === c.targetId) ? c.targetId! : null);
                      const point = r?.technicalPoints?.find(p => p.id === c.targetId);
                      setPointToComplete(point?.id);
                      setTool('select'); setView('room'); setSheet(point ? 'photos' : null);
                    }}>
                    <span aria-hidden>{icon[c.severity]}</span>
                    <span className="annotation-desc">{c.message}</span>
                    {c.roomId && <span aria-hidden>›</span>}
                  </button>
                ))}
              </>
            );
          })()}
          </>}
          {menuPage === 'export' && <>
          {photoCount > 0 && <div className="notice">{tr(`Le fichier contiendra ${photoCount} photo(s) d’intérieur, sans position GPS ni informations d’appareil. Partagez-le uniquement avec les personnes concernées par le chantier.`,
            `The file will contain ${photoCount} interior photo(s), without GPS position or device data. Share it only with people involved in the site.`)}</div>}
          <p className="hint">{tr('Le fichier relevé s’importe dans l’onglet Survey d’un étage de SkAItch.', 'The survey file is imported in the Survey tab of a SkAItch storey.')}</p>
          <div className="sheet-actions">
            <button className="secondary-btn" onClick={() => setSheet(null)}>{tr('Fermer', 'Close')}</button>
            <button className="primary-btn" onClick={async () => {
              try { await saving.current; await exportSurvey(survey); setSheet(null); setToast(tr('Fichier relevé exporté', 'Survey file exported')); }
              catch (e) { setToast((e as Error).message); }
            }}><Upload /> {surveyChecks(survey).some(c => c.severity === 'error') ? tr('Exporter quand même', 'Export anyway') : tr('Exporter', 'Export')}</button>
          </div>
          <SendPanel survey={survey} beforeSend={() => saving.current} onDone={msg => { setSheet(null); setToast(msg); }} />
          </>}
          {menuPage === 'settings' && <>
          <h4>{tr('Langue', 'Language')}</h4>
          <LanguageField />
          <ThemePicker />
          <h4>{tr('Cotes', 'Lengths')}</h4>
          <UnitField />
          <button className="secondary-btn" style={{ width: '100%' }} onClick={() => { reopenHints(); setSheet(null); setToast(tr('Les aides sont de nouveau affichées', 'Help messages are shown again')); }}>
            ? {tr('Réafficher toutes les aides', 'Show all help messages again')}
          </button>
          </>}
          {menuPage === 'about' && <>
          <div className="info-card about-card">
            <b>skAItch Survey</b> · {tr('version', 'version')} {APP_VERSION}
            <small>{tr(`Relevé de pièces sur site, hors ligne. Format du fichier relevé : ${SURVEY_FORMAT_VERSION}.`, `On-site room survey, offline. Survey file format: ${SURVEY_FORMAT_VERSION}.`)}</small>
            <small>{tr('Le relevé s’importe dans l’onglet Survey de skAItch (web et bureau).', 'The survey is imported in the Survey tab of skAItch (web and desktop).')}</small>
            <small>skaitch.online</small>
          </div>
          </>}
        </Sheet>
        );
      })()}
      <Toast text={toast} onDone={() => setToast('')} />
    </div>
  );
}

/** Aligned walls: the set-back measured between the two lines, or removing the alignment. */
function AlignSheet({ survey, a, b, onClose, onEdit }: {
  survey: Survey; a: { roomId: string; wallId: string }; b: { roomId: string; wallId: string };
  onClose: () => void; onEdit: (edit: () => Survey) => void;
}) {
  const level = survey.levels[0];
  const ra = level.rooms.find(r => r.id === a.roomId), rb = level.rooms.find(r => r.id === b.roomId);
  const wa = ra?.walls.find(w => w.id === a.wallId), wb = rb?.walls.find(w => w.id === b.wallId);
  const alignment = wa?.alignments?.find(x => x.roomId === b.roomId && x.wallId === b.wallId);
  const [step, setStep] = useState<string | null>(null);
  if (!ra || !rb || !wa || !wb || !alignment) return null;
  const placement = placeRooms(level);
  const toPlace = [rb, ra].find(r => placement.rooms.get(r.id)?.toReplace && placement.rooms.get(r.id)?.status !== 'reference' && !r.frozen);
  return (
    <Sheet eyebrow={tr('Murs dans le prolongement', 'Aligned walls')} title={`${ra.name.trim()} · ${wallLabel(wa)} → ${rb.name.trim()} · ${wallLabel(wb)}`} onClose={onClose}>
      <p>{tr('Le mur continue d’une pièce à l’autre, sur la même ligne. Il sert à orienter et placer les pièces : avec un mur lié entre elles, il remplace la mesure du décalage.',
        'The wall continues from one room to the other, on the same line. It turns and places the rooms: with a linked wall between them, it replaces measuring the offset.')}</p>
      <label className="field">{tr(`Décrochement (${U()})`, `Set-back (${U()})`)}
        <input inputMode={lengthInput()} value={step ?? fmtValue(alignment.step_m)} onChange={e => setStep(e.target.value)} />
        <small>{alignment.stepStatus === 'measured' ? tr('mesuré', 'measured') : tr('0 tant qu’il n’est pas mesuré', '0 until measured')}</small>
      </label>
      <p className="hint">{tr(`Positif quand le mur de ${rb.name.trim()} est plus à l’extérieur que celui de ${ra.name.trim()}.`, `Positive when ${rb.name.trim()}’s wall lies further out than ${ra.name.trim()}’s.`)}</p>
      <div className="sheet-actions">
        <button className="secondary-btn" style={{ color: '#b0523a' }} onClick={() => { onEdit(() => unalignFaces(survey, a, b)); onClose(); }}><Trash2 /> {tr('Supprimer', 'Remove')}</button>
        <button className="primary-btn" disabled={step === null} onClick={() => onEdit(() => { const v = num(step ?? ''); setStep(null); return setAlignmentStep(survey, a, b, v); })}><Check /> {tr('Enregistrer', 'Save')}</button>
      </div>
      {toPlace && (
        <button className="primary-btn" style={{ width: '100%', marginTop: 10 }} onClick={() => onEdit(() => replaceRooms(survey, level.id, [toPlace.id]))}>
          <Move /> {tr(`Placer ${toPlace.name.trim()}`, `Place ${toPlace.name.trim()}`)}
        </button>
      )}
      <button className="secondary-btn" style={{ width: '100%', marginTop: 10 }} onClick={onClose}>{tr('Terminé', 'Done')}</button>
    </Sheet>
  );
}

/**
 * After linking two walls (ADR 0013): the offset and thickness measured on site, and placing the
 * room against the other one when its drawing is not where the cotes put it.
 */
function LinkSheet({ survey, a, b, onClose, onEdit }: {
  survey: Survey; a: { roomId: string; wallId: string }; b: { roomId: string; wallId: string };
  onClose: () => void; onEdit: (edit: () => Survey) => void;
}) {
  const level = survey.levels[0];
  const ra = level.rooms.find(r => r.id === a.roomId), rb = level.rooms.find(r => r.id === b.roomId);
  const wa = ra?.walls.find(w => w.id === a.wallId), wb = rb?.walls.find(w => w.id === b.wallId);
  const link = wa?.links?.find(l => l.roomId === b.roomId && l.wallId === b.wallId);
  // Only a field the user typed in becomes measured.
  const [offset, setOffset] = useState<string | null>(null);
  const [thickness, setThickness] = useState<string | null>(null);
  if (!ra || !rb || !wa || !wb || !link) return null;
  const placement = placeRooms(level);
  // The room to place: the one whose drawing is off, never the reference room.
  const toPlace = [rb, ra].find(r => placement.rooms.get(r.id)?.toReplace && placement.rooms.get(r.id)?.status !== 'reference' && !r.frozen);
  const against = toPlace?.id === rb.id ? ra : rb;
  const save = () => onEdit(() => {
    let next = survey;
    if (offset !== null) {
      const v = num(offset);
      if (!(v >= 0)) throw new Error(tr('Décalage attendu, positif ou nul.', 'An offset of zero or more is expected.'));
      next = setLinkOffset(next, a, b, v);
    }
    if (thickness !== null) {
      const t = num(thickness);
      if (!(t > 0)) throw new Error(tr('Épaisseur attendue, strictement positive.', 'A thickness greater than zero is expected.'));
      next = setWallThickness(next, a.roomId, a.wallId, t, true);
    }
    setOffset(null); setThickness(null);
    return next;
  });
  return (
    <Sheet eyebrow={tr('Murs liés', 'Linked walls')} title={`${ra.name.trim()} · ${wallLabel(wa)} ⇄ ${rb.name.trim()} · ${wallLabel(wb)}`} onClose={onClose}>
      <p>{tr('C’est le même mur. Saisissez ce que vous avez mesuré ; sinon, les valeurs restent estimées et le plan global les demandera.',
        'They are one wall. Type what you measured; otherwise the values stay estimated and the global plan will ask for them.')}</p>
      <div className="fields">
        <label className="field">{tr(`Décalage (${U()})`, `Offset (${U()})`)}
          <input inputMode={lengthInput()} value={offset ?? fmtValue(link.offset_m)} onChange={e => setOffset(e.target.value)} />
          <small>{link.offsetStatus === 'measured' ? tr('mesuré', 'measured') : tr('estimé', 'estimated')}</small>
        </label>
        <label className="field">{tr(`Épaisseur (${U()})`, `Thickness (${U()})`)}
          <input inputMode={lengthInput()} value={thickness ?? fmtValue(wa.thickness_m)} onChange={e => setThickness(e.target.value)} />
          <small>{wa.thicknessStatus === 'measured' ? tr('mesurée', 'measured') : tr('estimée', 'estimated')}</small>
        </label>
      </div>
      <p className="hint">{tr(`Décalage : le long de « ${wallLabel(wa)} » de ${ra.name.trim()}, depuis P${wa.from + 1} jusqu’à l’angle de ${rb.name.trim()}.`,
        `Offset: along “${wallLabel(wa)}” of ${ra.name.trim()}, from P${wa.from + 1} to the corner of ${rb.name.trim()}.`)}</p>
      <div className="sheet-actions">
        <button className="secondary-btn" onClick={onClose}>{tr('Terminé', 'Done')}</button>
        <button className="primary-btn" onClick={save}><Check /> {tr('Enregistrer les mesures', 'Save the measurements')}</button>
      </div>
      {toPlace && (
        <button className="primary-btn" style={{ width: '100%', marginTop: 10 }} onClick={() => onEdit(() => replaceRooms(survey, level.id, [toPlace.id]))}>
          <Move /> {tr(`Placer ${toPlace.name.trim()} contre ${against.name.trim()}`, `Place ${toPlace.name.trim()} against ${against.name.trim()}`)}
        </button>
      )}
    </Sheet>
  );
}

/** Control measurements (spec F-05): diagonals and angles that let the solver resolve the room. */
function ControlsSheet({ room, onClose, onDiagonal, onAngle, onRightAngles, onDelete }: {
  room: Survey['levels'][number]['rooms'][number]; onClose: () => void;
  onDiagonal: (from: number, to: number, length: number) => void; onAngle: (vertex: number, deg: number) => void; onDelete: (id: string) => void;
  onRightAngles: () => void;
}) {
  const n = room.polygon.length;
  const pairs = [...Array(n).keys()].flatMap(i => [...Array(n).keys()].filter(j => j > i && (j - i) % n !== 1 && (i - j + n) % n !== 1).map(j => [i, j] as const));
  const [pair, setPair] = useState(pairs[0] ? `${pairs[0][0]}-${pairs[0][1]}` : '');
  const [length, setLength] = useState('');
  const [vertex, setVertex] = useState(0);
  const [deg, setDeg] = useState('90');
  const result = solveRoom(room);
  return (
    <Sheet eyebrow={room.name} title={tr('Mesures de contrôle', 'Control measurements')} onClose={onClose}>
      <div className={`notice ${result.status === 'resolved' ? 'good' : ''}`}>
        {result.status === 'resolved' ? tr('La forme de la pièce est déterminée par les mesures.', 'The room shape is determined by the measurements.')
          : result.status === 'inconsistent' ? result.message : result.hint}
      </div>
      {(room.diagonals ?? []).map(d => (
        <div key={d.id} className="opening-line"><span><Slash /> {tr('Diagonale', 'Diagonal')} P{d.from + 1}–P{d.to + 1}</span><b>{fmt(d.length_m)}</b>
          <button className="compact-btn" aria-label={tr('Supprimer', 'Delete')} onClick={() => onDelete(d.id)}><Trash2 /></button></div>
      ))}
      {(room.angles ?? []).map(a => (
        <div key={a.id} className="opening-line"><span><TriangleRight /> {tr('Angle en', 'Angle at')} P{a.vertex + 1}</span><b>{a.deg.toString().replace('.', ',')}°</b>
          <button className="compact-btn" aria-label={tr('Supprimer', 'Delete')} onClick={() => onDelete(a.id)}><Trash2 /></button></div>
      ))}
      {pairs.length > 0 && (
        <form onSubmit={e => { e.preventDefault(); const [a, b] = pair.split('-').map(Number); const l = num(length); if (l > 0) { onDiagonal(a, b, l); setLength(''); } }}>
          <h4>{tr('Ajouter une diagonale', 'Add a diagonal')}</h4>
          <div className="fields">
            <label className="field">{tr('Entre', 'Between')}
              <select value={pair} onChange={e => setPair(e.target.value)}>{pairs.map(([a, b]) => <option key={`${a}-${b}`} value={`${a}-${b}`}>P{a + 1} – P{b + 1}</option>)}</select>
            </label>
            <label className="field">{tr(`Longueur (${U()})`, `Length (${U()})`)}<input inputMode={lengthInput()} value={length} onChange={e => setLength(e.target.value)} placeholder={fmtValue(5)} /></label>
          </div>
          <div className="sheet-actions" style={{ marginTop: 10 }}><button type="submit" className="secondary-btn" disabled={!(num(length) > 0)}>＋ {tr('Diagonale', 'Diagonal')}</button></div>
        </form>
      )}
      <button type="button" className="secondary-btn" style={{ width: '100%', marginTop: 12 }} onClick={onRightAngles}>
        <TriangleRight /> {tr('Angles droits partout (90° / 270°)', 'Right angles everywhere (90° / 270°)')}
      </button>
      <form onSubmit={e => {
        e.preventDefault();
        const v = parseFloat(deg.replace(",", "."));
        if (!(v > 0 && v < 360)) return;
        onAngle(vertex, v);
        // Next corner without an angle, so several angles can be typed in a row.
        const done = new Set([...(room.angles ?? []).map(a => a.vertex), vertex]);
        const nextFree = [...Array(n).keys()].map(k => (vertex + 1 + k) % n).find(k => !done.has(k));
        if (nextFree !== undefined) setVertex(nextFree);
      }}>
        <h4>{tr('Ajouter un angle', 'Add an angle')}</h4>
        <div className="fields">
          <label className="field">{tr('Sommet', 'Vertex')}
            <select value={vertex} onChange={e => setVertex(Number(e.target.value))}>{room.polygon.map((_, i) => <option key={i} value={i}>P{i + 1}</option>)}</select>
          </label>
          <label className="field">{tr('Angle intérieur (°)', 'Interior angle (°)')}<input inputMode="decimal" value={deg} onChange={e => setDeg(e.target.value)} /></label>
        </div>
        <div className="sheet-actions" style={{ marginTop: 10 }}>
          <button type="submit" className="secondary-btn">＋ {tr('Angle', 'Angle')}</button>
          <button type="button" className="primary-btn" onClick={onClose}>{tr('Terminé', 'Done')}</button>
        </div>
      </form>
    </Sheet>
  );
}

type Room = Survey['levels'][number]['rooms'][number];
/** Surface last chosen in the room, kept while the app is open. */
const lastSurface = new Map<string, string>();
const surfaceKey = (s: SurveySurface) => (s.kind === 'wall' ? `wall:${s.wallId}` : s.kind);

/** Photos of a room's walls, floor and ceiling (spec F-19, F-20), stored on the device. */
function PhotosSheet({ survey, level, room, initialPoint, onClose, onAdd, onDelete, onError, onEdit }: {
  survey: Survey; level: Survey['levels'][number]; room: Room; initialPoint?: string; onClose: () => void; onError: (m: string) => void;
  onAdd: (surface: SurveySurface, file: File) => Promise<void>; onDelete: (id: string) => Promise<void>;
  onEdit: (f: (s: Survey) => Survey, gesture?: boolean) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [section, setSection] = useState<'photos' | 'elevation'>('elevation');
  const [allPhotos, setAllPhotos] = useState(false);
  const initialWall = room.technicalPoints?.find(p => p.id === initialPoint)?.wallId;
  // The surface last photographed in this room stays chosen, so a series of shots on one wall is not asked again.
  const [target, setTargetState] = useState(() => initialWall ? `wall:${initialWall}` : lastSurface.get(room.id) ?? (room.walls[0] ? `wall:${room.walls[0].id}` : 'floor'));
  const setTarget = (t: string) => { lastSurface.set(room.id, t); setTargetState(t); setAllPhotos(false); };
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const surfaceLabel = (s: SurveySurface) => s.kind === 'floor' ? tr('Sol', 'Floor') : s.kind === 'ceiling' ? tr('Plafond', 'Ceiling')
    : `${tr('Mur', 'Wall')} ${(w => w ? wallLabel(w) : '?')(room.walls.find(w => w.id === s.wallId))}`;
  const surfaces: SurveySurface[] = [{ kind: 'floor' }, { kind: 'ceiling' }, ...room.walls.map(w => ({ kind: 'wall' as const, wallId: w.id }))];
  const surface = surfaces.find(s => surfaceKey(s) === target) ?? surfaces[0];
  const wall = surface.kind === 'wall' ? room.walls.find(w => w.id === surface.wallId) : undefined;
  const photos = (room.photos ?? []).filter(p => allPhotos || surfaceKey(p.surface) === surfaceKey(surface));

  useEffect(() => {
    let alive = true; const made: string[] = [];
    void Promise.all((room.photos ?? []).map(async p => {
      const blob = await loadPhoto(survey.id, p.id);
      if (!blob) return null;
      const url = URL.createObjectURL(blob); made.push(url);
      return [p.id, url] as const;
    })).then(list => { if (alive) setUrls(Object.fromEntries(list.filter(Boolean) as [string, string][])); });
    return () => { alive = false; made.forEach(u => URL.revokeObjectURL(u)); };
  }, [survey.id, room.photos]);

  const editing = open ? room.photos?.find(p => p.id === open) : undefined;
  if (editing && urls[editing.id]) return (
    <PhotoEditor photo={editing} url={urls[editing.id]} label={`${surfaceLabel(editing.surface)} · ${room.name.trim()}`} roomId={room.id} frozen={!!room.frozen} onEdit={onEdit} onBack={() => setOpen(null)} />
  );
  const showingElevation = !!wall && section === 'elevation';
  return (
    <section className="surface-screen" role="dialog" aria-label={tr('Vue de face et photos', 'Wall elevation and photos')}>
      <header className="app-header">
        <button className="iconbtn dark" aria-label={tr('Retour', 'Back')} onClick={onClose}>‹</button>
        <div className="head-middle"><div className="head-title">{room.name}</div></div>
        <span className="surface-header-spacer" aria-hidden="true" />
      </header>
      <input ref={input} type="file" accept="image/*" capture="environment" className="visually-hidden"
        onChange={async e => {
          const file = e.target.files?.[0]; e.target.value = '';
          if (!file) return;
          setBusy(true);
          try { await onAdd(surface, file); }
          catch (err) { onError((err as Error).message); }
          finally { setBusy(false); }
        }} />
      <div className="rooms-bar surface-controls">
        <label className="surface-picker">
          <span className="visually-hidden">{tr('Surface', 'Surface')}</span>
          <select value={surfaceKey(surface)} onChange={e => setTarget(e.target.value)}>
            {surfaces.map(s => <option key={surfaceKey(s)} value={surfaceKey(s)}>{surfaceLabel(s)}</option>)}
          </select>
          <ChevronDown aria-hidden="true" />
        </label>
        {wall && <div className="surface-switch" role="group" aria-label={surfaceLabel(surface)}>
          <button type="button" aria-pressed={showingElevation} className="room-pill" onClick={() => setSection('elevation')}><RectangleHorizontal /> {tr('Vue de face', 'Wall elevation')}</button>
          <button type="button" aria-pressed={!showingElevation} className="room-pill" onClick={() => { setAllPhotos(false); setSection('photos'); }}><Camera /> {tr('Photos', 'Photos')}</button>
        </div>}
      </div>
      {showingElevation && wall ? <WallElevation key={wall.id} level={level} room={room} wall={wall} initialPoint={initialPoint}
        height={room.ceilingHeight_m ?? surveyDefaults(survey).ceilingHeight_m} onEdit={onEdit} /> : (
        <div className="secondary-page surface-photos">
          <div className="surface-photo-actions">
            <button className="primary-btn" disabled={busy || room.frozen} onClick={() => input.current?.click()}><Camera /> {busy ? tr('Enregistrement…', 'Saving…') : tr('Prendre ou importer', 'Take or import')}</button>
            <button className="compact-btn" aria-pressed={allPhotos} onClick={() => setAllPhotos(!allPhotos)}>{tr('Toutes les photos', 'All photos')}</button>
          </div>
          {!photos.length && <div className="empty-state"><Camera aria-hidden="true" /><p>{tr('Aucune photo pour ce filtre.', 'No photo for this filter.')}</p></div>}
          {photos.map(p => (
            <div key={p.id} className="photo-card">
              <button type="button" className="surface-photo-open" disabled={!urls[p.id]} onClick={() => { setTarget(surfaceKey(p.surface)); setOpen(p.id); }}>
                {urls[p.id] ? <img src={urls[p.id]} alt="" /> : <span className="photo-thumb" />}
                <span><b>{surfaceLabel(p.surface)}</b><small>{new Date(p.takenAt).toLocaleString(lang)} · {(p.annotations ?? []).length} {tr('annotation(s)', 'annotation(s)')}</small></span>
              </button>
              <button aria-label={tr('Supprimer la photo', 'Delete photo')} disabled={room.frozen} onClick={() => void onDelete(p.id)}><Trash2 /></button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type Photo = NonNullable<Room['photos']>[number];

/** A photo length drawn like MeasureIt: haloed line, white end dots and arrow heads, constant on screen whatever the zoom. */
function DimLine({ p1, p2, size, zoom, active }: { p1: [number, number]; p2: [number, number]; size: { w: number; h: number }; zoom: number; active?: boolean }) {
  const a = [p1[0] * size.w, p1[1] * size.h], b = [p2[0] * size.w, p2[1] * size.h];
  const u = 1 / zoom, ang = Math.atan2(b[1] - a[1], b[0] - a[0]), len = 12 * u, spread = Math.PI / 7;
  const head = (p: number[], dir: number) => `M${p[0] + len * Math.cos(dir - spread)},${p[1] + len * Math.sin(dir - spread)}L${p[0]},${p[1]}L${p[0] + len * Math.cos(dir + spread)},${p[1] + len * Math.sin(dir + spread)}`;
  const color = active ? '#ff9f1c' : '#22d3ee';
  return (
    <g strokeLinecap="round" strokeLinejoin="round" fill="none">
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#000" strokeOpacity={0.45} strokeWidth={6 * u} />
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color} strokeWidth={2.5 * u} strokeDasharray={active ? `${7 * u} ${5 * u}` : undefined} />
      <path d={head(a, ang) + head(b, ang + Math.PI)} stroke={color} strokeWidth={2.5 * u} />
      {[a, b].map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={4.5 * u} fill="#fff" stroke={color} strokeWidth={2 * u} />)}
    </g>
  );
}

/** Photo editor (prototype « Éditeur photo »): post-its placed, dragged and edited on the image. */
function PhotoEditor({ photo, url, label, roomId, frozen, onEdit, onBack }: {
  photo: Photo; url: string; label: string; roomId: string; frozen: boolean;
  onEdit: (f: (s: Survey) => Survey, gesture?: boolean) => void; onBack: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<'none' | 'note' | 'measure'>('none');
  /** The annotation list, shown under the photo on demand so the photo keeps the screen. */
  const [list, setList] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  /** Pinch zoom and pan of the photo: scale and translation of the stage, in screen pixels. */
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: typeof view; mid: { x: number; y: number }; dist: number; moved: boolean } | null>(null);
  /** Set by a pinch or a pan, so the tap that ends it does not place a post-it or a length point. */
  const swallowClick = useRef(false);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect(), st = stage.current!;
    return { x: e.clientX - r.left - st.offsetLeft, y: e.clientY - r.top - st.offsetTop };
  };
  const startGesture = () => {
    const pts = [...touches.current.values()];
    const mid = pts.length > 1 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture.current = { view, mid, dist, moved: gesture.current?.moved ?? false };
  };
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [frozenNoteStates, setFrozenNoteStates] = useState<Record<string, boolean>>({});
  /** Photo cote being created (first point placed) or whose value is being typed. */
  const [draft, setDraft] = useState<{ p1: [number, number]; p2: [number, number] } | null>(null);
  /** Untransformed stage size in pixels, to draw the lengths in screen units (arrows, badges). */
  const [size, setSize] = useState({ w: 1, h: 1 });
  useEffect(() => {
    const el = stage.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth || 1, h: el.offsetHeight || 1 }));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  /** Post-it being drawn: the corner pressed and the corner under the finger. */
  const [noteDraft, setNoteDraft] = useState<{ a: [number, number]; b: [number, number] } | null>(null);
  /** Magnifier shown while placing or moving a length end (MeasureIt's loupe). */
  const [loupe, setLoupe] = useState<{ p: [number, number]; left: boolean } | null>(null);
  const showLoupe = (p: [number, number]) => setLoupe({ p, left: p[0] * size.w * view.s + view.x > size.w / 2 });
  /** Snaps a length end to horizontal or vertical when within 14 screen pixels of it. */
  const snap = (from: [number, number], to: [number, number]): [number, number] => {
    const k = size.w * view.s, kh = size.h * view.s;
    return [Math.abs((to[0] - from[0]) * k) < 14 ? from[0] : to[0], Math.abs((to[1] - from[1]) * kh) < 14 ? from[1] : to[1]];
  };
  const [value, setValue] = useState<{ id: string | null; p1: [number, number]; p2: [number, number]; text: string; error?: string } | null>(null);
  const drag = useRef<{ id: string; moved: boolean; end?: 'p1' | 'p2' } | null>(null);
  const rel = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = stage.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  const notes = (photo.annotations ?? []).filter((a): a is Extract<typeof a, { type: 'note' }> => a.type === 'note');
  const noteCollapsed = (note: (typeof notes)[number]) => (frozen ? frozenNoteStates[note.id] ?? note.collapsed : note.collapsed) === true;
  function toggleNote(note: (typeof notes)[number]) {
    const collapsed = !noteCollapsed(note);
    if (frozen) setFrozenNoteStates(states => ({ ...states, [note.id]: collapsed }));
    else onEdit(s => updatePhotoNote(s, roomId, photo.id, note.id, { collapsed }));
  }
  const measures = (photo.annotations ?? []).filter((a): a is Extract<typeof a, { type: 'measure' }> => a.type === 'measure');
  const fmtM = fmt;
  function saveValue() {
    if (!value) return;
    // Left as shown, a rounded value keeps its exact value.
    const shown = measures.find(m => m.id === value.id);
    const v = shown && value.text === fmtValue(shown.value_m) ? shown.value_m : num(value.text);
    if (!(v > 0)) { setValue({ ...value, error: tr(`Saisissez la cote mesurée sur place (${U()}).`, `Type the length measured on site (${U()}).`) }); return; }
    onEdit(s => value.id ? updatePhotoMeasure(s, roomId, photo.id, value.id, { value: v }) : addPhotoMeasure(s, roomId, photo.id, value.p1, value.p2, v).survey);
    setValue(null);
  }
  return (
    <div className="photo-editor" role="dialog" aria-label={`${tr('Éditeur photo', 'Photo editor')} · ${label}`}>
      <div className="photo-editor-bar">
        <button className="iconbtn dark" aria-label={tr('Retour à la galerie', 'Back to gallery')} onClick={onBack}>‹</button>
        <div className="photo-editor-title">{label}</div>
        <button className={`compact-btn ${tool === 'note' ? 'on' : ''}`} aria-pressed={tool === 'note'} onClick={() => { setDraft(null); setTool(tool === 'note' ? 'none' : 'note'); }}><StickyNote /> Post-it</button>
        <button className={`compact-btn ${tool === 'measure' ? 'on' : ''}`} aria-pressed={tool === 'measure'} onClick={() => { setDraft(null); setTool(tool === 'measure' ? 'none' : 'measure'); }}><MoveHorizontal /> {tr('Cote', 'Length')}</button>
        <button className={`compact-btn ${list ? 'on' : ''}`} aria-pressed={list} aria-label={tr('Annotations', 'Annotations')} onClick={() => setList(!list)}><List /> {notes.length + measures.length}</button>
      </div>
      {/* The photo fills the free screen, at its own proportions, so the annotations keep their place. */}
      <div ref={wrap} className="photo-stage-wrap" style={{ ['--ar' as string]: `${photo.width} / ${photo.height}` }}
        onPointerDown={e => {
          if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
          touches.current.set(e.pointerId, local(e));
          if (touches.current.size === 1) gesture.current = null;
          startGesture();
        }}
        onPointerMove={e => {
          if (!touches.current.has(e.pointerId) || !gesture.current) return;
          touches.current.set(e.pointerId, local(e));
          const g = gesture.current, pts = [...touches.current.values()];
          if (pts.length >= 2) {
            const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
            const s1 = Math.min(6, Math.max(1, g.view.s * Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / (g.dist || 1)));
            const k = s1 / g.view.s;
            g.moved = true;
            setView({ s: s1, x: mid.x - k * (g.mid.x - g.view.x), y: mid.y - k * (g.mid.y - g.view.y) });
          } else if (g.view.s > 1 && tool === 'none') {
            const dx = pts[0].x - g.mid.x, dy = pts[0].y - g.mid.y;
            if (!g.moved && Math.hypot(dx, dy) < 8) return;
            g.moved = true;
            setView({ s: g.view.s, x: g.view.x + dx, y: g.view.y + dy });
          }
        }}
        onPointerUp={e => {
          if (!touches.current.delete(e.pointerId)) return;
          if (gesture.current?.moved) swallowClick.current = true;
          if (touches.current.size) startGesture();
          else {
            gesture.current = null;
            setView(v => v.s < 1.05 ? { s: 1, x: 0, y: 0 } : v);
          }
        }}
        onPointerCancel={e => { touches.current.delete(e.pointerId); if (!touches.current.size) gesture.current = null; }}
        onClickCapture={e => { if (swallowClick.current) { swallowClick.current = false; e.stopPropagation(); e.preventDefault(); } }}
        onDoubleClick={() => setView({ s: 1, x: 0, y: 0 })}>
        <p className="photo-editor-hint">{tool === 'measure'
        ? tr('Glissez d’une extrémité à l’autre de la cote ; elle s’aimante à l’horizontale et à la verticale.', 'Drag from one end of the length to the other; it snaps horizontal and vertical.')
        : tool === 'note'
        ? tr('Glissez pour dessiner le post-it à sa taille, ou touchez pour un post-it simple.', 'Drag to draw the post-it at its size, or tap for a plain post-it.')
        : notes.some(noteCollapsed)
        ? tr('Glissez un post-it pour le déplacer. Touchez son icône pour l’ouvrir.', 'Drag a post-it to move it. Tap its icon to open it.')
        : tr('Glissez un post-it pour le déplacer ; touchez-le pour modifier son texte.', 'Drag a post-it to move it; tap it to edit its text.')}</p>
      <div ref={stage} className={`photo-stage ${tool === 'note' ? 'photo-placing' : ''}`}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transformOrigin: '0 0' }}
        onPointerDown={e => {
          if (tool === 'none' || (e.target as Element).closest('.photo-note, .photo-dim-handle, .photo-dim-label')) return;
          if (touches.current.size > 1) return;
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          const at = rel(e);
          if (tool === 'note') { setNoteDraft({ a: at, b: at }); return; }
          setDraft({ p1: at, p2: at }); showLoupe(at);
        }}
        onPointerMove={e => {
          if (noteDraft) {
            if (touches.current.size > 1) { setNoteDraft(null); return; }
            const b = rel(e); setNoteDraft({ ...noteDraft, b: [Math.min(1, Math.max(0, b[0])), Math.min(1, Math.max(0, b[1]))] });
            return;
          }
          if (!draft) return;
          if (touches.current.size > 1) { setDraft(null); setLoupe(null); return; }
          const at = snap(draft.p1, rel(e));
          setDraft({ ...draft, p2: at }); showLoupe(at);
        }}
        onPointerUp={() => {
          if (noteDraft) {
            const { a, b } = noteDraft; setNoteDraft(null);
            const w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
            // A tap places a plain post-it; a drag gives it the drawn size.
            const sized = w * size.w * view.s > 24 && h * size.h * view.s > 24;
            const at: [number, number] = sized ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : a;
            let id = '';
            onEdit(s => { const r = addPhotoNote(s, roomId, photo.id, at, '', new Date(), sized ? [w, h] : undefined); id = r.noteId; return r.survey; });
            setTool('none');
            setEditing({ id, text: '' });
            return;
          }
          if (!draft) return;
          setLoupe(null); setDraft(null);
          const long = Math.hypot((draft.p2[0] - draft.p1[0]) * size.w * view.s, (draft.p2[1] - draft.p1[1]) * size.h * view.s) > 20;
          if (long) { setValue({ id: null, p1: draft.p1, p2: draft.p2, text: '' }); setTool('none'); }
        }}
        onPointerCancel={() => { setDraft(null); setNoteDraft(null); setLoupe(null); }}>
        <img className="photo-main-img" src={url} alt={label} />
        <svg className="photo-dimension-svg" viewBox={`0 0 ${size.w} ${size.h}`}>
          {measures.map(m => <DimLine key={m.id} p1={m.p1} p2={m.p2} size={size} zoom={view.s} />)}
          {value && !value.id && <DimLine p1={value.p1} p2={value.p2} size={size} zoom={view.s} active />}
          {draft && <DimLine p1={draft.p1} p2={draft.p2} size={size} zoom={view.s} active />}
        </svg>
        <div className="photo-ann-layer">
          {measures.flatMap(m => [
            ...(['p1', 'p2'] as const).map(end => (
              <div key={`${m.id}-${end}`} className="photo-dim-handle" role="button" aria-label={tr('Extrémité de la cote', 'Length end')}
                style={{ left: `${m[end][0] * 100}%`, top: `${m[end][1] * 100}%`, transform: `translate(-50%, -50%) scale(${1 / view.s})` }}
                onPointerDown={e => { e.stopPropagation(); (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { id: m.id, moved: false, end }; }}
                onPointerMove={e => {
                  if (drag.current?.id !== m.id || drag.current.end !== end) return;
                  const first = !drag.current.moved;
                  drag.current.moved = true;
                  const other = m[end === 'p1' ? 'p2' : 'p1'], at = snap(other, rel(e));
                  showLoupe(at);
                  onEdit(s => updatePhotoMeasure(s, roomId, photo.id, m.id, { [end]: at }), !first);
                }}
                onPointerUp={() => { drag.current = null; setLoupe(null); }} />
            )),
            <button key={`${m.id}-label`} className="photo-dim-label" style={{ left: `${((m.p1[0] + m.p2[0]) / 2) * 100}%`, top: `${((m.p1[1] + m.p2[1]) / 2) * 100}%`, transform: `translate(-50%, -50%) scale(${1 / view.s})` }}
              onClick={e => { e.stopPropagation(); setValue({ id: m.id, p1: m.p1, p2: m.p2, text: fmtValue(m.value_m) }); }}>
              {fmtM(m.value_m)}
            </button>,
          ])}
          {notes.map(n => noteCollapsed(n) ? (
            <PhotoNoteMarker key={n.id} at={n.p} zoom={view.s} label={tr('Ouvrir le post-it', 'Open post-it')} positionOnPhoto={rel}
              onOpen={() => toggleNote(n)} onMove={frozen ? undefined : at => onEdit(s => updatePhotoNote(s, roomId, photo.id, n.id, { at }))} />
          ) : (
            <div key={n.id} className={`photo-note ${n.size ? 'sized' : ''}`}
              style={{ left: `${n.p[0] * 100}%`, top: `${n.p[1] * 100}%`, ...(n.size ? { width: `${n.size[0] * 100}%`, height: `${n.size[1] * 100}%` } : {}) }}
              onPointerDown={e => { e.stopPropagation(); if (frozen) return; (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { id: n.id, moved: false }; }}
              onPointerMove={e => {
                if (drag.current?.id !== n.id || drag.current.end) return;
                const first = !drag.current.moved;
                drag.current.moved = true;
                onEdit(s => updatePhotoNote(s, roomId, photo.id, n.id, { at: rel(e) }), !first);
              }}
              onPointerUp={() => { if (drag.current?.id === n.id && !drag.current.moved) setEditing({ id: n.id, text: n.text }); drag.current = null; }}>
              <span>{n.text || tr('(vide)', '(empty)')}</span>
              <div className="photo-note-actions" onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}>
                <button type="button" aria-label={tr('Réduire le post-it', 'Collapse post-it')} aria-expanded={true} onClick={() => toggleNote(n)}>−</button>
                {!frozen && <button type="button" aria-label={tr('Supprimer le post-it', 'Delete post-it')}
                  onClick={() => onEdit(s => deletePhotoAnnotation(s, roomId, photo.id, n.id))}>×</button>}
              </div>
              {/* Resize from the bottom-right corner; the top-left corner stays where it is. */}
              {!frozen && <div className="photo-note-resize" role="button" aria-label={tr('Redimensionner le post-it', 'Resize post-it')}
                onPointerDown={e => { e.stopPropagation(); (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { id: n.id, moved: false, end: 'p2' }; }}
                onPointerMove={e => {
                  if (drag.current?.id !== n.id || drag.current.end !== 'p2') return;
                  const box = (e.currentTarget.parentElement as HTMLElement), r = stage.current!.getBoundingClientRect(), b = box.getBoundingClientRect();
                  const tl: [number, number] = [(b.left - r.left) / r.width, (b.top - r.top) / r.height];
                  const at = rel(e), w = Math.max(0.04, at[0] - tl[0]), h = Math.max(0.04, at[1] - tl[1]);
                  const first = !drag.current.moved; drag.current.moved = true;
                  onEdit(s => updatePhotoNote(s, roomId, photo.id, n.id, { at: [tl[0] + w / 2, tl[1] + h / 2], size: [w, h] }), !first);
                }}
                onPointerUp={e => { e.stopPropagation(); drag.current = null; }} />}
            </div>
          ))}
          {noteDraft && (
            <div className="photo-note-draft" style={{ left: `${Math.min(noteDraft.a[0], noteDraft.b[0]) * 100}%`, top: `${Math.min(noteDraft.a[1], noteDraft.b[1]) * 100}%`,
              width: `${Math.abs(noteDraft.b[0] - noteDraft.a[0]) * 100}%`, height: `${Math.abs(noteDraft.b[1] - noteDraft.a[1]) * 100}%` }} />
          )}
        </div>
      </div>
        {loupe && (
          <div className={`photo-loupe ${loupe.left ? 'left' : ''}`} aria-hidden
            style={{ backgroundImage: `url(${url})`, backgroundSize: `${size.w * view.s * 3}px ${size.h * view.s * 3}px`,
              backgroundPosition: `${60 - loupe.p[0] * size.w * view.s * 3}px ${60 - loupe.p[1] * size.h * view.s * 3}px` }} />
        )}
      </div>
      {(editing || value || list) && <div className="photo-editor-panel">
      {editing && (
        <form style={{ marginTop: 10 }} onSubmit={e => {
          e.preventDefault();
          if (editing.id) onEdit(s => updatePhotoNote(s, roomId, photo.id, editing.id, { text: editing.text.trim() }));
          setEditing(null);
        }}>
          <div className="fields">
            <label className="field wide">{tr('Texte du post-it', 'Post-it text')}
              <input autoFocus value={editing.text} onChange={e => setEditing({ ...editing, text: e.target.value })} placeholder={tr('Ex. reprise d’enduit', 'E.g. plaster repair')} />
            </label>
          </div>
          <div className="sheet-actions" style={{ marginTop: 8 }}>
            <button type="button" className="secondary-btn" onClick={() => setEditing(null)}>{tr('Annuler', 'Cancel')}</button>
            <button type="submit" className="primary-btn">{tr('Enregistrer', 'Save')}</button>
          </div>
        </form>
      )}
      {value && (
        <form style={{ marginTop: 10 }} onSubmit={e => { e.preventDefault(); saveValue(); }}>
          <div className="fields">
            <label className="field wide">{tr(`Cote mesurée sur place (${U()})`, `Length measured on site (${U()})`)}
              <input autoFocus inputMode={lengthInput()} value={value.text} onChange={e => setValue({ ...value, text: e.target.value, error: undefined })} placeholder={fmtValue(2.1)} />
            </label>
          </div>
          {value.error && <div className="notice">{value.error}</div>}
          <p className="photo-editor-note">{tr('La photo n’est pas calibrée : la valeur est celle que vous saisissez.', 'The photo is not calibrated: the value is the one you type.')}</p>
          <div className="sheet-actions" style={{ marginTop: 8 }}>
            <button type="button" className="secondary-btn" onClick={() => setValue(null)}>{tr('Annuler', 'Cancel')}</button>
            <button type="submit" className="primary-btn">{tr('Enregistrer', 'Save')}</button>
          </div>
        </form>
      )}
      {list && !editing && !value && <>
      <h4 className="section-title">{tr('Annotations', 'Annotations')} · {notes.length + measures.length}</h4>
      {!(notes.length + measures.length) && <p className="hint">{tr('Aucune annotation.', 'No annotation.')}</p>}
      {measures.map(m => (
        <div key={m.id} className="photo-annotation-row">
          <span className="annotation-desc"><MoveHorizontal /> {tr('Cote', 'Length')} · {fmtM(m.value_m)}</span>
          <button className="compact-btn" onClick={() => setValue({ id: m.id, p1: m.p1, p2: m.p2, text: fmtValue(m.value_m) })}>{tr('Modifier', 'Edit')}</button>
          <button className="compact-btn" onClick={() => onEdit(s => deletePhotoAnnotation(s, roomId, photo.id, m.id))}>{tr('Supprimer', 'Delete')}</button>
        </div>
      ))}
      {notes.map(n => (
        <div key={n.id} className="photo-annotation-row">
          <span className="annotation-desc"><StickyNote /> {n.text || tr('(vide)', '(empty)')}</span>
          <button className="compact-btn" aria-label={noteCollapsed(n) ? tr('Ouvrir le post-it', 'Open post-it') : tr('Réduire le post-it', 'Collapse post-it')}
            aria-expanded={!noteCollapsed(n)} onClick={() => toggleNote(n)}>{noteCollapsed(n) ? <StickyNote /> : '−'}</button>
          {!frozen && <>
            <button className="compact-btn" onClick={() => setEditing({ id: n.id, text: n.text })}>{tr('Modifier', 'Edit')}</button>
            <button className="compact-btn" onClick={() => onEdit(s => deletePhotoAnnotation(s, roomId, photo.id, n.id))}>{tr('Supprimer', 'Delete')}</button>
          </>}
        </div>
      ))}
      </>}
      </div>}
    </div>
  );
}

/**
 * Sending to the account (ADR 0011): optional pairing with a skAItch account, then « Envoyer vers
 * skAItch ». Each send is a new revision; an interrupted send resumes.
 */
function SendPanel({ survey, beforeSend, onDone }: { survey: Survey; beforeSend: () => Promise<void>; onDone: (message: string) => void }) {
  const [pairing, setPairing] = useState<Pairing | null | undefined>(undefined);
  const [form, setForm] = useState<{ server: string; key: string } | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [live, setLive] = useState(false);
  const qrInput = useRef<HTMLInputElement>(null);
  const pairWith = async (text: string) => {
    setError(''); setScanning(true);
    try { setPairing(await pairFromQr(text)); setForm(null); }
    catch (err) { setError((err as Error).message); }
    finally { setScanning(false); }
  };
  useEffect(() => { void loadPairing().then(p => setPairing(p ?? null)); }, []);
  if (pairing === undefined) return null;
  const host = pairing ? (pairing.name ? `${pairing.name} (${new URL(pairing.server).host})` : new URL(pairing.server).host) : '';
  // Pairing by photographing the QR code shown in skAItch (web or desktop app on the same Wi-Fi).
  const scan = (
    <>
      <input ref={qrInput} type="file" accept="image/*" capture="environment" hidden onChange={async e => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try { await pairWith(await readQrFromImage(file)); } catch (err) { setError((err as Error).message); }
      }} />
      <button type="button" className="primary-btn" style={{ width: '100%', marginBottom: 6 }} disabled={scanning} onClick={() => { setError(''); setLive(true); }}>
        {scanning ? tr('Recherche de l’ordinateur…', 'Looking for the computer…') : <><Camera /> {tr('Scanner le QR code de skAItch', 'Scan the skAItch QR code')}</>}
      </button>
      <button type="button" className="compact-btn" style={{ marginBottom: 8 }} disabled={scanning} onClick={() => qrInput.current?.click()}>{tr('…ou depuis une photo', '…or from a photo')}</button>
      {live && <QrScanner onCode={text => { setLive(false); void pairWith(text); }} onClose={msg => { setLive(false); if (msg) setError(msg); }} />}
    </>
  );
  return (
    <div style={{ borderTop: '1px solid #ececec', marginTop: 16, paddingTop: 12 }}>
      <h4 style={{ margin: '0 0 8px' }}>{tr('Envoyer vers skAItch', 'Send to skAItch')}</h4>
      {error && <div className="notice" role="alert">{error}</div>}
      {form ? (
        <>{scan}<form onSubmit={async e => {
          e.preventDefault(); setError('');
          try { setPairing(await savePairing(form.server, form.key)); setForm(null); } catch (err) { setError((err as Error).message); }
        }}>
          <p className="hint">{tr('Dans skAItch (web ou application sur un ordinateur du même Wi-Fi), ouvrez l’onglet Survey d’un étage, « Appairer un téléphone » : scannez le QR code, ou copiez la clé ici. Elle ne permet que d’envoyer des relevés.',
            'In skAItch (web, or the app on a computer on the same Wi-Fi), open a storey’s Survey tab, « Pair a phone »: scan the QR code, or paste the key here. It only allows sending surveys.')}</p>
          <div className="fields">
            <label className="field wide">{tr('Clé d’appairage', 'Pairing key')}
              <input autoFocus value={form.key} onChange={e => setForm({ ...form, key: e.target.value })} placeholder="sv_…" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </label>
            <label className="field wide">{tr('Serveur', 'Server')}
              <input value={form.server} onChange={e => setForm({ ...form, server: e.target.value })} inputMode="url" autoCapitalize="off" />
            </label>
          </div>
          <div className="sheet-actions">
            <button type="button" className="secondary-btn" onClick={() => setForm(null)}>{tr('Annuler', 'Cancel')}</button>
            <button type="submit" className="primary-btn">{tr('Appairer', 'Pair')}</button>
          </div>
        </form></>
      ) : pairing ? (
        <>
          <p className="hint">{tr(`Appairé avec ${host}.`, `Paired with ${host}.`)} <button className="compact-btn" onClick={async () => { await forgetPairing(); setPairing(null); }}>{tr('Oublier', 'Forget')}</button></p>
          {progress && <div className="notice good" role="status">{tr('Envoi', 'Sending')} {progress[0]}/{progress[1]}…</div>}
          <div className="sheet-actions" style={{ marginTop: 8 }}>
            <button className="primary-btn" disabled={!!progress} onClick={async () => {
              setError('');
              setProgress([0, 1]);
              try {
                await beforeSend();
                const r = await sendSurvey(survey, pairing, (d, t) => setProgress([d, t]));
                onDone(tr(`Relevé envoyé à skAItch (révision ${r.revision})`, `Survey sent to skAItch (revision ${r.revision})`));
              } catch (err) { setError((err as Error).message); }
              finally { setProgress(null); }
            }}><CloudUpload /> {tr('Envoyer vers skAItch', 'Send to skAItch')}</button>
          </div>
        </>
      ) : (
        <>
          <p className="hint">{tr('Optionnel : appairez l’application avec votre compte pour envoyer le relevé sans passer par un fichier.', 'Optional: pair the app with your account to send the survey without a file.')}</p>
          <button className="secondary-btn" style={{ width: '100%' }} onClick={() => setForm({ server: DEFAULT_SERVER, key: '' })}><Link /> {tr('Appairer avec skAItch', 'Pair with skAItch')}</button>
        </>
      )}
    </div>
  );
}

/** Full-screen camera viewfinder; the QR code is detected as soon as it is in the frame. */
function QrScanner({ onCode, onClose }: { onCode: (text: string) => void; onClose: (error?: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let stop: (() => void) | null = null, cancelled = false;
    scanLive(video.current!, onCode).then(s => { if (cancelled) s(); else stop = s; },
      () => onClose(tr('Caméra indisponible : autorisez-la pour skAItch Survey dans les réglages, ou utilisez une photo.', 'Camera unavailable: allow it for skAItch Survey in the settings, or use a photo.')));
    return () => { cancelled = true; stop?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div role="dialog" aria-label={tr('Scanner le QR code', 'Scan the QR code')} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <video ref={video} muted playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      <div aria-hidden style={{ position: 'relative', width: '70vmin', height: '70vmin', border: '3px solid #fff', borderRadius: 18, boxShadow: '0 0 0 100vmax #0008' }} />
      <div style={{ position: 'absolute', top: 'calc(24px + env(safe-area-inset-top))', left: 16, right: 16, color: '#fff', textAlign: 'center', fontWeight: 700 }}>
        {tr('Visez le QR code affiché dans skAItch', 'Aim at the QR code shown in skAItch')}
      </div>
      <button className="secondary-btn" style={{ position: 'absolute', bottom: 'calc(24px + env(safe-area-inset-bottom))', left: 24, right: 24 }} onClick={() => onClose()}>{tr('Annuler', 'Cancel')}</button>
    </div>
  );
}
