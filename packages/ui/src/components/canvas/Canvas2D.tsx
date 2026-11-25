import { captureSvg, nextFrame, type ViewportRef } from '../../lib/viewport';
import ToolHint from '../ToolHint';
import StairTypePicker from './StairTypePicker';
import { trackpadView } from '../../lib/view2d';
import { roomLabelPoint } from '@skaitch/core/survey/surveyFile';
import { buildStair, STAIR_DEFAULTS, slabOpenings, stairAscentPath, stairFlightHandles, stairFlightLengthAt, stairFlightDimensions, stairBaseCount, canStartWithWinders, type StairGeom } from '@skaitch/core/lib/stairGeometry';
import ReliabilityLayer from './ReliabilityLayer';
import VectorPlanLayer from './VectorPlanLayer';
import { alignBackgroundPlan, defaultAlignmentReference, storeyAlignmentPoints } from '../../lib/translateStorey';
import { buildVectorSnapIndex, snapToVector, vectorMetresPerUnit, vectorToWorld, worldToVector, type VectorSnapKind } from '@skaitch/core/cad/vectorPlan';
import { renderPlan, DEFAULT_PENS, type PlanPens, type Primitive } from '@skaitch/core/drawing/plan';
import PlanPrimitives, { type PrimitiveStyle } from './PlanPrimitives';
import { makeT } from '@skaitch/core/data/i18n';
import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import type { ItemsMap, IfcEntity, ToolType, IfcStoreyEntity, IfcTechnicalEntity, IfcColumnEntity, IfcChimneyEntity, ViewState2D } from '@skaitch/core/types/ifc';
import {
  wallLength, wallAngle, wallPointAtT, pointInPoly, bbox, polyArea,
} from '@skaitch/core/data/query';
import { guid } from '@skaitch/core/data/starter';
import { formatArea, formatDims, formatLength, shortName } from '../../lib/format';
import { renderElementSvg } from '../../data/elementSvg';
import type { ElementDef } from '@skaitch/core/data/elementCatalogue';
import { TECHNICAL_CATALOGUE, disciplineColor } from '../../data/technicalCatalogue';
import { renderTechnicalSymbol } from '../../data/technicalSymbols';
import { connectedWallEndpoints, wallGeomWithEndpoint, type WallEndpoint } from '@skaitch/core/lib/wallContinuity';
import { buildRoof, roofCreases, roofEdges, ROOF_DEFAULTS } from '@skaitch/core/lib/roofGeometry';
import { catalogueLabel, defaultName } from '@skaitch/core/lib/defaultNames';
import { chimneyGeom, chimneyHeightThroughRoof, columnGeom, pointInPolygon, storeyHeight, structuralOutlines } from '@skaitch/core/lib/structuralElements';

interface Props {
  viewportRef?: ViewportRef;
  showAllStoreys?: boolean;
  items: ItemsMap;
  storeyId: string;
  tool: ToolType;
  setTool: (t: ToolType) => void;
  selection: string[];
  setSelection: (ids: string[]) => void;
  addItem: (it: IfcEntity) => void;
  updateItem: (id: string, patch: Partial<IfcEntity>) => void;
  deleteItems: (ids: string[]) => void;
  showGrid: boolean;
  snapEnabled: boolean;
  snapSize: number;
  t: (k: string) => string;
  lang: string;
  view: ViewState2D;
  setView: React.Dispatch<React.SetStateAction<ViewState2D>>;
  fitCount?: number;
  hiddenTypes?: Set<string>;
  /** Wall fill opacity (0–1). Default 0.92 */
  wallOpacity?: number;
  /** Active element definition from the library panel (door/window type) */
  activeElementDef?: ElementDef;
  selectedElementId?: string | null;
  showBgImage?: boolean;
  showLabels?: boolean;
  showDimensions?: boolean;
  showReliability?: boolean;
}

// ViewState is now shared ViewState2D

type DragState =
  | { kind: 'pan';           startX: number; startY: number; ox0: number; oy0: number; hasMoved?: boolean }
  | { kind: 'marquee';       startX: number; startY: number }
  | { kind: 'move';          startX: number; startY: number; ids: string[]; originals: ItemsMap }
  | { kind: 'draw-wall';     x1: number; y1: number; x2: number; y2: number; snapEnd: boolean }
  | { kind: 'draw-room';     x1: number; y1: number; x2: number; y2: number }
  | { kind: 'draw-room-poly'; points: [number, number][]; cursor: [number, number] }
  | { kind: 'draw-fur';      x1: number; y1: number; x2: number; y2: number }
  | { kind: 'wall-handle';   wallId: string; handle: 'A'|'B'; ox1: number; oy1: number; ox2: number; oy2: number; connected: WallEndpoint[] }
  | { kind: 'room-vertex';   roomId: string; idx: number; origPoly: [number, number][] }
  | { kind: 'measure';       x1: number; y1: number; x2: number; y2: number }
  | { kind: 'draw-dim';      x1: number; y1: number; x2: number; y2: number }
  | { kind: 'draw-slab';     points: [number, number][]; cursor: [number, number] }
  | { kind: 'draw-roof';     points: [number, number][]; cursor: [number, number] }
  | { kind: 'stair-flight'; id: string; index: number; start: [number, number]; direction: [number, number]; lengths: number[]; offset: number }
  | { kind: 'furniture-rotate'; id: string; centerX: number; centerY: number };

interface MarqueeRect { x1: number; y1: number; x2: number; y2: number }
interface HoverState {
  type: string; id: string;
  sub?: 'stair-flight' | 'wall-handle-A' | 'wall-handle-B' | 'room-vertex' | 'furniture-rotate';
  idx?: number;
}

// ── Geometry helpers ──────────────────────────────────────────────────────────
function distPointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function itemSearchLabel(it: IfcEntity): string {
  return `${it.id ?? ''} ${it.name ?? ''} ${(it as any).Name ?? ''} ${(it as any).ifcType ?? ''} ${(it as any).category ?? ''}`;
}

function isCurtainLikeElement(it: IfcEntity): boolean {
  return /curtain|curtain[_ -]?wall|exterior[_ -]?glazing|system panel|glazed|mullion/i.test(itemSearchLabel(it));
}

function isCeilingLikeElement(it: IfcEntity): boolean {
  return /compound ceiling|ceiling|plafond|ifccovering/i.test(itemSearchLabel(it));
}

/** Editor colours for the shared plan drawing; weights stay the print ones (paper mm). */
const SCREEN_PENS: Partial<PlanPens> = {
  wallCut: { ...DEFAULT_PENS.wallCut, color: 'var(--ink)' },
  wallFill: 'var(--c-wall)',
  partitionFill: 'var(--ink-3)',
};

function hiddenIn2D(it: IfcEntity): boolean {
  const isCurtainLike = isCurtainLikeElement(it);
  if (it.type === 'Wall') return (it as any).ifcType === 'IfcCurtainWall' || isCurtainLike;
  if (it.type === 'GenericElement') return isCurtainLike;
  return false;
}

