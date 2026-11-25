import { setSurveyLanguage } from '@skaitch/core/survey/lang';
import { Fragment } from 'react';
import type { SkaitchPlatform } from './platform';
import './lib/appTheme'; // applies the colour theme at start-up
import { renameProjectItems } from '@skaitch/core/lib/projectName';
import { canAddProject, PROJECT_LIMIT_MESSAGE } from '@skaitch/core/lib/projectLimit';
import { importBimwiq } from './lib/importBimwiq';
import { nextFrame, validateViewRequest, type ViewportApi } from './lib/viewport';
import SavedSectionsMenu from './components/SavedSectionsMenu';
import EditorHeader from './components/EditorHeader';
import { listSheets } from '@skaitch/core/drawing/sheet';
import { sheetsToPdf, sheetPdfName } from './lib/sheetPdf';
import ProjectActions, { type ExportFormat } from './components/ProjectActions';
import { Settings2, PanelRight, CircleHelp } from 'lucide-react';
import ViewSelect from './components/ViewSelect';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { ToolType, ViewType, LangType, AiConfig, ViewState2D, IfcEntity } from '@skaitch/core/types/ifc';
import TechnicalLibraryPanel from './components/panels/TechnicalLibraryPanel';
import { TECHNICAL_CATALOGUE } from './data/technicalCatalogue';
import { useItems } from './hooks/useItems';
import { useTweaks } from './hooks/useTweaks';
import { useProjects, saveIfcBuffer, loadIfcBuffer } from './hooks/useProjects';
import { readSkaitchFile, writeSkaitchFile, SKAITCH_EXTENSION, SKAITCH_MIME } from '@skaitch/core/file/skaitchFile';
import { makeT, resolveLanguage } from '@skaitch/core/data/i18n';
import LanguageSelect from './components/LanguageSelect';
import { bbox } from '@skaitch/core/data/query';
import { guid } from '@skaitch/core/data/starter';
import Canvas2D from './components/canvas/Canvas2D';
import PlanImageUpload, { vectorOriginSources } from './components/panels/PlanImageUpload';
import Canvas3D, { StoreyScopeSwitch } from './components/canvas/Canvas3D';
import SheetView from './components/canvas/SheetView';
import TreePane from './components/panels/TreePane';
import PropertiesPane from './components/panels/PropertiesPane';
import ItemsBar from './components/panels/ItemsBar';
import HelpDocPanel from './components/panels/HelpDocPanel';
import HomePage from './components/HomePage';
import MobileShell from './components/mobile/MobileShell';
import { importIFCBuffer, type ImportProgress, type ImportResult, type IfcMeshGeometry } from './lib/importIFC';
import { downloadIFC, exportIFC } from './lib/exportIFC';
import { exportToDXF, exportToBimJSON, exportToPDF, exportToPNG, triggerFileDownload } from './lib/exportFormats';
import { patchIFC } from './lib/patchIFC';
import { checkRoundTrip, fixRoundTripProblems } from './lib/roundTripCheck';
import ElementLibraryPanel from './components/panels/ElementLibraryPanel';
import { DEFAULT_DOOR_ID, DEFAULT_WINDOW_ID, DEFAULT_FURNITURE_ID, getElementDef, BUILTIN_CATALOGUE, loadUserLibrary, type ElementDef } from '@skaitch/core/data/elementCatalogue';

// ── Minimap ────────────────────────────────────────────────────────────────
function Minimap({ items, storeyId }: { items: any; storeyId: string }) {
  const W = 180, H = 120;
  const rooms = Object.values(items).filter((i: any) => i.type === 'Room') as any[];
  if (rooms.length === 0) return null;
  const allPts: [number, number][] = [];
  for (const r of rooms) for (const p of r.geom.polygon) allPts.push(p);
  const bb = bbox(allPts);
  const scale = Math.min((W - 12) / (bb.maxX - bb.minX), (H - 12) / (bb.maxY - bb.minY));
  const ox = 6 - bb.minX * scale, oy = 6 - bb.minY * scale;
  return (
    <div className="minimap">
      <svg viewBox={`0 0 ${W} ${H}`}>
        {rooms.map((r: any) => {
          const isActive = r.parentId === storeyId;
          const pts = r.geom.polygon.map(([x, y]: [number, number]) => `${x * scale + ox},${H - (y * scale + oy)}`).join(' ');
          return (
            <polygon key={r.id} points={pts}
              fill={isActive ? 'var(--accent)' : 'var(--ink-4)'}
              fillOpacity={isActive ? 0.3 : 0.08}
              stroke={isActive ? 'var(--accent)' : 'var(--border-strong)'}
              strokeWidth={isActive ? 1 : 0.5}
            />
          );
        })}
      </svg>
    </div>
  );
}