// ── Relation chip component ───────────────────────────────────────────────────
function RelChip({
  icon, label, dimLabel, action, onEnter, onLeave, badge,
}: {
  icon: string; label: string; dimLabel?: string;
  action?: () => void;
  onEnter?: () => void; onLeave?: () => void;
  badge?: string;
}) {
  return (
    <div
      onClick={action}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      title={label}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 8px', borderRadius: 5,
        background: action ? 'var(--bg)' : 'transparent',
        border: action ? '1px solid var(--border)' : 'none',
        cursor: action ? 'pointer' : 'default',
        fontSize: 11.5, color: 'var(--ink)',
        userSelect: 'none',
      }}
    >
      <span style={{ fontSize: 13, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {dimLabel && <span style={{ fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>{dimLabel}</span>}
      {badge && <span style={{ fontSize: 9, background: 'var(--hover)', color: 'var(--ink-2)', borderRadius: 3, padding: '0 4px' }}>{badge}</span>}
      {action && <svg width="9" height="9" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" /></svg>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Canvas2D({
  viewportRef, showAllStoreys = false, items, storeyId, tool, setTool, selection, setSelection,
  addItem, updateItem, deleteItems, showGrid, snapEnabled, snapSize, t, lang,
  view, setView, fitCount = 0, hiddenTypes, wallOpacity = 0.92,
  activeElementDef, selectedElementId,
  showBgImage = true, showLabels = true,
  showDimensions = true,
  showReliability = false,
}: Props) {
  const [stairForm, setStairForm] = useState<StairGeom['form']>('straight');
  const [stairLanding, setStairLanding] = useState(true);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize]         = useState({ w: 1200, h: 700 });
  const [hover, setHover]       = useState<HoverState | null>(null);
  const [drag, setDrag]         = useState<DragState | null>(null);
  const [marquee, setMarquee]   = useState<MarqueeRect | null>(null);
  const [cursorWorld, setCursorWorld] = useState<[number, number] | null>(null);
  // For hovering over a relation chip → temporarily highlight the referenced element
  const [relHoverIds, setRelHoverIds] = useState<string[]>([]);

  // ── Calibration state ────────────────────────────────────────────────────────
  const [calibPoints, setCalibPoints] = useState<[number, number][]>([]);
  const [calibValue, setCalibValue] = useState('5.0');
  const [isCalibrating, setIsCalibrating] = useState(false);
  /** Plan alignment: the point picked on the background plan, waiting for its target. */
  const [alignFrom, setAlignFrom] = useState<[number, number] | null>(null);
  const alignRefId = useMemo(() => tool === 'alignPlan' ? defaultAlignmentReference(items, storeyId) : null, [tool, items, storeyId]);
  const alignRefPoints = useMemo(() => alignRefId ? storeyAlignmentPoints(items, alignRefId) : [], [alignRefId, items]);
  useEffect(() => { if (tool !== 'alignPlan') setAlignFrom(null); }, [tool]);
  const lastPanMovedRef = useRef(false);

  useEffect(() => {
    if (tool !== 'calibrate') {
      setCalibPoints([]);
      setIsCalibrating(false);
    }
  }, [tool]);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => { const r = e.contentRect; setSize({ w: r.width, h: r.height }); });
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!viewportRef) return;
    const api = {
      view: '2d' as const, storeyId, allStoreys: showAllStoreys,
      read: () => ({ ...view, width: size.w, height: size.h, center: [(size.w / 2 - view.ox) / view.scale, (view.oy - size.h / 2) / view.scale] }),
      set: async (request: import('../../lib/viewport').ViewRequest) => {
        if (request.position || request.target || request.preset) throw new Error('Camera parameters require the 3d view.');
        if (request.fit) { fitView(); await nextFrame(); await nextFrame(); }
        setView(current => {
          const center = request.center ?? [(size.w / 2 - current.ox) / current.scale, (current.oy - size.h / 2) / current.scale];
          const scale = Math.max(0.5, Math.min(200, (request.scale ?? current.scale) * (request.zoom_factor ?? 1)));
          return { scale, ox: size.w / 2 - center[0] * scale, oy: size.h / 2 + center[1] * scale };
        });
      },
      capture: async () => {
        const svg = wrapRef.current?.querySelector('svg#plan-svg-canvas');
        if (!svg) throw new Error('2D viewport is unavailable.');
        return captureSvg(svg as SVGSVGElement);
      },
    };
    viewportRef.current = api;
    return () => { if (viewportRef.current === api) viewportRef.current = null; };
  });

  const w2s = useCallback((x: number, y: number): [number, number] =>
    [x * view.scale + view.ox, -y * view.scale + view.oy], [view]);
  const s2w = useCallback((x: number, y: number): [number, number] =>
    [(x - view.ox) / view.scale, (view.oy - y) / view.scale], [view]);
  const snap = useCallback((v: number) =>
    snapEnabled ? Math.round(v / snapSize) * snapSize : v, [snapEnabled, snapSize]);

  const toggleSelection = (id: string, multi: boolean) => {
    if (multi) {
      setSelection(selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id]);
    } else {
      setSelection([id]);
    }
  };

  const inStorey   = useMemo(() => Object.values(items).filter((i) => (showAllStoreys ? items[i.parentId ?? '']?.type === 'Storey' : i.parentId === storeyId)), [items, storeyId, showAllStoreys]);
  const allWalls   = useMemo(() => inStorey.filter((i) => i.type === 'Wall'), [inStorey]);
  const walls      = useMemo(() => allWalls.filter((i) => !hiddenIn2D(i) && !hiddenTypes?.has('Wall')), [allWalls, hiddenTypes]);
  const rooms      = useMemo(() => inStorey.filter((i) => i.type === 'Room' && !hiddenTypes?.has('Room')), [inStorey, hiddenTypes]);

  const doors      = useMemo(() => inStorey.filter((i) => i.type === 'Door' && !hiddenTypes?.has('Door')), [inStorey, hiddenTypes]);
  const windowsArr = useMemo(() => inStorey.filter((i) => i.type === 'Window' && !hiddenTypes?.has('Window')), [inStorey, hiddenTypes]);
  const furniture  = useMemo(() => inStorey.filter((i) => i.type === 'Furniture' && !hiddenTypes?.has('Furniture')), [inStorey, hiddenTypes]);
  const technical  = useMemo(() => inStorey.filter((i): i is IfcTechnicalEntity => i.type === 'Technical' && !hiddenTypes?.has('Technical')), [inStorey, hiddenTypes]);
  const structural = useMemo(() => inStorey.filter((i): i is IfcColumnEntity | IfcChimneyEntity => (i.type === 'Column' || i.type === 'Chimney') && !hiddenTypes?.has(i.type)), [inStorey, hiddenTypes]);
  const genericElements = useMemo(() => inStorey.filter((i) => {
    if (i.type !== 'GenericElement' || hiddenIn2D(i)) return false;
    if (hiddenTypes?.has('GenericElement')) return false;
    if (isCeilingLikeElement(i) && hiddenTypes?.has('Ceiling')) return false;
    return true;
  }), [inStorey, hiddenTypes]);
  const wallsById  = useMemo(() => Object.fromEntries(allWalls.map((w) => [w.id, w])), [allWalls]);



  // ── Keyboard Shortcuts ────────────────────────────────────────────────────
  const clipboardRef = useRef<any[]>([]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea
      const tag = document.activeElement?.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || document.activeElement?.hasAttribute('contenteditable')) {
        return;
      }

      if (e.key === 'Escape') {
        if (drag && drag.kind.startsWith('draw-')) {
          setDrag(null);
          setTool('select');
        }
        return;
      }

      // --- COPY (Ctrl+C / Cmd+C) ---
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (selection.length > 0) {
          e.preventDefault();
          const toCopy = selection.map(id => items[id]).filter(Boolean);
          clipboardRef.current = JSON.parse(JSON.stringify(toCopy));
          console.log('[KB] Copied items:', clipboardRef.current.length);
        }
        return;
      }

      // --- PASTE (Ctrl+V / Cmd+V) ---
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (clipboardRef.current.length > 0) {
          e.preventDefault();
          
          // Map old IDs to new IDs
          const idMap: Record<string, string> = {};
          clipboardRef.current.forEach(item => {
            idMap[item.id] = guid(String(Date.now() + Math.random() + item.id));
          });

          // Offset to apply on paste (e.g. 0.5m)
          const offset = 0.5;
          const newSelection: string[] = [];

          clipboardRef.current.forEach(item => {
            const newItem = JSON.parse(JSON.stringify(item));
            newItem.id = idMap[item.id];
            newItem.GlobalId = guid(String(Date.now() + Math.random() + newItem.id));
            newItem._edited = true;

            // Offset geometry
            if (newItem.type === 'Wall') {
              newItem.geom.x1 += offset;
              newItem.geom.y1 += offset;
              newItem.geom.x2 += offset;
              newItem.geom.y2 += offset;
            } else if (newItem.type === 'Stair' || newItem.type === 'Furniture' || newItem.type === 'GenericElement' || newItem.type === 'Marker') {
              newItem.geom.x += offset;
              newItem.geom.y += offset;
            } else if (newItem.type === 'Room' || newItem.type === 'Slab' || newItem.type === 'Roof') {
              newItem.geom.polygon = newItem.geom.polygon.map(([x, y]: [number, number]) => [x + offset, y + offset]);
            } else if (newItem.type === 'Dimension') {
              newItem.geom.x1 += offset;
              newItem.geom.y1 += offset;
              newItem.geom.x2 += offset;
              newItem.geom.y2 += offset;
            } else if (newItem.type === 'Door' || newItem.type === 'Window') {
              // If the host wall is also pasted, update parent wall ID
              const oldWallId = newItem.geom.wallId;
              if (idMap[oldWallId]) {
                newItem.geom.wallId = idMap[oldWallId];
              }
            }

            addItem(newItem);
            newSelection.push(newItem.id);
          });

          if (newSelection.length > 0) {
            setSelection(newSelection);
          }
        }
        return;
      }

      // --- ARROW KEYS NUDGE (Arrow keys) ---
      const arrowKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
      if (arrowKeys.includes(e.key) && selection.length > 0) {
        e.preventDefault();

        // Determine step in meters
        let step = 0.05; // 5 cm default
        if (e.shiftKey) {
          step = 0.25; // 25 cm with Shift
        } else if (e.altKey || e.ctrlKey || e.metaKey) {
          step = 0.01; // 1 cm with Alt/Ctrl/Meta
        }

        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        if (e.key === 'ArrowUp') dy = step;    // World Y goes UP visually
        if (e.key === 'ArrowDown') dy = -step; // World Y goes DOWN visually

        selection.forEach((id) => {
          const it = items[id];
          if (!it) return;

          if (it.type === 'Door' || it.type === 'Window') {
            const g = (it as any).geom;
            const hostWall = wallsById[g.wallId];
            if (hostWall) {
              const wGeom = (hostWall as any).geom;
              const wallLen = Math.hypot(wGeom.x2 - wGeom.x1, wGeom.y2 - wGeom.y1) || 1;
              const halfSpan = Math.min(0.49, Math.max(0.01, ((g.width ?? 1) / 2) / wallLen));

              // dt is change in parameter t
              // Project the keyboard displacement (dx, dy) onto the wall's normalized direction vector
              // to ensure the movement always visually aligns with the arrow key pressed.
              const wallDx = wGeom.x2 - wGeom.x1;
              const wallDy = wGeom.y2 - wGeom.y1;
              const ux = wallDx / wallLen;
              const uy = wallDy / wallLen;
              
              const proj = dx * ux + dy * uy;
              const dt = proj / wallLen;

              const nt = Math.max(halfSpan, Math.min(1 - halfSpan, g.t + dt));
              const newPW: [number, number] = [
                wGeom.x1 + nt * (wGeom.x2 - wGeom.x1),
                wGeom.y1 + nt * (wGeom.y2 - wGeom.y1)
              ];

              updateItem(it.id, {
                geom: {
                  ...g,
                  t: nt,
                  _placementWorld: newPW,
                  _edited: true
                }
              } as any);
            }
          } else if (it.type === 'Stair' || it.type === 'Furniture' || it.type === 'GenericElement' || it.type === 'Marker' || it.type === 'Technical' || it.type === 'Column' || it.type === 'Chimney') {
            const g = (it as any).geom;
            const placementWorld = (it.type === 'Furniture' || it.type === 'GenericElement') && Array.isArray(g._placementWorld)
              ? { _placementWorld: [g._placementWorld[0] + dx, g._placementWorld[1] + dy] }
              : {};
            updateItem(it.id, {
              geom: {
                ...g,
                x: g.x + dx,
                y: g.y + dy,
                ...placementWorld,
                _edited: true
              }
            } as any);
          } else if (it.type === 'Wall') {
            const g = (it as any).geom;
            const nextGeom = {
              ...g,
              x1: g.x1 + dx,
              y1: g.y1 + dy,
              x2: g.x2 + dx,
              y2: g.y2 + dy,
              _edited: true
            };
            updateItem(it.id, { geom: nextGeom } as any);
            updateHostedOpenings(it.id, nextGeom, items, new Set(selection));
          } else if (it.type === 'Room' || it.type === 'Slab' || it.type === 'Roof') {
            const g = (it as any).geom;
            const placementWorld = Array.isArray(g._placementWorld)
              ? { _placementWorld: [g._placementWorld[0] + dx, g._placementWorld[1] + dy] }
              : {};
            const nextGeom = {
              ...g,
              polygon: g.polygon.map(([x, y]: [number, number]) => [x + dx, y + dy]),
              ...placementWorld,
              _edited: true
            };
            updateItem(it.id, { geom: nextGeom } as any);
            updateContainedFurniture(it, dx, dy, items, new Set(selection));
          } else if (it.type === 'Dimension') {
            const g = (it as any).geom;
            updateItem(it.id, {
              geom: {
                ...g,
                x1: g.x1 + dx,
                y1: g.y1 + dy,
                x2: g.x2 + dx,
                y2: g.y2 + dy,
                _edited: true
              }
            } as any);
          }
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drag, setTool, selection, items, updateItem, wallsById, addItem, storeyId, setSelection]);

  // A single non-passive listener owns both browser cancellation and trackpad zoom.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setView(current => trackpadView(current, e.clientX - rect.left, e.clientY - rect.top, e.deltaX, e.deltaY, e.ctrlKey));
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [setView]);

  // ── Auto-fit ──────────────────────────────────────────────────────────────
  // Trigger auto-fit when the storey changes, or when explicitly requested
  const fitView = () => {
    const all: [number, number][] = [];
    // If we have a selection of actual elements (not just the storey node itself),
    // fit to those elements; otherwise fit to the entire storey content + plan image.
    const selectionIsStoreyOnly =
      selection.length > 0 &&
      selection.every(id => items[id]?.type === 'Storey');

    const fitToStorey = selection.length === 0 || selectionIsStoreyOnly;

    const targets = fitToStorey
      ? inStorey.filter(i => !hiddenIn2D(i) && !hiddenTypes?.has(i.type))
      : selection.map(id => items[id]).filter(it => it && (showAllStoreys || it.parentId === storeyId || it.type === 'Storey') && !hiddenIn2D(it));

    for (const it of targets) {
      if (it.type === 'Room' || it.type === 'Slab' || it.type === 'Roof') {
        for (const p of (it as any).geom.polygon) {
          if (Number.isFinite(p[0]) && Number.isFinite(p[1])) all.push(p);
        }
      } else if (it.type === 'Wall') {
        const g = (it as any).geom;
        if (Number.isFinite(g.x1) && Number.isFinite(g.y1)) all.push([g.x1, g.y1]);
        if (Number.isFinite(g.x2) && Number.isFinite(g.y2)) all.push([g.x2, g.y2]);
      } else if (it.type === 'Stair') {
        all.push(...buildStair(it.geom,it.parentId,items).parts.flatMap(p=>p.polygon));
      } else if (it.type === 'Furniture') {
        const g = (it as any).geom;
        all.push([Math.min(g.x, g.x + g.w), Math.min(g.y, g.y + g.d)], [Math.max(g.x, g.x + g.w), Math.max(g.y, g.y + g.d)]);
      } else if (it.type === 'Technical') {
        const g = (it as any).geom;
        all.push([g.x, g.y]);
      } else if (it.type === 'Column' || it.type === 'Chimney') {
        all.push(...structuralOutlines(it).flat());
      } else if (it.type === 'GenericElement') {
        const g = (it as any).geom;
        all.push([Math.min(g.x, g.x + g.w), Math.min(g.y, g.y + g.d)], [Math.max(g.x, g.x + g.w), Math.max(g.y, g.y + g.d)]);
      } else if (it.type === 'Dimension' || it.type === 'Section') {
        const g = (it as any).geom;
        all.push([g.x1, g.y1], [g.x2, g.y2]);
      }
    }

    // Always include plan image bounds when fitting to the whole storey
    // (no selection, or only the storey node itself selected)
    if (fitToStorey) {
      const storey = items[storeyId] as any;
      const plan = storey?.geom?.plan;
      if (plan?.url && Number.isFinite(plan.x) && Number.isFinite(plan.y) && plan.w && plan.scale) {
        const imgW = plan.w * plan.scale;
        const imgH = plan.h * plan.scale;
        all.push([plan.x, plan.y], [plan.x + imgW, plan.y], [plan.x, plan.y + imgH], [plan.x + imgW, plan.y + imgH]);
      }
    }

    if (!all.length) {
      if (targets.length === 0) setView({ scale: 36, ox: 80, oy: 80 });
      return;
    }
    const bb = bbox(all);
    const wW = bb.maxX - bb.minX, wH = bb.maxY - bb.minY;
    const pad = 100;
    const sc = Math.max(10, Math.min(120, Math.min((size.w - pad * 2) / Math.max(wW, 0.1), (size.h - pad * 2) / Math.max(wH, 0.1))));
    let nextOx = (size.w - wW * sc) / 2 - bb.minX * sc;
    let nextOy = (size.h - wH * sc) / 2 + bb.maxY * sc;
    if (!Number.isFinite(nextOx)) nextOx = 80;
    if (!Number.isFinite(nextOy)) nextOy = 80;
    setView({ scale: Number.isFinite(sc) ? sc : 36, ox: nextOx, oy: nextOy });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  };
  useEffect(fitView, [storeyId, fitCount, size.w, size.h, showAllStoreys]);

  // ══════════════════════════════════════════════════════════════════════════
  //  IFC Relationship computation
  // ══════════════════════════════════════════════════════════════════════════

  // 1. Wall junctions: pairs of wall endpoints within 20 cm
  const junctions = useMemo(() => {
    const THRESH = 0.20;
    const result: Array<{ pt: [number, number]; ids: string[] }> = [];
    for (let i = 0; i < walls.length; i++) {
      const a = (walls[i] as any).geom;
      const epsA: [number, number][] = [[a.x1, a.y1], [a.x2, a.y2]];
      for (let j = i + 1; j < walls.length; j++) {
        const b = (walls[j] as any).geom;
        const epsB: [number, number][] = [[b.x1, b.y1], [b.x2, b.y2]];
        for (const [px, py] of epsA) {
          for (const [qx, qy] of epsB) {
            if (Math.hypot(px - qx, py - qy) < THRESH) {
              // avoid duplicates
              const already = result.find((r) => Math.hypot(r.pt[0] - (px + qx) / 2, r.pt[1] - (py + qy) / 2) < THRESH);
              if (already) { if (!already.ids.includes(walls[j].id)) already.ids.push(walls[j].id); }
              else result.push({ pt: [(px + qx) / 2, (py + qy) / 2], ids: [walls[i].id, walls[j].id] });
            }
          }
        }
      }
    }
    return result;
  }, [walls]);

  // 2. Room ↔ Wall spatial boundaries (IfcRelSpaceBoundary equivalent)
  //    A room edge is "bounded by" a wall if the edge lies along the wall centerline within tolerance
  const { roomToWalls, wallToRooms } = useMemo(() => {
    const THRESH = 0.35; // 35 cm tolerance
    const r2w = new Map<string, Set<string>>();
    const w2r = new Map<string, Set<string>>();
    for (const room of rooms) {
      const poly = (room as any).geom.polygon as [number, number][];
      const wallSet = new Set<string>();
      for (const wall of walls) {
        const g = (wall as any).geom;
        // Check every room edge against this wall
        let matched = false;
        for (let i = 0; i < poly.length && !matched; i++) {
          const [ax, ay] = poly[i];
          const [bx, by] = poly[(i + 1) % poly.length];
          const edgeLen = Math.hypot(bx - ax, by - ay);
          if (edgeLen < 0.3) continue;
          // Both endpoints of edge must be close to wall centerline
          const da = distPointToSegment(ax, ay, g.x1, g.y1, g.x2, g.y2);
          const db = distPointToSegment(bx, by, g.x1, g.y1, g.x2, g.y2);
          // Also verify edge midpoint is within wall extents (avoid matching through extensions)
          const mx = (ax + bx) / 2, my = (ay + by) / 2;
          const dm = distPointToSegment(mx, my, g.x1, g.y1, g.x2, g.y2);
          if (da < THRESH && db < THRESH && dm < THRESH) {
            matched = true;
            wallSet.add(wall.id);
          }
        }
      }
      r2w.set(room.id, wallSet);
      for (const wid of wallSet) {
        if (!w2r.has(wid)) w2r.set(wid, new Set());
        w2r.get(wid)!.add(room.id);
      }
    }
    return { roomToWalls: r2w, wallToRooms: w2r };
  }, [rooms, walls]);

  // 3. Wall → its hosted openings
  const wallOpenings = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const o of [...doors, ...windowsArr]) {
      const wid = (o as any).geom?.wallId;
      if (!wid) continue;
      if (!map.has(wid)) map.set(wid, []);
      map.get(wid)!.push(o.id);
    }
    return map;
  }, [doors, windowsArr]);

  // 4. IDs that are "related" to the current selection (highlighted but not selected)
  const relatedIds = useMemo(() => {
    const set = new Set<string>();
    for (const id of selection) {
      const it = items[id];
      if (!it) continue;
      if (it.type === 'Door' || it.type === 'Window') {
        const wid = (it as any).geom?.wallId;
        if (wid) set.add(wid);
      }
      if (it.type === 'Wall') {
        for (const oid of wallOpenings.get(id) ?? []) set.add(oid);
        for (const rid of wallToRooms.get(id) ?? []) set.add(rid);
      }
      if (it.type === 'Room') {
        for (const wid of roomToWalls.get(id) ?? []) set.add(wid);
      }
    }
    for (const id of selection) set.delete(id);
    for (const id of relHoverIds) set.add(id);
    return set;
  }, [selection, items, wallOpenings, wallToRooms, roomToWalls, relHoverIds]);

  // 5. Snap targets: wall endpoints + room/slab polygon vertices
  const snapTargets = useMemo(() => {
    const pts: [number, number][] = [];
    for (const w of walls) {
      const g = (w as any).geom;
      pts.push([g.x1, g.y1], [g.x2, g.y2]);
    }
    for (const it of Object.values(items)) {
      if (it.type === 'Room' || it.type === 'Slab' || it.type === 'Roof') {
        const poly = (it as any).geom?.polygon as [number, number][] | undefined;
        if (poly) for (const pt of poly) pts.push(pt);
      }
    }
    return pts;
  }, [walls, items]);

  // ── Snapping to a vector background plan (model snapping keeps priority) ──
  const bgPlan = (items[storeyId] as IfcStoreyEntity | undefined)?.geom?.plan;
  const bgVector = bgPlan?.kind === 'vector' && bgPlan.snap !== false && showBgImage ? bgPlan.vector : undefined;
  const vectorSnapIndex = useMemo(() => bgVector ? buildVectorSnapIndex(bgVector) : null, [bgVector]);
  const [planSnapMark, setPlanSnapMark] = useState<{ x: number; y: number; kind: VectorSnapKind } | null>(null);

  /** Nearest snap target on the visible layers of the vector plan, within 10 screen pixels of the raw cursor. */
  function snapToPlan(wx: number, wy: number): [number, number] | null {
    if (!vectorSnapIndex || !bgPlan) { if (planSnapMark) setPlanSnapMark(null); return null; }
    const data = vectorSnapIndex.data;
    const [lx, ly] = worldToVector(bgPlan, data, wx, wy);
    const hit = snapToVector(vectorSnapIndex, lx, ly, (10 / view.scale) / vectorMetresPerUnit(bgPlan, data));
    if (!hit) { if (planSnapMark) setPlanSnapMark(null); return null; }
    const [x, y] = vectorToWorld(bgPlan, data, hit.x, hit.y);
    setPlanSnapMark({ x, y, kind: hit.kind });
    return [x, y];
  }

  function snapToEndpoints(wx: number, wy: number, radius = 0.30): [number, number] | null {
    if (!snapEnabled) return null;
    for (const [ex, ey] of snapTargets) {
      if (Math.hypot(wx - ex, wy - ey) < radius) return [ex, ey];
    }
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Handle & hit testing
  // ══════════════════════════════════════════════════════════════════════════
  const stairHandles = useMemo(() => selection.flatMap(id => {
    const item=items[id];
    if(item?.type!=='Stair'||item.parentId!==storeyId||hiddenTypes?.has('Stair')) return [];
    return stairFlightHandles(item.geom,item.parentId,items).map(handle=>({...handle,id}));
  }),[selection,items,storeyId,hiddenTypes]);

  useEffect(()=>{
    if(drag?.kind!=='stair-flight') return;
    const finish=()=>setDrag(null);
    window.addEventListener('mouseup',finish);
    window.addEventListener('blur',finish);
    return ()=>{window.removeEventListener('mouseup',finish);window.removeEventListener('blur',finish);};
  },[drag?.kind]);

  const handleR = useCallback(() => 10 / view.scale, [view.scale]);

  function checkHandles(wx: number, wy: number): HoverState | null {
    const hr = handleR();
    for(const handle of stairHandles) {
      if(Math.hypot(wx-handle.end[0],wy-handle.end[1])<=hr) return {type:'Stair',id:handle.id,sub:'stair-flight',idx:handle.index};
    }
    for (const id of selection) {
      const it = items[id];
      if (!it) continue;
      if (it.type === 'Wall') {
        const g = (it as any).geom;
        if (Math.hypot(wx - g.x1, wy - g.y1) <= hr) return { type: 'Wall', id, sub: 'wall-handle-A' };
        if (Math.hypot(wx - g.x2, wy - g.y2) <= hr) return { type: 'Wall', id, sub: 'wall-handle-B' };
      }
      if (it.type === 'Room' || it.type === 'Slab' || it.type === 'Roof') {
        const poly = (it as any).geom.polygon as [number, number][];
        for (let i = 0; i < poly.length; i++) {
          if (Math.hypot(wx - poly[i][0], wy - poly[i][1]) <= hr)
            return { type: it.type, id, sub: 'room-vertex', idx: i };
        }
      }
      if (it.type === 'Stair' || it.type === 'Furniture' || it.type === 'Technical' || it.type === 'Column' || it.type === 'Chimney') {
        const isFur = it.type === 'Furniture';
        const isStructural = it.type === 'Column' || it.type === 'Chimney';
        const { x, y, rotation } = (it as any).geom;
        const fw = isFur ? ((it as any).geom.w ?? 0.6) : 0.4;
        const fd = isFur ? ((it as any).geom.d ?? 0.6) : 0.4;
        const cx = isFur ? (x + fw / 2) : x;
        const cy = isFur ? (y + fd / 2) : y;
        const handleDist = (it.type === 'Stair' ? it.geom.width / 2 : isFur ? fd / 2 : isStructural ? Math.max(it.geom.w, it.geom.d) / 2 : 0.2) + 0.35;
        const hwx = cx + Math.sin(rotation) * handleDist;
        const hwy = cy - Math.cos(rotation) * handleDist;
        if (Math.hypot(wx - hwx, wy - hwy) <= hr * 1.5) {
          return { type: it.type as any, id, sub: 'furniture-rotate' };
        }
      }
    }
    return null;
  }

  function hitTest(wx: number, wy: number): HoverState | null {
    for(const it of Object.values(items)) {
      if(it.type!=='Stair'||it.parentId!==storeyId||hiddenTypes?.has('Stair')) continue;
      if(buildStair(it.geom,it.parentId,items).parts.some(p=>p.kind!=='rail' && pointInPoly([wx,wy],p.polygon))) return {type:'Stair',id:it.id};
    }
    if (tool === 'select') {
      const h = checkHandles(wx, wy);
      if (h) return h;
    }
    // 1. Windows (highest priority as they are inside walls)
    for (const wn of windowsArr) {
      const wallId = (wn as any).geom?.wallId;
      const w = wallsById[wallId];
      if (!w) { console.warn('[DBG] Window', wn.id, 'wallId', wallId, 'NOT found in wallsById. Keys:', Object.keys(wallsById).slice(0,3)); continue; }
      const [px, py] = wallPointAtT((w as any).geom, (wn as any).geom.t);
      const ang = wallAngle((w as any).geom);
      const lx = (wx - px) * Math.cos(-ang) - (wy - py) * Math.sin(-ang);
      const ly = (wx - px) * Math.sin(-ang) + (wy - py) * Math.cos(-ang);
      const thickness = (w as any).geom.thickness ?? 0.20;
      const tolerance = Math.max(thickness / 2 + 0.18, 0.40);
      if (Math.abs(lx) <= (wn as any).geom.width / 2 + 0.10 && Math.abs(ly) <= tolerance) return { type: 'Window', id: wn.id };
    }
    // 2. Doors
    for (const d of doors) {
      const wallId = (d as any).geom?.wallId;
      const w = wallsById[wallId];
      if (!w) { console.warn('[DBG] Door', d.id, 'wallId', wallId, 'NOT found in wallsById. Keys:', Object.keys(wallsById).slice(0,3)); continue; }
      const [px, py] = wallPointAtT((w as any).geom, (d as any).geom.t);
      const ang = wallAngle((w as any).geom);
      const lx = (wx - px) * Math.cos(-ang) - (wy - py) * Math.sin(-ang);
      const ly = (wx - px) * Math.sin(-ang) + (wy - py) * Math.cos(-ang);
      const thickness = (w as any).geom.thickness ?? 0.20;
      const tolerance = Math.max(thickness / 2 + 0.18, 0.40);
      if (Math.abs(lx) <= (d as any).geom.width / 2 + 0.10 && Math.abs(ly) <= tolerance) return { type: 'Door', id: d.id };
    }
    // 3. Furniture
    for (let i = furniture.length - 1; i >= 0; i--) {
      const f = furniture[i];
      const { x, y, w: fw, d: fd, rotation } = (f as any).geom;
      const cx = x + fw / 2, cy = y + fd / 2;
      const dx = wx - cx, dy = wy - cy;
      const ca = Math.cos(-rotation), sa = Math.sin(-rotation);
      if (Math.abs(dx * ca - dy * sa) <= fw / 2 && Math.abs(dx * sa + dy * ca) <= fd / 2)
        return { type: 'Furniture', id: f.id };
    }
    // 2b. Columns and chimneys
    for (let i = structural.length - 1; i >= 0; i--) {
      if (structuralOutlines(structural[i]).some(poly => pointInPolygon([wx, wy], poly)))
        return { type: structural[i].type, id: structural[i].id };
    }
    // 3a. Technical elements
    for (let i = technical.length - 1; i >= 0; i--) {
      const tEl = technical[i];
      const { x, y } = (tEl as any).geom;
      if (Math.hypot(wx - x, wy - y) <= 0.25)
        return { type: 'Technical', id: tEl.id };
    }
    // 3b. Generic elements
    for (let i = genericElements.length - 1; i >= 0; i--) {
      const ge = genericElements[i];
      const g = (ge as any).geom;
      const minX = Math.min(g.x, g.x + g.w), maxX = Math.max(g.x, g.x + g.w);
      const minY = Math.min(g.y, g.y + g.d), maxY = Math.max(g.y, g.y + g.d);
      if (wx >= minX && wx <= maxX && wy >= minY && wy <= maxY)
        return { type: 'GenericElement', id: ge.id };
    }
    // 3c. Markers
    for (const it of Object.values(items).filter(i => i.type === 'Marker' && i.parentId === storeyId)) {
      const g = (it as any).geom;
      if (Math.hypot(wx - g.x, wy - g.y) <= 0.3)
        return { type: 'Marker', id: it.id };
    }
    // 3d. Dimensions (cotes): a thin segment, so test distance to the line with a screen-pixel tolerance
    const dimTol = 10 / view.scale;
    for (const it of Object.values(items).filter(i => i.type === 'Dimension' && i.parentId === storeyId && !hiddenTypes?.has('Dimension'))) {
      const g = (it as any).geom;
      const dxd = g.x2 - g.x1, dyd = g.y2 - g.y1;
      const len2d = dxd * dxd + dyd * dyd;
      const td = len2d > 0 ? Math.max(0, Math.min(1, ((wx - g.x1) * dxd + (wy - g.y1) * dyd) / len2d)) : 0;
      if (Math.hypot(wx - (g.x1 + td * dxd), wy - (g.y1 + td * dyd)) <= dimTol)
        return { type: 'Dimension', id: it.id };
      // Its value label too (drawn just beside the middle of the line), which sits over a room.
      if (Math.hypot(wx - (g.x1 + g.x2) / 2, wy - (g.y1 + g.y2) / 2) <= 22 / view.scale)
        return { type: 'Dimension', id: it.id };
    }
    // 4. Walls
    for (const w of walls) {
      const { x1, y1, x2, y2, thickness } = (w as any).geom;
      const dxw = x2 - x1, dyw = y2 - y1;
      const len2 = dxw * dxw + dyw * dyw;
      let tt = ((wx - x1) * dxw + (wy - y1) * dyw) / len2;
      tt = Math.max(0, Math.min(1, tt));
      if (Math.hypot(wx - (x1 + tt * dxw), wy - (y1 + tt * dyw)) <= thickness / 2 + 0.05)
        return { type: 'Wall', id: w.id };
    }
    // 5. Rooms
    for (const r of rooms) {
      if (pointInPoly([wx, wy], (r as any).geom.polygon)) return { type: 'Room', id: r.id };
    }
    // 6. Slabs (last priority as they are background)
    for (const s of Object.values(items).filter(i => i.type === 'Slab' && i.parentId === storeyId && !hiddenTypes?.has('Slab'))) {
      if (pointInPoly([wx, wy], (s as any).geom.polygon)) return { type: 'Slab', id: s.id };
    }
    // 7. Roofs (lowest priority: they cover the whole footprint)
    for (const r of Object.values(items).filter(i => i.type === 'Roof' && i.parentId === storeyId && !hiddenTypes?.has('Roof'))) {
      const solid = buildRoof((r as any).geom);
      const outline = solid ? solid.outline.pts : (r as any).geom.polygon;
      if (pointInPoly([wx, wy], outline)) return { type: 'Roof', id: r.id };
    }
    return null;
  }

  function closestWall(wx: number, wy: number) {
    let best: { wall: IfcEntity; t: number; px: number; py: number; d: number } | null = null;
    let bestD = Infinity;
    for (const w of walls) {
      const { x1, y1, x2, y2 } = (w as any).geom;
      const dxw = x2 - x1, dyw = y2 - y1;
      const len2 = dxw * dxw + dyw * dyw;
      let tt = ((wx - x1) * dxw + (wy - y1) * dyw) / len2;
      tt = Math.max(0, Math.min(1, tt));
      const px = x1 + tt * dxw, py = y1 + tt * dyw;
      const dist = Math.hypot(wx - px, wy - py);
      if (dist < bestD) { bestD = dist; best = { wall: w, t: tt, px, py, d: dist }; }
    }
    return best;
  }

  function snapshotItems(src: ItemsMap): ItemsMap {
    const s: ItemsMap = {};
    for (const id of Object.keys(src)) s[id] = JSON.parse(JSON.stringify(src[id]));
    return s;
  }

  function hostedOpeningPatch(opening: IfcEntity, wallGeom: any) {
    const g = (opening as any).geom;
    const t = Math.max(0.05, Math.min(0.95, Number(g.t ?? 0.5)));
    const point: [number, number] = [
      wallGeom.x1 + t * (wallGeom.x2 - wallGeom.x1),
      wallGeom.y1 + t * (wallGeom.y2 - wallGeom.y1),
    ];
    return { geom: { ...g, t, _placementWorld: point, _edited: true } } as any;
  }

  function updateHostedOpenings(wallId: string, wallGeom: any, source: ItemsMap = items, skip = new Set<string>()) {
    for (const opening of Object.values(source)) {
      if ((opening.type !== 'Door' && opening.type !== 'Window') || skip.has(opening.id)) continue;
      if ((opening as any).geom?.wallId !== wallId) continue;
      updateItem(opening.id, hostedOpeningPatch(opening, wallGeom));
    }
  }

  function updateContainedFurniture(room: IfcEntity, dx: number, dy: number, source: ItemsMap = items, skip = new Set<string>()) {
    if (room.type !== 'Room') return;
    const poly = (room as any).geom?.polygon;
    if (!Array.isArray(poly)) return;
    for (const child of Object.values(source)) {
      if ((child.type !== 'Furniture' && child.type !== 'GenericElement') || skip.has(child.id)) continue;
      const g = (child as any).geom;
      if (!g || typeof g.x !== 'number' || typeof g.y !== 'number') continue;
      const cx = g.x + (g.w ?? 0) / 2;
      const cy = g.y + (g.d ?? 0) / 2;
      if (!pointInPoly([cx, cy], poly)) continue;
      const placementWorld = Array.isArray(g._placementWorld)
        ? { _placementWorld: [g._placementWorld[0] + dx, g._placementWorld[1] + dy] }
        : {};
      updateItem(child.id, { geom: { ...g, x: g.x + dx, y: g.y + dy, ...placementWorld, _edited: true } } as any);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Mouse handlers
  // ══════════════════════════════════════════════════════════════════════════
  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const [wx, wy] = s2w(sx, sy);

    if (tool === 'alignPlan' && e.button === 0) {
      const st = items[storeyId] as IfcStoreyEntity;
      if (!st?.geom?.plan) { setTool('select'); return; }
      if (!alignFrom) {
        setAlignFrom(snapToPlan(wx, wy) ?? [wx, wy]);
      } else {
        const tol = 10 / view.scale;
        let to: [number, number] = [wx, wy], best = tol;
        for (const p of alignRefPoints) {
          const d = Math.hypot(p[0] - wx, p[1] - wy);
          if (d <= best) { best = d; to = p; }
        }
        updateItem(storeyId, { geom: { ...st.geom, plan: alignBackgroundPlan(st.geom.plan, alignFrom, to) } });
        setAlignFrom(null);
        setTool('select');
      }
      return;
    }

    if (tool === 'calibrate' && e.button === 0) {
      const newPoints = [...calibPoints, [wx, wy]];
      if (newPoints.length <= 2) {
        setIsCalibrating(true);
      }
      setCalibPoints(newPoints as [number, number][]);
      return;
    }

    if (e.button === 1 || e.button === 2 || (e.button === 0 && (e.altKey || e.metaKey))) {
      setDrag({ kind: 'pan', startX: e.clientX, startY: e.clientY, ox0: view.ox, oy0: view.oy, hasMoved: false });
      lastPanMovedRef.current = false;
      return;
    }
    if (e.button !== 0) return;

    if (tool === 'select') {
      const handleHit = checkHandles(wx, wy);
      if (handleHit?.sub === 'wall-handle-A' || handleHit?.sub === 'wall-handle-B') {
        const it = items[handleHit.id] as any;
        const handle = handleHit.sub === 'wall-handle-A' ? 'A' : 'B';
        setDrag({
          kind: 'wall-handle', wallId: handleHit.id, handle,
          ox1: it.geom.x1, oy1: it.geom.y1, ox2: it.geom.x2, oy2: it.geom.y2,
          connected: connectedWallEndpoints(items, handleHit.id, handle === 'A' ? 'start' : 'end'),
        });
        return;
      }
      if(handleHit?.sub==='stair-flight') {
        const handle=stairHandles.find(h=>h.id===handleHit.id&&h.index===handleHit.idx);
        const item=items[handleHit.id];
        if(handle && item?.type==='Stair') setDrag({kind:'stair-flight',id:handle.id,index:handle.index,start:handle.start,direction:handle.direction,lengths:stairFlightDimensions(item.geom,stairBaseCount(item.geom,buildStair(item.geom,item.parentId,items).height)).map(f=>f.length),offset:(wx-handle.end[0])*handle.direction[0]+(wy-handle.end[1])*handle.direction[1]});
        return;
      }
      if (handleHit?.sub === 'room-vertex'  && handleHit.idx !== undefined) {
        const it = items[handleHit.id] as any;
        setDrag({ kind: 'room-vertex', roomId: handleHit.id, idx: handleHit.idx, origPoly: JSON.parse(JSON.stringify(it.geom.polygon)) });
        return;
      }
      if (handleHit?.sub === 'furniture-rotate') {
        const it = items[handleHit.id] as any;
        setDrag({
          kind: 'furniture-rotate',
          id: handleHit.id,
          centerX: it.geom.x + (it.type === 'Furniture' ? it.geom.w / 2 : 0),
          centerY: it.geom.y + (it.type === 'Furniture' ? it.geom.d / 2 : 0)
        });
        return;
      }
      const hit = hitTest(wx, wy);
      if (hit && !hit.sub) {
        const exists = selection.includes(hit.id);
        const ids = e.shiftKey || e.metaKey
          ? (exists ? selection.filter((id) => id !== hit.id) : [...selection, hit.id])
          : (exists ? selection : [hit.id]);
        setSelection(ids);
        setDrag({ kind: 'move', startX: wx, startY: wy, ids: e.shiftKey || e.metaKey ? ids : (exists ? selection : [hit.id]), originals: snapshotItems(items) });
      } else if (!hit) {
        if (!e.shiftKey) setSelection([]);
        setDrag({ kind: 'marquee', startX: sx, startY: sy });
      }
    } else if (tool === 'Wall') {
      if (!drag || drag.kind !== 'draw-wall') {
        const snapped = snapToEndpoints(snap(wx), snap(wy)) ?? snapToPlan(wx, wy);
        const x1 = snapped?.[0] ?? snap(wx), y1 = snapped?.[1] ?? snap(wy);
        setDrag({ kind: 'draw-wall', x1, y1, x2: x1, y2: y1, snapEnd: false, isDrawing: false } as any);
      }
    } else if (tool === 'Door' || tool === 'Window') {
      const cw = closestWall(wx, wy);
      if (cw && cw.d < 0.6) {
        const id = (tool === 'Door' ? 'd_' : 'wn_') + Date.now();
        if (tool === 'Door') {
          const def = activeElementDef?.type === 'Door' ? activeElementDef : null;
          const dWidth  = def?.defaults.width   ?? 0.90;
          const dHeight = def?.defaults.height  ?? 2.10;
          const dSwing  = (def?.defaults.swing  ?? 'left') as 'left' | 'right';
          const dOpType = def?.defaults.OperationType ?? 'SINGLE_SWING_LEFT';
          const dLabel  = def ? catalogueLabel(def, lang) : defaultName('newDoor', lang);
          addItem({
            id, type: 'Door', ifcType: 'IfcDoor', name: dLabel, Name: dLabel,
            GlobalId: guid(id), parentId: storeyId,
            PredefinedType: 'DOOR', OperationType: dOpType as any,
            OverallWidth: dWidth, OverallHeight: dHeight, FireRating: 'EI 30', Material: 'Bois — chêne',
            geom: { wallId: cw.wall.id, t: cw.t, width: dWidth, height: dHeight, swing: dSwing, side: 1, ...(def ? { catalogueId: def.id } : {}) },
            material: 'Bois — chêne', fireRating: 'EI 30',
          });
        } else {
          const def = activeElementDef?.type === 'Window' ? activeElementDef : null;
          const wWidth   = def?.defaults.width       ?? 1.20;
          const wHeight  = def?.defaults.height      ?? 1.20;
          const wSill    = def?.defaults.sillHeight  ?? 0.90;
          let wOpType  = def?.defaults.OperationType ?? 'DOUBLE_PANEL';
          if (wOpType === 'FIXED') wOpType = 'FIXEDCASEMENT';
          if (wOpType === 'DOUBLE_PANEL') wOpType = 'DOUBLE_PANEL_VERTICAL';
          if (wOpType === 'SLIDING') wOpType = 'SLIDINGHORIZONTAL';
          if (wOpType === 'TILT_AND_TURN') wOpType = 'TILTANDTURNLEFT';
          const wIsBay   = def?.defaults.isBayWindow  ?? false;
          const wLabel   = def ? catalogueLabel(def, lang) : defaultName('newWindow', lang);
          addItem({
            id, type: 'Window', ifcType: 'IfcWindow', name: wLabel, Name: wLabel,
            GlobalId: guid(id), parentId: storeyId,
            PredefinedType: 'WINDOW', OverallWidth: wWidth, OverallHeight: wHeight,
            ThermalTransmittance: 1.4, Material: 'Aluminium',
            OperationType: wOpType,
            ...(wIsBay ? { isBayWindow: true } : {}),
            geom: { wallId: cw.wall.id, t: cw.t, width: wWidth, height: wHeight, sillHeight: wSill, ...(def ? { catalogueId: def.id } : {}) },
            material: 'Aluminium', uValue: 1.4,
          } as any);
        }
        setSelection([id]);
        setTool('select');
      }
    } else if (tool === 'Stair') {
      const id = 'st_' + Date.now();
      const elevation = Number((items[storeyId] as any)?.geom?.elevation ?? 0);
      const target = Object.values(items).filter(i => i.type === 'Storey' && i.geom.elevation > elevation).sort((a:any,b:any)=>a.geom.elevation-b.geom.elevation)[0];
      addItem({ id, GlobalId: guid(id), type: 'Stair', ifcType: 'IfcStair', name: defaultName('stair', lang), Name: defaultName('stair', lang), parentId: storeyId, geom: { ...STAIR_DEFAULTS, form: stairForm, landing: stairLanding, x: snap(wx), y: snap(wy), targetId: target?.id ?? '' } });
      setSelection([id]); setTool('select');
    } else if (tool === 'Room' || tool === 'Slab' || tool === 'Roof') {
      if (!drag || (drag.kind !== 'draw-room-poly' && drag.kind !== 'draw-slab' && drag.kind !== 'draw-roof')) {
        const first = (snapEnabled ? snapToEndpoints(snap(wx), snap(wy)) : null) ?? snapToPlan(wx, wy);
        const x0 = first?.[0] ?? snap(wx), y0 = first?.[1] ?? snap(wy);
        setDrag({ kind: tool === 'Room' ? 'draw-room-poly' : tool === 'Roof' ? 'draw-roof' : 'draw-slab', points: [[x0, y0]], cursor: [x0, y0] } as any);
      } else {
        // Continuous clicking handled in onMouseUp to avoid double-processing
      }
    } else if (tool === 'Furniture') {
      const x0 = snap(wx), y0 = snap(wy);
      setDrag({ kind: 'draw-fur', x1: x0, y1: y0, x2: x0, y2: y0 });
    } else if (tool === 'Measure') {
      setDrag({ kind: 'measure', x1: wx, y1: wy, x2: wx, y2: wy });
    } else if (tool === 'Dimension' || tool === 'Section') {
      const x0 = snap(wx), y0 = snap(wy);
      setDrag({ kind: 'draw-dim', x1: x0, y1: y0, x2: x0, y2: y0 });
    } else if (tool === 'Marker') {
      const id = 'm_' + Math.random().toString(36).substr(2, 6);
      addItem({
        id, type: 'Marker', ifcType: 'IfcAnnotation', name: defaultName('newMarker', lang), Name: defaultName('newMarker', lang),
        GlobalId: guid(id), parentId: storeyId,
        geom: { x: snap(wx), y: snap(wy) }
      } as any);
      setSelection([id]);
      setTool('select');
    } else if (tool === 'Column' || tool === 'Chimney') {
      const id = (tool === 'Column' ? 'col_' : 'chm_') + Math.random().toString(36).substr(2, 6);
      const label = defaultName(tool === 'Column' ? 'column' : 'chimney', lang);
      const at = { x: snap(wx), y: snap(wy) }, height = storeyHeight(items, storeyId);
      addItem({
        id, type: tool, ifcType: tool === 'Column' ? 'IfcColumn' : 'IfcChimney', name: label, Name: label,
        GlobalId: guid(id), parentId: storeyId,
        // A chimney under a roof rises 0.50 m above it.
        ...(tool === 'Column' ? { geom: columnGeom(at, undefined, height) }
          : chimneyGeom({ ...at, height: Math.max(height, chimneyHeightThroughRoof(items, storeyId, at.x, at.y) ?? 0) }, undefined, height)),
      } as any);
      setSelection([id]);
      setTool('select');
    } else if (tool === 'Technical') {
      const x0 = snap(wx), y0 = snap(wy);
      const elDef = TECHNICAL_CATALOGUE.find(el => el.id === selectedElementId) || TECHNICAL_CATALOGUE[0];
      const id = 'tech_' + Math.random().toString(36).substr(2, 6);
      const label = catalogueLabel(elDef, lang);
      addItem({
        id,
        type: 'Technical',
        ifcType: elDef.ifcType ?? 'IfcDistributionElement',
        name: label,
        Name: label,
        GlobalId: guid(id),
        parentId: storeyId,
        geom: {
          x: x0,
          y: y0,
          rotation: 0,
          mountHeight: elDef.defaults.mountHeight ?? 0.30,
        },
        discipline: elDef.discipline,
        model: elDef.id,
        category: elDef.category,
        diameter: elDef.defaults.diameter,
        fluidType: elDef.defaults.fluidType,
      } as any);
      setSelection([id]);
      setTool('select');
    }
  };

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const [wx, wy] = s2w(sx, sy);
    setCursorWorld([wx, wy]);

    if (!drag) {
      setHover(tool === 'select' ? hitTest(wx, wy) : null);
      // Show where the first click will snap on the vector plan.
      if (tool === 'alignPlan' && !alignFrom) snapToPlan(wx, wy);
      else if (tool === 'Wall' || tool === 'Room' || tool === 'Slab' || tool === 'Roof') {
        if (!(snapEnabled && snapToEndpoints(snap(wx), snap(wy)))) snapToPlan(wx, wy);
        else if (planSnapMark) setPlanSnapMark(null);
      }
      return;
    }
    if (drag.kind === 'pan') {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        if (!drag.hasMoved) setDrag({ ...drag, hasMoved: true });
        lastPanMovedRef.current = true;
      }
      setView((v) => ({ ...v, ox: drag.ox0 + dx, oy: drag.oy0 + dy }));
    } else if (drag.kind === 'marquee') {
      setMarquee({ x1: drag.startX, y1: drag.startY, x2: sx, y2: sy });
    } else if (drag.kind === 'wall-handle') {
      const snapped = snapToEndpoints(snap(wx), snap(wy)) ?? snapToPlan(wx, wy) ?? [snap(wx), snap(wy)] as [number,number];
      const [nx, ny] = snapped;
      const it = items[drag.wallId] as any;
      const geomBase = {
        thickness: Number.isFinite(it.geom.thickness) && it.geom.thickness > 0 ? it.geom.thickness : 0.2,
        height: Number.isFinite(it.geom.height) && it.geom.height > 0 ? it.geom.height : 2.7,
      };
      const nextGeom = drag.handle === 'A'
        ? { ...geomBase, x1: nx, y1: ny, x2: drag.ox2, y2: drag.oy2, _edited: true }
        : { ...geomBase, x1: drag.ox1, y1: drag.oy1, x2: nx, y2: ny, _edited: true };
      updateItem(drag.wallId, { geom: nextGeom } as any);
      updateHostedOpenings(drag.wallId, nextGeom);
      for (const endpoint of drag.connected) {
        if (endpoint.wallId === drag.wallId) continue;
        const connectedWall = items[endpoint.wallId] as any;
        if (!connectedWall?.geom) continue;
        const connectedGeom = { ...wallGeomWithEndpoint(connectedWall.geom, endpoint.end, [nx, ny]), _edited: true };
        updateItem(endpoint.wallId, { geom: connectedGeom } as any);
        updateHostedOpenings(endpoint.wallId, connectedGeom);
      }
    } else if (drag.kind === 'room-vertex') {
      const newPoly = drag.origPoly.map((pt, i): [number, number] => i === drag.idx ? [snap(wx), snap(wy)] : pt);
      updateItem(drag.roomId, { geom: { ...(items[drag.roomId] as any).geom, polygon: newPoly, _edited: true, _shapeEdited: true } } as any);
    } else if(drag.kind==='stair-flight') {
      const item=items[drag.id];
      if(item?.type==='Stair') {
        const minimum=.01;
        const length=Math.max(minimum,snap(stairFlightLengthAt(drag.start,drag.direction,[wx,wy],drag.offset,minimum)));
        updateItem(item.id,{geom:{...item.geom,flightLengths:drag.lengths.map((v,i)=>i===drag.index?length:v),count:undefined,_edited:true}} as any);
      }
    } else if (drag.kind === 'furniture-rotate') {
      const { id, centerX, centerY } = drag;
      let angle = Math.atan2(wx - centerX, -(wy - centerY));
      if (e.shiftKey) {
        const snapRad = 15 * Math.PI / 180;
        angle = Math.round(angle / snapRad) * snapRad;
      }
      updateItem(id, { geom: { ...(items[id] as any).geom, rotation: angle, _edited: true } } as any);
    } else if (drag.kind === 'move') {
      const dx = wx - drag.startX, dy = wy - drag.startY;
      const sdx = snap(dx), sdy = snap(dy);
      const selectedIds = new Set(drag.ids);
      const movedWallIds = new Set(drag.ids.filter((id) => drag.originals[id]?.type === 'Wall'));
      for (const id of drag.ids) {
        const it = drag.originals[id]; if (!it) continue;
        if (it.type === 'Wall') {
          const g = (it as any).geom;
          const nextGeom = { ...g, x1: g.x1 + sdx, y1: g.y1 + sdy, x2: g.x2 + sdx, y2: g.y2 + sdy, _edited: true };
          updateItem(id, { geom: nextGeom } as any);
          updateHostedOpenings(id, nextGeom, drag.originals, selectedIds);
        } else if (it.type === 'Stair' || it.type === 'Furniture' || it.type === 'GenericElement' || it.type === 'Technical' || it.type === 'Column' || it.type === 'Chimney') {
          const g = (it as any).geom;
          const placementWorld = (it.type === 'Furniture' || it.type === 'GenericElement') && Array.isArray(g._placementWorld)
            ? { _placementWorld: [g._placementWorld[0] + sdx, g._placementWorld[1] + sdy] }
            : {};
          updateItem(id, { geom: { ...g, x: g.x + sdx, y: g.y + sdy, ...placementWorld, _edited: true } } as any);
        } else if (it.type === 'Room' || it.type === 'Slab' || it.type === 'Roof') {
          const g = (it as any).geom;
          const placementWorld = Array.isArray(g._placementWorld)
            ? { _placementWorld: [g._placementWorld[0] + sdx, g._placementWorld[1] + sdy] }
            : {};
          updateItem(id, { geom: { ...g, polygon: g.polygon.map(([x, y]: [number, number]) => [x + sdx, y + sdy]), ...placementWorld, _edited: true } } as any);
          updateContainedFurniture(it, sdx, sdy, drag.originals, selectedIds);
        } else if (it.type === 'Marker') {
          const g = (it as any).geom;
          updateItem(id, { geom: { ...g, x: g.x + sdx, y: g.y + sdy, _edited: true } } as any);
        } else if (it.type === 'Door' || it.type === 'Window') {
          if (movedWallIds.has((it as any).geom.wallId)) continue;
          // Lire le mur depuis drag.originals (snapshot stable pris au mousedown),
          // fallback sur wallsById si le mur n'était pas dans le snapshot
          const wallFromOriginals = drag.originals[(it as any).geom.wallId];
          const w = wallFromOriginals ?? wallsById[(it as any).geom.wallId];
          if (!w) {
            console.warn('[DBG] Move: wall NOT found for', it.type, id, 'wallId=', (it as any).geom.wallId);
          } else {
            const wGeom = (w as any).geom;
            const wallLen = wallLength(wGeom) || 1;
            const ang = wallAngle(wGeom);
            const halfSpan = Math.min(0.49, Math.max(0.01, (((it as any).geom.width ?? 1) / 2) / wallLen));
            const alongM = dx * Math.cos(ang) + dy * Math.sin(ang);
            const along = snap(alongM) / wallLen;
            const origT = (it as any).geom.t;
            const nt = Math.max(halfSpan, Math.min(1 - halfSpan, origT + along));
            const newPW: [number, number] = [wGeom.x1 + nt * (wGeom.x2 - wGeom.x1), wGeom.y1 + nt * (wGeom.y2 - wGeom.y1)];
            updateItem(id, { geom: { ...(it as any).geom, t: nt, _placementWorld: newPW, _edited: true } } as any);
          }
        }
      }
    } else if (drag.kind === 'draw-wall') {
      // Try snapping end to existing endpoints first
      const rawX2 = snap(wx), rawY2 = snap(wy);
      const snapped = snapToEndpoints(rawX2, rawY2) ?? snapToPlan(wx, wy);
      let x2 = snapped?.[0] ?? rawX2, y2 = snapped?.[1] ?? rawY2;
      const snapEnd = snapped != null;
      if (snapEnabled && !snapEnd) {
        // Ortho snapping (3:1)
        const adx = Math.abs(x2 - drag.x1), ady = Math.abs(y2 - drag.y1);
        if (adx > ady * 3) y2 = drag.y1; else if (ady > adx * 3) x2 = drag.x1;
      }
      setDrag({ ...drag, x2, y2, snapEnd });
    } else if (drag.kind === 'draw-room-poly' || drag.kind === 'draw-slab' || drag.kind === 'draw-roof') {
      let cx = snap(wx), cy = snap(wy);
      let snapPt: [number, number] | null = null;
      let alignX: number | null = null;
      let alignY: number | null = null;
      const planPt = snapEnabled && snapToEndpoints(cx, cy) ? null : snapToPlan(wx, wy);
      if (planPt) {
        [cx, cy] = planPt;
        snapPt = planPt;
      } else if (snapEnabled) {
        const ptSnap = snapToEndpoints(cx, cy);
        if (ptSnap) {
          [cx, cy] = ptSnap;
          snapPt = ptSnap;
        } else {
          const alignTol = 0.20;
          let bestXD = alignTol, bestYD = alignTol;
          for (const [px, py] of snapTargets) {
            const dxp = Math.abs(cx - px), dyp = Math.abs(cy - py);
            if (dxp < bestXD) { bestXD = dxp; alignX = px; }
            if (dyp < bestYD) { bestYD = dyp; alignY = py; }
          }
          if (alignX !== null) cx = alignX;
          if (alignY !== null) cy = alignY;
        }
      }
      setDrag({ kind: drag.kind, points: drag.points, cursor: [cx, cy], snapPt, alignX, alignY } as any);
    } else if (drag.kind === 'draw-fur') {
      setDrag({ ...drag, x2: snap(wx), y2: snap(wy) });
    } else if (drag.kind === 'measure') {
      setDrag({ ...drag, x2: wx, y2: wy });
    } else if (drag.kind === 'draw-dim') {
      setDrag({ ...drag, x2: snap(wx), y2: snap(wy) });
    }
  };

  const onMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!drag) return;
    if (drag.kind === 'stair-flight' || drag.kind === 'wall-handle' || drag.kind === 'room-vertex' || drag.kind === 'furniture-rotate') { setDrag(null); return; }
    if (drag.kind === 'marquee' && marquee) {
      const [wx1, wy1] = s2w(Math.min(marquee.x1, marquee.x2), Math.min(marquee.y1, marquee.y2));
      const [wx2, wy2] = s2w(Math.max(marquee.x1, marquee.x2), Math.max(marquee.y1, marquee.y2));
      const minX = Math.min(wx1, wx2);
      const maxX = Math.max(wx1, wx2);
      const minY = Math.min(wy1, wy2);
      const maxY = Math.max(wy1, wy2);

      const ids: string[] = [];
      for (const it of inStorey) {
        let cx: number | undefined, cy: number | undefined;
        if (it.type === 'Wall') { const g = (it as any).geom; cx = (g.x1 + g.x2) / 2; cy = (g.y1 + g.y2) / 2; }
        else if (it.type === 'Furniture') { const g = (it as any).geom; cx = g.x + g.w / 2; cy = g.y + g.d / 2; }
        else if (it.type === 'Technical' || it.type === 'Column' || it.type === 'Chimney') { const g = (it as any).geom; cx = g.x; cy = g.y; }
        else if (it.type === 'GenericElement') { const g = (it as any).geom; cx = g.x + g.w / 2; cy = g.y + g.d / 2; }
        else if (it.type === 'Room') { const g = (it as any).geom; const bb2 = bbox(g.polygon); cx = (bb2.minX + bb2.maxX) / 2; cy = (bb2.minY + bb2.maxY) / 2; }
        else continue;
        if (cx !== undefined && cy !== undefined && cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) ids.push(it.id);
      }
      // ctrlKey or metaKey works as toggle, shiftKey as add
      if (e.ctrlKey || e.metaKey) {
        const nextSel = new Set(selection);
        for (const id of ids) {
          if (nextSel.has(id)) nextSel.delete(id);
          else nextSel.add(id);
        }
        setSelection(Array.from(nextSel));
      } else {
        setSelection(e.shiftKey ? [...new Set([...selection, ...ids])] : ids);
      }
      setMarquee(null);
    } else if (drag.kind === 'draw-wall') {
      const len = Math.hypot(drag.x2 - drag.x1, drag.y2 - drag.y1);
      if (len > 0.3) {
        const id = 'w_' + Date.now();
        addItem({
          id, type: 'Wall', ifcType: 'IfcWall', name: defaultName('wall', lang), Name: defaultName('wall', lang),
          GlobalId: guid(id), parentId: storeyId,
          PredefinedType: 'STANDARD', IsExternal: false, LoadBearing: false,
          FireRating: 'EI 60', ThermalTransmittance: 0.24, Material: 'Brique 200mm',
          geom: { x1: drag.x1, y1: drag.y1, x2: drag.x2, y2: drag.y2, thickness: 0.20, height: 2.70 },
          material: 'Brique 200mm', fireRating: 'EI 60', loadBearing: false, isExternal: false,
        });
        setSelection([id]);
        
        if (drag.snapEnd) {
          // If we snapped to an existing junction, stop drawing automatically to close the loop
          setTool('select');
          setDrag(null);
        } else {
          // Continuous drawing: start next segment from current end
          setDrag({ kind: 'draw-wall', x1: drag.x2, y1: drag.y2, x2: drag.x2, y2: drag.y2, snapEnd: true, isDrawing: true } as any);
        }
        return;
      } else {
        if ((drag as any).isDrawing) {
          // Double click, or click without moving after having drawn something. Stop.
          setTool('select');
          setDrag(null);
          return;
        } else {
          // First click without moving. Just switch to drawing state.
          setDrag({ ...drag, isDrawing: true } as any);
          return;
        }
      }
    } else if (drag.kind === 'draw-room-poly' || drag.kind === 'draw-slab' || drag.kind === 'draw-roof') {
      const pts = (drag as any).points;
      const [nx, ny] = (drag as any).cursor;
      const [fx, fy] = pts[0];
      const distToStart = Math.hypot(nx - fx, ny - fy);
      
      if (pts.length >= 3 && distToStart * view.scale < 12) {
        // Close polygon
        if (drag.kind === 'draw-roof') {
          const id = 'rf_' + Date.now();
          // Eaves sit on the tallest wall of the storey
          const wallTops = Object.values(items)
            .filter(i => i.type === 'Wall' && i.parentId === storeyId)
            .map(i => Number((i as any).geom?.height) || 0);
          const elevation = wallTops.length ? Math.max(...wallTops) : ROOF_DEFAULTS.elevation;
          addItem({
            id, type: 'Roof', ifcType: 'IfcRoof', PredefinedType: 'GABLE_ROOF',
            name: defaultName('roof', lang), Name: defaultName('roof', lang),
            GlobalId: guid(id), parentId: storeyId,
            geom: { ...ROOF_DEFAULTS, polygon: pts, elevation },
          } as any);
          setSelection([id]);
          setTool('select');
          setDrag(null);
          return;
        }
        const isSlab = drag.kind === 'draw-slab';
        const id = (isSlab ? 'slb_' : 'rm_') + Date.now();
        addItem({
          id, type: isSlab ? 'Slab' : 'Room', ifcType: isSlab ? 'IfcSlab' : 'IfcSpace', 
          name: defaultName(isSlab ? 'slab' : 'room', lang), Name: defaultName(isSlab ? 'slab' : 'room', lang),
          GlobalId: guid(id), parentId: storeyId,
          geom: { polygon: pts, height: isSlab ? 0.2 : 2.70, thickness: isSlab ? 0.2 : undefined },
          function: isSlab ? '' : 'Habitation', occupancy: isSlab ? 0 : 1,
        } as any);
        setSelection([id]);
        setTool('select');
        setDrag(null);
      } else {
        // The first mouse-up follows the mouse-down that already added this vertex.
        const last = pts[pts.length - 1];
        if (Math.hypot(nx - last[0], ny - last[1]) > 1e-8) {
          setDrag({ kind: drag.kind, points: [...pts, [nx, ny]], cursor: drag.cursor } as any);
        }
      }
      return;
    } else if (drag.kind === 'draw-fur') {
      const x1 = Math.min(drag.x1, drag.x2), y1 = Math.min(drag.y1, drag.y2);
      const x2 = Math.max(drag.x1, drag.x2), y2 = Math.max(drag.y1, drag.y2);
      
      const defW = activeElementDef?.defaults.width ?? 0.60;
      const defD = activeElementDef?.defaults.depth ?? activeElementDef?.defaults.width ?? 0.60;
      const defH = activeElementDef?.defaults.height ?? 0.85;

      const isBigDrag = (x2 - x1 > 0.3 && y2 - y1 > 0.3);
      const w = isBigDrag ? (x2 - x1) : defW;
      const d = isBigDrag ? (y2 - y1) : defD;
      const h = defH;

      // Snapped or centered placement coordinates
      const px = isBigDrag ? x1 : (drag.x1 - w / 2);
      const py = isBigDrag ? y1 : (drag.y1 - d / 2);

      const id = 'fur_' + Date.now();
      const label = activeElementDef ? catalogueLabel(activeElementDef, lang) : defaultName('furniture', lang);

      addItem({
        id,
        type: 'Furniture',
        ifcType: 'IfcFurnishingElement',
        name: label,
        Name: label,
        GlobalId: guid(id),
        parentId: storeyId,
        geom: { x: px, y: py, w, d, h, rotation: 0 },
        category: activeElementDef?.category ?? 'Cuisine',
        model: activeElementDef?.id ?? 'custom',
      } as any);

      setSelection([id]);
      setTool('select');
    } else if (drag.kind === 'draw-dim') {
      const d = Math.hypot(drag.x2 - drag.x1, drag.y2 - drag.y1);
      if (d > 0.1) {
        const id = (tool==='Section'?'section_':'dim_') + Date.now();
        addItem({
          id, type: tool === 'Section' ? 'Section' : 'Dimension', ifcType: 'IfcAnnotation', name: tool === 'Section' ? 'Coupe' : 'Cote', Name: tool === 'Section' ? 'Coupe' : 'Cote',
          GlobalId: guid(id), parentId: storeyId,
          geom: { x1: drag.x1, y1: drag.y1, x2: drag.x2, y2: drag.y2 }
        } as any);
        setSelection([id]);
      }
      setTool('select');
    }
    setDrag(null);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = wrapRef.current!.getBoundingClientRect();
    const [wx, wy] = s2w(e.clientX - rect.left, e.clientY - rect.top);
    const edgeR = 12 / view.scale;
    for (const id of selection) {
      const it = items[id];
      if (it?.type === 'Room' || it?.type === 'Slab' || it?.type === 'Roof') {
        const poly = (it as any).geom.polygon as [number, number][];
        for (let i = 0; i < poly.length; i++) {
          const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
          const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
          if (len2 === 0) continue;
          const tt = Math.max(0, Math.min(1, ((wx - ax) * dx + (wy - ay) * dy) / len2));
          if (Math.hypot(wx - (ax + tt * dx), wy - (ay + tt * dy)) < edgeR) {
            const newPoly: [number, number][] = [...poly.slice(0, i + 1), [snap(ax + tt * dx), snap(ay + tt * dy)], ...poly.slice(i + 1)];
            // A split roof edge gives two edges with the same settings
            const oldEdges = (it as any).geom.edges;
            const edges = Array.isArray(oldEdges) && oldEdges.length === poly.length
              ? { edges: [...oldEdges.slice(0, i + 1), { ...oldEdges[i] }, ...oldEdges.slice(i + 1)] } : {};
            updateItem(id, { geom: { ...(it as any).geom, polygon: newPoly, ...edges, _edited: true, _shapeEdited: true } } as any);
            return;
          }
        }
      } else if (it?.type === 'Wall') {
        const g = (it as any).geom;
        const dx = g.x2 - g.x1, dy = g.y2 - g.y1, len2 = dx * dx + dy * dy;
        if (len2 === 0) continue;
        const tt = Math.max(0, Math.min(1, ((wx - g.x1) * dx + (wy - g.y1) * dy) / len2));
        if (Math.hypot(wx - (g.x1 + tt * dx), wy - (g.y1 + tt * dy)) < edgeR) {
          const px = snap(g.x1 + tt * dx), py = snap(g.y1 + tt * dy);
          // Split wall into two
          const id2 = 'w_' + Date.now();
          const oldX2 = g.x2, oldY2 = g.y2;
          updateItem(id, { geom: { ...g, x2: px, y2: py } } as any);
          addItem({
            ...it,
            id: id2,
            GlobalId: guid(id2),
            geom: { ...g, x1: px, y1: py, x2: oldX2, y2: oldY2 }
          } as any);
          setSelection([id, id2]);
          return;
        }
      }
    }
  };

  const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (lastPanMovedRef.current) return;
    if (hover?.sub === 'room-vertex' && hover.idx !== undefined) {
      const it = items[hover.id];
      if (!it || (it.type !== 'Room' && it.type !== 'Slab' && it.type !== 'Roof')) return;
      const poly = (it as any).geom.polygon as [number, number][];
      if (poly.length <= 3) return;
      // Removing vertex k merges edges k-1 and k: keep the settings of edge k-1
      const oldEdges = (it as any).geom.edges;
      const edges = Array.isArray(oldEdges) && oldEdges.length === poly.length
        ? { edges: hover.idx === 0 ? oldEdges.slice(1, -1).concat([oldEdges[oldEdges.length - 1]]) : oldEdges.filter((_: unknown, i: number) => i !== hover.idx) } : {};
      updateItem(hover.id, { geom: { ...(it as any).geom, polygon: poly.filter((_, i) => i !== hover.idx), ...edges, _edited: true, _shapeEdited: true } } as any);
      setHover(null);
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  //  Rendering helpers
  // ══════════════════════════════════════════════════════════════════════════
  const renderGrid = () => {
    if (!showGrid) return null;
    const step = view.scale; if (step < 8) return null;
    const lines: React.ReactElement[] = [];
    let fx = view.ox % step; if (fx > 0) fx -= step;
    for (let x = fx; x < size.w; x += step) lines.push(<line key={'gx'+x} x1={x} y1={0} x2={x} y2={size.h} stroke="var(--border)" strokeWidth="1" />);
    let fy = view.oy % step; if (fy > 0) fy -= step;
    for (let y = fy; y < size.h; y += step) lines.push(<line key={'gy'+y} x1={0} y1={y} x2={size.w} y2={y} stroke="var(--border)" strokeWidth="1" />);
    lines.push(<line key="ax" x1={view.ox} y1={0} x2={view.ox} y2={size.h} stroke="var(--border-strong)" strokeWidth="1.2" strokeDasharray="2 2" />);
    lines.push(<line key="ay" x1={0} y1={view.oy} x2={size.w} y2={view.oy} stroke="var(--border-strong)" strokeWidth="1.2" strokeDasharray="2 2" />);
    return <g className="editor-overlay editor-grid">{lines}</g>;
  };

  const isSel = (id: string) => selection.includes(id);
  const isHov = (id: string) => hover?.id === id && !hover.sub;
  const isRel = (id: string) => relatedIds.has(id);

  const planPrimitives = useMemo(() => {
    const storeyIds = showAllStoreys ? Object.values(items).filter((i) => i.type === 'Storey').map((i) => i.id) : [storeyId];
    return storeyIds.flatMap((id) => renderPlan(items, id, {
      showRooms: false, showStairs: false, showDimensions: false, windowSwings: true,
      skipWall: hiddenIn2D, hiddenTypes, pens: SCREEN_PENS,
    }).primitives);
  }, [items, storeyId, showAllStoreys, hiddenTypes]);
  const planStyle = (p: Primitive): PrimitiveStyle | undefined => {
    if (!p.id) return undefined;
    const sel = isSel(p.id), rel = isRel(p.id), hov = isHov(p.id);
    const accent = sel ? 'var(--accent)' : rel ? 'oklch(0.6 0.2 200)' : undefined;
    if (p.layer === 'opening') {
      return { stroke: accent ?? (items[p.id]?.type === 'Window' ? 'var(--c-window)' : 'var(--c-door)') };
    }
    if (p.layer === 'wall' && p.kind === 'polygon') {
      if (p.fill === 'none') return { stroke: accent };
      // Fills must stay opaque: they hide the outlines drawn under them, which is what merges wall joints.
      // The wall opacity setting applies to the whole layer instead (see the <g opacity> around PlanPrimitives).
      return hov && !sel ? { fill: 'color-mix(in oklch, var(--c-wall), var(--accent) 12%)' } : undefined;
    }
    return undefined;
  };

  const cursor = !drag
    ? (hover?.sub === 'wall-handle-A' || hover?.sub === 'wall-handle-B' ? 'crosshair'
      : hover?.sub === 'stair-flight' || hover?.sub === 'room-vertex' ? 'move'
      : hover?.sub === 'furniture-rotate' ? 'grab'
      : tool !== 'select' ? 'crosshair'
      : hover ? 'pointer' : 'default')
    : drag.kind === 'pan' ? 'grabbing'
    : drag.kind === 'wall-handle' ? 'crosshair'
    : drag.kind === 'stair-flight' || drag.kind === 'room-vertex' ? 'move'
    : drag.kind === 'furniture-rotate' ? 'grabbing'
    : 'default';

  // ── Relationship panel (single selection only) ───────────────────────────
  const relPanel = useMemo(() => {
    if (selection.length !== 1) return null;
    const it = items[selection[0]]; if (!it) return null;
    const fr = lang === 'fr';

    type Chip = { icon: string; label: string; dim?: string; action?: () => void; highlightIds?: string[] };
    const chips: Chip[] = [];

    // Spatial containment → storey
    const storey = items[it.parentId ?? ''];
    if (storey?.type === 'Storey') {
      chips.push({ icon: '📐', label: storey.name || (makeT(lang)("Storey")), dim: 'IfcRelContained' });
    }
    // Building
    const building = storey ? items[storey.parentId ?? ''] : null;
    if (building?.type === 'Building') {
      chips.push({ icon: '🏢', label: building.name || (makeT(lang)("Building")), dim: 'IfcRelAggregates' });
    }

    // Door/Window → host wall
    if ((it.type === 'Door' || it.type === 'Window') && (it as any).geom?.wallId) {
      const wall = items[(it as any).geom.wallId];
      if (wall) chips.push({
        icon: it.type === 'Door' ? '🚪' : '🪟',
        label: fr ? `Dans: ${shortName(wall, lang)}` : `In: ${shortName(wall, lang)}`,
        dim: 'IfcRelVoidsElement',
        highlightIds: [wall.id],
      });
    }

    // Wall → hosted openings
    if (it.type === 'Wall') {
      const openings = wallOpenings.get(it.id) ?? [];
      for (const oid of openings) {
        const op = items[oid]; if (!op) continue;
        chips.push({
          icon: op.type === 'Door' ? '🚪' : '🪟',
          label: shortName(op, lang),
          dim: 'IfcRelFillsVoid',
          highlightIds: [oid],
        });
      }
      // Wall → bounded rooms
      const rids = [...(wallToRooms.get(it.id) ?? [])];
      if (rids.length) chips.push({
        icon: '🏠',
        label: fr ? `Borde ${rids.length} pièce${rids.length > 1 ? 's' : ''}` : `Bounds ${rids.length} room${rids.length > 1 ? 's' : ''}`,
        dim: 'IfcRelSpaceBoundary',
        highlightIds: rids,
      });
      // Wall junction count
      const jCount = junctions.filter((j) => j.ids.includes(it.id)).length;
      if (jCount) chips.push({ icon: '⊞', label: fr ? `${jCount} jonction${jCount > 1 ? 's' : ''}` : `${jCount} junction${jCount > 1 ? 's' : ''}`, dim: 'IfcRelConnectsPathElements' });
    }

    // Room → bounding walls
    if (it.type === 'Room') {
      const wids = [...(roomToWalls.get(it.id) ?? [])];
      if (wids.length) chips.push({
        icon: '🧱',
        label: fr ? `${wids.length} mur${wids.length > 1 ? 's' : ''} bornant` : `${wids.length} bounding wall${wids.length > 1 ? 's' : ''}`,
        dim: 'IfcRelSpaceBoundary',
        highlightIds: wids,
      });
      // Room area
      const area = polyArea((it as any).geom.polygon);
      chips.push({ icon: '📏', label: formatArea(area), dim: 'GrossFloorArea' });
    }

    if (!chips.length) return null;
    return chips;
  }, [selection, items, wallOpenings, wallToRooms, roomToWalls, junctions, lang]);

  // ══════════════════════════════════════════════════════════════════════════
  //  Render
  // ══════════════════════════════════════════════════════════════════════════
  const fr = lang === 'fr';
  const storey = items[storeyId] as IfcStoreyEntity;
  const plan = storey?.geom?.plan;

  return (
    <div
      ref={wrapRef}
      className={`canvas2d tool-${tool}${drag ? ' dragging' : ''}`}
      style={{ cursor }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onDoubleClick={onDoubleClick}
      onMouseLeave={() => { setHover(null); setCursorWorld(null); }}
      onContextMenu={onContextMenu}
      onTouchStart={(e) => {
        if (e.touches.length === 2) {
          const t1 = e.touches[0], t2 = e.touches[1];
          const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
          setDrag({ kind: 'pan', lastDist: dist } as any); // Reuse 'pan' or similar for simplicity or add a new kind
        } else {
          // Convert single touch to mouse-like event if needed, 
          // but for now we'll focus on pinch collision.
        }
      }}
      onTouchMove={(e) => {
        if (e.touches.length === 2) {
          // Handled in onMouseMove / similar logic if we unify them, 
          // but React doesn't unify touch and mouse automatically.
          // Let's add a proper onTouchMove.
          const rect = wrapRef.current!.getBoundingClientRect();
          const t1 = e.touches[0], t2 = e.touches[1];
          const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
          const midX = (t1.clientX + t2.clientX) / 2 - rect.left;
          const midY = (t1.clientY + t2.clientY) / 2 - rect.top;
          
          if (drag && (drag as any).lastDist) {
            const delta = dist / (drag as any).lastDist;
            const [mwx, mwy] = s2w(midX, midY);
            const newScale = Math.max(0.5, Math.min(200, view.scale * delta));
            setView({ scale: newScale, ox: midX - mwx * newScale, oy: midY + mwy * newScale });
            setDrag({ ...drag, lastDist: dist } as any);
          }
        }
      }}
      onTouchEnd={() => setDrag(null)}
    >
      <ToolHint tool={tool} lang={lang} drawing={drag?.kind === 'draw-wall' || (tool === 'alignPlan' && !!alignFrom)}
        onSelect={() => { setDrag(null); setTool('select'); }} />
      {tool === 'Stair' && <StairTypePicker form={stairForm} landing={stairLanding} onFormChange={setStairForm} onLandingChange={setStairLanding} onClose={() => setTool('select')} lang={lang} />}
      {/* ── CALIBRATION OVERLAY ── */}
      {isCalibrating && (
        <div onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} style={{ position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 100, background: 'var(--panel)', border: '1px solid var(--accent)', padding: '12px 16px', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 260 }}>
          {calibPoints.length === 1 ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{makeT(lang)("Position Marker")}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                {makeT(lang)("1 point selected. You can set this point as origin (0,0) or click a 2nd point to calibrate scale.")}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button className="btn ghost" onClick={() => { setTool('select'); setCalibPoints([]); setIsCalibrating(false); }}>{makeT(lang)("Cancel")}</button>
                <button className="btn primary" onClick={() => {
                  const [wx, wy] = calibPoints[0];
                  const newX = plan!.x - wx;
                  const newY = plan!.y - wy;
                  const newCalib = plan!.calibrationPoints ? plan!.calibrationPoints.map(p => [p[0] - wx, p[1] - wy]) : undefined;
                  updateItem(storeyId, { geom: { ...storey.geom, plan: { ...plan!, x: newX, y: newY, calibrationPoints: newCalib as any } } });
                  setView(v => ({
                    ...v,
                    ox: v.ox + wx * v.scale,
                    oy: v.oy - wy * v.scale
                  }));
                  setTool('select');
                  setCalibPoints([]);
                  setIsCalibrating(false);
                }}>{makeT(lang)("Set origin (0,0)")}</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{makeT(lang)("Scale Calibration")}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{makeT(lang)("Enter the real distance between the two points:")}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input 
                  autoFocus
                  type="number"
                  step="any"
                  value={calibValue} 
                  onChange={(e) => setCalibValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const distM = parseFloat(calibValue);
                      if (distM > 0 && calibPoints.length === 2) {
                        const [p1, p2] = calibPoints;
                        const worldDist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
                        const ratio = distM / worldDist;
                        const newAbsoluteScale = plan!.scale * ratio;
                        const newP1 = [plan!.x + (p1[0] - plan!.x) * ratio, plan!.y + (p1[1] - plan!.y) * ratio] as [number, number];
                        const newP2 = [plan!.x + (p2[0] - plan!.x) * ratio, plan!.y + (p2[1] - plan!.y) * ratio] as [number, number];
                        updateItem(storeyId, { geom: { ...storey.geom, plan: { ...plan!, scale: newAbsoluteScale, calibrationPoints: [newP1, newP2] } } });
                        setTool('select');
                        setIsCalibrating(false);
                      }
                    }
                  }}
                  style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px', color: 'var(--ink)', fontFamily: 'var(--font-mono)' }} 
                />
                <span style={{ fontSize: 12 }}>m</span>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button className="btn ghost" onClick={() => { setTool('select'); setCalibPoints([]); setIsCalibrating(false); }}>{makeT(lang)("Cancel")}</button>
                <button className="btn primary" onClick={() => {
                  const distM = parseFloat(calibValue);
                  if (distM > 0 && calibPoints.length === 2) {
                    const [p1, p2] = calibPoints;
                    const worldDist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
                    const ratio = distM / worldDist;
                    const newAbsoluteScale = plan!.scale * ratio;
                    const newP1 = [plan!.x + (p1[0] - plan!.x) * ratio, plan!.y + (p1[1] - plan!.y) * ratio] as [number, number];
                    const newP2 = [plan!.x + (p2[0] - plan!.x) * ratio, plan!.y + (p2[1] - plan!.y) * ratio] as [number, number];
                    updateItem(storeyId, { geom: { ...storey.geom, plan: { ...plan!, scale: newAbsoluteScale, calibrationPoints: [newP1, newP2] } } });
                    setTool('select');
                    setIsCalibrating(false);
                  }
                }}>{makeT(lang)("Apply")}</button>
              </div>
            </>
          )}
        </div>
      )}

      <svg id="plan-svg-canvas" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none" style={{ direction: 'ltr', position: 'absolute', inset: 0 }}>
        {/* ── BACKGROUND IMAGE ── */}
        {plan && showBgImage && plan.kind === 'vector' && plan.vector && (
          <VectorPlanLayer plan={plan} data={plan.vector} view={view} opacity={plan.opacity} />
        )}
        {tool === 'alignPlan' && (
          <g pointerEvents="none" className="editor-overlay plan-align">
            {Object.values(items).filter(it => it.type === 'Wall' && it.parentId === alignRefId).map(it => {
              const g = (it as any).geom;
              const [ax, ay] = w2s(g.x1, g.y1), [bx, by] = w2s(g.x2, g.y2);
              return <line key={it.id} x1={ax} y1={ay} x2={bx} y2={by} stroke="var(--accent)" strokeWidth={1} strokeDasharray="6 4" opacity={0.7} />;
            })}
            {alignFrom && (() => {
              const [fx, fy] = w2s(alignFrom[0], alignFrom[1]);
              const c = cursorWorld ? w2s(cursorWorld[0], cursorWorld[1]) : null;
              return <>
                <circle cx={fx} cy={fy} r={5} fill="var(--accent)" />
                {c && <line x1={fx} y1={fy} x2={c[0]} y2={c[1]} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="4 2" />}
              </>;
            })()}
          </g>
        )}
        {planSnapMark && (tool === 'alignPlan' || tool === 'Wall' || tool === 'Room' || tool === 'Slab' || tool === 'Roof' || drag?.kind === 'wall-handle') && (() => {
          const [mx, my] = w2s(planSnapMark.x, planSnapMark.y);
          return <g pointerEvents="none" className="editor-overlay plan-snap-mark">
            {planSnapMark.kind === 'endpoint' && <rect x={mx - 5} y={my - 5} width={10} height={10} fill="none" stroke="var(--accent)" strokeWidth={1.5} />}
            {planSnapMark.kind === 'midpoint' && <path d={`M${mx} ${my - 6}L${mx + 6} ${my + 5}L${mx - 6} ${my + 5}Z`} fill="none" stroke="var(--accent)" strokeWidth={1.5} />}
            {planSnapMark.kind === 'center' && <circle cx={mx} cy={my} r={6} fill="none" stroke="var(--accent)" strokeWidth={1.5} />}
            {planSnapMark.kind === 'nearest' && <path d={`M${mx - 5} ${my - 5}L${mx + 5} ${my + 5}M${mx + 5} ${my - 5}L${mx - 5} ${my + 5}`} stroke="var(--accent)" strokeWidth={1.5} />}
          </g>;
        })()}
        {plan && showBgImage && !(plan.kind === 'vector' && plan.vector) && (
          <image
            href={plan.url}
            x={plan.x * view.scale + view.ox}
            y={-(plan.y + plan.h * plan.scale) * view.scale + view.oy}
            width={plan.w * plan.scale * view.scale}
            height={plan.h * plan.scale * view.scale}
            style={{ opacity: plan.opacity, pointerEvents: 'none' }}
          />
        )}

        {/* ── Calibration Line ── */}
        {calibPoints.length > 0 && (() => {
          const spts = calibPoints.map(p => w2s(p[0], p[1]));
          const [scx, scy] = cursorWorld ? w2s(cursorWorld[0], cursorWorld[1]) : [0, 0];
          return (
            <g pointerEvents="none" className="editor-overlay">
              {spts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="5" fill="var(--accent)" />)}
              {spts.length === 1 && cursorWorld && (
                <line x1={spts[0][0]} y1={spts[0][1]} x2={scx} y2={scy} stroke="var(--accent)" strokeWidth="2" strokeDasharray="4 2" />
              )}
              {spts.length === 2 && (
                <line x1={spts[0][0]} y1={spts[0][1]} x2={spts[1][0]} y2={spts[1][1]} stroke="var(--accent)" strokeWidth="2" />
              )}
            </g>
          );
        })()}
        <defs>
          {/* Arrowhead marker for normal vector of selected walls */}
          <marker id="arrow-normal" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="var(--accent)" />
          </marker>
          {/* Glow filter for relation highlights */}
          <filter id="rel-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {renderGrid()}

        {/* ── Slabs ── (rendered BEFORE rooms so rooms are on top for click selection) */}
        {Object.values(items).filter(i => i.type === 'Slab' && i.parentId === storeyId && !hiddenTypes?.has('Slab')).map(it => {
          const s = it as any;
          const poly = s.geom.polygon as [number, number][];
          const bb = bbox(poly);
          if (!Number.isFinite(bb.minX)) return null;
          const sel = isSel(it.id), hov = isHov(it.id);
          const [tx, ty] = w2s(bb.minX + 0.2, bb.minY + 0.2);
          return (
            <g key={it.id} className="slab">
              <path d={[poly,...slabOpenings(it.id,items)].map(ring=>'M'+ring.map(p=>w2s(...p).join(',')).join('L')+'Z').join(' ')} fillRule="evenodd"
                fill="var(--ink-4)" fillOpacity="0.08"
                stroke={sel ? 'var(--accent)' : hov ? 'var(--ink-3)' : 'var(--border-strong)'}
                strokeWidth={sel ? 2 : 1}
                strokeDasharray="4 2"
                onClick={(e) => { e.stopPropagation(); toggleSelection(it.id, e.shiftKey); }}
              />
              <text x={tx} y={ty}
                fontSize="9" fontWeight="700" fill="var(--ink-3)" fontFamily="var(--font-mono)" pointerEvents="none"
                style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                DALLE {formatLength(s.geom.thickness)}
              </text>
            </g>
          );
        })}

        {/* ── Roofs ── outline (with overhang) + ridge/hip lines; selection via hitTest */}
        {Object.values(items).filter(i => i.type === 'Roof' && i.parentId === storeyId && !hiddenTypes?.has('Roof')).map(it => {
          const r = it as any;
          const solid = buildRoof(r.geom);
          if (!solid) return null;
          const outline = solid.outline.pts;
          const bb = bbox(outline);
          if (!Number.isFinite(bb.minX)) return null;
          const sel = isSel(it.id), hov = isHov(it.id);
          const stroke = sel ? 'var(--accent)' : hov ? 'var(--ink-2)' : 'oklch(0.55 0.09 30)';
          const fp = (r.geom.polygon as [number, number][]).map(([px, py]) => w2s(px, py).join(',')).join(' ');
          const [tx, ty] = w2s((bb.minX + bb.maxX) / 2, bb.maxY - 0.15);
          return (
            <g key={it.id} className="roof" pointerEvents="none">
              <polygon points={outline.map(([px, py]) => w2s(px, py).join(',')).join(' ')}
                fill="oklch(0.55 0.09 30)" fillOpacity={sel ? 0.12 : 0.05}
                stroke={stroke} strokeWidth={sel ? 2 : 1.2} strokeDasharray="8 3 2 3" />
              {r.geom.overhang > 0 && <polygon points={fp} fill="none" stroke={stroke} strokeOpacity="0.4" strokeWidth="0.8" strokeDasharray="2 3" />}
              {roofCreases(solid).map(([a, b], i) => {
                const [x1, y1] = w2s(a[0], a[1]), [x2, y2] = w2s(b[0], b[1]);
                return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={sel ? 1.6 : 1} />;
              })}
              {sel && r.geom.roofType !== 'flat' && roofEdges(r.geom).map((e, i) => {
                const poly = r.geom.polygon as [number, number][];
                const a = poly[i], b = poly[(i + 1) % poly.length];
                const [mx, my] = w2s((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
                return (
                  <g key={'e' + i}>
                    <circle cx={mx} cy={my} r="8" fill={e.gable ? 'var(--bg)' : stroke} stroke={stroke} strokeWidth="1.2" />
                    <text x={mx} y={my + 3} textAnchor="middle" fontSize="9" fontWeight="700" fill={e.gable ? stroke : 'var(--bg)'} fontFamily="var(--font-mono)">{i + 1}</text>
                  </g>
                );
              })}
              <text x={tx} y={ty} textAnchor="middle"
                fontSize="9" fontWeight="700" fill={stroke} fontFamily="var(--font-mono)"
                style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {makeT(lang)('roof')} {r.geom.roofType !== 'flat' ? `${Math.round(r.geom.pitch)}°` : ''}
              </text>
            </g>
          );
        })}

        {/* ── Rooms ── */}
        {rooms.map((r) => {
          const g = (r as any).geom;
          const bb2 = bbox(g.polygon);
          if (!Number.isFinite(bb2.minX) || !Number.isFinite(bb2.minY)) return null;
          const pts = g.polygon.map(([x, y]: [number, number]) => w2s(x, y).join(',')).join(' ');
          const sel = isSel(r.id), hov = isHov(r.id), rel = isRel(r.id);
          // Inside the room even when it is L-shaped or concave (the bounding-box centre may fall outside).
          const [cx, cy] = w2s(...roomLabelPoint(g.polygon));
          return (
            <g key={r.id} filter={rel ? 'url(#rel-glow)' : undefined}>
              <polygon points={pts}
                fill="var(--c-room)"
                fillOpacity={sel ? 0.32 : rel ? 0.28 : hov ? 0.20 : 0.14}
                stroke={sel ? 'var(--accent)' : rel ? 'oklch(0.6 0.2 200)' : 'transparent'}
                strokeWidth={sel ? 2 : rel ? 2 : 0}
                strokeDasharray={sel ? '4 3' : rel ? '6 3' : ''}
                onClick={(e) => {
                  e.stopPropagation();
                  // An element drawn over the room (a cote, furniture…) was already picked on pointer down.
                  const rect = wrapRef.current!.getBoundingClientRect();
                  const hit = hitTest(...s2w(e.clientX - rect.left, e.clientY - rect.top));
                  if (!hit || hit.id === r.id) toggleSelection(r.id, e.shiftKey);
                }}
              />
              {showLabels && (
                <g pointerEvents="none">
                  <text x={cx} y={cy - 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--ink)">{shortName(r, lang)}</text>
                  <text x={cx} y={cy + 9} textAnchor="middle" fontSize="9" fill="var(--ink-3)" fontFamily="var(--font-mono)">{formatArea(polyArea(g.polygon))}</text>
                </g>
              )}
            </g>
          );
        })}

        {Object.values(items).filter(i=>i.type === 'Stair' && (i.parentId === storeyId || i.geom.targetId === storeyId) && !hiddenTypes?.has('Stair')).map(it => {
          const parts=buildStair((it as any).geom,it.parentId,items).parts;
          const ascent=stairAscentPath(parts).map(v=>w2s(...v));
          const label=fr?'Montée':'Up';
          return <g key={it.id}>
            {parts.filter(p=>p.kind!=='rail').map((p,k)=><polygon key={k} points={p.polygon.map(v=>w2s(...v).join(',')).join(' ')} fill={isSel(it.id)?'var(--accent)':'var(--panel)'} fillOpacity={.5} stroke="var(--ink)" strokeWidth={1}/>)}
            {ascent.length>1 && <g pointerEvents="none" aria-label={label}>
              <title>{label}</title>
              <polyline points={ascent.map(v=>v.join(',')).join(' ')} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" markerEnd="url(#arrow-normal)"/>
              <circle cx={ascent[0][0]} cy={ascent[0][1]} r={3} fill="var(--accent)"/>
              {showLabels && <text x={ascent[0][0]+7} y={ascent[0][1]-7} fontSize={10} fontWeight={600} fill="var(--accent)" fontFamily="var(--font-mono)">{label}</text>}
            </g>}
          </g>;
        })}
        {Object.values(items).filter(i=>i.type==='Section' && i.parentId===storeyId).map(it=>{const g=(it as any).geom;const a=w2s(g.x1,g.y1),b=w2s(g.x2,g.y2);return <g key={it.id} onMouseDown={e=>{e.stopPropagation();setSelection([it.id]);}}><line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="var(--accent)" strokeWidth={3} strokeDasharray="10 4"/><text x={a[0]} y={a[1]-8} fill="var(--accent)">Coupe</text></g>;})}
        {/* ── Furniture ── */}
        {furniture.map((f) => {
          const { x, y, w: fw, d: fd, rotation, footprint } = (f as any).geom;
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          const cx = x + fw / 2, cy = y + fd / 2;
          const [scx, scy] = w2s(cx, cy);
          const sw = fw * view.scale, sd = fd * view.scale;
          const sel = isSel(f.id), hov = isHov(f.id);
          const stroke = sel ? 'var(--accent)' : hov ? 'var(--ink-2)' : 'var(--c-furniture)';
          const fillOp = sel ? 0.42 : 0.22;
          const hasFootprint = footprint && footprint.length >= 3;
          return (
            <g key={f.id} transform={`translate(${scx} ${scy}) rotate(${-rotation * 180 / Math.PI})`}>
              {hasFootprint ? (
                <polygon
                  points={footprint.map(([px, py]: [number, number]) =>
                    `${(px - fw/2) * view.scale},${-(py - fd/2) * view.scale}`).join(' ')}
                  fill="var(--c-furniture)" fillOpacity={fillOp}
                  stroke={stroke} strokeWidth={sel ? 2 : 1} />
              ) : (
                <g style={{ color: stroke }}>
                  {/* Always draw the accurate bounding rect first */}
                  <rect x={-sw/2} y={-sd/2} width={sw} height={sd}
                    fill="var(--c-furniture)" fillOpacity={fillOp}
                    stroke={stroke} strokeWidth={sel ? 2 : 1} rx="2" />
                  {/* Overlay decorative icon only if element is large enough */}
                  {sw > 30 && sd > 20 && renderElementSvg((f as any).model || (f as any).category, 72, 44) ? (
                    <svg x={-sw/2} y={-sd/2} width={sw} height={sd}
                      viewBox="0 0 72 44" preserveAspectRatio={(f as any).model === 'sdb-wc' ? 'none' : 'xMidYMid meet'}
                      overflow="hidden" opacity={0.85}>
                      {renderElementSvg((f as any).model || (f as any).category, 72, 44)}
                    </svg>
                  ) : null}
                </g>
              )}
              {showLabels && sw > 50 && sd > 30 && <text textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="var(--ink-2)" pointerEvents="none" y={sd/2 - 12}>{shortName(f, lang)}</text>}
            </g>
          );
        })}

        {/* ── Generic Elements ── */}
        {genericElements.map((ge) => {
          const g = (ge as any).geom;
          if (!Number.isFinite(g.x) || !Number.isFinite(g.y)) return null;
          const minX = Math.min(g.x, g.x + g.w), maxX = Math.max(g.x, g.x + g.w);
          const minY = Math.min(g.y, g.y + g.d), maxY = Math.max(g.y, g.y + g.d);
          const [scx, scy] = w2s((minX + maxX) / 2, (minY + maxY) / 2);
          const sw = (maxX - minX) * view.scale, sd = (maxY - minY) * view.scale;
          const sel = isSel(ge.id), hov = isHov(ge.id);
          const TYPE_COLORS: Record<string, string> = {
            IfcColumn: '#7c8db5', IfcBeam: '#8b7355', IfcStair: '#9b8ec4',
            IfcRailing: '#6b8e6b', IfcRoof: '#8b6b6b', IfcCovering: '#7b7b9b',
            IfcPlate: '#6b8b8b', IfcMember: '#8b8b6b', IfcBuildingElementProxy: '#7f9fbd',
          };
          const fillColor = TYPE_COLORS[(ge as any).ifcType] ?? '#7f9fbd';
          return (
            <g key={ge.id}>
              <rect
                x={scx - sw / 2} y={scy - sd / 2} width={sw} height={sd}
                fill={fillColor} fillOpacity={sel ? 0.42 : hov ? 0.30 : 0.18}
                stroke={sel ? 'var(--accent)' : hov ? 'var(--ink-2)' : fillColor}
                strokeWidth={sel ? 2 : 1} rx="1"
                strokeDasharray="3 2"
                onClick={(e) => { e.stopPropagation(); toggleSelection(ge.id, e.shiftKey); }}
              />
              {showLabels && sw > 40 && sd > 20 && (
                <text
                  x={scx} y={scy} textAnchor="middle" dominantBaseline="middle"
                  fontSize="8" fill="var(--ink-2)" pointerEvents="none"
                  fontFamily="var(--font-mono)"
                >
                  {isCeilingLikeElement(ge) ? (makeT(lang)("Ceiling")) : ((ge as any).ifcType?.replace('Ifc', '') || ge.type)}
                </text>
              )}
            </g>
          );
        })}

        {/* ── Walls with cuts, doors and windows: the shared drawing engine (same plan as printed sheets) ── */}
        <g opacity={wallOpacity}>
          <PlanPrimitives primitives={planPrimitives} w2s={w2s} unitsPerMm={3} styleOf={planStyle} />
        </g>
        {/* ── Columns & chimneys: drawn by renderPlan; selection/hover outline here ── */}
        {structural.filter(el => isSel(el.id) || isHov(el.id)).flatMap(el => structuralOutlines(el).map((poly, k) => (
          <polygon key={el.id + 'hl' + k} points={poly.map(([px, py]) => w2s(px, py).join(',')).join(' ')}
            fill={isSel(el.id) ? 'var(--accent)' : 'none'} fillOpacity={0.15} stroke={isSel(el.id) ? 'var(--accent)' : 'var(--ink-2)'} strokeWidth={1.5} pointerEvents="none" />
        )))}
        {/* ── Technical Elements ── */}
        {technical.map((tEl) => {
          const { x, y, rotation = 0 } = tEl.geom;
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          const [sx, sy] = w2s(x, y);
          const sel = isSel(tEl.id), hov = isHov(tEl.id);
          const discColor = disciplineColor(tEl.discipline ?? 'electrical');
          const model = TECHNICAL_CATALOGUE.find(def => def.id === tEl.model);
          const stroke = sel ? 'var(--accent)' : hov ? 'var(--ink-2)' : discColor;

          return (
            <g key={tEl.id} data-technical-id={tEl.id} transform={`translate(${sx} ${sy}) rotate(${-rotation * 180 / Math.PI})`}
               onClick={(e) => { e.stopPropagation(); toggleSelection(tEl.id, e.shiftKey); }}
               style={{ cursor: 'pointer' }}>
              <title>{tEl.Name || tEl.name}</title>
              <circle cx={0} cy={0} r={14} fill={sel ? "var(--accent)" : discColor} fillOpacity={sel ? 0.20 : 0.05}
                      stroke={stroke} strokeWidth={sel ? 1.5 : 0.8} />

              <g transform="translate(-16, -16)">
                {renderTechnicalSymbol(model?.symbolKey ?? (tEl.model || 'elec-prise-simple'), 32, 32, discColor)}
              </g>

              {showLabels && (sel || hov) && (
                <text y={24} textAnchor="middle" fontSize="8" fontWeight="600" fill="var(--ink)" pointerEvents="none">
                  {tEl.Name || tEl.name} {tEl.circuitRef ? ` [${tEl.circuitRef}]` : ''}
                </text>
              )}
            </g>
          );
        })}

        {showReliability && <ReliabilityLayer items={items} storeyId={storeyId} w2s={w2s} width={size.w} height={size.h} lang={lang} />}
        {/* Visual direction normal arrow indicator for selected walls */}
        {walls.filter((w) => isSel(w.id)).map((w) => {
          const g = (w as any).geom;
          if (!Number.isFinite(g.x1) || !Number.isFinite(g.y1) || !Number.isFinite(g.x2) || !Number.isFinite(g.y2)) return null;
          const [sx1, sy1] = w2s(g.x1, g.y1);
          return (
            <g key={'n' + w.id} transform={`translate(${sx1} ${sy1}) rotate(${-wallAngle(g) * 180 / Math.PI}) translate(${(wallLength(g) * view.scale) / 2}, 0)`}
              pointerEvents="none" className="editor-overlay">
              {/* Arrow pointing to INT (interior / positive normal) */}
              <line x1="0" y1="0" x2="0" y2="-26" stroke="var(--accent)" strokeWidth="2.5" markerEnd="url(#arrow-normal)" />
              <circle cx="0" cy="0" r="4.5" fill="var(--accent)" />
              <g transform="translate(0, -34)">
                <rect x="-16" y="-7" width="32" height="14" rx="3" fill="var(--accent)" />
                <text x="0" y="3" textAnchor="middle" fontSize="9" fontWeight="bold" fill="white" fontFamily="var(--font-sans)">INT</text>
              </g>
              <g transform="translate(0, 16)">
                <rect x="-16" y="-7" width="32" height="14" rx="3" fill="var(--panel-active, var(--panel))" stroke="var(--border)" strokeWidth="1" />
                <text x="0" y="3" textAnchor="middle" fontSize="8" fontWeight="bold" fill="var(--ink)" fontFamily="var(--font-sans)">EXT</text>
              </g>
            </g>
          );
        })}

        {/* ── Global bay windows on hidden curtain-wall supports ── */}
        {windowsArr.map((wn) => {
          const wg = (wn as any).geom;
          const host = wallsById[wg.wallId];
          if (!host || !hiddenIn2D(host)) return null;
          const g = (host as any).geom;
          if (!Number.isFinite(g.x1) || !Number.isFinite(g.y1) || !Number.isFinite(g.x2) || !Number.isFinite(g.y2)) return null;
          const len = wallLength(g);
          if (len < 0.001) return null;
          const ang = wallAngle(g);
          const [sx1, sy1] = w2s(g.x1, g.y1);
          const cx = wg.t * len * view.scale;
          const hw = (wg.width / 2) * view.scale;
          const openingH = Math.max((g.thickness || 0.12) * view.scale, 10);
          const openingY = -openingH / 2;
          const sel = isSel(wn.id), hov = isHov(wn.id), rel = isRel(wn.id);
          const strokeColor = sel ? 'var(--accent)' : rel ? 'oklch(0.6 0.2 200)' : hov ? 'var(--ink-2)' : 'var(--c-window)';
          return (
            <g key={wn.id} transform={`translate(${sx1} ${sy1}) rotate(${-ang * 180 / Math.PI})`}>
              <rect x={cx-hw} y={openingY} width={hw*2} height={openingH}
                fill="var(--c-window)" fillOpacity={sel ? 0.34 : hov ? 0.28 : 0.20}
                stroke={strokeColor} strokeWidth={sel || rel ? 1.8 : 1.2} />
              <line x1={cx-hw} y1={openingY + 2} x2={cx+hw} y2={openingY + 2} stroke={strokeColor} strokeWidth="1" strokeOpacity="0.85" />
              <line x1={cx-hw} y1={openingY + openingH - 2} x2={cx+hw} y2={openingY + openingH - 2} stroke={strokeColor} strokeWidth="1" strokeOpacity="0.85" />
              <rect x={cx-hw} y={openingY + openingH * 0.25} width={hw} height={openingH * 0.32} fill="var(--c-window)" opacity="0.42" />
              <rect x={cx} y={openingY + openingH * 0.48} width={hw} height={openingH * 0.32} fill="var(--c-window)" opacity="0.42" />
              {(sel || rel) && <rect x={cx-hw-2} y={openingY-2} width={hw*2+4} height={openingH+4} fill="none" stroke={sel ? 'var(--accent)' : 'oklch(0.6 0.2 200)'} strokeWidth="1.4" strokeDasharray="3 2" />}
            </g>
          );
        })}

        {/* ── Junction dots (IfcRelConnectsPathElements) ── */}
        {junctions.map((j, i) => {
          const [sx, sy] = w2s(j.pt[0], j.pt[1]);
          const anySelected = j.ids.some((id) => isSel(id));
          if (view.scale < 20) return null;
          return (
            <circle key={'junc'+i} cx={sx} cy={sy} r={anySelected ? 5 : 3.5}
              fill={anySelected ? 'var(--accent)' : 'var(--ink-2)'}
              stroke="var(--bg)" strokeWidth="1.5"
              pointerEvents="none" className="editor-overlay" />
            );
          })}
        {/* ── Room-wall boundary lines (IfcRelSpaceBoundary, only when something selected) ── */}
        {selection.length > 0 && rooms.map((r) => {
          if (!isSel(r.id) && !isRel(r.id)) return null;
          const poly = (r as any).geom.polygon as [number, number][];
          const boundWalls = roomToWalls.get(r.id) ?? new Set<string>();
          return poly.map((_, i) => {
            const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
            // Is this edge associated with a wall?
            let matchedWall: string | null = null;
            for (const wid of boundWalls) {
              const wg = (items[wid] as any)?.geom;
              if (!wg) continue;
              const da = distPointToSegment(ax, ay, wg.x1, wg.y1, wg.x2, wg.y2);
              const db = distPointToSegment(bx, by, wg.x1, wg.y1, wg.x2, wg.y2);
              if (da < 0.35 && db < 0.35) { matchedWall = wid; break; }
            }
            const [sax, say] = w2s(ax, ay), [sbx, sby] = w2s(bx, by);
            return (
              <line key={r.id+'e'+i} x1={sax} y1={say} x2={sbx} y2={sby}
                stroke={matchedWall ? 'oklch(0.65 0.22 200)' : 'oklch(0.7 0.15 30)'}
                strokeWidth={matchedWall ? 2.5 : 1.5}
                strokeDasharray={matchedWall ? '' : '4 3'}
                strokeOpacity={0.7}
                pointerEvents="none"
                className="editor-overlay"
              />
            );
          });
        })}

        {/* ── Dimensions ── */}
        {!hiddenTypes?.has('Dimension') && Object.values(items).filter(i => i.type === 'Dimension' && i.parentId === storeyId).map(it => {
          const d = it as any;
          const [sx1, sy1] = w2s(d.geom.x1, d.geom.y1);
          const [sx2, sy2] = w2s(d.geom.x2, d.geom.y2);
          const dist = Math.hypot(d.geom.x2 - d.geom.x1, d.geom.y2 - d.geom.y1);
          const ang = Math.atan2(sy2 - sy1, sx2 - sx1);
          const isSelected = selection.includes(it.id);
          return (
            <g key={it.id} className="dimension" onClick={(e) => { e.stopPropagation(); toggleSelection(it.id, e.shiftKey); }}>
              <line x1={sx1} y1={sy1} x2={sx2} y2={sy2} stroke={isSelected ? 'var(--accent)' : 'var(--ink-2)'} strokeWidth="1" />
              <g transform={`translate(${sx1},${sy1}) rotate(${ang * 180 / Math.PI + 45})`}>
                <line x1="-4" y1="0" x2="4" y2="0" stroke={isSelected ? 'var(--accent)' : 'var(--ink-2)'} strokeWidth="1" />
              </g>
              <g transform={`translate(${sx2},${sy2}) rotate(${ang * 180 / Math.PI + 45})`}>
                <line x1="-4" y1="0" x2="4" y2="0" stroke={isSelected ? 'var(--accent)' : 'var(--ink-2)'} strokeWidth="1" />
              </g>
              {/* The text always reads left to right or bottom to top, whatever the direction the cote was drawn in. */}
              <g transform={`translate(${(sx1+sx2)/2},${(sy1+sy2)/2}) rotate(${(() => { const deg = ang * 180 / Math.PI; return deg > 90 ? deg - 180 : deg <= -90 ? deg + 180 : deg; })()})`}>
                <rect x="-18" y="-12" width="36" height="12" fill="var(--bg)" />
                <text y="-3" textAnchor="middle" fontSize="9" fontWeight="600" fill={isSelected ? 'var(--accent)' : 'var(--ink)'} fontFamily="var(--font-mono)">
                  {/* Typed text, else the measured value (imported cote); an emptied field shows the drawn length. */}
                  {d.geom.valueOverride || formatLength(d.geom.valueOverride === '' ? dist : d.geom.value ?? dist, '').trim()}
                </text>
              </g>
            </g>
          );
        })}

        {/* ── Markers ── */}
        {!hiddenTypes?.has('Marker') && Object.values(items).filter(i => i.type === 'Marker' && i.parentId === storeyId).map(it => {
          const m = it as any;
          const [sx, sy] = w2s(m.geom.x, m.geom.y);
          const isSelected = selection.includes(it.id);
          return (
            <g key={it.id} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); toggleSelection(it.id, e.shiftKey); }}>
              <circle cx={sx} cy={sy} r="4" fill={isSelected ? "var(--accent)" : "var(--bg)"} stroke="var(--accent)" strokeWidth="2" />
              {showLabels && (
                <text x={sx + 8} y={sy + 4} fontSize="11" fill="var(--ink)" fontFamily="var(--font-mono)" fontWeight={isSelected ? 600 : 400}>
                  {it.Name || it.name}
                </text>
              )}
            </g>
          );
        })}

        {/* ── Selection bounding box ── */}
        {selection.length > 0 && (() => {
          const sels = selection.map((id) => items[id]).filter(Boolean);
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const it of sels) {
            if (it.type === 'Wall') { const g = (it as any).geom; minX = Math.min(minX,g.x1,g.x2); maxX = Math.max(maxX,g.x1,g.x2); minY = Math.min(minY,g.y1,g.y2); maxY = Math.max(maxY,g.y1,g.y2); }
            else if (it.type === 'Furniture') { const g = (it as any).geom; minX = Math.min(minX,g.x,g.x+g.w); maxX = Math.max(maxX,g.x,g.x+g.w); minY = Math.min(minY,g.y,g.y+g.d); maxY = Math.max(maxY,g.y,g.y+g.d); }
            else if (it.type === 'GenericElement') { const g = (it as any).geom; minX = Math.min(minX,g.x,g.x+g.w); maxX = Math.max(maxX,g.x,g.x+g.w); minY = Math.min(minY,g.y,g.y+g.d); maxY = Math.max(maxY,g.y,g.y+g.d); }
            else if (it.type === 'Room') { const g = (it as any).geom; const bb2 = bbox(g.polygon); minX = Math.min(minX,bb2.minX); maxX = Math.max(maxX,bb2.maxX); minY = Math.min(minY,bb2.minY); maxY = Math.max(maxY,bb2.maxY); }
            else if (it.type === 'Column' || it.type === 'Chimney') { for (const [px, py] of structuralOutlines(it).flat()) { minX = Math.min(minX,px); maxX = Math.max(maxX,px); minY = Math.min(minY,py); maxY = Math.max(maxY,py); } }
            else if (it.type === 'Marker' || it.type === 'Technical') { const g = (it as any).geom; minX = Math.min(minX,g.x); maxX = Math.max(maxX,g.x); minY = Math.min(minY,g.y); maxY = Math.max(maxY,g.y); }
          }
          if (!isFinite(minX)) return null;
          const [sxA, syA] = w2s(minX, minY), [sxB, syB] = w2s(maxX, maxY);
          const bx = Math.min(sxA, sxB), by = Math.min(syA, syB);
          const bw = Math.abs(sxB - sxA), bh = Math.abs(syB - syA);
          return (
            <g pointerEvents="none" className="editor-overlay">
              <rect x={bx-4} y={by-4} width={bw+8} height={bh+8} fill="none" stroke="var(--accent)" strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />
              <text x={bx} y={by-8} fontSize="10" fontFamily="var(--font-mono)" fill="var(--accent)">{formatDims([maxX-minX, maxY-minY])}</text>
            </g>
          );
        })()}

        {/* ── Wall endpoint handles ── */}
        {selection.flatMap((id) => {
          const it = items[id]; if (it?.type !== 'Wall') return [];
          const g = (it as any).geom;
          return (['A','B'] as const).map((h) => {
            const [hwx, hwy] = h === 'A' ? [g.x1,g.y1] : [g.x2,g.y2];
            const [hsx, hsy] = w2s(hwx, hwy);
            const active = (hover?.id === id && hover.sub === `wall-handle-${h}`) || (drag?.kind === 'wall-handle' && drag.wallId === id && drag.handle === h);
            return <rect key={id+h} x={hsx-5} y={hsy-5} width={10} height={10} rx="2"
              className="editor-overlay"
              fill={active ? 'var(--accent)' : 'var(--bg)'}
              stroke="var(--accent)" strokeWidth="1.8" style={{ cursor:'crosshair' }} />;
          });
        })}

        {/* ── Room vertex handles ── */}
        {selection.flatMap((id) => {
          const it = items[id]; if (it?.type !== 'Room') return [];
          const poly = (it as any).geom.polygon as [number,number][];
          return poly.map(([vx,vy], idx) => {
            const [sx, sy] = w2s(vx, vy);
            const active = (hover?.id===id && hover.sub==='room-vertex' && hover.idx===idx) || (drag?.kind==='room-vertex' && drag.roomId===id && drag.idx===idx);
            return <circle key={id+idx} cx={sx} cy={sy} r={active?6.5:4.5}
              className="editor-overlay"
              fill={active?'var(--accent)':'var(--bg)'}
              stroke="var(--accent)" strokeWidth="1.8" style={{ cursor:'move' }} />;
          });
        })}

        {tool==='select' && stairHandles.map(handle=>{
          const [sx,sy]=w2s(...handle.start),[ex,ey]=w2s(...handle.end);
          const active=hover?.id===handle.id&&hover.sub==='stair-flight'&&hover.idx===handle.index||drag?.kind==='stair-flight'&&drag.id===handle.id&&drag.index===handle.index;
          return <g key={handle.id+'flight'+handle.index} className="editor-overlay">
            <title>{`${fr?'Glisser pour régler la longueur de la volée':'Drag to resize the stair flight'} ${handle.index+1}`}</title>
            <line x1={sx} y1={sy} x2={ex} y2={ey} stroke="var(--accent)" strokeWidth={1} strokeDasharray="3 3" opacity={.5} pointerEvents="none"/>
            <rect x={ex-5} y={ey-5} width={10} height={10} rx={1} fill={active?'var(--accent)':'var(--bg)'} stroke="var(--accent)" strokeWidth={2} style={{cursor:'move'}}/>
            <text x={ex+10} y={ey-10} fontSize={10} fill="var(--accent)" fontFamily="var(--font-mono)" pointerEvents="none">V{handle.index+1} · {formatLength(handle.length)}</text>
          </g>;
        })}

        {/* ── Furniture & Technical rotation handles ── */}
        {selection.flatMap((id) => {
          const it = items[id]; if (it?.type !== 'Stair' && it?.type !== 'Furniture' && it?.type !== 'Technical' && it?.type !== 'Column' && it?.type !== 'Chimney') return [];
          const isFur = it.type === 'Furniture';
          const isStructural = it.type === 'Column' || it.type === 'Chimney';
          const { x, y, rotation } = (it as any).geom;
          const fw = isFur ? ((it as any).geom.w ?? 0.6) : 0.4;
          const fd = isFur ? ((it as any).geom.d ?? 0.6) : 0.4;
          const cx = isFur ? (x + fw / 2) : x;
          const cy = isFur ? (y + fd / 2) : y;
          const handleDist = (it.type === 'Stair' ? it.geom.width / 2 : isFur ? fd / 2 : isStructural ? Math.max(it.geom.w, it.geom.d) / 2 : 0.2) + 0.35;
          const hwx = cx + Math.sin(rotation) * handleDist;
          const hwy = cy - Math.cos(rotation) * handleDist;
          const [hsx, hsy] = w2s(hwx, hwy);
          const [csx, csy] = w2s(cx, cy);
          
          const active = (hover?.id === id && hover.sub === 'furniture-rotate') || (drag?.kind === 'furniture-rotate' && drag.id === id);
          return (
            <g key={id + 'rot'} className="editor-overlay">
              <title>{fr ? 'Tourner la sélection (Maj : pas de 15°)' : 'Rotate selection (Shift: 15° steps)'}</title>
              {/* Line from center to handle */}
              <line x1={csx} y1={csy} x2={hsx} y2={hsy} stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.65" pointerEvents="none" />
              {/* Drag handle */}
              <circle cx={hsx} cy={hsy} r={active ? 8 : 6}
                fill={active ? 'var(--accent)' : 'var(--bg)'}
                stroke="var(--accent)" strokeWidth="2" style={{ cursor: 'grab' }} />
              <circle cx={hsx} cy={hsy} r="2" fill={active ? 'var(--bg)' : 'var(--accent)'} pointerEvents="none" />
            </g>
          );
        })}

        {/* Edge midpoint hints for rooms */}
        {tool === 'select' && selection.flatMap((id) => {
          const it = items[id]; if (it?.type !== 'Room') return [];
          const poly = (it as any).geom.polygon as [number,number][];
          return poly.map((_,i) => {
            const [ax,ay]=poly[i],[bx,by]=poly[(i+1)%poly.length];
            const [mx,my]=w2s((ax+bx)/2,(ay+by)/2);
            return <circle key={id+'em'+i} cx={mx} cy={my} r={2.5} className="editor-overlay" fill="var(--accent)" fillOpacity={0.35} pointerEvents="none" />;
          });
        })}

        {/* ── Draw-wall preview ── */}
        {drag?.kind === 'draw-wall' && (() => {
          const [x1,y1]=w2s(drag.x1,drag.y1),[x2,y2]=w2s(drag.x2,drag.y2);
          const len = Math.hypot(drag.x2-drag.x1,drag.y2-drag.y1);
          return <g className="editor-overlay">
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--accent)" strokeWidth="6" strokeOpacity="0.3" strokeLinecap="round" />
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 2" />
            <circle cx={x1} cy={y1} r="3" fill="var(--accent)" />
            <circle cx={x2} cy={y2} r={drag.snapEnd ? 7 : 3}
              fill={drag.snapEnd ? 'oklch(0.6 0.25 145)' : 'var(--accent)'}
              stroke={drag.snapEnd ? 'var(--bg)' : 'none'} strokeWidth="2" />
            {drag.snapEnd && <text x={x2} y={y2-10} textAnchor="middle" fontSize="9" fill="oklch(0.6 0.25 145)" fontFamily="var(--font-mono)">jonction</text>}
            <text x={(x1+x2)/2} y={(y1+y2)/2-8} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--accent)">{formatLength(len)}</text>
          </g>;
        })()}

        {/* ── Draw-room-poly preview ── */}
        {drag?.kind === 'draw-room-poly' && (() => {
          const pts = (drag as any).points as [number, number][];
          const [cx, cy] = (drag as any).cursor;
          const snapPt = (drag as any).snapPt as [number, number] | null;
          const alignX = (drag as any).alignX as number | null;
          const alignY = (drag as any).alignY as number | null;
          const spts = pts.map(p => w2s(p[0], p[1]));
          const [scx, scy] = w2s(cx, cy);
          const pathD = spts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ` L ${scx} ${scy} Z`;
          const [fx, fy] = spts[0];
          const distToStart = Math.hypot(scx - fx, scy - fy);
          const canClose = pts.length >= 3 && distToStart < 12;
          const lastPt = pts.length > 0 ? pts[pts.length - 1] : null;
          const segDist = lastPt ? Math.hypot(cx - lastPt[0], cy - lastPt[1]) : 0;
          const sAlignX = alignX !== null ? w2s(alignX, 0)[0] : null;
          const sAlignY = alignY !== null ? w2s(0, alignY)[1] : null;

          return <g pointerEvents="none" className="editor-overlay">
            {sAlignX !== null && <line x1={sAlignX} y1={0} x2={sAlignX} y2={size.h} stroke="var(--select)" strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />}
            {sAlignY !== null && <line x1={0} y1={sAlignY} x2={size.w} y2={sAlignY} stroke="var(--select)" strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />}
            <path d={pathD} fill="var(--c-room)" fillOpacity="0.2" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 2" />
            {spts.map(([sx, sy], i) => <circle key={i} cx={sx} cy={sy} r={i === 0 && pts.length >= 3 ? 8 : 3} fill="var(--accent)" />)}
            {snapPt && (() => { const [ssx, ssy] = w2s(snapPt[0], snapPt[1]); return <circle cx={ssx} cy={ssy} r="9" fill="none" stroke="var(--select)" strokeWidth="2" />; })()}
            <circle cx={scx} cy={scy} r={canClose ? 8 : 4} fill={canClose ? 'var(--accent)' : 'none'} stroke="var(--accent)" strokeWidth="2" />
            {lastPt && segDist > 0.05 && (() => {
              const [slx, sly] = w2s(lastPt[0], lastPt[1]);
              return <text x={(slx + scx) / 2 + 6} y={(sly + scy) / 2 - 6} fontSize="10" fill="var(--accent)" fontFamily="var(--font-mono)" stroke="var(--bg)" strokeWidth="3" paintOrder="stroke">{formatLength(segDist)}</text>;
            })()}
            {pts.length > 0 && <text x={scx + 10} y={scy - 10} fontSize="10" fill="var(--accent)" fontFamily="var(--font-mono)">
              {pts.length} pts {canClose ? '(Fermer)' : ''}
            </text>}
          </g>;
        })()}

        {/* ── Draw-slab preview ── */}
        {(drag?.kind === 'draw-slab' || drag?.kind === 'draw-roof') && (() => {
          const pts = (drag as any).points as [number, number][];
          const [cx, cy] = (drag as any).cursor;
          const snapPt = (drag as any).snapPt as [number, number] | null;
          const alignX = (drag as any).alignX as number | null;
          const alignY = (drag as any).alignY as number | null;
          const spts = pts.map(p => w2s(p[0], p[1]));
          const [scx, scy] = w2s(cx, cy);
          const pathD = spts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ` L ${scx} ${scy} Z`;
          const [fx, fy] = spts[0];
          const distToStart = Math.hypot(scx - fx, scy - fy);
          const canClose = pts.length >= 3 && distToStart < 12;
          const lastPt = pts.length > 0 ? pts[pts.length - 1] : null;
          const segDist = lastPt ? Math.hypot(cx - lastPt[0], cy - lastPt[1]) : 0;
          const sAlignX = alignX !== null ? w2s(alignX, 0)[0] : null;
          const sAlignY = alignY !== null ? w2s(0, alignY)[1] : null;

          return <g pointerEvents="none" className="editor-overlay">
            {/* Alignment guide lines */}
            {sAlignX !== null && <line x1={sAlignX} y1={0} x2={sAlignX} y2={size.h} stroke="var(--select)" strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />}
            {sAlignY !== null && <line x1={0} y1={sAlignY} x2={size.w} y2={sAlignY} stroke="var(--select)" strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />}
            {/* Polygon fill */}
            <path d={pathD} fill="var(--ink-4)" fillOpacity="0.25" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 2" />
            {spts.map(([sx, sy], i) => <circle key={i} cx={sx} cy={sy} r={i === 0 && pts.length >= 3 ? 8 : 3} fill="var(--accent)" />)}
            {/* Point-snap indicator */}
            {snapPt && (() => { const [ssx, ssy] = w2s(snapPt[0], snapPt[1]); return <circle cx={ssx} cy={ssy} r="9" fill="none" stroke="var(--select)" strokeWidth="2" />; })()}
            {/* Cursor */}
            <circle cx={scx} cy={scy} r={canClose ? 8 : 4} fill={canClose ? 'var(--accent)' : 'none'} stroke="var(--accent)" strokeWidth="2" />
            {/* Segment length */}
            {lastPt && segDist > 0.05 && (() => {
              const [slx, sly] = w2s(lastPt[0], lastPt[1]);
              return <text x={(slx + scx) / 2 + 6} y={(sly + scy) / 2 - 6} fontSize="10" fill="var(--accent)" fontFamily="var(--font-mono)" stroke="var(--bg)" strokeWidth="3" paintOrder="stroke">{formatLength(segDist)}</text>;
            })()}
            {pts.length > 0 && <text x={scx + 10} y={scy - 10} fontSize="10" fill="var(--accent)" fontFamily="var(--font-mono)">
              {pts.length} pts {canClose ? '(Fermer)' : ''}
            </text>}
          </g>;
        })()}

        {/* ── Draw-furniture preview ── */}
        {drag?.kind === 'draw-fur' && (() => {
          const rx1=Math.min(drag.x1,drag.x2),ry1=Math.min(drag.y1,drag.y2);
          const rx2=Math.max(drag.x1,drag.x2),ry2=Math.max(drag.y1,drag.y2);
          const [sx1,sy1]=w2s(rx1,ry1),[sx2,sy2]=w2s(rx2,ry2);
          return <g className="editor-overlay">
            <rect x={sx1} y={sy1} width={sx2-sx1} height={sy2-sy1} fill="var(--c-furniture)" fillOpacity="0.25" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 2" />
            <text x={(sx1+sx2)/2} y={(sy1+sy2)/2} textAnchor="middle" dominantBaseline="middle" fontSize="11" fontFamily="var(--font-mono)" fill="var(--accent)">{formatDims([rx2-rx1, ry2-ry1])}</text>
          </g>;
        })()}
        
        {/* ── Measure preview ── */}
        {drag?.kind === 'measure' && (() => {
          const [mx1, my1] = w2s(drag.x1, drag.y1);
          const [mx2, my2] = w2s(drag.x2, drag.y2);
          const d = Math.hypot(drag.x2 - drag.x1, drag.y2 - drag.y1);
          const ang = Math.atan2(my2 - my1, mx2 - mx1);
          return (
            <g pointerEvents="none" className="editor-overlay">
              <line x1={mx1} y1={my1} x2={mx2} y2={my2} stroke="var(--accent)" strokeWidth="2" strokeDasharray="5 3" />
              <circle cx={mx1} cy={my1} r="4" fill="var(--bg)" stroke="var(--accent)" strokeWidth="2" />
              <circle cx={mx2} cy={my2} r="4" fill="var(--bg)" stroke="var(--accent)" strokeWidth="2" />
              <g transform={`translate(${(mx1+mx2)/2} ${(my1+my2)/2}) rotate(${ang * 180 / Math.PI})`}>
                <rect x="-35" y="-18" width="70" height="16" rx="4" fill="var(--accent)" />
                <text y="-6" textAnchor="middle" fontSize="11" fontWeight="700" fill="#ffffff" fontFamily="var(--font-mono)">
                  {formatLength(d)}
                </text>
              </g>
            </g>
          );
        })()}

        {/* ── Dimension preview ── */}
        {drag?.kind === 'draw-dim' && (() => {
          const [sx1, sy1] = w2s(drag.x1, drag.y1);
          const [sx2, sy2] = w2s(drag.x2, drag.y2);
          const dist = Math.hypot(drag.x2 - drag.x1, drag.y2 - drag.y1);
          const ang = Math.atan2(sy2 - sy1, sx2 - sx1);
          return (
            <g pointerEvents="none" className="editor-overlay">
              <line x1={sx1} y1={sy1} x2={sx2} y2={sy2} stroke="var(--accent)" strokeWidth="1" strokeDasharray="2 2" />
              <g transform={`translate(${(sx1+sx2)/2},${(sy1+sy2)/2}) rotate(${ang * 180 / Math.PI})`}>
                <text y="-4" textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--accent)" fontFamily="var(--font-mono)">
                  {formatLength(dist)}
                </text>
              </g>
            </g>
          );
        })()}

        {/* ── Tool cursor ── */}
        {!drag && cursorWorld && tool !== 'select' && (() => {
          if (tool==='Door'||tool==='Window') {
            const cw=closestWall(...cursorWorld);
            if (cw&&cw.d<0.6) {
              const [px,py]=w2s(cw.px,cw.py);
              const c=tool==='Door'?'var(--c-door)':'var(--c-window)';
              return <g pointerEvents="none" className="editor-overlay"><circle cx={px} cy={py} r="8" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="3 2" /><circle cx={px} cy={py} r="2.5" fill={c} /></g>;
            }
          }
          const [sx,sy]=w2s(snap(cursorWorld[0]),snap(cursorWorld[1]));
          return <circle cx={sx} cy={sy} r="3" className="editor-overlay" fill="var(--accent)" pointerEvents="none" />;
        })()}
      </svg>


      {/* Vertex hint for rooms and walls */}
      {tool === 'select' && selection.some((id) => ['Room', 'Wall'].includes(items[id]?.type)) && (
        <div style={{ position:'absolute', bottom:8, left:'50%', transform:'translateX(-50%)', background:'var(--panel)', border:'1px solid var(--border)', borderRadius:5, padding:'3px 10px', fontSize:10.5, fontFamily:'var(--font-mono)', color:'var(--ink-3)', pointerEvents:'none', whiteSpace:'nowrap' }}>
          {makeT(lang)("Double-click edge → split/vertex · Right-click vertex → delete")}
        </div>
      )}

      {/* Marquee */}
      {marquee && (
        <div className="marquee" style={{ position:'absolute', left:Math.min(marquee.x1,marquee.x2), top:Math.min(marquee.y1,marquee.y2), width:Math.abs(marquee.x2-marquee.x1), height:Math.abs(marquee.y2-marquee.y1) }} />
      )}

      {/* Coordinates HUD */}
      {cursorWorld && (
        <div style={{ position:'absolute', bottom:8, right:8, background:'var(--panel)', border:'1px solid var(--border)', borderRadius:5, padding:'3px 8px', fontSize:10.5, fontFamily:'var(--font-mono)', color:'var(--ink-3)', pointerEvents:'none', zIndex: 10 }}>
          X: {cursorWorld[0].toFixed(2)}m · Y: {cursorWorld[1].toFixed(2)}m
        </div>
      )}
    </div>
  );
}