// ── SnapControl ────────────────────────────────────────────────────────────
function SnapControl({
  enabled, size, setEnabled, setSize, lang,
}: { enabled: boolean; size: number; setEnabled: (v: boolean) => void; setSize: (v: number) => void; lang: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [open]);
  const sizes = [0.05, 0.10, 0.25, 0.50, 1.00];
  const fmt = (s: number) => s < 1 ? `${(s * 100).toFixed(0)} cm` : `${s.toFixed(2)} m`;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={(makeT(lang)("Snap to grid")) + ' · ' + fmt(size)}
        style={{ color: enabled ? 'var(--accent)' : 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px', height: 22, border: 0, background: 'transparent', cursor: 'pointer', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 10 }}
      >
        <svg width="13" height="13" viewBox="0 0 14 14"><path d="M4 2v5a3 3 0 0 0 6 0V2M4 2H2M10 2h2M7 10v2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        {enabled ? fmt(size) : 'off'}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 8px 22px rgba(0,0,0,0.08)', padding: 6, minWidth: 168, zIndex: 50 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px 6px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-3)' }}>{makeT(lang)("Snap")}</span>
            <button onClick={() => setEnabled(!enabled)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: enabled ? 'var(--accent)' : 'var(--ink-3)', fontSize: 10, padding: '1px 6px', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
              {enabled ? 'ON' : 'OFF'}
            </button>
          </div>
          {sizes.map((s) => (
            <div key={s} onClick={() => { setSize(s); setEnabled(true); setOpen(false); }}
              style={{ padding: '5px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: enabled && Math.abs(size - s) < 1e-6 ? 'var(--hover)' : 'transparent', color: enabled && Math.abs(size - s) < 1e-6 ? 'var(--accent)' : 'var(--ink)' }}>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{fmt(s)}</span>
              {enabled && Math.abs(size - s) < 1e-6 && <span style={{ fontSize: 10 }}>●</span>}
            </div>
          ))}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, padding: '6px 6px 2px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>{makeT(lang)("Custom")}</span>
            <input type="number" min="0.01" max="5" step="0.01" value={size}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setSize(v); }}
              style={{ flex: 1, padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 3, fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg)', color: 'var(--ink)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>m</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ZoomBox ────────────────────────────────────────────────────────────────
function ZoomBox({ view, setView }: { view: ViewState2D, setView: React.Dispatch<React.SetStateAction<ViewState2D>> }) {
  const z = Math.round((view.scale / 36) * 100);
  const handleZoom = (factor: number) => {
    setView(v => ({ ...v, scale: Math.max(8, Math.min(200, v.scale * factor)) }));
  };
  return (
    <div className="zoom-control">
      <button onClick={() => handleZoom(0.8)}>−</button>
      <span className="val">{z}%</span>
      <button onClick={() => handleZoom(1.2)}>+</button>
    </div>
  );
}

const TOOLBAR_TYPES = ['Slab', 'Roof', 'Wall', 'Column', 'Chimney', 'Stair', 'Room', 'Door', 'Window', 'Technical', 'Furniture'] as const;

// ── WallOpacityControl ──────────────────────────────────────────────────────
function WallOpacityControl({ opacity, setOpacity, lang }: { opacity: number; setOpacity: (v: number) => void; lang: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [open]);

  const pct = Math.round(opacity * 100);
  const isTransparent = opacity < 0.89;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={makeT(lang)('Wall transparency ({pct}%)', { pct })}
        style={{
          color: isTransparent ? 'var(--accent)' : 'var(--ink-3)',
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '0 6px', height: 22,
          border: 0, background: 'transparent', cursor: 'pointer',
          borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 10,
        }}
      >
        {/* Wall transparency icon */}
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <rect x="1" y="4" width="12" height="6" rx="1"
            fill="currentColor" fillOpacity={opacity * 0.85}
            stroke="currentColor" strokeWidth="1.2" />
          {isTransparent && <line x1="1" y1="13" x2="13" y2="1" stroke="currentColor" strokeWidth="1" strokeOpacity="0.5" />}
        </svg>
        {isTransparent ? `${pct}%` : ''}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--panel)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: '0 8px 22px rgba(0,0,0,0.12)',
          padding: '10px 14px', minWidth: 180, zIndex: 50,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-3)' }}>
              {makeT(lang)("Walls")}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink)', fontWeight: 600 }}>
              {pct}%
            </span>
          </div>
          <input
            type="range" min={0} max={100} step={5}
            value={pct}
            onChange={e => setOpacity(Number(e.target.value) / 100)}
            style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 9, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>
              {makeT(lang)("Transparent")}
            </span>
            <span style={{ fontSize: 9, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>
              {makeT(lang)("Opaque")}
            </span>
          </div>
          {pct < 100 && (
            <button
              onClick={() => setOpacity(0.92)}
              style={{
                marginTop: 8, width: '100%', padding: '4px 0',
                border: '1px solid var(--border)', borderRadius: 4,
                background: 'transparent', cursor: 'pointer',
                fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)',
              }}
            >
              {makeT(lang)("Reset")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
const TYPE_KEYS: Record<string, string> = { Wall: 'W', Door: 'D', Window: 'F', Room: 'R', Slab: 'S', Roof: 'K', Furniture: 'M', Technical: 'T', Column: 'P', Chimney: 'H' };
const TYPE_ICONS: Record<string, React.ReactNode> = {
  Column: <><rect x="7" y="3" width="6" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M5 3h10M5 17h10" stroke="currentColor" strokeWidth="1.6" /></>,
  Chimney: <><path d="M3 18V10h14v8M8 10V3h4v7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M7 18v-4h6v4" fill="none" stroke="currentColor" strokeWidth="1.2" /></>,
  Wall: <path d="M3 8h14M3 12h14" stroke="currentColor" strokeWidth="1.5" />,
  Door: <><path d="M5 3v14h7l4-2V3z" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M16 3v14" stroke="currentColor" strokeWidth="1.4" /></>,
  Window: <><rect x="3.5" y="5.5" width="13" height="9" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M10 5.5v9M3.5 10h13" stroke="currentColor" strokeWidth="1.2" /></>,
  Room: <path d="M3 4l6-2 8 3v11l-7 2-7-3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />,
  Slab: <path d="M3 8l14-3 1 7-14 3z" fill="none" stroke="currentColor" strokeWidth="1.4" />,
  Stair: <><path d="M2 18h4v-4h4v-4h4V6h4" fill="none" stroke="currentColor" /></>,
  Roof: <><path d="M2 11l8-7 8 7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M5 9v7h10V9" fill="none" stroke="currentColor" strokeWidth="1.2" /></>,
  Furniture: <><rect x="3" y="9" width="14" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M5 9V7M15 9V7M4 15v2M16 15v2" stroke="currentColor" strokeWidth="1.4" /></>,
  Technical: <><path d="M10 2v4M10 14v4M2 10h4m8 0h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.6" /></>,
};

// ── ImportOverlay ───────────────────────────────────────────────────────────
function ImportOverlay({ progress, lang }: { progress: ImportProgress; lang: string }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12,
        padding: '28px 36px', minWidth: 320, boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="18" height="18" viewBox="0 0 20 20" style={{ color: 'var(--accent)', flexShrink: 0 }}>
            <path d="M10 14V5M5 9l5-5 5 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 16h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            {makeT(lang)("Importing IFC…")}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
          {progress.phase}
        </div>
        <div style={{ background: 'var(--bg)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
          <div style={{
            height: '100%', background: 'var(--accent)', borderRadius: 4,
            width: `${progress.pct}%`, transition: 'width 0.3s ease',
          }} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-4)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
          {progress.pct}%
        </div>
      </div>
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────
const UI_STATE_KEY = 'skaitch:ui-state';

/** The shared editor application; the host app supplies its platform services. */
export default function SkaitchApp({ platform }: { platform: SkaitchPlatform }) {
  const [winW, setWinW] = useState(() => window.innerWidth);
  useEffect(() => {
    const h = () => setWinW(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  const isMobile = winW < 1024;

  const [sectionManaging, setSectionManaging] = useState(false);
  const [sectionToolHost, setSectionToolHost] = useState<HTMLDivElement | null>(null);
  const account = platform.useAccount();
  const user = account === undefined ? undefined : account ? account.user : null;
  const logout = account?.logout;
  const { tweaks, setTweak } = useTweaks();
  const { items, addItem, updateItem, deleteItems, replaceItems, undo, redo, canUndo, canRedo, histTick } = useItems();
  const uid = account ? account.id : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one repository per account
  // An account may lift or change the platform limit (administrators have none).
  const projectLimit = account && account.projectLimit !== undefined ? account.projectLimit ?? undefined : platform.projectLimit;
  const projectRepo = useMemo(() => account ? platform.createProjectRepository(account) : null, [uid]);
  const [projectElements, setProjectElements] = useState<ElementDef[]>([]);
  const fullCatalogue = [...new Map([...BUILTIN_CATALOGUE, ...loadUserLibrary(), ...projectElements].map(def => [def.id, def])).values()];
  const catalogueJson = JSON.stringify(fullCatalogue);
  const mcpPendingRef = useRef(false);
  const { list: projectList, loading: projectsLoading, subscribeProject, createProject, openProject, saveProject, updateMeta, duplicateProject, deleteProject, setArchived } = useProjects(projectRepo, projectLimit);

  // Load UI state once
  const [uiState, setUiState] = useState(() => {
    try {
      const raw = localStorage.getItem(UI_STATE_KEY);
      const saved = raw ? JSON.parse(raw) : {};
      if (!platform.aiSettings) return saved;
      const { ai, storageBlocked } = platform.aiSettings.load(saved.ai);
      return { ...saved, ai, ...(storageBlocked ? { aiStorageBlocked: true } : {}) };
    } catch { return {}; }
  });

  const [lang, setLang] = useState<LangType>(() => resolveLanguage(uiState.lang));
  const t = useCallback(makeT(lang), [lang]);
  const atProjectLimit = !canAddProject(projectList.length, projectLimit);
  /** Tells the user and returns true when the account cannot hold another project. */
  const refuseNewProject = useCallback(() => {
    if (!atProjectLimit) return false;
    alert(makeT(lang)(PROJECT_LIMIT_MESSAGE, { limit: projectLimit ?? 0 }));
    return true;
  }, [atProjectLimit, projectLimit, lang]);
  const banner = platform.renderBanner?.({ lang, projectLimit });

  useEffect(() => {
    document.documentElement.lang = lang;
    // Survey import messages from the shared engine follow the interface language.
    setSurveyLanguage(lang);
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  // ── Screen / project state ────────────────────────────────────────────
  const [screen, setScreen] = useState<'home' | 'editor'>('home');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // Auto-save debounce + UI state persistence
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Persist UI state helper
  const persistUi = useCallback((patch: any) => {
    setUiState((current: any) => {
      const nextAi = patch.ai || current.ai;
      const updated = { ...current, ...patch, ai: platform.aiSettings ? platform.aiSettings.toStored(nextAi) : nextAi };
      try {
        if (!current.aiStorageBlocked) localStorage.setItem(UI_STATE_KEY, JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  }, []);

  const handleOpenProject = useCallback(async (proj: { id: string }) => {
    if (mcpPendingRef.current) throw new Error('Validez ou refusez l’action MCP avant de changer de projet.');
    if (activeProjectId && activeProjectId !== proj.id && (!projectRepo || !projectRepo.isSaved(activeProjectId, items, fullCatalogue))) {
      try { await saveProject(activeProjectId, items, undefined, fullCatalogue); }
      catch (error) { setRtToast({ ok: false, msg: String((error as Error).message || error) }); throw error; }
    }
    const loaded = await openProject(proj.id);
    if (!loaded) return;
    setProjectElements((loaded.catalogue ?? []).filter(def => def.source !== 'builtin'));
    replaceItems(loaded.items, true);
    setActiveProjectId(loaded.id);
    persistUi({ activeProjectId: loaded.id });
    setScreen('editor');
    setSelection([]);
    setFocusStorey(Object.values(loaded.items).find((i) => i.type === 'Storey')?.id ?? 'sty_A0');
  }, [openProject, replaceItems, persistUi, activeProjectId, uid, items, saveProject, catalogueJson]);

  const handleGoHome = useCallback(async () => {
    if (mcpPendingRef.current) { setRtToast({ ok: false, msg: 'Validez ou refusez l’action MCP avant de quitter le projet.' }); return; }
    try { if (activeProjectId) await saveProject(activeProjectId, items, undefined, fullCatalogue); }
    catch (error) { setRtToast({ ok: false, msg: String((error as Error).message || error) }); return; }
    setScreen('home');
    setActiveProjectId(null);
    persistUi({ activeProjectId: null });
  }, [activeProjectId, saveProject, items, persistUi, catalogueJson]);

  const handleCreateProject = useCallback(async () => {
    if (refuseNewProject()) return;
    let proj: Awaited<ReturnType<typeof createProject>>;
    try { proj = await createProject(makeT(lang)('New project'), '', lang); }
    catch (error) { alert(error instanceof Error ? error.message : String(error)); return; }
    replaceItems(proj.items, true);
    setProjectElements([]);
    setActiveProjectId(proj.id);
    persistUi({ activeProjectId: proj.id });
    setScreen('editor');
    setSelection([]);
    setFocusStorey(Object.values(proj.items).find((i) => i.type === 'Storey')?.id ?? 'sty_A0');
  }, [createProject, replaceItems, persistUi, lang, refuseNewProject]);

  // ── Editor state ──────────────────────────────────────────────────────
  const [selection, setSelection] = useState<string[]>([]);
  const [tool, setTool] = useState<ToolType>(uiState.tool || 'select');
  const viewportRef = useRef<ViewportApi | null>(null);
  const [showAllStoreys,setShowAllStoreys] = useState(false);
  const [view, setView] = useState<ViewType>(uiState.view && (uiState.view as string) !== 'sketch' ? uiState.view : '2d');
  useEffect(() => { if (view !== '3d' && view !== 'section') setSectionManaging(false); }, [view]);
  const [focusStorey, setFocusStorey] = useState(uiState.focusStorey || 'sty_A0');
  const [droppedPlan, setDroppedPlan] = useState<{ file: File; storeyId: string } | null>(null);
  const [planDragOver, setPlanDragOver] = useState(false);
  const [query, setQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpDocOpen, setHelpDocOpen] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(uiState.treeCollapsed || false);

  useEffect(() => {
    if (chatOpen) setHelpDocOpen(false);
  }, [chatOpen]);

  useEffect(() => {
    if (helpDocOpen) setChatOpen(false);
  }, [helpDocOpen]);
  const [propsCollapsed, setPropsCollapsed] = useState(uiState.propsCollapsed || false);
  const [treeWidth, setTreeWidth] = useState(uiState.treeWidth || 280);
  const [propsWidth, setPropsWidth] = useState(uiState.propsWidth || 320);
  const [resizing, setResizing] = useState<'tree' | 'props' | null>(null);
  const [view2d, setView2d] = useState<ViewState2D>(uiState.view2d || { scale: 36, ox: 80, oy: 80 });
  const [chatPrompt, setChatPrompt] = useState<{ text: string; image?: string } | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(uiState.selectedElementId ?? null);

  // ── Resizing logic ──────────────────────────────────────────────────
  const startResize = useCallback((panel: 'tree' | 'props') => (e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(panel);
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      if (resizing === 'tree') {
        const tbW = tweaks.density === 'compact' ? 38 : 44;
        const newW = e.clientX - tbW;
        setTreeWidth(Math.max(180, Math.min(600, newW)));
      } else {
        const newW = window.innerWidth - e.clientX;
        setPropsWidth(Math.max(180, Math.min(600, newW)));
      }
    };
    const onUp = () => {
      setResizing(null);
      persistUi({ treeWidth, propsWidth });
    };
    window.addEventListener('pointermove', onMove as any);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove as any);
      window.removeEventListener('pointerup', onUp);
    };
  }, [resizing, tweaks.density, persistUi, treeWidth, propsWidth]);
  
  const [ai, setAi] = useState<AiConfig>(() => ({ 
    provider: 'gemini', 
    model: 'gemini-2.5-flash', 
    apiKey: '', 
    temperature: 0, 
    baseUrl: '',
    mcpEnabled: true,
    mcpAlwaysValidate: true,
    ...(uiState.ai || {})
  }));

  // Auto-set default element when switching to Door/Window/Furniture tool
  useEffect(() => {
    if (tool === 'Door') {
      setSelectedElementId((prev) => prev && BUILTIN_CATALOGUE.find(e => e.id === prev)?.type === 'Door' ? prev : DEFAULT_DOOR_ID);
    } else if (tool === 'Window') {
      setSelectedElementId((prev) => prev && BUILTIN_CATALOGUE.find(e => e.id === prev)?.type === 'Window' ? prev : DEFAULT_WINDOW_ID);
    } else if (tool === 'Furniture') {
      setSelectedElementId((prev) => prev && BUILTIN_CATALOGUE.find(e => e.id === prev)?.type === 'Furniture' ? prev : DEFAULT_FURNITURE_ID);
    } else if (tool === 'Technical') {
      setSelectedElementId((prev) => TECHNICAL_CATALOGUE.some(el => el.id === prev) ? prev : TECHNICAL_CATALOGUE[0].id);
    }
  }, [tool]);

  // Persist changes
  useEffect(() => { persistUi({ tool, view, focusStorey, treeCollapsed, propsCollapsed, lang, treeWidth, propsWidth, view2d, ai, selectedElementId }); }, 
    [tool, view, focusStorey, treeCollapsed, propsCollapsed, lang, treeWidth, propsWidth, view2d, ai, selectedElementId, persistUi]);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [rtToast, setRtToast] = useState<{ ok: boolean; msg: string; canFix?: boolean } | null>(null);
  useEffect(() => {
    if (uiState.aiStorageBlocked) setRtToast({ ok: false, msg: 'Impossible de préparer la copie de récupération des anciennes clés. Elles restent dans les réglages locaux ; libérez le stockage puis rechargez avant le transfert.' });
  }, [uiState.aiStorageBlocked]);
  const [fitCount, setFitCount] = useState(0);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const toggleHiddenType = useCallback((type: string) => {
    setHiddenTypes(prev => { const next = new Set(prev); if (next.has(type)) next.delete(type); else next.add(type); return next; });
  }, []);

  const handleLoadSample = useCallback(async () => {
    if (refuseNewProject()) return;
    setImportProgress({ phase: makeT(lang)("Loading sample..."), pct: 10 });
    try {
      const response = await fetch('/ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc');
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const buffer = await response.arrayBuffer();
      const result: ImportResult = await importIFCBuffer(buffer, setImportProgress);
      
      const projName = 'Sample House';
      const proj = await createProject(projName, 'Sample house for testing');
      result.items = renameProjectItems(result.items, proj.name);
      await saveProject(proj.id, result.items);
      if (result.rawIfcBuffer) await saveIfcBuffer(proj.id, result.rawIfcBuffer);

      setRawIfcBuffer(result.rawIfcBuffer ?? buffer);
      replaceItems(result.items, true);
      setRawIfcStructure(result.rawStructure);
      setIfcMeshes(result.meshes);
      setIfcCenterOffset(result.centerOffset);
      setProjectElements([]);
    setActiveProjectId(proj.id);
      persistUi({ activeProjectId: proj.id, camera3d: null });
      setScreen('editor');
      setFocusStorey(Object.values(result.items).find((i) => i.type === 'Storey')?.id ?? 'sty_A0');
      setFitCount(c => c + 1);
    } catch (err) {
      console.error('Failed to load sample', err);
      alert(makeT(lang)('Failed to load sample: {error}', { error: String(err) }));
    } finally {
      setImportProgress(null);
    }
  }, [lang, createProject, saveProject, replaceItems, persistUi, refuseNewProject]);

  const readViewport = () => {
    const api = viewportRef.current;
    if (!api) throw new Error('Viewport is not ready; open the editor in 2d or 3d.');
    return { view, storey_id: api.storeyId, all_storeys: api.allStoreys, ...api.read() };
  };
  const controlViewport = async (raw: Record<string, unknown>) => {
    const request = validateViewRequest(raw);
    const targetView = request.view ?? (view === 'section' ? '3d' : view);
    if (targetView !== '2d' && targetView !== '3d') throw new Error('Choose a 2d or 3d view.');
    const storeyId = request.storey_id ?? focusStorey;
    if (items[storeyId]?.type !== 'Storey') throw new Error('Invalid storey_id.');
    if (targetView === '2d' && (request.position || request.target || request.preset)) throw new Error('Camera parameters require the 3d view.');
    if (targetView === '3d' && (request.center || request.scale !== undefined)) throw new Error('center and scale require the 2d view.');
    setView(targetView); setFocusStorey(storeyId);
    const allStoreys = request.all_storeys ?? showAllStoreys;
    setShowAllStoreys(allStoreys);
    const deadline = Date.now() + 12_000;
    while (true) {
      await nextFrame();
      const api = viewportRef.current;
      if (api?.view === targetView && api.storeyId === storeyId && api.allStoreys === allStoreys) break;
      if (Date.now() > deadline) throw new Error('Viewport loading timed out; retry when the model is ready.');
    }
    await viewportRef.current!.set(request);
    await nextFrame(); await nextFrame();
    const api = viewportRef.current!;
    return { success: true, view: targetView, storey_id: api.storeyId, all_storeys: api.allStoreys, ...api.read() };
  };
  const captureViewport = async () => {
    if (view !== '2d' && view !== '3d') throw new Error('Choose the 2d or 3d view before capturing.');
    const api = viewportRef.current;
    if (!api) throw new Error('Viewport is not ready for capture.');
    const image_url = await api.capture();
    const image = new Image(); image.src = image_url; await image.decode();
    return { ...readViewport(), image_url, mime_type: 'image/jpeg', image_width: image.naturalWidth, image_height: image.naturalHeight };
  };

  const { connected: mcpConnected, pending: mcpPending, renderConfirmDialog, execute: mcpExecute } = platform.useAssistant({
    accountId: uid,
    activeProjectId,
    items,
    catalogue: fullCatalogue,
    focusStorey,
    lang,
    ai,
    setAi,
    onError: error => setRtToast({ ok: false, msg: error.message }),
    getView: readViewport, setView: controlViewport, captureView: captureViewport,
    flushProject: async () => {
      const current = currentItemsRef.current;
      if (activeProjectId && !projectRepo?.isSaved(activeProjectId, current, fullCatalogue)) {
        await saveProject(activeProjectId, current, undefined, fullCatalogue);
      }
    },
    openProject: async (proj) => {
      await handleOpenProject(proj);
    },
    addItem: addItem as any,
    updateItem: updateItem as any,
    deleteItems,
    replaceItems,
    setFocusStorey,
    setSelection,
    triggerFit: () => setFitCount(prev => prev + 1),
  });
  useEffect(() => {
    if (screen !== 'editor' || !activeProjectId || mcpPending || (projectRepo && projectRepo.isSaved(activeProjectId, items, fullCatalogue))) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    let cancelled = false;
    saveTimerRef.current = setTimeout(() => {
      saveProject(activeProjectId, items, undefined, fullCatalogue).then(name => {
        const project = Object.values(items).find(item => item.type === 'Project');
        if (!cancelled && name && project && project.name !== name) updateItem(project.id, { name, Name: name });
      }).catch(error => { if (!cancelled) setRtToast({ ok: false, msg: String(error.message || error) }); });
    }, 1500);
    return () => { cancelled = true; if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [items, screen, activeProjectId, saveProject, updateItem, uid, mcpPending, catalogueJson]);

  mcpPendingRef.current = mcpPending;
  const currentItemsRef = useRef(items);
  currentItemsRef.current = items;
  useEffect(() => {
    if (screen !== 'editor' || !activeProjectId) return;
    return subscribeProject(activeProjectId, () => currentItemsRef.current, (next, catalogue) => {
      setProjectElements((catalogue ?? []).filter(def => def.source !== 'builtin'));
      replaceItems(next, true);
      setSelection([]);
      setFocusStorey(current => next[current]?.type === 'Storey' ? current : Object.values(next).find(item => item.type === 'Storey')?.id ?? '');
    }, error => setRtToast({ ok: false, msg: error.message }));
  }, [screen, activeProjectId, subscribeProject, replaceItems]);

  const [rawIfcStructure, setRawIfcStructure] = useState<unknown>(null);
  const [ifcMeshes, setIfcMeshes] = useState<IfcMeshGeometry[] | undefined>(undefined);
  const [ifcCenterOffset, setIfcCenterOffset] = useState<[number, number] | undefined>(undefined);
  const [rawIfcBuffer, setRawIfcBuffer] = useState<ArrayBuffer | null | undefined>(undefined);
  const [liveIfcBuffer, setLiveIfcBuffer] = useState<ArrayBuffer | null | undefined>(undefined);

  const handleAutoFix = useCallback(async () => {
    if (mcpPendingRef.current) { setRtToast({ ok: false, msg: 'Validez ou refusez l’action MCP avant de corriger le modèle.' }); return; }
    setImportProgress({ phase: 'Correction IFC sur le serveur…', pct: 10 });
    try {
      const corrected = await fixRoundTripProblems(items);
      const verifyText = liveIfcBuffer
        ? await patchIFC(corrected, liveIfcBuffer)
        : await exportIFC(corrected);
      const result = await checkRoundTrip(corrected, verifyText);
      const bytes = new TextEncoder().encode(verifyText);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      if (activeProjectId) {
        await saveProject(activeProjectId, corrected);
        await saveIfcBuffer(activeProjectId, buffer);
      }
      replaceItems(corrected);
      persistUi({ camera3d: null });
      setRawIfcBuffer(buffer);
      setLiveIfcBuffer(buffer);
      setRtToast({
        ok: result.ok, canFix: true,
        msg: result.ok
          ? makeT(lang)('✓ All fixed — {count} entities synced', { count: result.matched })
          : makeT(lang)('✗ {missing} missing, {names} name issues', { missing: result.missing.length, names: result.nameMismatch.length }),
      });
      setTimeout(() => setRtToast(null), 8000);
    } catch (error) { alert(String(error)); }
    finally { setImportProgress(null); }
  }, [items, replaceItems, lang, liveIfcBuffer, persistUi, activeProjectId, saveProject]);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the rawIfcBuffer reference we've already dispatched patchIFC for.
  // When rawIfcBuffer is new, patchIFC runs immediately so Canvas3D receives exactly
  // one buffer and loads once.  When only items change, we debounce.
  const lastPatchedRawRef = useRef<ArrayBuffer | null | undefined>(undefined);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    const newBuffer = rawIfcBuffer !== lastPatchedRawRef.current;
    lastPatchedRawRef.current = rawIfcBuffer;
    if (rawIfcBuffer === undefined) {
      setLiveIfcBuffer(undefined);
      return;
    }
    if (rawIfcBuffer === null) {
      // No stored IFC (project modelled from scratch or via MCP): generate one from the
      // items so the full 3D viewer, with its colours and section tool, is still used.
      const hasGeometry = Object.values(items).some((item: any) => item.type !== 'Storey' && item.type !== 'BackgroundPlan');
      if (!hasGeometry) {
        setLiveIfcBuffer(null);
        return;
      }
      const generate = async () => {
        try {
          const text = await exportIFC(items);
          if (cancelled) return;
          const bytes = new TextEncoder().encode(text);
          setLiveIfcBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
        } catch (error) {
          if (cancelled) return;
          console.error('[ifc-generate]', error);
          setLiveIfcBuffer(null);
        }
      };
      if (newBuffer) void generate();
      else syncTimerRef.current = setTimeout(generate, 1500);
      return () => { cancelled = true; if (syncTimerRef.current) clearTimeout(syncTimerRef.current); };
    }
    const hasEdits = Object.values(items).some((item: any) => item.geom?._edited === true);
    if (newBuffer && !hasEdits) {
      setLiveIfcBuffer(rawIfcBuffer);
      return;
    }
    const sync = async () => {
      try {
        const patched = await patchIFC(items, rawIfcBuffer);
        if (cancelled) return;
        const bytes = new TextEncoder().encode(patched);
        setLiveIfcBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      } catch (error) {
        if (cancelled) return;
        console.error('[ifc-sync]', error);
        setRtToast({ ok: false, msg: String(error) });
      }
    };
    if (newBuffer) void sync();
    else syncTimerRef.current = setTimeout(sync, 1500);
    return () => { cancelled = true; if (syncTimerRef.current) clearTimeout(syncTimerRef.current); };
  }, [items, rawIfcBuffer]);

  useEffect(() => {
    let cancelled = false;
    if (!activeProjectId) {
      setRawIfcBuffer(null);
      return;
    }
    setRawIfcBuffer(undefined);
    loadIfcBuffer(activeProjectId)
      .then((buffer) => {
        if (!cancelled) setRawIfcBuffer(buffer);
      })
      .catch((err) => {
        console.error('Failed to load stored IFC buffer', err);
        if (!cancelled) setRawIfcBuffer(null);
      });
    return () => { cancelled = true; };
  }, [activeProjectId]);

  const handleImportIFC = useCallback(() => {
    // On the home page an IFC import creates a project; in the editor it replaces the open model.
    if (!importInputRef.current || (screen === 'home' && refuseNewProject())) return;
    importInputRef.current.accept = '.ifc';
    importInputRef.current.click();
  }, [screen, refuseNewProject]);

  const handleImportSkaitch = useCallback(() => {
    if (!importInputRef.current || refuseNewProject()) return;
    importInputRef.current.accept = SKAITCH_EXTENSION;
    importInputRef.current.click();
  }, [refuseNewProject]);

  const handleImportBimwiq = useCallback(() => {
    if (!importInputRef.current || refuseNewProject()) return;
    importInputRef.current.accept = '.json';
    importInputRef.current.click();
  }, [refuseNewProject]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const createsProject = screen === 'home' || /\.json$/i.test(file.name) || file.name.toLowerCase().endsWith(SKAITCH_EXTENSION);
    if (createsProject && refuseNewProject()) return;
    try {
      const buffer = await file.arrayBuffer();
      if (file.name.toLowerCase().endsWith(SKAITCH_EXTENSION)) {
        // A .skaitch file always becomes a new project; it never overwrites the open one.
        const imported = readSkaitchFile(new Uint8Array(buffer));
        const created = await createProject(imported.meta.name, imported.meta.description);
        await saveProject(created.id, renameProjectItems(imported.items, created.name), undefined, imported.catalogue);
        if (imported.sourceIfc) await saveIfcBuffer(created.id, imported.sourceIfc.slice().buffer);
        await handleOpenProject(created);
        return;
      }
      const isBimwiq = /\.json$/i.test(file.name);
      setImportProgress({ phase: isBimwiq ? 'Import BIMWIQ sur le serveur…' : 'Import IFC sur le serveur…', pct: 10 });
      const result: ImportResult = isBimwiq
        ? await importBimwiq(JSON.parse(new TextDecoder().decode(buffer)))
        : await importIFCBuffer(buffer, setImportProgress);
      if (screen === 'home' || isBimwiq) {
        const proj = await createProject(file.name.replace(/\.(ifc|json)$/i, ''), isBimwiq ? 'Import partiel BIMWIQ' : 'Importé depuis IFC');
        result.items = renameProjectItems(result.items, proj.name);
        await saveProject(proj.id, result.items);
        if (result.rawIfcBuffer) await saveIfcBuffer(proj.id, result.rawIfcBuffer);
        setRawIfcBuffer(isBimwiq ? null : result.rawIfcBuffer ?? buffer);
        replaceItems(result.items, true);
        setRawIfcStructure(result.rawStructure);
        setIfcMeshes(result.meshes);
        setIfcCenterOffset(result.centerOffset);
        setProjectElements([]);
    setActiveProjectId(proj.id);
        persistUi({ camera3d: null });
        setScreen('editor');
        setFocusStorey(Object.values(result.items).find((i) => i.type === 'Storey')?.id ?? 'sty_A0');
      } else {
        if (activeProjectId && result.rawIfcBuffer) {
          await saveIfcBuffer(activeProjectId, result.rawIfcBuffer);
        }
        setRawIfcBuffer(result.rawIfcBuffer ?? buffer);
        replaceItems(result.items);
        setRawIfcStructure(result.rawStructure);
        setIfcMeshes(result.meshes);
      setIfcCenterOffset(result.centerOffset);
        persistUi({ camera3d: null });
        setFocusStorey(Object.values(result.items).find((i) => i.type === 'Storey')?.id ?? 'sty_A0');
      }
      if (isBimwiq) alert('Import BIMWIQ partiel : niveaux, murs, pièces, portes et fenêtres. Dalles, toiture, terrain et données thermiques non importés. Position des axes de murs approximative.');
    } catch (err) {
      console.error('Import failed', err);
      alert(makeT(lang)('IFC import error: {error}', { error: String(err) }));
    } finally {
      setImportProgress(null);
    }
  }, [replaceItems, lang, screen, createProject, saveProject, activeProjectId, persistUi, handleOpenProject, refuseNewProject]);

  const handleInjectIFC = useCallback(async (ifcText: string, filename = 'ai_generated.ifc') => {
    try {
      const bytes = new TextEncoder().encode(ifcText);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const result: ImportResult = await importIFCBuffer(buffer, setImportProgress);
      setRawIfcBuffer(result.rawIfcBuffer ?? buffer);
      replaceItems(result.items);
      setRawIfcStructure(result.rawStructure);
      setIfcMeshes(result.meshes);
      setIfcCenterOffset(result.centerOffset);
      setSelection([]);
      persistUi({ camera3d: null });
      const sty = Object.values(result.items).find((i) => i.type === 'Storey')?.id ?? 'sty_A0';
      setFocusStorey(sty);
      setView('2d');
      setFitCount(c => c + 1);
      if (activeProjectId && result.rawIfcBuffer) {
        await saveIfcBuffer(activeProjectId, result.rawIfcBuffer);
      }
      const byType: Record<string, number> = {};
      Object.values(result.items).forEach((i) => { byType[i.type] = (byType[i.type] ?? 0) + 1; });
      return {
        success: true,
        filename,
        active_storey: sty,
        total_elements: Object.keys(result.items).length,
        by_type: byType,
        resynced_2d: true,
        resynced_3d: Boolean(result.meshes?.length),
      };
    } catch (err) {
      console.error('AI IFC injection failed', err);
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      setImportProgress(null);
    }
  }, [replaceItems, activeProjectId, persistUi]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', tweaks.theme);
    document.documentElement.setAttribute('data-density', tweaks.density);
    document.documentElement.setAttribute('data-panels', tweaks.panelsLayout);
  }, [tweaks]);

  const duplicateSelection = useCallback(() => {
    if (selection.length === 0) return;
    const now = Date.now();
    const selected = selection.map((id) => items[id]).filter(Boolean) as IfcEntity[];
    const idMap = new Map<string, string>();
    const newItems: IfcEntity[] = [];

    const prefixFor = (type: string) => ({
      Wall: 'w', Door: 'd', Window: 'wn', Room: 'rm', Slab: 'slb', Roof: 'rf', Stair: 'st', Furniture: 'fur', GenericElement: 'ifcelement', Column: 'col', Chimney: 'chm',
    } as Record<string, string>)[type] ?? type.toLowerCase().slice(0, 3);

    selected.forEach((it, index) => idMap.set(it.id, `${prefixFor(it.type)}_copy_${now}_${index}`));

    for (const it of selected) {
      if (!['Wall', 'Door', 'Window', 'Room', 'Slab', 'Roof', 'Stair', 'Section', 'Furniture', 'GenericElement', 'Column', 'Chimney'].includes(it.type)) continue;
      const copy: any = JSON.parse(JSON.stringify(it));
      copy.id = idMap.get(it.id)!;
      copy.GlobalId = guid(copy.id);
      copy.name = `${it.name || it.type} (copie)`;
      copy.Name = copy.name;
      if (typeof copy.expressID === 'number') delete copy.expressID;
      if (copy.type === 'Stair') delete copy.geom.opening;
      if (copy.geom) {
        delete copy.geom.openingExpId;
        delete copy.geom._placementWorld;
      }

      if (copy.parentId && idMap.has(copy.parentId)) copy.parentId = idMap.get(copy.parentId)!;

      if (it.type === 'Wall' || it.type === 'Section') {
        copy.geom.x1 += 0.5; copy.geom.y1 += 0.5; copy.geom.x2 += 0.5; copy.geom.y2 += 0.5;
      } else if (it.type === 'Stair' || it.type === 'Furniture' || it.type === 'GenericElement' || it.type === 'Column' || it.type === 'Chimney') {
        copy.geom.x += 0.5; copy.geom.y += 0.5;
      } else if (it.type === 'Room' || it.type === 'Slab' || it.type === 'Roof') {
        copy.geom.polygon = copy.geom.polygon.map(([x, y]: [number, number]) => [x + 0.5, y + 0.5]);
      } else if (it.type === 'Door' || it.type === 'Window') {
        if (idMap.has(copy.geom.wallId)) {
          copy.geom.wallId = idMap.get(copy.geom.wallId);
        } else {
          copy.geom.t = Math.max(0.05, Math.min(0.95, copy.geom.t + 0.08));
        }
      }
      newItems.push(copy as IfcEntity);
    }

    for (const it of newItems) addItem(it);
    if (newItems.length > 0) setSelection(newItems.map((it) => it.id));
  }, [selection, items, addItem]);


  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault(); redo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault(); duplicateSelection();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const all = Object.values(items).filter((i) => i.parentId === focusStorey).map((i) => i.id);
        setSelection(all);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.length) { e.preventDefault(); deleteItems(selection); setSelection([]); }
      } else if (e.key === 'Escape') {
        setSelection([]); setTool('select');
      } else if (e.key === 'v' || e.key === 'V') setTool('select');
      else if (e.key === 'w' || e.key === 'W') setTool('Wall');
      else if (e.key === 'd' || e.key === 'D') setTool('Door');
      else if (e.key === 'f' || e.key === 'F') setTool('Window');
      else if (e.key === 'r' || e.key === 'R') setTool('Room');
      else if (e.key === 's' || e.key === 'S') setTool('Slab');
      else if (e.key === 'k' || e.key === 'K') setTool('Roof');
      else if (e.key === 'm' || e.key === 'M') setTool('Furniture');
      else if (e.key === 't' || e.key === 'T') setTool('Technical');
      else if (e.key === 'p' || e.key === 'P') setTool('Column');
      else if (e.key === 'h' || e.key === 'H') setTool('Chimney');
      else if (e.key === 'l' || e.key === 'L') setTool('Measure');
      else if (e.key === 'c' || e.key === 'C') setTool('Dimension');
      else if (e.key === 'j' || e.key === 'J') setTool('Marker');
      else if (e.key === 'g' || e.key === 'G') setTweak('showGrid', !tweaks.showGrid);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, deleteItems, items, focusStorey, tweaks.showGrid, setTweak, undo, redo, duplicateSelection]);

  // Auto-focus storey when selecting
  useEffect(() => {
    if (selection.length === 0) return;
    let cur = items[selection[0]];
    while (cur && cur.type !== 'Storey' && cur.parentId) cur = items[cur.parentId];
    if (cur?.type === 'Storey') setFocusStorey(cur.id);
  }, [selection, items]);

  const storeys = useMemo(() =>
    Object.values(items)
      .filter((i) => i.type === 'Storey')
      .sort((a, b) => {
        const ba = items[a.parentId!]?.name || '';
        const bb = items[b.parentId!]?.name || '';
        if (ba !== bb) return ba.localeCompare(bb);
        return (a as any).geom.level - (b as any).geom.level;
      }), [items]);

  const proj = useMemo(() => Object.values(items).find((i) => i.type === 'Project'), [items]);
  const itemCount = Object.keys(items).length;
  const activeProject = activeProjectId ? projectList.find((p) => p.id === activeProjectId) : null;


  // ── Auth gate ──────────────────────────────────────────────────────────
  if (user === undefined) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }
  if (user === null) return <>{platform.renderSignIn?.({ lang, onLangChange: setLang }) ?? null}{banner}</>;

  // ── Home screen ────────────────────────────────────────────────────────
  if (screen === 'home') {
    return (
      <>
        <HomePage
          about={platform.renderAbout?.(lang, 'home')}
          projects={projectList}
          loading={projectsLoading}
          user={user}
          onLogout={logout}
          lang={lang}
          onLangChange={setLang}
          onOpen={(p) => handleOpenProject(p)}
          onCreate={handleCreateProject}
          onEdit={(id, name, description) => updateMeta(id, { name, description })}
          onDuplicate={(id) => { if (!refuseNewProject()) duplicateProject(id).catch(error => alert(error instanceof Error ? error.message : String(error))); }}
          projectLimit={projectLimit}
          onDelete={(id) => deleteProject(id)}
          onArchive={(id, archived) => { setArchived(id, archived).catch(error => alert(error instanceof Error ? error.message : String(error))); }}
          onImportIFC={handleImportIFC}
          onImportBimwiq={handleImportBimwiq}
          onImportSkaitch={handleImportSkaitch}
          onLoadSample={handleLoadSample}
          onSettings={() => setSettingsOpen(true)}
        />
        {platform.renderSettings({ applicationOnly: true, open: settingsOpen, onClose: () => setSettingsOpen(false), ai, setAi, t, lang, onLangChange: setLang, projects: projectList, accountId: uid })}
        <input ref={importInputRef} type="file" accept=".ifc" style={{ display: 'none' }} onChange={handleFileChange} />
        {importProgress && <ImportOverlay progress={importProgress} lang={lang} />}
        {banner}
      </>
    );
  }

  const syncIfc = async () => {
    if (!activeProjectId) return;
    const buffer = await loadIfcBuffer(activeProjectId);
    if (!buffer) {
      alert(makeT(lang)("No IFC file associated with this project."));
      return;
    }
    setImportProgress({ phase: makeT(lang)("Syncing 3D view..."), pct: 50 });
    try {
      const patched = await patchIFC(items, buffer);
      const bytes = new TextEncoder().encode(patched);
      const newBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      setLiveIfcBuffer(newBuffer);
      setRtToast({
        ok: true,
        msg: makeT(lang)("✓ 3D View synchronized!")
      });
      setTimeout(() => setRtToast(null), 3000);
    } catch (err) {
      console.error(err);
      alert(makeT(lang)("Error during 3D synchronization."));
    } finally {
      setImportProgress(null);
    }
  };
  const verifyIfc = async () => {
    setImportProgress({ phase: 'Vérification IFC sur le serveur…', pct: 10 });
    try {
      const liveIfcText = liveIfcBuffer ? new TextDecoder().decode(liveIfcBuffer) : null;
      const result = await checkRoundTrip(items, liveIfcText);
      setRtToast({
        ok: result.ok, canFix: true,
        msg: result.ok
          ? `✓ Round-trip OK — ${result.matched} entités vérifiées`
          : `✗ ${result.missing.length} manquantes, ${result.nameMismatch.length} noms incorrects`,
      });
      setTimeout(() => setRtToast(null), 12000);
    } catch (error) { alert(String(error)); }
    finally { setImportProgress(null); }
  };
  const exportProject = async (format: ExportFormat) => {
    const name = (activeProject?.name ?? proj?.name ?? 'export').replace(/\s+/g, '_');
    if (format === 'ifc') setImportProgress({ phase: 'Export IFC sur le serveur…', pct: 10 });
    try {
    switch (format) {
      case 'skaitch': {
        const sourceIfc = activeProjectId ? await loadIfcBuffer(activeProjectId) : null;
        const file = writeSkaitchFile({
          meta: {
            name: activeProject?.name ?? proj?.name ?? name, description: activeProject?.description ?? '',
            createdAt: activeProject?.createdAt ?? '', updatedAt: new Date().toISOString(),
          },
          items, catalogue: fullCatalogue, ...(sourceIfc ? { sourceIfc: new Uint8Array(sourceIfc) } : {}),
        }, __RELEASE_VERSION__);
        triggerFileDownload(new Blob([file as Uint8Array<ArrayBuffer>], { type: SKAITCH_MIME }), `${name}${SKAITCH_EXTENSION}`, SKAITCH_MIME);
        break;
      }
      case 'ifc': {
        const buffer = activeProjectId ? await loadIfcBuffer(activeProjectId) : null;
        await downloadIFC(items, buffer, `${name}.ifc`, ifcCenterOffset);
        break;
      }
      case 'dxf': triggerFileDownload(await exportToDXF(items, name), `${name}.dxf`, 'image/vnd.dxf'); break;
      case 'json': await exportToBimJSON(items, activeProjectId || 'default', name); break;
      case 'pdf': exportToPDF(items, items[focusStorey]?.name || 'Niveau', name); break;
      case 'sheets': {
        const sheets = listSheets(items);
        if (!sheets.length) { alert(t('No sheet yet. Create one to lay out plans and sections at scale.')); break; }
        triggerFileDownload(await sheetsToPdf(items, sheets), sheetPdfName(name, sheets), 'application/pdf');
        break;
      }
      case 'png': exportToPNG('#plan-svg-canvas', name); break;
    }
    } catch (error) { alert(String(error)); }
    finally { if (format === 'ifc') setImportProgress(null); }
  };
  const editorHeader = <EditorHeader
    projectName={activeProject?.name ?? proj?.name ?? ''} lang={lang}
    onHome={handleGoHome} undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo}
    onAssistant={() => setChatOpen(o => !o)} assistantOpen={chatOpen}
    actions={<ProjectActions lang={lang} onImport={handleImportIFC} onImportBimwiq={handleImportBimwiq} onImportSkaitch={handleImportSkaitch} onSync={syncIfc} onVerify={verifyIfc} onExport={exportProject} />}
    context={isMobile && <label className="header-storey"><span>{t('storey')}</span>
      <select value={focusStorey} onChange={e => setFocusStorey(e.target.value)}>
        {storeys.map(storey => <option key={storey.id} value={storey.id}>{storey.name}</option>)}
      </select>
    </label>}
    options={<>
      <button className="toolbar-menu-action" data-menu-close onClick={() => setSettingsOpen(true)}><Settings2 size={18}/>{t('settings')}</button>
      <button className="toolbar-menu-action" data-menu-close aria-pressed={helpDocOpen} onClick={() => { setHelpDocOpen(o => !o); setChatOpen(false); }}><CircleHelp size={18}/>{makeT(lang)('Documentation & Help')}</button>
      {!isMobile && <button className="toolbar-menu-action" data-menu-close onClick={() => setPropsCollapsed(!propsCollapsed)}><PanelRight size={18}/>{makeT(lang)(propsCollapsed ? 'Show properties' : 'Hide properties')}</button>}
      <label className="toolbar-menu-language"><span>{makeT(lang)('Language')}</span><LanguageSelect lang={lang} onChange={setLang}/></label>
      {platform.renderAbout?.(lang, 'menu')}
      <div className="header-connection" data-connected={ai.mcpEnabled && mcpConnected}>
        <strong><span/>MCP · IFC4</strong>
        <span>{makeT(lang)(!ai.mcpEnabled ? 'MCP disabled in settings' : mcpConnected
          ? 'MCP connected — Claude can control this model' : 'MCP disconnected — configure Claude in settings')}</span>
      </div>
    </>}
  />;

  const savedSectionsMenu = <SavedSectionsMenu items={items} selection={selection} active={view === 'section'} lang={lang}
    onOpen={(id, targetView) => { setSectionManaging(false); setSelection([id]); setView(targetView); }}
    onDelete={id => { deleteItems([id]); setSelection(current => current.filter(selected => selected !== id)); }} />;
  const sectionToggle = <button className="btn section-management-toggle" aria-expanded={sectionManaging}
    aria-controls="section-settings" onClick={() => {
      setSectionManaging(!sectionManaging);
      if (!sectionManaging) setView('3d');
    }}>{makeT(lang)('Section settings')}</button>;

  // ── Mobile editor ─────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ height: '100%', position: 'relative' }}>
        <MobileShell viewportRef={viewportRef}
          header={editorHeader}
          sectionToolbar={<>{sectionToggle}{savedSectionsMenu}</>} sectionManaging={sectionManaging}
          openSectionSettings={() => { setSectionManaging(true); setView('3d'); }}
          showAllStoreys={showAllStoreys} setShowAllStoreys={setShowAllStoreys}
          items={items} selection={selection} setSelection={setSelection}
          tool={tool} setTool={setTool} view={view} setView={setView}
          focusStorey={focusStorey} setFocusStorey={setFocusStorey}
          storeys={storeys}
          addItem={addItem} updateItem={updateItem} deleteItems={deleteItems} replaceItems={replaceItems}
          query={query} setQuery={setQuery}
          expandedIds={expandedIds} setExpandedIds={setExpandedIds}
          rawIfcStructure={rawIfcStructure}
          view2d={view2d} setView2d={setView2d}
          fitCount={fitCount} setFitCount={setFitCount}
          hiddenTypes={hiddenTypes}
          showGrid={tweaks.showGrid}
          snapEnabled={tweaks.snap}
          snapSize={tweaks.snapSize}
          ifcMeshes={ifcMeshes}
          liveIfcBuffer={liveIfcBuffer}
          ifcCenterOffset={ifcCenterOffset}
          uiState={uiState}
          persistUi={persistUi}
          openSettings={() => setSettingsOpen(true)}
          setChatOpen={setChatOpen}
          setChatPrompt={setChatPrompt}
          winW={winW} lang={lang} t={t}
        />
        {platform.renderSettings({ open: settingsOpen, onClose: () => setSettingsOpen(false), ai, setAi, t, lang, onLangChange: setLang, projects: projectList, accountId: uid })}
        <Fragment key={`${uid}:${activeProjectId}`}>{platform.renderChat({
          open: chatOpen, onClose: () => setChatOpen(false), items, ai, selection, setSelection,
          addItem, updateItem, deleteItems, injectIfc: handleInjectIFC, focusStorey, t, lang, view2d,
          catalogue: fullCatalogue, chatPrompt, clearChatPrompt: () => setChatPrompt(null), executeToolWithValidation: mcpExecute,
        })}</Fragment>
        <HelpDocPanel
          open={helpDocOpen}
          onClose={() => setHelpDocOpen(false)}
          lang={lang}
          selection={selection}
          items={items}
        />
        {renderConfirmDialog && renderConfirmDialog()}
        {banner}
        <input ref={importInputRef} type="file" accept=".ifc" style={{ display: 'none' }} onChange={handleFileChange} />
        {importProgress && <ImportOverlay progress={importProgress} lang={lang} />}
        {rtToast && (
          <div style={{
            position: 'fixed', bottom: 72, left: '50%', transform: 'translateX(-50%)',
            background: rtToast.ok ? 'oklch(0.35 0.12 145)' : 'oklch(0.38 0.15 25)',
            color: '#fff', borderRadius: 8, padding: '12px 20px',
            fontFamily: 'var(--font-mono)', fontSize: 12.5, zIndex: 9998,
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: 12,
            backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)',
          }}>
            <span style={{ whiteSpace: 'pre' }}>{rtToast.msg}</span>
            {rtToast.canFix && (
              <button
                onClick={() => handleAutoFix()}
                style={{
                  background: '#fff',
                  color: 'oklch(0.38 0.15 25)',
                  border: 'none',
                  borderRadius: 4,
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                }}
              >
                {rtToast.ok ? (makeT(lang)("Regenerate")) : ('🪄 ' + (makeT(lang)("Correct")))}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="app"
      data-tree-col={treeCollapsed ? '1' : '0'}
      data-props-col={propsCollapsed ? '1' : '0'}
      style={{
        '--tree-w': `${treeWidth}px`,
        '--props-w': `${propsWidth}px`,
      } as any}
    >
      {editorHeader}
      <input ref={importInputRef} type="file" accept=".ifc" style={{ display: 'none' }} onChange={handleFileChange} />

      {/* TOOLBOX */}
      <div className="toolbox">
        <button className={`tool${tool === 'select' ? ' active' : ''}`} data-tip={`${t('select')} (V)`} onClick={() => setTool('select')}>
          <svg width="16" height="16" viewBox="0 0 20 20"><path d="M4 3l13 7-5.5 1.5L9 17 4 3z" fill="currentColor" /></svg>
          <span className="key">V</span>
        </button>
        <button className={`tool${tool === 'Measure' ? ' active' : ''}`} data-tip={makeT(lang)("Measure (L)")} onClick={() => setTool('Measure')}>
          <svg width="16" height="16" viewBox="0 0 20 20"><path d="M2 12l10-10 6 6L8 18z" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
          <span className="key">L</span>
        </button>
        <div className="divider" />
        {TOOLBAR_TYPES.map((typ) => (
          <button key={typ} className={`tool type-${typ}${tool === typ ? ' active' : ''}`}
            data-tip={`${t(typ.toLowerCase())} (${TYPE_KEYS[typ]})`}
            onClick={() => setTool(typ as ToolType)}>
            <svg width="17" height="17" viewBox="0 0 20 20">{TYPE_ICONS[typ]}</svg>
            <span className="swatch" />
            <span className="key">{TYPE_KEYS[typ]}</span>
          </button>
        ))}
        <div className="divider" />
        <button className={`tool${tool === 'Dimension' ? ' active' : ''}`} data-tip={makeT(lang)("Dimension (C)")} onClick={() => setTool('Dimension')}>
          <svg width="16" height="16" viewBox="0 0 20 20"><path d="M4 14l3 3-9 9H5v-3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M3 17l14-14M13 3h4v4M3 13v4h4" stroke="currentColor" strokeWidth="1.4" fill="none" />
          </svg>
          <span className="key">C</span>
        </button>
        <button className={`tool${tool === 'Marker' ? ' active' : ''}`} data-tip={makeT(lang)("Marker (J)")} onClick={() => setTool('Marker')}>
          <svg width="16" height="16" viewBox="0 0 20 20"><path d="M10 2c-3.3 0-6 2.7-6 6 0 4.5 6 10 6 10s6-5.5 6-10c0-3.3-2.7-6-6-6zm0 8.5c-1.4 0-2.5-1.1-2.5-2.5S8.6 5.5 10 5.5s2.5 1.1 2.5 2.5S11.4 10.5 10 10.5z" fill="currentColor" /></svg>
          <span className="key">J</span>
        </button>
        <div style={{ flex: 1 }} />
        <button
          className={`tool${selection.length === 0 ? ' disabled' : ''}`}
          style={{ color: selection.length ? 'var(--accent)' : 'var(--ink-4)' }}
          onClick={() => { if (selection.length) duplicateSelection(); }}
          data-tip={`${t('duplicate')} (Ctrl+D)`}
        >
          <svg width="16" height="16" viewBox="0 0 20 20"><rect x="6" y="6" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M3 13V4a1 1 0 011-1h9" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
          <span className="key">D</span>
        </button>
        <button
          className={`tool${selection.length === 0 ? ' disabled' : ''}`}
          style={{ color: selection.length ? 'oklch(0.55 0.18 25)' : 'var(--ink-4)' }}
          onClick={() => { if (selection.length) { deleteItems(selection); setSelection([]); } }}
          data-tip={`${t('delete')} (⌫)`}
        >
          <svg width="16" height="16" viewBox="0 0 20 20"><path d="M5 6h10l-1 11H6L5 6zM3 6h14M8 6V4h4v2" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="key">⌫</span>
        </button>
      </div>

      {/* ELEMENT LIBRARY PANEL — shown when Door, Window or Furniture tool is active */}
      {(tool === 'Door' || tool === 'Window' || tool === 'Furniture') && view === '2d' && (
        <ElementLibraryPanel
          tool={tool}
          setTool={(t) => setTool(t)}
          selectedElementId={selectedElementId}
          onSelectElement={setSelectedElementId}
          lang={lang}
          projectElements={projectElements}
          onProjectElementsChange={setProjectElements}
        />
      )}

      {/* TECHNICAL LIBRARY PANEL — shown when Technical tool is active */}
      {tool === 'Technical' && view === '2d' && (
        <TechnicalLibraryPanel
          tool={tool}
          selectedElementId={selectedElementId}
          onSelectElement={setSelectedElementId}
          setTool={setTool}
          lang={lang}
        />
      )}

      {/* TREE PANE */}
      {treeCollapsed ? (
        <div className="pane-collapsed tree-side">
          <button className="expand-btn" onClick={() => setTreeCollapsed(false)}>
            <svg width="11" height="11" viewBox="0 0 14 14"><path d="M5 4l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="vert-label">{makeT(lang)("Project tree")}</div>
        </div>
      ) : (
        <TreePane
          items={items} selection={selection} setSelection={setSelection}
          addItem={addItem} updateItem={updateItem}
          t={t} lang={lang} query={query} setQuery={setQuery}
          expandedIds={expandedIds} setExpandedIds={setExpandedIds}
          focusStorey={focusStorey} setFocusStorey={setFocusStorey}
          onCollapse={() => setTreeCollapsed(true)}
          rawIfcStructure={rawIfcStructure}
          hiddenTypes={hiddenTypes} onToggleHiddenType={toggleHiddenType}
        />
      )}

      {/* RESIZE HANDLES */}
      <div className={`resize-handle resize-handle-left${resizing === 'tree' ? ' resizing' : ''}`} onMouseDown={startResize('tree')} />
      <div className={`resize-handle resize-handle-right${resizing === 'props' ? ' resizing' : ''}`} onMouseDown={startResize('props')} />

      {/* CENTER */}
      <div className="center">
        <div className="view-tabs">
          <ViewSelect view={view} onChange={setView} lang={lang} tabs sectionMenu={savedSectionsMenu} />
          {sectionToggle}
          <div className="display-tools" role="group" aria-label={`${t('grid')} / ${t('zoom')}`}>
            <span className="display-tools-label">{t('grid')} / {t('zoom')}</span>
            <button
              style={{ border: 0, background: 'transparent', cursor: 'pointer', color: tweaks.showGrid ? 'var(--accent)' : 'var(--ink-3)', width: 22, height: 22, display: 'grid', placeItems: 'center', borderRadius: 4 }}
              title={t('grid')}
              aria-pressed={tweaks.showGrid}
              onClick={() => setTweak('showGrid', !tweaks.showGrid)}
            >
              <svg width="13" height="13" viewBox="0 0 20 20"><path d="M3 7h14M3 13h14M7 3v14M13 3v14" stroke="currentColor" strokeWidth="1.4" /></svg>
            </button>
            <button
              style={{ border: 0, background: 'transparent', cursor: 'pointer', color: tweaks.showReliability ? 'var(--accent)' : 'var(--ink-3)', width: 22, height: 22, display: 'grid', placeItems: 'center', borderRadius: 4 }}
              title={lang === 'fr' ? 'Fiabilité du relevé' : 'Survey reliability'}
              aria-pressed={!!tweaks.showReliability}
              onClick={() => setTweak('showReliability', !tweaks.showReliability)}
            >
              <svg width="13" height="13" viewBox="0 0 20 20"><circle cx="5" cy="10" r="2.6" fill="currentColor" /><circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="15" cy="10" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 1.5" /></svg>
            </button>
            <button
              style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-3)', width: 22, height: 22, display: 'grid', placeItems: 'center', borderRadius: 4 }}
              title={makeT(lang)("Fit view")}
              onClick={() => setFitCount(c => c + 1)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4m10 0h4M12 3v4m0 10v4" /><circle cx="12" cy="12" r="9" /></svg>
            </button>
            <SnapControl
              enabled={tweaks.snap}
              size={tweaks.snapSize}
              setEnabled={(v) => setTweak('snap', v)}
              setSize={(v) => setTweak('snapSize', v)}
              lang={lang}
            />
            {view === '2d' && (
              <WallOpacityControl
                opacity={tweaks.wallOpacity ?? 0.92}
                setOpacity={(v) => setTweak('wallOpacity', v)}
                lang={lang}
              />
            )}
          </div>
          <div className="spacer" />
          <div className="meta">
            <span><b>{itemCount}</b> {t('items')}</span>
            <span><b>{storeys.length}</b> {t('storeys')}</span>
            {selection.length > 0 && <span style={{ color: 'var(--accent)' }}><b>{selection.length}</b> {t('selected')}</span>}
          </div>
        </div>

        <div className="viewport"
          onDragOver={view === '2d' ? (e) => {
            // DXF files often have no MIME type while dragging; the name is checked on drop.
            if (!Array.from(e.dataTransfer.items).some(i => i.kind === 'file' && (i.type.startsWith('image/') || i.type === '' || /dxf/.test(i.type)))) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setPlanDragOver(true);
          } : undefined}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPlanDragOver(false); }}
          onDrop={view === '2d' ? (e) => {
            setPlanDragOver(false);
            const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/') || /\.dxf$/i.test(f.name));
            if (!file || !items[focusStorey]) return;
            e.preventDefault();
            setDroppedPlan({ file, storeyId: focusStorey });
          } : undefined}>
          {planDragOver && (
            <div style={{ position: 'absolute', inset: 8, zIndex: 50, pointerEvents: 'none', border: '2px dashed var(--accent)', borderRadius: 12, background: 'color-mix(in srgb, var(--accent) 10%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)', fontWeight: 600 }}>
              {lang === 'fr' ? `Déposer l’image ou le DXF comme fond de plan de « ${items[focusStorey]?.name ?? ''} »` : `Drop the image or DXF as background plan for “${items[focusStorey]?.name ?? ''}”`}
            </div>
          )}
          <PlanImageUpload hideTrigger hasPlan lang={lang} initialFile={droppedPlan?.file ?? null}
            vectorOrigins={droppedPlan ? vectorOriginSources(items, droppedPlan.storeyId) : []}
            onDone={() => setDroppedPlan(null)}
            onApply={image => {
              const id = droppedPlan?.storeyId;
              if (!id) return;
              updateItem(id, prev => ({ geom: { ...(prev as any).geom, plan: { opacity: 0.5, scale: 0.05, x: 0, y: 0, rotation: 0, ...image } } }) as any);
            }} />
          {view === '2d' ? (
            <Canvas2D viewportRef={viewportRef} showAllStoreys={showAllStoreys}
                items={items} storeyId={focusStorey} tool={tool} setTool={setTool}
                selection={selection} setSelection={setSelection}
                addItem={addItem} updateItem={updateItem} deleteItems={deleteItems}
                showGrid={tweaks.showGrid} snapEnabled={tweaks.snap} snapSize={tweaks.snapSize}
                t={t} lang={lang} view={view2d} setView={setView2d}
                fitCount={fitCount} hiddenTypes={hiddenTypes}
                wallOpacity={tweaks.wallOpacity ?? 0.92}
                activeElementDef={getElementDef(selectedElementId, fullCatalogue) ?? undefined}
                selectedElementId={selectedElementId}
                showBgImage={tweaks.showBgImage ?? true}
                showLabels={tweaks.showLabels ?? true}
                showDimensions={tweaks.showDimensions ?? true}
                showReliability={tweaks.showReliability ?? false}
              />
          ) : (view === '3d' || view === 'section') ? (
            <Canvas3D viewportRef={viewportRef} sectionToolHost={sectionToolHost} addItem={addItem} updateItem={updateItem} deleteItems={deleteItems} sectionManaging={sectionManaging} section2D={view === 'section'} onViewSection2D={()=>setView('section')} showScopeControl={false}
              showAllStoreys={showAllStoreys} setShowAllStoreys={setShowAllStoreys}
              key={`3d-${focusStorey}`}
              items={items} storeyId={focusStorey}
              selection={selection} setSelection={setSelection}
              t={t} lang={lang}
              meshes={ifcMeshes}
              ifcBuffer={liveIfcBuffer}
              centerOffset={ifcCenterOffset}
              fitCount={fitCount}
              cameraViewState={uiState.camera3d}
              onCameraViewStateChange={(cam) => persistUi({ camera3d: cam })}
              hiddenTypes={hiddenTypes}
              showBgImage={tweaks.showBgImage ?? true}
            />
          ) : view === 'sheets' ? (
            <SheetView projectName={activeProject?.name ?? proj?.name ?? 'export'} items={items} addItem={addItem} updateItem={updateItem} deleteItems={deleteItems} lang={lang} />
          ) : null}

          {/* Storey switcher — top left */}
          <div className="viewport-overlay top-left">
            <div className="storey-switch">
              <div className="head">{t('storeys')}</div>
              {storeys.map((s) => (
                <button key={s.id} className={s.id === focusStorey ? 'on' : ''} onClick={() => setFocusStorey(s.id)}>
                  <span className="swatch" />
                  <span style={{ flex: 1 }}>{s.name}</span>
                  <span className="lvl">L{(s as any).geom.level}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Compass + minimap — top right */}
          <div className="viewport-overlay top-right viewport-navigation" style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
            <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
              {(view==='3d' || view==='2d') && <StoreyScopeSwitch lang={lang} showAllStoreys={showAllStoreys} setShowAllStoreys={setShowAllStoreys}/>}
              <div className="compass"><span className="arrow" /></div>
            </div>
            <Minimap items={items} storeyId={focusStorey} />
            <div ref={setSectionToolHost} />
          </div>

          {/* Keyboard shortcuts hint — bottom left */}
          <div className="viewport-overlay bottom-left">
            <div className="shortcut-helper">
              <span><kbd>V</kbd> {t('select')}</span>
              <span><kbd>W</kbd>/<kbd>D</kbd>/<kbd>F</kbd>/<kbd>R</kbd>/<kbd>S</kbd> {makeT(lang)("wall/door/win/room/slab")}</span>
              <span><kbd>⌫</kbd> {makeT(lang)("delete")}</span>
              <span><kbd>Alt</kbd>+drag, <kbd>Right Click</kbd> drag or <kbd>Trackpad</kbd> {makeT(lang)("pan")}</span>
            </div>
          </div>

          {/* Zoom — bottom right */}
          <div className="viewport-overlay bottom-right">
            {view === '2d' ? (
              <ZoomBox view={view2d} setView={setView2d} />
            ) : (
              <div className="zoom-control disabled">
                <span className="val">3D</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* PROPERTIES */}
      {propsCollapsed ? (
        <div className="pane-collapsed props-side">
          <button className="expand-btn" onClick={() => setPropsCollapsed(false)}>
            <svg width="11" height="11" viewBox="0 0 14 14"><path d="M9 4l-3 3 3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="vert-label">{t('properties')}</div>
        </div>
      ) : (
        <PropertiesPane
          items={items} selection={selection} updateItem={updateItem}
          addItem={addItem} deleteItems={deleteItems}
          tool={tool} setTool={setTool}
          t={t} lang={lang}
          openSettings={() => setSettingsOpen(true)}
          onCollapse={() => setPropsCollapsed(true)}
          fullCatalogue={fullCatalogue}
          replaceItems={replaceItems}
          surveyInbox={platform.surveyInbox}
        />
      )}

      {/* ITEMS BAR */}
      <ItemsBar
        items={items}
        currentStorey={focusStorey}
        selection={selection}
        setSelection={setSelection}
        hiddenTypes={hiddenTypes}
        onToggleHiddenType={toggleHiddenType}
        t={t}
        lang={lang}
        tweaks={tweaks}
        setTweak={setTweak}
      />

      {/* MODALS */}
      {platform.renderSettings({ open: settingsOpen, onClose: () => setSettingsOpen(false), ai, setAi, t, lang, onLangChange: setLang, projects: projectList, accountId: uid })}
      <Fragment key={`${uid}:${activeProjectId}`}>{platform.renderChat({
        open: chatOpen, onClose: () => setChatOpen(false), items, ai, selection, setSelection,
        addItem, updateItem, deleteItems, injectIfc: handleInjectIFC, focusStorey, t, lang, view2d,
        catalogue: fullCatalogue, chatPrompt, clearChatPrompt: () => setChatPrompt(null), executeToolWithValidation: mcpExecute,
      })}</Fragment>
      <HelpDocPanel
        open={helpDocOpen}
        onClose={() => setHelpDocOpen(false)}
        lang={lang}
        selection={selection}
        items={items}
      />

      {renderConfirmDialog && renderConfirmDialog()}
      {banner}

      {importProgress && <ImportOverlay progress={importProgress} lang={lang} />}

      {rtToast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: rtToast.ok ? 'oklch(0.35 0.12 145)' : 'oklch(0.38 0.15 25)',
          color: '#fff', borderRadius: 8, padding: '12px 24px',
          fontFamily: 'var(--font-mono)', fontSize: 12.5, zIndex: 9998,
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: 16,
          backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <span style={{ whiteSpace: 'pre' }}>{rtToast.msg}</span>
          {rtToast.canFix && (
            <button
              onClick={() => handleAutoFix()}
              style={{
                background: '#fff',
                color: 'oklch(0.38 0.15 25)',
                border: 'none',
                borderRadius: 4,
                padding: '4px 12px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                transition: 'all 0.12s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f3f4f6';
                e.currentTarget.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#fff';
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
                {rtToast.ok ? (makeT(lang)("Regenerate")) : ('🪄 ' + (makeT(lang)("Correct")))}
              </button>
          )}
          {rtToast.ok && (
            <span style={{ opacity: 0.6, fontSize: 10 }}>
              {makeT(lang)("(see console for details)")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
