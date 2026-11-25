import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { setSurveyLanguage, surveyLangOf, surveyLanguage, tr as surveyTr } from '@skaitch/core/survey/lang';
import { Check, Minus, Plus, Slash, Trash2, Undo2, X } from 'lucide-react';
import { formatLength, formatLengthValue, lengthPlaceholder, parseLength, unitLabel } from '@skaitch/core/survey/units';
import { useLengthUnit } from './lengthUnit';
import { SURVEY_STRUCTURE_CATEGORY, alignedFaces, duplicateOpenings, type DuplicateOpening, faceOpenings, isLinked, linkedFaces, linkStretch, wallLinks, roomLabelPoint, surveyWarnings, type MeasureSource, type OpeningKind, type Survey, type SurveyOpening, type SurveyRoom } from '@skaitch/core/survey/surveyFile';
import { alignFaces, deleteOpening, clearWallLength, renameWall, wallLabel, linkFaces, unlinkFaces, addDiagonal, addOpening, addPolygonRoom, deleteVertex, insertVertex, addRectangleRoom, moveOpening, moveRoom, moveVertex, openingCotes, setOpeningCote, setWallLength, setWallThickness } from '@skaitch/core/survey/edit';
import { setSurveyFurniture } from '@skaitch/core/survey/edit';
import { furniturePlanFrame, pointInPolygon, SURVEY_FURNITURE_MODELS } from '@skaitch/core/survey/surveyFile';
import { catalogueLabel } from '@skaitch/core/lib/defaultNames';
import SurveyFurnitureFootprint from './SurveyFurnitureFootprint';

const CLOSED_HINTS_KEY = 'skaitch-survey:closed-hints';
const HINTS_RESET_EVENT = 'skaitch-survey:hints-reset';

/** Shows again every help message the user closed on this device. */
export function reopenHints() {
  try { localStorage.removeItem(CLOSED_HINTS_KEY); } catch { /* private mode */ }
  window.dispatchEvent(new Event(HINTS_RESET_EVENT));
}

interface Props {
  survey: Survey;
  levelId: string;
  /** `gesture`: a later step of the same drag, which undo treats as one edit with the first. */
  onChange: (survey: Survey, gesture?: boolean) => void;
  selectedRoomId: string | null;
  onSelectRoom: (roomId: string | null) => void;
  selectedOpeningId?: string | null;
  onSelectOpening?: (openingId: string | null) => void;
  furnitureModel?: string;
  /** Element types the user locked to focus on another kind of edit: a locked type cannot be moved or changed on the plan. */
  locked?: { walls?: boolean; openings?: boolean; furniture?: boolean };
  selectedFurnitureId?: string | null;
  onSelectFurniture?: (id: string | null) => void;
  /** Active tool; door/window: the next tap on a wall places one there. */
  tool: SurveyTool;
  onToolChange: (tool: SurveyTool) => void;
  /** Two faces were just linked: the app may ask for the measured offset and thickness. */
  onLinked?: (a: { roomId: string; wallId: string }, b: { roomId: string; wallId: string }, kind: 'link' | 'alignment') => void;
  lang: string;
  /** Theme colours of the plan (strokes, accents, help banner). */
  palette?: SurveyEditorPalette;
}

type Cote = 'before' | 'width' | 'after';
/** A value typed directly on the plan, in place of the pill it edits (`at`: world point of the pill). */
/** `original`: the exact value shown, kept when the rounded text is not changed. */
type Editing = { at: Pt; value: string; error?: string; original?: number } & (
  | { target: 'wall'; roomId: string; wallId: string; source: MeasureSource; thickness: string; thicknessMeasured: boolean; name: string }
  | { target: 'opening'; roomId: string; openingId: string; cote: Cote }
  | { target: 'diagonal'; roomId: string; from: number; to: number; source: MeasureSource });

/** Inner-face geometry of an opening: its two jambs, the wall direction and the outward normal. */
function openingFrame(room: SurveyRoom, o: SurveyOpening) {
  const wall = room.walls.find(w => w.id === o.wallId)!;
  const a = room.polygon[wall.from], b = room.polygon[wall.to];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const d: [number, number] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const n: [number, number] = [d[1], -d[0]];
  const at = (s: number): [number, number] => [a[0] + d[0] * s, a[1] + d[1] * s];
  return { wall, a, b, d, n, at, len };
}

/** `link`: tap a wall, then the wall of another room facing it, to say they are one wall. */
export type SurveyTool = 'select' | 'rect' | 'polygon' | 'door' | 'window' | 'link' | 'furniture';
type Pt = [number, number];
type Drag =
  | { kind: 'draw'; start: Pt; end: Pt }
  | { kind: 'move'; roomId: string; start: Pt; last: Pt; moved: boolean }
  | { kind: 'opening'; roomId: string; openingId: string; startAlong: number; startOffset: number }
  | { kind: 'furniture'; roomId: string; id: string; start: Pt; center: Pt }
  | { kind: 'rotate-furniture'; roomId: string; id: string }
  | { kind: 'place-furniture'; startClient: Pt }
  | { kind: 'vertex'; roomId: string; index: number; moved: boolean; startClient: Pt; refused?: string }
  | { kind: 'pan'; startClient: Pt; origin: Pt };

/** SkAItch Survey palette (prototype v0.11). */
const BASE_C = { brand: '#087f84', accent: '#13a9a2', ink: '#163942', muted: '#81959a', wall: '#405d66', wallDim: '#9ab0b4', fill: '#f1f6f6', fillSel: '#e7f5f2', orange: '#df9043',
  /** Help banner: background while drawing / placing, background while selecting, text. */
  hint: '#087f84e8', hintIdle: '#143d49e8', hintInk: '#fff' };
/** Colours of the editor an app can override (theme). */
export type SurveyEditorPalette = Partial<typeof BASE_C> & {
  /** Recolours the editor's tinted greys (texts, guides, fields) to match the theme. */
  tint?: (hex: string) => string;
};

const SNAP = 0.05;
const MIN_SIDE = 0.5;
// Sketch positions only, to the millimetre; typed measurements are never rounded.
const snap = (v: number) => Number((Math.round(v / SNAP) * SNAP).toFixed(3));

/**
 * Touch sketch editor of a survey level (ADR 0007): draw rectangles with a finger, move them,
 * tap a cote to type the measured length. World y grows upward like the BIM model.
 */
export default function SurveyEditor({
  survey, levelId, onChange, selectedRoomId, onSelectRoom, selectedOpeningId = null, onSelectOpening = () => {},
  furnitureModel, locked = {}, selectedFurnitureId, onSelectFurniture, tool, onToolChange, onLinked, lang, palette,
}: Props) {
  const T = (hex: string) => palette?.tint?.(hex) ?? hex;
  const C = { ...(Object.fromEntries(Object.entries(BASE_C).map(([k, v]) => [k, T(v)])) as typeof BASE_C), ...palette };
  // Texts follow the interface language, through the survey language tables (11 languages).
  const tr = (fr: string, en: string) => { if (surveyLanguage() !== surveyLangOf(lang)) setSurveyLanguage(lang); return surveyTr(fr, en); };
  const svg = useRef<SVGSVGElement>(null);
  const mode = tool === 'rect' ? 'draw' : tool === 'polygon' ? 'polygon' : 'select';
  const placing: OpeningKind | null = tool === 'door' || tool === 'window' ? tool : null;
  const placingFurniture = tool === 'furniture' ? SURVEY_FURNITURE_MODELS.find(m => m.id === furnitureModel) : undefined;
  /** First wall picked in `link` mode. */
  const unit = useLengthUnit();
  const fmt = (m: number) => formatLength(m, unit);
  const fmtValue = (m: number) => formatLengthValue(m, unit);
  const [linkFirst, setLinkFirst] = useState<{ roomId: string; wallId: string } | null>(null);
  /** The two faces just linked: drawn with a short animation that joins them. */
  const [justLinked, setJustLinked] = useState<{ faces: { roomId: string; wallId: string }[]; key: number } | null>(null);
  useEffect(() => {
    if (!justLinked) return;
    const t = setTimeout(() => setJustLinked(null), 1800);
    return () => clearTimeout(t);
  }, [justLinked]);
  useEffect(() => { if (tool !== 'link') setLinkFirst(null); }, [tool]);
  // Leaving the outline tool drops an unfinished outline.
  useEffect(() => { if (mode !== 'polygon') setPoly([]); }, [mode]);
  const setMode = (m: 'select') => onToolChange(m);
  const [view, setView] = useState({ x: -1, y: -1, scale: 60 }); // px per metre; x/y: world at bottom-left
  const [size, setSize] = useState({ w: 360, h: 480 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  // The cote being typed may disappear (undo, deleted point, room made rectangular): close its bubble.
  useEffect(() => {
    if (!editing) return;
    const room = survey.levels.flatMap(l => l.rooms).find(r => r.id === editing.roomId);
    const gone = !room
      || (editing.target === 'wall' && !room.walls.some(w => w.id === editing.wallId))
      || (editing.target === 'opening' && !room.openings?.some(o => o.id === editing.openingId))
      || (editing.target === 'diagonal' && (editing.from >= room.polygon.length || editing.to >= room.polygon.length));
    if (gone) setEditing(null);
  }, [survey, editing]);
  /** Last measuring mode chosen (laser, tape, typed), kept on the device for the next cotes. */
  const [lastSource, setLastSource] = useState<MeasureSource>(() => {
    try { const v = localStorage.getItem('skaitch-survey:source'); return v === 'tape' || v === 'manual' ? v : 'laser'; } catch { return 'laser'; }
  });
  /** Help messages closed by the user, kept on the device: each one stays hidden once closed. */
  const [closedHints, setClosedHints] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(CLOSED_HINTS_KEY) ?? '[]'); } catch { return []; }
  });
  useEffect(() => {
    const reopen = () => setClosedHints([]);
    window.addEventListener(HINTS_RESET_EVENT, reopen);
    return () => window.removeEventListener(HINTS_RESET_EVENT, reopen);
  }, []);
  const closeHint = (text: string) => setClosedHints(prev => {
    const next = [...prev, text];
    try { localStorage.setItem(CLOSED_HINTS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });
  const chooseSource = (src: MeasureSource) => { setLastSource(src); try { localStorage.setItem('skaitch-survey:source', src); } catch { /* private mode */ } };
  const [poly, setPoly] = useState<Pt[]>([]);
  const [selectedVertex, setSelectedVertex] = useState<{ roomId: string; index: number } | null>(null);
  /** Measuring a diagonal on the plan: its first corner, waiting for the second. */
  const [diagFrom, setDiagFrom] = useState<{ roomId: string; index: number } | null>(null);
  const level = survey.levels.find(l => l.id === levelId)!;
  const flagged = new Set(surveyWarnings(survey).flatMap(w => w.wallIds));

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    let prevH: number | null = null;
    const ro = new ResizeObserver(([e]) => {
      // Keep the top of the plan in place when panels below open or close.
      const h = e.contentRect.height, before = prevH;
      if (before !== null && before !== h) setView(v => ({ ...v, y: v.y + (before - h) / v.scale }));
      prevH = h;
      setSize({ w: e.contentRect.width, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** The view framing these points with room for their cotes. */
  const frame = (pts: Pt[]) => {
    const margin = 1.2;
    const minX = Math.min(...pts.map(p => p[0])) - margin, maxX = Math.max(...pts.map(p => p[0])) + margin;
    const minY = Math.min(...pts.map(p => p[1])) - margin, maxY = Math.max(...pts.map(p => p[1])) + margin;
    const scale = Math.min(200, size.w / (maxX - minX), size.h / (maxY - minY));
    return { scale, x: (minX + maxX) / 2 - size.w / scale / 2, y: (minY + maxY) / 2 - size.h / scale / 2 };
  };

  // Once the real size is known, frame the selected room, or every room when none is selected.
  const fitted = useRef(false);
  useEffect(() => {
    const el = svg.current;
    if (fitted.current || !el?.clientWidth || Math.abs(el.clientWidth - size.w) > 1 || Math.abs(el.clientHeight - size.h) > 1) return;
    fitted.current = true;
    const selectedRoom = level.rooms.find(r => r.id === selectedRoomId);
    const pts = selectedRoom ? selectedRoom.polygon : level.rooms.flatMap(r => r.polygon);
    if (!pts.length) return;
    setView(frame(pts));
  }, [size, level.rooms]);

  // Selecting a room zooms onto it with a short animation.
  const prevSelected = useRef(selectedRoomId);
  useEffect(() => {
    if (prevSelected.current === selectedRoomId) return;
    prevSelected.current = selectedRoomId;
    const room = level.rooms.find(r => r.id === selectedRoomId);
    if (!fitted.current || !room?.polygon.length) return;
    const target = frame(room.polygon);
    let from: typeof target | null = null;
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 280), k = 1 - (1 - t) ** 3;
      setView(v => {
        from ??= v;
        // Interpolate the scale geometrically and the centre linearly, so the zoom feels even.
        const scale = from.scale * (target.scale / from.scale) ** k;
        const c0 = [from.x + size.w / from.scale / 2, from.y + size.h / from.scale / 2];
        const c1 = [target.x + size.w / target.scale / 2, target.y + size.h / target.scale / 2];
        const cx = c0[0] + (c1[0] - c0[0]) * k, cy = c0[1] + (c1[1] - c0[1]) * k;
        return { scale, x: cx - size.w / scale / 2, y: cy - size.h / scale / 2 };
      });
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [selectedRoomId]);

  const toScreen = ([x, y]: Pt): Pt => [(x - view.x) * view.scale, size.h - (y - view.y) * view.scale];
  const toWorld = (e: { clientX: number; clientY: number }): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / view.scale + view.x, (size.h - (e.clientY - r.top)) / view.scale + view.y];
  };

  const gestureStarted = useRef(false);
  /** Emits a change made while dragging; only the first one of a drag starts a new undo step. */
  const emitDrag = (next: Survey) => { onChange(next, gestureStarted.current); gestureStarted.current = true; };

  function placeFurniture(center: Pt) {
    const room = level.rooms.find(r => r.id === selectedRoomId);
    if (!placingFurniture || !room || !pointInPolygon(center, room.polygon)) return;
    const { width, depth } = placingFurniture.defaults;
    // Columns and chimneys default to the room's ceiling height.
    const height = placingFurniture.category === SURVEY_STRUCTURE_CATEGORY && room.ceilingHeight_m ? room.ceilingHeight_m : placingFurniture.defaults.height;
    const id = crypto.randomUUID();
    try {
      onChange(setSurveyFurniture(survey, room.id, {
        id, model: placingFurniture.id, center, width_m: width, depth_m: depth ?? width, height_m: height, rotation: 0,
      }));
      onSelectFurniture?.(id);
      onToolChange('select');
    } catch (err) { setNotice((err as Error).message); }
  }

  /** Fingers on the plan (client coordinates), and the pinch in progress when two are down. */
  const pointers = useRef(new Map<number, Pt>());
  const pinch = useRef<{ dist: number; world: Pt; scale: number } | null>(null);
  /** The current touch added an outline point: a pinch that follows takes it back. */
  const addedPolyPoint = useRef(false);
  const svgPoint = ([cx, cy]: Pt): Pt => { const r = svg.current!.getBoundingClientRect(); return [cx - r.left, cy - r.top]; };

  function startPinch() {
    const [a, b] = [...pointers.current.values()];
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const [sx, sy] = svgPoint(mid);
    pinch.current = { dist: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, world: [sx / view.scale + view.x, (size.h - sy) / view.scale + view.y], scale: view.scale };
    // The first finger's gesture is abandoned for the pinch.
    setDrag(null);
    if (addedPolyPoint.current) { setPoly(pts => pts.slice(0, -1)); addedPolyPoint.current = false; }
  }

  function down(e: ReactPointerEvent<SVGSVGElement>) {
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.current.size >= 2) {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      startPinch();
      return;
    }
    if (pinch.current) return;
    gestureStarted.current = false;
    setSelectedVertex(null);
    if (diagFrom && !(e.target as Element).closest('[data-vertex]')) setDiagFrom(null);
    if (editing) return;
    const target = (e.target as Element).closest('[data-room]');
    const openingEl = (e.target as Element).closest('[data-opening]');
    const p = toWorld(e);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (placingFurniture) {
      setDrag({ kind: 'place-furniture', startClient: [e.clientX, e.clientY] });
      return;
    }
    if (tool === 'link') {
      // Nearest wall within 40 px. First tap: a wall of the active room (a free one to link, a linked
      // one to unlink). Second tap: a free wall of another room, facing the first one (or another
      // free wall of the same room, to change the first choice).
      let hit: { roomId: string; wallId: string; dist: number; unlink?: { roomId: string; wallId: string } } | null = null;
      const candidates = level.rooms.filter(r => linkFirst || !selectedRoomId || r.id === selectedRoomId);
      for (const room of candidates) for (const wall of room.walls) {
        const a = room.polygon[wall.from], b = room.polygon[wall.to];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const along = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / len;
        if (along < 0 || along > len) continue;
        const dist = Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / len;
        if (dist * view.scale < 40 && (!hit || dist < hit.dist)) {
          // First tap on a linked stretch (purple): that link is the one to remove.
          const s = (along / (len || 1)) * wall.length_m;
          const on = linkFirst ? undefined : linkedFaces(level, wall).find(f => { const [lo, hi] = linkStretch(wall, f); return s >= lo && s <= hi; });
          hit = { roomId: room.id, wallId: wall.id, dist, unlink: on && { roomId: on.room.id, wallId: on.wall.id } };
        }
      }
      if (!hit) return;
      if (hit.unlink) {
        try { onChange(unlinkFaces(survey, hit, hit.unlink)); setNotice(tr('Murs déliés : chaque pièce a de nouveau son propre mur (↶ pour annuler).', 'Walls unlinked: each room has its own wall again (↶ to undo).')); }
        catch (err) { setNotice((err as Error).message); }
        return;
      }
      if (!linkFirst || linkFirst.roomId === hit.roomId) { setLinkFirst({ roomId: hit.roomId, wallId: hit.wallId }); return; }
      try {
        // A wall running the same way continues the first one; a wall running the other way faces it.
        const second = { roomId: hit.roomId, wallId: hit.wallId };
        const dir = (f: { roomId: string; wallId: string }) => {
          const r = level.rooms.find(x => x.id === f.roomId)!, w = r.walls.find(x => x.id === f.wallId)!;
          const [a, b] = [r.polygon[w.from], r.polygon[w.to]];
          return [b[0] - a[0], b[1] - a[1]];
        };
        const [d1, d2] = [dir(linkFirst), dir(second)];
        const same = d1[0] * d2[0] + d1[1] * d2[1] > 0;
        const next = same ? alignFaces(survey, linkFirst, second) : linkFaces(survey, linkFirst, second);
        onChange(next);
        // Both rooms may already hold the same opening on these faces: offer to keep one.
        const dups = same ? [] : duplicateOpenings(next.levels.find(l => l.id === levelId)!, [linkFirst, second]);
        setMerge(dups.length ? { survey: next, dups } : null);
        setJustLinked({ faces: [linkFirst, second], key: Date.now() });
        onLinked?.(linkFirst, second, same ? 'alignment' : 'link');
        setNotice(same ? tr('Murs dans le prolongement : c’est le même alignement.', 'Walls aligned: one continues the other.') : tr('Murs liés : c’est le même mur.', 'Walls linked: they are one wall.'));
        onToolChange('select');
      } catch (err) { setNotice((err as Error).message); }
      setLinkFirst(null);
      return;
    }
    if (placing) {
      // Nearest inner face within 40 px of the tap.
      let best: { roomId: string; wallId: string; along: number; dist: number } | null = null;
      // Only the selected room's walls: rooms are switched with the room buttons, never by a tap.
      for (const room of level.rooms.filter(r => !selectedRoomId || r.id === selectedRoomId)) for (const wall of room.walls) {
        const a = room.polygon[wall.from], b = room.polygon[wall.to];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const along = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / len;
        if (along < 0 || along > len) continue;
        const dist = Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / len;
        if (dist * view.scale < 40 && (!best || dist < best.dist)) best = { roomId: room.id, wallId: wall.id, along: along * (wall.length_m / len), dist };
      }
      if (best) {
        try {
          const r = addOpening(survey, best.roomId, best.wallId, placing, best.along);
          onChange(r.survey);
          if (!selectedRoomId) onSelectRoom(best.roomId);
          onSelectOpening(r.openingId);
          onToolChange('select');
        } catch (err) { setNotice((err as Error).message); }
      }
      return;
    }
    if (mode === 'polygon') {
      const q: Pt = [snap(p[0]), snap(p[1])];
      const first = poly[0] && toScreen(poly[0]);
      const tap = toScreen(q);
      if (poly.length >= 3 && first && Math.hypot(first[0] - tap[0], first[1] - tap[1]) < 24) closePolygon();
      else { setPoly([...poly, q]); addedPolyPoint.current = true; }
      return;
    }
    const rotateId = (e.target as Element).closest('[data-furniture-rotate]')?.getAttribute('data-furniture-rotate');
    const rotateRoom = level.rooms.find(r => r.id === selectedRoomId);
    const pan = () => setDrag({ kind: 'pan', startClient: [e.clientX, e.clientY], origin: [view.x, view.y] });
    // A locked element type is out of play: touching it just pans the plan.
    if (locked.furniture && (e.target as Element).closest('[data-survey-furniture]')) { pan(); return; }
    if (tool === 'select' && rotateId && rotateRoom && !rotateRoom.frozen) {
      setDrag({ kind: 'rotate-furniture', roomId: rotateRoom.id, id: rotateId });
      return;
    }
    const furnitureId = (e.target as Element).closest('[data-survey-furniture]')?.getAttribute('data-survey-furniture');
    const activeRoom = level.rooms.find(r => r.id === selectedRoomId);
    const furniture = activeRoom?.furniture?.find(f => f.id === furnitureId);
    if (tool === 'select' && activeRoom && furniture) {
      onSelectOpening(null);
      onSelectFurniture?.(furniture.id);
      if (!activeRoom.frozen) setDrag({ kind: 'furniture', roomId: activeRoom.id, id: furniture.id, start: p, center: furniture.center });
      return;
    }
    onSelectFurniture?.(null);
    const addEl = (e.target as Element).closest('[data-add-vertex]');
    if (locked.walls && mode === 'select' && (addEl || (e.target as Element).closest('[data-vertex]'))) { pan(); return; }
    if (addEl && mode === 'select') {
      // « + » in the middle of a wall: a new point there, selected so it can be dragged or deleted.
      const [roomId, wallId, t] = addEl.getAttribute('data-add-vertex')!.split('|');
      try {
        const r = insertVertex(survey, roomId, wallId, Number(t));
        onChange(r.survey);
        setSelectedVertex({ roomId, index: r.index });
      } catch (err) { setNotice((err as Error).message); }
      return;
    }
    const vertexEl = (e.target as Element).closest('[data-vertex]');
    if (vertexEl && mode === 'select') {
      const [roomId, index] = vertexEl.getAttribute('data-vertex')!.split('|');
      setDrag({ kind: 'vertex', roomId, index: Number(index), moved: false, startClient: [e.clientX, e.clientY] });
      return;
    }
    // An opening, a room or anything else of another room is not for this room: the plan just pans.
    const viewing = openingEl?.getAttribute('data-opening')!.split('|')[2];
    if (openingEl && mode === 'select' && locked.openings) { pan(); return; }
    if (openingEl && mode === 'select' && (!selectedRoomId || viewing === selectedRoomId)) {
      const [roomId, openingId] = openingEl.getAttribute('data-opening')!.split('|');
      const room = level.rooms.find(r => r.id === roomId)!;
      const o = room.openings!.find(x => x.id === openingId)!;
      const f = openingFrame(room, o);
      if (!selectedRoomId) onSelectRoom(viewing!);
      onSelectOpening(openingId);
      setDrag({ kind: 'opening', roomId, openingId, startOffset: o.offset_m, startAlong: (p[0] - f.a[0]) * f.d[0] + (p[1] - f.a[1]) * f.d[1] });
      return;
    }
    onSelectOpening(null);
    const tappedRoom = target?.getAttribute('data-room');
    if (tappedRoom && mode === 'select' && (!selectedRoomId || tappedRoom === selectedRoomId)) {
      if (!selectedRoomId) onSelectRoom(tappedRoom);
      if (locked.walls) pan();
      else setDrag({ kind: 'move', roomId: tappedRoom, start: p, last: p, moved: false });
    } else if (mode === 'draw') {
      setDrag({ kind: 'draw', start: [snap(p[0]), snap(p[1])], end: [snap(p[0]), snap(p[1])] });
    } else {
      // Keeps the selected room: only the room buttons change it.
      setDrag({ kind: 'pan', startClient: [e.clientX, e.clientY], origin: [view.x, view.y] });
    }
  }

  function move(e: ReactPointerEvent<SVGSVGElement>) {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch.current) {
      // Two fingers: zoom by their spread, keeping the plan point between them under them (pan included).
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const p0 = pinch.current;
      const scale = Math.min(400, Math.max(10, p0.scale * (Math.hypot(b[0] - a[0], b[1] - a[1]) / p0.dist)));
      const [sx, sy] = svgPoint([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      setView({ scale, x: p0.world[0] - sx / scale, y: p0.world[1] - (size.h - sy) / scale });
      return;
    }
    if (!drag) return;
    const p = toWorld(e);
    if (drag.kind === 'draw') setDrag({ ...drag, end: [snap(p[0]), snap(p[1])] });
    else if (drag.kind === 'vertex') {
      const q: Pt = [snap(p[0]), snap(p[1])];
      const cur = level.rooms.find(r => r.id === drag.roomId)!.polygon[drag.index];
      // A drag is a finger that moved, whether or not the position is accepted: it never ends as a tap.
      const moved = drag.moved || Math.hypot(e.clientX - drag.startClient[0], e.clientY - drag.startClient[1]) > 8;
      let refused = drag.refused;
      if (moved && (q[0] !== cur[0] || q[1] !== cur[1])) {
        try { emitDrag(moveVertex(survey, drag.roomId, drag.index, q)); refused = undefined; }
        // An invalid position (crossing outline, opening no longer fits) is not taken; the point stays at the last valid one.
        catch (err) { refused = (err as Error).message; }
      }
      if (moved !== drag.moved || refused !== drag.refused) setDrag({ ...drag, moved, refused });
    } else if (drag.kind === 'opening') {
      const room = level.rooms.find(r => r.id === drag.roomId)!;
      const o = room.openings!.find(x => x.id === drag.openingId)!;
      const f = openingFrame(room, o);
      const along = (p[0] - f.a[0]) * f.d[0] + (p[1] - f.a[1]) * f.d[1];
      // Sketch distance converted to the measured face length, 1 cm steps.
      const offset = Math.round((drag.startOffset + (along - drag.startAlong) * (f.wall.length_m / f.len)) * 100) / 100;
      if (offset !== o.offset_m) emitDrag(moveOpening(survey, drag.roomId, drag.openingId, offset));
    } else if (drag.kind === 'furniture') {
      const room = level.rooms.find(r => r.id === drag.roomId);
      const furniture = room?.furniture?.find(f => f.id === drag.id);
      const dx = snap(p[0] - drag.start[0]), dy = snap(p[1] - drag.start[1]);
      const center: Pt = [drag.center[0] + dx, drag.center[1] + dy];
      if (room && !room.frozen && furniture && (center[0] !== furniture.center[0] || center[1] !== furniture.center[1])
        && pointInPolygon(center, room.polygon)) emitDrag(setSurveyFurniture(survey, room.id, { ...furniture, center }));
    } else if (drag.kind === 'rotate-furniture') {
      const room = level.rooms.find(r => r.id === drag.roomId);
      const furniture = room?.furniture?.find(f => f.id === drag.id);
      if (room && furniture) {
        // The handle sits in front of the piece (local +y): its angle to the centre, minus 90°, is the rotation; 5° steps.
        const step = Math.PI / 36;
        const raw = Math.atan2(p[1] - furniture.center[1], p[0] - furniture.center[0]) - Math.PI / 2;
        const rotation = +(((Math.round(raw / step) * step) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)).toFixed(6);
        if (rotation !== furniture.rotation) emitDrag(setSurveyFurniture(survey, room.id, { ...furniture, rotation }));
      }
    } else if (drag.kind === 'place-furniture') {
      if (Math.hypot(e.clientX - drag.startClient[0], e.clientY - drag.startClient[1]) > 8) setDrag(null);
    } else if (drag.kind === 'pan') {
      setView(v => ({ ...v, x: drag.origin[0] - (e.clientX - drag.startClient[0]) / v.scale, y: drag.origin[1] + (e.clientY - drag.startClient[1]) / v.scale }));
    } else {
      const dx = snap(p[0] - drag.start[0]) - snap(drag.last[0] - drag.start[0]);
      const dy = snap(p[1] - drag.start[1]) - snap(drag.last[1] - drag.start[1]);
      if (dx || dy) {
        try { emitDrag(moveRoom(survey, drag.roomId, dx, dy)); setDrag({ ...drag, last: p, moved: true }); }
        catch (err) { setNotice((err as Error).message); setDrag(null); }
      }
    }
  }

  function up(e: ReactPointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
    addedPolyPoint.current = false;
    if (pinch.current) {
      // The pinch ends with its last finger; nothing else happens on that release.
      if (pointers.current.size === 0) pinch.current = null;
      setDrag(null);
      return;
    }
    if (drag?.kind === 'place-furniture' && Math.hypot(e.clientX - drag.startClient[0], e.clientY - drag.startClient[1]) <= 8) placeFurniture(toWorld(e));
    if (drag?.kind === 'vertex' && drag.refused) {
      // Say why the point did not follow the finger.
      console.warn('[survey] vertex move refused:', drag.refused);
      setNotice(drag.refused);
    }
    // A tap on a vertex (no drag): second corner of a diagonal being measured, or selection.
    if (drag?.kind === 'vertex' && !drag.moved) {
      const room = level.rooms.find(r => r.id === drag.roomId)!;
      const n = room.polygon.length, [i, j] = [diagFrom?.index ?? -1, drag.index];
      if (diagFrom && diagFrom.roomId === drag.roomId && i !== j && (j - i + n) % n !== 1 && (i - j + n) % n !== 1) {
        const [p, q] = [room.polygon[i], room.polygon[j]];
        const existing = room.diagonals?.find(d => (d.from === i && d.to === j) || (d.from === j && d.to === i));
        setEditing({ target: 'diagonal', roomId: room.id, from: i, to: j, value: existing ? fmtValue(existing.length_m) : '', original: existing?.length_m, source: lastSource, at: [p[0] + (q[0] - p[0]) / 3, p[1] + (q[1] - p[1]) / 3] });
        setDiagFrom(null);
      } else if (diagFrom) {
        setNotice(tr('Choisissez un sommet non voisin du premier.', 'Pick a corner that is not next to the first one.'));
      } else setSelectedVertex({ roomId: drag.roomId, index: drag.index });
    }
    if (drag?.kind === 'draw') {
      const [x1, y1] = drag.start, [x2, y2] = drag.end;
      const w = snap(Math.abs(x2 - x1)), d = snap(Math.abs(y2 - y1));
      if (w >= MIN_SIDE && d >= MIN_SIDE) {
        const name = `${tr('Pièce', 'Room')} ${level.rooms.length + 1}`;
        const r = addRectangleRoom(survey, levelId, name, Math.min(x1, x2), Math.min(y1, y2), w, d);
        onChange(r.survey);
        onSelectRoom(r.roomId);
        setMode('select');
      }
    }
    setDrag(null);
  }

  const [notice, setNotice] = useState('');
  /** Openings entered from both rooms of the faces just linked, waiting for the user's choice. */
  const [merge, setMerge] = useState<{ survey: Survey; dups: DuplicateOpening[] } | null>(null);
  function resolveMerge(keep: 'first' | 'other' | 'both') {
    if (!merge) return;
    if (keep !== 'both') {
      let s = merge.survey;
      for (const d of merge.dups) s = keep === 'first' ? deleteOpening(s, d.otherRoomId, d.other.id) : deleteOpening(s, d.roomId, d.opening.id);
      onChange(s);
    }
    setMerge(null);
  }
  function closePolygon() {
    try {
      const r = addPolygonRoom(survey, levelId, `${tr('Pièce', 'Room')} ${level.rooms.length + 1}`, poly);
      onChange(r.survey);
      onSelectRoom(r.roomId);
      setMode('select');
    } catch (err) { setNotice((err as Error).message); }
    setPoly([]);
  }
  function commitLength() {
    if (!editing) return;
    // A displayed value is rounded to the unit: left as shown, it keeps its exact value.
    const value = editing.original !== undefined && editing.value === fmtValue(editing.original) ? editing.original : parseLength(editing.value, unit);
    try {
      if (editing.target === 'wall') {
        // Length and thickness can be typed together; an empty length keeps the current one.
        let next = survey;
        if (editing.value.trim()) {
          if (!Number.isFinite(value)) { setEditing({ ...editing, error: tr('Nombre attendu.', 'Number expected.') }); return; }
          next = setWallLength(next, editing.roomId, editing.wallId, value, editing.source);
        }
        const wall = survey.levels.flatMap(l => l.rooms).find(r => r.id === editing.roomId)?.walls.find(w => w.id === editing.wallId);
        if (!wall) { setEditing(null); return; }
        if (editing.name.trim() !== (wall.name ?? '')) next = renameWall(next, editing.roomId, editing.wallId, editing.name);
        const t = editing.thickness === fmtValue(wall.thickness_m) ? wall.thickness_m : parseLength(editing.thickness, unit);
        if (!(t > 0) || t > 1.5) { setEditing({ ...editing, error: tr(`Épaisseur entre 0 et ${fmt(1.5)}.`, `Thickness between 0 and ${fmt(1.5)}.`) }); return; }
        if (Math.abs(t - wall.thickness_m) > 1e-6 || editing.thicknessMeasured !== (wall.thicknessStatus === 'measured'))
          next = setWallThickness(next, editing.roomId, editing.wallId, t, editing.thicknessMeasured);
        if (next !== survey) onChange(next);
        setEditing(null);
        return;
      }
      if (!Number.isFinite(value)) { setEditing({ ...editing, error: tr('Nombre attendu.', 'Number expected.') }); return; }
      onChange(editing.target === 'diagonal' ? addDiagonal(survey, editing.roomId, editing.from, editing.to, value, editing.source)
        : setOpeningCote(survey, editing.roomId, editing.openingId, editing.cote, value));
      setEditing(null);
    } catch (err) {
      // Overflow and overlap are refused, never clamped (spec F-10): keep the dialog open.
      setEditing({ ...editing, error: (err as Error).message });
    }
  }

  const zoom = (f: number) => setView(v => {
    const cx = v.x + size.w / v.scale / 2, cy = v.y + size.h / v.scale / 2, scale = Math.min(400, Math.max(10, v.scale * f));
    return { scale, x: cx - size.w / scale / 2, y: cy - size.h / scale / 2 };
  });

  const preview = drag?.kind === 'draw' ? drag : null;
  const furnitureRoom = level.rooms.find(r => r.id === selectedRoomId);
  const selectedFurniture = furnitureRoom?.furniture?.find(f => f.id === selectedFurnitureId);
  const btn = (on: boolean): React.CSSProperties => ({ minHeight: 44, padding: '11px 13px', borderRadius: 12, border: `1px solid ${on ? C.brand : T('#cde4e4')}`, background: on ? C.brand : '#fff', color: on ? '#fff' : T('#476970'), fontSize: 12, fontWeight: 700, boxShadow: '0 5px 20px #1d4a4a18' });
  const hint = placingFurniture ? tr('Touchez le plan pour placer le meuble', 'Tap the plan to place the furniture')
    : placing ? (placing === 'door' ? tr('Touchez un mur pour placer la porte', 'Tap a wall to place the door') : tr('Touchez un mur pour placer la fenêtre', 'Tap a wall to place the window'))
    : mode === 'polygon' ? tr('Touchez chaque coin, puis le premier pour fermer', 'Tap each corner, then the first to close')
    : mode === 'draw' ? tr('Glissez le doigt pour tracer une pièce rectangulaire', 'Drag to draw a rectangular room')
    : tool === 'link' ? (linkFirst ? tr('Touchez le mur de l’autre pièce : en face pour le lier, dans le prolongement pour dire qu’il continue', 'Tap the other room’s wall: facing to link it, in line to say it continues') : tr('Touchez un mur à lier (pointillés), ou un mur lié (violet) pour le délier', 'Tap a wall to link (dashed), or a linked wall (purple) to unlink it'))
    : diagFrom ? tr(`Touchez le second sommet de la diagonale depuis P${diagFrom.index + 1}`, `Tap the other corner of the diagonal from P${diagFrom.index + 1}`)
    : selectedVertex ? tr('Glissez le point pour le déplacer, ou supprimez-le', 'Drag the point to move it, or delete it')
    : selectedOpeningId ? tr('Glissez l’ouverture le long du mur ; touchez une cote pour la saisir', 'Drag the opening along the wall; tap a cote to type it')
    : selectedFurniture && !furnitureRoom?.frozen ? tr('Glissez le meuble ou saisissez ses cotes', 'Drag the furniture or enter its dimensions')
    : selectedRoomId ? tr('Touchez une cote pour la saisir ; « + » ajoute un point sur un mur', 'Tap a cote to type it; « + » adds a point on a wall')
    : tr('Touchez une cote pour la saisir, ou une ouverture pour la modifier', 'Tap a cote to type it, or an opening to edit it');

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <svg ref={svg} role="application" aria-label={tr('Croquis du niveau', 'Level sketch')}
        style={{ flex: 1, minHeight: 0, width: '100%', touchAction: 'none', userSelect: 'none', WebkitTapHighlightColor: 'transparent', background: 'radial-gradient(circle at 50% 48%, #fff 0%, #f7fbfb 75%)', cursor: mode === 'select' && !placing && !placingFurniture ? 'default' : 'crosshair' }}
        tabIndex={placingFurniture ? 0 : undefined}
        onKeyDown={e => {
          if (e.target !== e.currentTarget || e.key !== 'Enter') return;
          const room = level.rooms.find(r => r.id === selectedRoomId);
          if (placingFurniture && room) { e.preventDefault(); placeFurniture(roomLabelPoint(room.polygon)); }
        }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={e => { pointers.current.delete(e.pointerId); if (!pointers.current.size) pinch.current = null; setDrag(null); }}
        onWheel={e => zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1)}>
        <defs><pattern id="survey-grid" width={22} height={22} patternUnits="userSpaceOnUse"><path d="M22 0H0V22" fill="none" stroke={T('#e6efee')} /></pattern></defs>
        <rect width="100%" height="100%" fill="url(#survey-grid)" pointerEvents="none" />
        {/* The active room is drawn last, on top of the others: it is the only one that can be edited. */}
        {[...level.rooms].sort((a, b) => Number(a.id === selectedRoomId) - Number(b.id === selectedRoomId)).map(room => {
          const pts = room.polygon.map(p => toScreen(p).join(',')).join(' ');
          const sel = room.id === selectedRoomId;
          // Another room than the active one: drawn, without anything to edit.
          const passive = !!selectedRoomId && !sel;
          const c = toScreen(roomLabelPoint(room.polygon));
          // Other rooms fade back, except while linking walls, where they are the targets.
          return (
            <g key={room.id} opacity={passive && tool !== 'link' ? 0.32 : 1} style={{ transition: 'opacity .25s ease' }}>
              <polygon data-room={room.id} points={pts} fill={sel ? C.fillSel : C.fill} fillOpacity={0.9} />
              {room.polygon.map((a, i) => {
                const [x1, y1] = toScreen(a), [x2, y2] = toScreen(room.polygon[(i + 1) % room.polygon.length]);
                const wallI = room.walls.find(w => w.from === i), shared = wallI && isLinked(wallI);
                return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={shared ? C.brand : sel ? C.wall : C.wallDim} strokeWidth={sel ? 5 : 3.5} strokeLinecap="round" pointerEvents="none" />;
              })}
              {room.furniture?.map(f => {
                const interactive = sel && tool === 'select' && !locked.furniture;
                const model = SURVEY_FURNITURE_MODELS.find(m => m.id === f.model);
                return <g key={f.id} data-survey-furniture={f.id} role={interactive ? 'button' : undefined}
                  aria-label={interactive && model ? catalogueLabel(model, lang) : undefined}
                  aria-pressed={interactive ? f.id === selectedFurnitureId : undefined}
                  tabIndex={interactive ? 0 : undefined} pointerEvents={interactive ? undefined : 'none'}
                  onKeyDown={interactive ? e => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    onSelectOpening(null);
                    onSelectFurniture?.(f.id);
                  } : undefined}>
                  <SurveyFurnitureFootprint furniture={f} at={toScreen(f.center)} scale={view.scale} color={C.brand} lang={lang} selected={f.id === selectedFurnitureId} />
                  {interactive && !locked.furniture && f.id === selectedFurnitureId && !room.frozen && (() => {
                    // Rotation handle: a knob in front of the piece, on its local +y axis, 28 px beyond its edge.
                    const [cx, cy] = toScreen(f.center), reach = f.depth_m * view.scale / 2 + 28;
                    const hx = cx - Math.sin(f.rotation) * reach, hy = cy - Math.cos(f.rotation) * reach;
                    const ex = cx - Math.sin(f.rotation) * (reach - 28), ey = cy - Math.cos(f.rotation) * (reach - 28);
                    return <g data-furniture-rotate={f.id} role="slider" aria-label={tr('Rotation', 'Rotation')}
                      aria-valuenow={Math.round(f.rotation * 180 / Math.PI)} aria-valuemin={0} aria-valuemax={359} style={{ cursor: 'grab' }}>
                      <line x1={ex} y1={ey} x2={hx} y2={hy} stroke={C.brand} strokeWidth={1.5} strokeDasharray="3 3" pointerEvents="none" />
                      <circle cx={hx} cy={hy} r={22} fill="transparent" />
                      <circle cx={hx} cy={hy} r={11} fill="#fff" stroke={C.brand} strokeWidth={2} />
                      <path d={`M ${hx - 5} ${hy + 1} a 5 5 0 1 1 3 4.5`} fill="none" stroke={C.brand} strokeWidth={1.6} strokeLinecap="round" pointerEvents="none" />
                    </g>;
                  })()}
                </g>;
              })}
              <text x={c[0]} y={c[1] - 4} textAnchor="middle" fontSize={15} fontWeight={800} fill={T('#25515a')} pointerEvents="none">{room.name}</text>
              <text x={c[0]} y={c[1] + 13} textAnchor="middle" fontSize={10} fill={C.muted} pointerEvents="none">
                {room.geometryStatus === 'assumed' ? (room.shape === 'polygon' ? tr('Contour supposé', 'Assumed outline') : tr('Plan rectangulaire', 'Rectangular plan')) : tr('Géométrie résolue', 'Resolved geometry')}
              </text>
              {room.walls.map(wall => {
                // Both faces of a shared wall sit on the same spot: show the selected room's cote only.
                if (passive) return null;
                if (isLinked(wall) && !sel && wallLinks(wall).some(l => l.roomId === selectedRoomId || room.id > l.roomId)) return null;
                const a = room.polygon[wall.from], b = room.polygon[wall.to];
                const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
                const n: Pt = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
                const off = 25 / view.scale;
                // Measured: plain; deduced from the others (right angles): « = »; sketched: « ≈ ».
                const deduced = !wall.locked && wall.source === 'computed';
                const txt = wall.locked ? `${fmt(wall.length_m)}` : deduced ? `= ${fmt(wall.length_m)}` : `≈ ${fmt(wall.length_m)}`;
                const wPill = Math.max(68, txt.length * 6.8 + 14);
                const [lx, ly] = toScreen([(a[0] + b[0]) / 2 + n[0] * off, (a[1] + b[1]) / 2 + n[1] * off]);
                const bad = flagged.has(wall.id);
                // Wall name (or its corners), inside the selected room along the wall.
                const [nx, ny] = toScreen([(a[0] + b[0]) / 2 - n[0] * (28 / view.scale), (a[1] + b[1]) / 2 - n[1] * (28 / view.scale)]);
                return (
                  <g key={wall.id}>
                  {sel && <text data-wall-name={wall.id} x={nx} y={ny + 3} textAnchor="middle" fontSize={10} fontWeight={wall.name ? 750 : 600} fill={wall.name ? C.brand : T('#9fb3b7')} pointerEvents="none">{wallLabel(wall)}</text>}
                  <g role="button" aria-label={`${tr('Cote', 'Length')} ${wallLabel(wall)} ${fmt(wall.length_m)}`}
                    style={{ cursor: 'pointer', pointerEvents: sel || !selectedRoomId ? undefined : 'none' }}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => setEditing({ target: 'wall', roomId: room.id, wallId: wall.id, name: wall.name ?? '', value: wall.locked ? fmtValue(wall.length_m) : '', original: wall.locked ? wall.length_m : undefined, at: [(a[0] + b[0]) / 2 + n[0] * off, (a[1] + b[1]) / 2 + n[1] * off], source: wall.source === 'estimated' || wall.source === 'computed' ? lastSource : wall.source, thickness: fmtValue(wall.thickness_m), thicknessMeasured: wall.thicknessStatus === 'measured' })}>
                    <rect x={lx - wPill / 2} y={ly - 13} width={wPill} height={26} rx={10} fill="#fff" stroke={bad ? C.orange : T('#d9e6e7')} strokeWidth={1.5} />
                    <text x={lx} y={ly + 4} textAnchor="middle" fontSize={12} fontWeight={750} fill={bad ? C.orange : wall.locked ? T('#32555f') : deduced ? C.brand : '#9d7843'} pointerEvents="none">{txt}</text>
                  </g>
                  </g>
                );
              })}
              {faceOpenings(level, room).map(seen => {
                // A door of a linked face is drawn from this side too (one object, spec F-15).
                const o = { ...seen.opening, wallId: seen.wallId, offset_m: seen.offset_m, hinge: seen.hinge, swing: seen.swing };
                const f = openingFrame(room, o);
                const k = f.len / (f.wall.length_m || 1); // measured metres → sketch metres
                const s0 = o.offset_m * k, s1 = (o.offset_m + o.width_m) * k;
                const [p0, p1] = [toScreen(f.at(s0)), toScreen(f.at(s1))];
                const sel = o.id === selectedOpeningId;
                const color = sel ? C.accent : C.brand;
                const hingeAt = o.hinge === 'start' ? s0 : s1, tipAt = o.hinge === 'start' ? s1 : s0;
                // Leaf drawn open at 90°: towards the room (−n) or outside (+n).
                const dir = o.swing === 'in' ? -1 : 1, w = o.width_m * k;
                const hinge = f.at(hingeAt);
                const leaf: Pt = [hinge[0] + f.n[0] * dir * w, hinge[1] + f.n[1] * dir * w];
                const [hs, ls, ts] = [toScreen(hinge), toScreen(leaf), toScreen(f.at(tipAt))];
                const r = w * view.scale;
                const sweep = (o.hinge === 'start') === (o.swing === 'in') ? 1 : 0;
                const symbol = o.kind === 'door' && o.operation !== 'sliding' && o.operation !== 'none';
                return (
                  <g key={o.id} data-opening={`${seen.owner}|${o.id}|${room.id}`} style={{ cursor: passive ? undefined : 'grab', pointerEvents: passive ? 'none' : undefined }} opacity={passive ? 0.55 : 1}>
                    <line x1={p0[0]} y1={p0[1]} x2={p1[0]} y2={p1[1]} stroke={sel ? C.fillSel : '#fff'} strokeWidth={9} />
                    {o.kind === 'window'
                      ? <><line x1={p0[0]} y1={p0[1]} x2={p1[0]} y2={p1[1]} stroke={color} strokeWidth={6} strokeOpacity={0.25} />
                          <line x1={p0[0]} y1={p0[1]} x2={p1[0]} y2={p1[1]} stroke={color} strokeWidth={1.5} /></>
                      : <line x1={p0[0]} y1={p0[1]} x2={p1[0]} y2={p1[1]} stroke={color} strokeWidth={1} strokeDasharray="3 3" />}
                    {symbol && (o.operation === 'double_swing'
                      ? null
                      : <><line x1={hs[0]} y1={hs[1]} x2={ls[0]} y2={ls[1]} stroke={color} strokeWidth={2} />
                          <path d={`M ${ls[0]} ${ls[1]} A ${r} ${r} 0 0 ${sweep} ${ts[0]} ${ts[1]}`} fill="none" stroke={color} strokeWidth={1} strokeDasharray="4 3" /></>)}
                    {o.kind === 'door' && o.operation === 'double_swing' && [s0, s1].map((h, i) => {
                      const hp = f.at(h), half = w / 2, lp: Pt = [hp[0] + f.n[0] * dir * half, hp[1] + f.n[1] * dir * half];
                      const [a1, b1, c1] = [toScreen(hp), toScreen(lp), toScreen(f.at((s0 + s1) / 2))];
                      return <g key={i}><line x1={a1[0]} y1={a1[1]} x2={b1[0]} y2={b1[1]} stroke={color} strokeWidth={2} />
                        <path d={`M ${b1[0]} ${b1[1]} A ${half * view.scale} ${half * view.scale} 0 0 ${(i === 0) === (o.swing === 'in') ? 1 : 0} ${c1[0]} ${c1[1]}`} fill="none" stroke={color} strokeWidth={1} strokeDasharray="4 3" /></g>;
                    })}
                    {o.kind === 'door' && o.operation === 'sliding' && (() => {
                      const q0 = toScreen([f.at(s0)[0] - f.n[0] * 0.06, f.at(s0)[1] - f.n[1] * 0.06]), q1 = toScreen([f.at((s0 + s1) / 2 + w * 0.5)[0] - f.n[0] * 0.06, f.at((s0 + s1) / 2 + w * 0.5)[1] - f.n[1] * 0.06]);
                      return <line x1={q0[0]} y1={q0[1]} x2={q1[0]} y2={q1[1]} stroke={color} strokeWidth={3} />;
                    })()}
                    {/* Generous invisible hit area for fingers. */}
                    <line x1={p0[0]} y1={p0[1]} x2={p1[0]} y2={p1[1]} stroke="transparent" strokeWidth={36} />
                  </g>
                );
              })}
              {(room.openings ?? []).filter(o => o.id === selectedOpeningId).map(o => {
                const f = openingFrame(room, o);
                const k = f.len / (f.wall.length_m || 1);
                const c = openingCotes(room, o);
                const inset = 58 / view.scale; // outside, beyond the wall cote, clear of the door leaf
                const spans: [Cote, number, number, number][] = [
                  ['before', 0, o.offset_m, c.before], ['width', o.offset_m, o.offset_m + o.width_m, c.width], ['after', o.offset_m + o.width_m, f.wall.length_m, c.after],
                ];
                return spans.map(([cote, from, to, value]) => {
                  const m = f.at(((from + to) / 2) * k);
                  // A span too short for its pill (about 60 px) pushes the before/after pill one row further out.
                  const out = cote !== 'width' && (to - from) * k * view.scale < 64 ? inset + 30 / view.scale : inset;
                  const [lx, ly] = toScreen([m[0] + f.n[0] * out, m[1] + f.n[1] * out]);
                  const [e0, e1] = [toScreen([f.at(from * k)[0] + f.n[0] * inset, f.at(from * k)[1] + f.n[1] * inset]), toScreen([f.at(to * k)[0] + f.n[0] * inset, f.at(to * k)[1] + f.n[1] * inset])];
                  return (
                    <g key={cote} role="button" aria-label={`${cote === 'before' ? tr('Avant', 'Before') : cote === 'width' ? tr('Largeur', 'Width') : tr('Après', 'After')} ${fmt(value)}`}
                      style={{ cursor: 'pointer' }} onPointerDown={e => e.stopPropagation()}
                      onClick={() => setEditing({ target: 'opening', roomId: room.id, openingId: o.id, cote, value: fmtValue(value), original: value, at: [m[0] + f.n[0] * out, m[1] + f.n[1] * out] })}>
                      <line x1={e0[0]} y1={e0[1]} x2={e1[0]} y2={e1[1]} stroke={cote === 'width' ? C.brand : T('#84aab0')} strokeWidth={cote === 'width' ? 2.3 : 1.6} markerStart="url(#tick)" markerEnd="url(#tick)" />
                      <rect x={lx - Math.max(56, fmt(value).length * 6.4 + 12) / 2} y={ly - 12} width={Math.max(56, fmt(value).length * 6.4 + 12)} height={24} rx={10} fill={cote === 'width' ? C.brand : '#fff'} stroke={cote === 'width' ? C.brand : T('#c9dfe1')} strokeWidth={1.5} />
                      <text x={lx} y={ly + 4} textAnchor="middle" fontSize={11} fontWeight={800} fill={cote === 'width' ? '#fff' : T('#244f58')} pointerEvents="none">{fmt(value)}</text>
                    </g>
                  );
                });
              })}
            </g>
          );
        })}
        {tool === 'select' && furnitureRoom && selectedFurniture && (() => {
          const frame = furniturePlanFrame(furnitureRoom);
          const [x, y] = frame.toPlan(selectedFurniture.center);
          const marks: Pt[] = [[0, 0], [x, 0], [0, y], [x, y]];
          const [origin, alongX, alongY, center] = marks.map(p => toScreen(frame.fromPlan(p)));
          return <g pointerEvents="none" aria-hidden="true">
            <path d={`M${origin} L${alongX} ${center} ${alongY} Z`} fill="none" stroke={C.brand} strokeWidth={1.5} strokeDasharray="4 4" />
            <circle cx={origin[0]} cy={origin[1]} r={3} fill={C.brand} />
          </g>;
        })()}
        {level.rooms.filter(r => r.id === selectedRoomId).flatMap(room => (room.diagonals ?? []).map(d => {
          // Control measurements: dashed diagonal with its measured length.
          const [a, b] = [toScreen(room.polygon[d.from]), toScreen(room.polygon[d.to])];
          // At a third of the way, clear of the room name in the middle.
          const [mx, my] = [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3];
          return (
            <g key={d.id}>
              <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={flagged.has(d.id) ? C.orange : T('#84aab0')} strokeWidth={flagged.has(d.id) ? 2.4 : 1.6} strokeDasharray="5 4" pointerEvents="none" />
              <rect role="button" aria-label={`${tr('Diagonale', 'Diagonal')} P${d.from + 1}–P${d.to + 1} ${fmt(d.length_m)}`} style={{ cursor: 'pointer' }}
                onPointerDown={e => e.stopPropagation()}
                onClick={() => {
                  const [p, q] = [room.polygon[d.from], room.polygon[d.to]];
                  setEditing({ target: 'diagonal', roomId: room.id, from: d.from, to: d.to, value: fmtValue(d.length_m), original: d.length_m, source: d.source, at: [p[0] + (q[0] - p[0]) / 3, p[1] + (q[1] - p[1]) / 3] });
                }}
                x={mx - Math.max(60, fmt(d.length_m).length * 6.4 + 12) / 2} y={my - 11} width={Math.max(60, fmt(d.length_m).length * 6.4 + 12)} height={22} rx={9} fill={T('#f3fffd')} stroke={flagged.has(d.id) ? C.orange : T('#9abcc0')} />
              <text x={mx} y={my + 4} textAnchor="middle" fontSize={11} fontWeight={750} fill={T('#244f58')} pointerEvents="none">{fmt(d.length_m)}</text>
            </g>
          );
        }))}
        {level.rooms.filter(r => r.id === selectedRoomId).flatMap(room => room.polygon.map((v, i) => {
          // Vertex names, as used by the solver's requests (« mesurez la diagonale P1–P3 »).
          const [x, y] = toScreen(v);
          const c = toScreen(roomLabelPoint(room.polygon));
          const dx = x - c[0], dy = y - c[1], dl = Math.hypot(dx, dy) || 1;
          return <text key={`lbl-${i}`} x={x + (dx / dl) * 20} y={y + (dy / dl) * 20 + 4} textAnchor="middle" fontSize={11} fontWeight={800} fill={C.brand} pointerEvents="none">P{i + 1}</text>;
        }))}
        {mode === 'select' && !locked.walls && !selectedOpeningId && level.rooms.filter(r => r.id === selectedRoomId).flatMap(room => room.walls.filter(w => !isLinked(w)).map(w => {
          // Small « + » at each wall's middle to add a point there.
          const [a, b] = [toScreen(room.polygon[w.from]), toScreen(room.polygon[w.to])];
          if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 70) return null;
          // Middle of the widest stretch free of openings, so the « + » never sits on a door.
          const taken = (room.openings ?? []).filter(o => o.wallId === w.id).map(o => [o.offset_m, o.offset_m + o.width_m]).sort((p, q) => p[0] - q[0]);
          let best: [number, number] = [0, 0], from = 0;
          for (const [s0, s1] of [...taken, [w.length_m, w.length_m]]) { if (s0 - from > best[1] - best[0]) best = [from, s0]; from = Math.max(from, s1); }
          if ((best[1] - best[0]) / w.length_m < 0.15) return null;
          const t = +(((best[0] + best[1]) / 2) / w.length_m).toFixed(4);
          const [x, y] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          return (
            <g key={`add-${w.id}`} data-add-vertex={`${room.id}|${w.id}|${t}`} role="button" aria-label={tr('Ajouter un point sur ce mur', 'Add a point on this wall')} style={{ cursor: 'copy' }}>
              <circle cx={x} cy={y} r={16} fill="transparent" />
              <circle cx={x} cy={y} r={8} fill="#fff" stroke={C.brand} strokeWidth={2} strokeDasharray="3 2" />
              <path d={`M ${x - 4} ${y} H ${x + 4} M ${x} ${y - 4} V ${y + 4}`} stroke={C.brand} strokeWidth={2} />
            </g>
          );
        }))}
        {mode === 'select' && level.rooms.filter(r => r.id === selectedRoomId).flatMap(room => room.polygon.map((v, i) => {
          const [x, y] = toScreen(v);
          return <circle key={`${room.id}-${i}`} data-vertex={`${room.id}|${i}`} cx={x} cy={y} r={selectedVertex?.roomId === room.id && selectedVertex.index === i ? 11 : 9}
            fill={(selectedVertex?.roomId === room.id && selectedVertex.index === i) || (diagFrom?.roomId === room.id && diagFrom.index === i) ? C.brand : '#fff'} stroke={C.wall} strokeWidth={3}
            role="button" aria-label={`${tr('Sommet', 'Vertex')} ${i + 1}`} style={{ cursor: 'move' }} />;
        }))}
        {poly.length > 0 && (() => {
          const pts = poly.map(toScreen);
          return (
            <g pointerEvents="none">
              <polyline points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke={C.brand} strokeWidth={2} strokeDasharray="6 4" />
              {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === 0 && poly.length >= 3 ? 12 : 6} fill={i === 0 ? C.brand : '#fff'} stroke={C.brand} strokeWidth={2} />)}
              {poly.slice(1).map((q, i) => {
                const a = pts[i], b = pts[i + 1];
                return <text key={i} x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 - 8} textAnchor="middle" fontSize={12} fontWeight={700} fill={C.brand}>{fmt(Math.hypot(q[0] - poly[i][0], q[1] - poly[i][1]))}</text>;
              })}
            </g>
          );
        })()}
        {tool === 'link' && level.rooms.filter(r => linkFirst || !selectedRoomId || r.id === selectedRoomId).flatMap(room => room.walls.map(w => {
          const [a, b] = [toScreen(room.polygon[w.from]), toScreen(room.polygon[w.to])];
          const first = linkFirst?.roomId === room.id && linkFirst.wallId === w.id;
          return <line key={`link-${w.id}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} pointerEvents="none" strokeLinecap="round"
            stroke={first ? C.orange : C.accent} strokeWidth={first ? 9 : 5} strokeOpacity={first ? 1 : 0.45} strokeDasharray={first ? undefined : '10 6'} />;
        }))}
        {/* Aligned walls of the active room: a dotted line joins each pair on their common line. */}
        {tool === 'link' && !linkFirst && level.rooms.filter(r => !selectedRoomId || r.id === selectedRoomId).flatMap(room => room.walls.flatMap(w => alignedFaces(level, w).map(f => {
          const [a, b] = [toScreen(room.polygon[w.from]), toScreen(room.polygon[w.to])];
          const [c, d] = [toScreen(f.room.polygon[f.wall.from]), toScreen(f.room.polygon[f.wall.to])];
          const proj = (p: number[]) => (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]);
          const ends = [a, b, c, d].sort((p, q) => proj(p) - proj(q));
          return <line key={`aligned-${w.id}-${f.wall.id}`} x1={ends[0][0]} y1={ends[0][1]} x2={ends[3][0]} y2={ends[3][1]} pointerEvents="none" strokeLinecap="round" stroke={C.orange} strokeWidth={3} strokeDasharray="2 6" />;
        })))}
        {/* Linked stretches of the active room, in purple: tapped, that link is removed. */}
        {tool === 'link' && !linkFirst && level.rooms.filter(r => !selectedRoomId || r.id === selectedRoomId).flatMap(room => room.walls.flatMap(w => linkedFaces(level, w).map(f => {
          const [lo, hi] = linkStretch(w, f);
          const a = room.polygon[w.from], b = room.polygon[w.to], k = 1 / (w.length_m || 1);
          const at = (t: number) => toScreen([a[0] + (b[0] - a[0]) * t * k, a[1] + (b[1] - a[1]) * t * k]);
          const [p, q] = [at(lo), at(hi)];
          return <line key={`linked-${w.id}-${f.wall.id}`} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} pointerEvents="none" strokeLinecap="round" stroke="#8a5cc7" strokeWidth={7} strokeOpacity={0.85} />;
        })))}
        {justLinked && (() => {
          // Both faces flash in the linked colour, then a band joins them across the wall.
          const lines = justLinked.faces.map(f => {
            const room = level.rooms.find(r => r.id === f.roomId), w = room?.walls.find(x => x.id === f.wallId);
            return room && w ? [toScreen(room.polygon[w.from]), toScreen(room.polygon[w.to])] : null;
          });
          if (lines.some(l => !l)) return null;
          const [[a0, a1], [b0, b1]] = lines as Pt[][];
          return (
            <g key={justLinked.key} pointerEvents="none" data-just-linked>
              <polygon points={[a0, a1, b0, b1].map(p => p.join(',')).join(' ')} fill="#8a5cc7">
                <animate attributeName="fill-opacity" values="0;0.45;0" dur="0.9s" repeatCount="2" />
              </polygon>
              {[[a0, a1], [b0, b1]].map(([p, q], i) => (
                <line key={i} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke="#8a5cc7" strokeLinecap="round">
                  <animate attributeName="stroke-width" values="4;14;6" dur="0.9s" repeatCount="2" />
                  <animate attributeName="stroke-opacity" values="1;0.5;1" dur="0.9s" repeatCount="2" />
                </line>
              ))}
            </g>
          );
        })()}
        {editing && editing.target !== 'opening' && (() => {
          const room = level.rooms.find(r => r.id === editing.roomId);
          if (!room) return null;
          const w = editing.target === 'wall' ? room.walls.find(x => x.id === editing.wallId) : undefined;
          if (editing.target === 'wall' && !w) return null;
          const [i, j] = w ? [w.from, w.to] : editing.target === 'diagonal' ? [editing.from, editing.to] : [0, 0];
          if (!room.polygon[i] || !room.polygon[j]) return null;
          const [a, b] = [toScreen(room.polygon[i]), toScreen(room.polygon[j])];
          return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={C.orange} strokeWidth={8} strokeLinecap="round" strokeOpacity={0.85} pointerEvents="none" />;
        })()}
        <defs><marker id="tick" viewBox="-4 -4 8 8" markerWidth={8} markerHeight={8} orient="auto"><line x1={0} y1={-4} x2={0} y2={4} stroke={T('#9abcc0')} strokeWidth={1.5} /></marker></defs>
        {preview && (() => {
          const [x1, y1] = preview.start, [x2, y2] = preview.end;
          const [sx1, sy1] = toScreen([Math.min(x1, x2), Math.max(y1, y2)]), [sx2, sy2] = toScreen([Math.max(x1, x2), Math.min(y1, y2)]);
          return (
            <g pointerEvents="none">
              <rect x={sx1} y={sy1} width={sx2 - sx1} height={sy2 - sy1} fill="none" stroke={C.brand} strokeWidth={2} strokeDasharray="6 4" />
              <text x={(sx1 + sx2) / 2} y={sy1 - 8} textAnchor="middle" fontSize={13} fill={C.brand} fontWeight={700}>{fmt(Math.abs(x2 - x1))} × {fmt(Math.abs(y2 - y1))}</text>
            </g>
          );
        })()}
      </svg>
      <div style={{ position: 'absolute', zIndex: 2, top: 'calc(11px + var(--plan-top-inset, 0px))', left: 11, right: 11, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
        {!closedHints.includes(hint) && (
          <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, background: mode === 'select' && !placing && !placingFurniture ? C.hintIdle : C.hint, color: C.hintInk, padding: '4px 4px 4px 12px', boxShadow: '0 4px 16px #112f3430', borderRadius: 10, fontSize: 11, fontWeight: 650, maxWidth: '96%', textAlign: 'center' }}>
            <span style={{ padding: '4px 0' }}>{hint}</span>
            <button type="button" aria-label={tr('Fermer l’aide', 'Close the help')} onClick={() => closeHint(hint)}
              style={{ pointerEvents: 'auto', flex: '0 0 auto', width: 28, height: 28, border: 0, borderRadius: 8, background: 'transparent', color: C.hintInk, fontSize: 16, lineHeight: 1, cursor: 'pointer' }}>×</button>
          </div>
        )}
      </div>
      {selectedVertex && mode === 'select' && (
        <div style={{ position: 'absolute', bottom: 'calc(17px + var(--plan-inset, 0px))', left: 15, right: 60, display: 'flex', justifyContent: 'center', gap: 8, zIndex: 2 }}>
          <button style={btn(false)} onClick={() => setSelectedVertex(null)}>{tr('Annuler', 'Cancel')}</button>
          <button style={btn(false)} onClick={() => { setDiagFrom(selectedVertex); setSelectedVertex(null); }}><Slash size={14} /> {tr('Diagonale', 'Diagonal')}</button>
          <button style={{ ...btn(true), background: '#b0523a', borderColor: '#b0523a' }} onClick={() => {
            try { onChange(deleteVertex(survey, selectedVertex.roomId, selectedVertex.index)); }
            catch (err) { setNotice((err as Error).message); }
            setSelectedVertex(null);
          }}><Trash2 size={14} /> {tr('Supprimer le point', 'Delete point')}</button>
        </div>
      )}
      {mode === 'polygon' && poly.length > 0 && (
        <div style={{ position: 'absolute', bottom: 'calc(17px + var(--plan-inset, 0px))', left: 15, right: 15, display: 'flex', justifyContent: 'center', gap: 8, zIndex: 2 }}>
          <button style={{ ...btn(false), color: '#b0523a' }} onClick={() => { setPoly([]); setMode('select'); }}><X size={14} /> {tr('Abandonner', 'Discard')}</button>
          <button style={btn(false)} onClick={() => setPoly(poly.slice(0, -1))}><Undo2 size={14} /> {tr('Point', 'Point')}</button>
          <button style={{ ...btn(true), opacity: poly.length < 3 ? 0.35 : 1 }} disabled={poly.length < 3} onClick={closePolygon}><Check size={14} /> {tr('Fermer la pièce', 'Close room')}</button>
        </div>
      )}
      <div style={{ position: 'absolute', right: 10, bottom: `calc(${mode === 'polygon' && poly.length ? 76 : 12}px + var(--plan-inset, 0px))`, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 2 }}>
        {[[<Plus key="p" size={18} />, 1.25, tr('Zoom avant', 'Zoom in')], [<Minus key="m" size={18} />, 1 / 1.25, tr('Zoom arrière', 'Zoom out')]].map(([l, f, a]) => (
          <button key={a as string} aria-label={a as string} onClick={() => zoom(f as number)}
            style={{ width: 38, height: 38, borderRadius: 12, border: `1px solid ${T(T('#d9e6e8'))}`, background: '#fff', color: T('#325660'), fontSize: 20, lineHeight: 1 }}>{l}</button>
        ))}
      </div>
      {notice && (
        <div role="alert" onClick={() => setNotice('')} style={{ position: 'absolute', zIndex: 3, top: 'calc(54px + var(--plan-top-inset, 0px))', left: 18, right: 18, padding: 11, borderRadius: 11, border: '1px solid #f0dcbe', background: '#fff8eb', color: '#88652d', fontSize: 11, lineHeight: 1.55 }}>{notice}</div>
      )}
      {merge && (() => {
        const d = merge.dups[0];
        const name = (id: string) => level.rooms.find(r => r.id === id)?.name.trim() ?? '';
        const desc = (o: SurveyOpening, at: number) => `${o.width_m.toFixed(2)} m ${tr('à', 'at')} ${at.toFixed(2)} m`;
        return (
          <div role="dialog" aria-label={tr('Ouverture en double', 'Duplicate opening')} style={{ position: 'absolute', zIndex: 4, top: 'calc(54px + var(--plan-top-inset, 0px))', left: 18, right: 18, padding: 12, borderRadius: 11, border: '1px solid #f0dcbe', background: '#fff8eb', color: '#88652d', fontSize: 12, lineHeight: 1.55 }}>
            <div style={{ marginBottom: 8 }}>
              {tr(`Ces deux pièces ont chacune saisi une ouverture sur ce mur. Un mur partagé n'en porte qu'une : laquelle garder ? (Gardez les deux seulement s'il s'agit de deux ouvertures distinctes.)`,
                `Both rooms hold an opening on this wall. A shared wall holds only one: which one to keep? (Keep both only if they are two separate openings.)`)}
              {merge.dups.length > 1 && ` (${merge.dups.length} ${tr('paires', 'pairs')})`}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button style={btn(true)} onClick={() => resolveMerge('first')}>{name(d.roomId)} · {desc(d.opening, d.opening.offset_m)}</button>
              <button style={btn(true)} onClick={() => resolveMerge('other')}>{name(d.otherRoomId)} · {desc(d.other, d.other.offset_m)}</button>
              <button style={btn(false)} onClick={() => resolveMerge('both')}>{tr('Garder les deux', 'Keep both')}</button>
            </div>
          </div>
        );
      })()}
      {editing && (() => {
        // Fixed at the top of the screen, above every bar: the keyboard opening at the bottom shrinks
        // the app and would hide a field placed on the plan. The edited wall is highlighted instead.
        const boxW = Math.min(320, (typeof window !== 'undefined' ? window.innerWidth : size.w) - 16);
        const label = editing.target === 'wall' ? tr('Cote de face', 'Face length')
          : editing.target === 'diagonal' ? `${tr('Diagonale', 'Diagonal')} P${editing.from + 1}–P${editing.to + 1}`
          : editing.cote === 'before' ? tr('Avant', 'Before') : editing.cote === 'width' ? tr('Largeur', 'Width') : tr('Après', 'After');
        return (
          <form role="dialog" aria-label={label} onSubmit={e => { e.preventDefault(); commitLength(); }}
            onKeyDown={e => { if (e.key === 'Escape') setEditing(null); }}
            style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', top: 'calc(8px + env(safe-area-inset-top))', width: boxW, boxSizing: 'border-box', zIndex: 1000, background: '#fff', border: `2px solid ${C.brand}`, borderRadius: 12, padding: 6, boxShadow: '0 8px 28px #1b48503a' }}>
            {/* What is typed, above the field: the placeholder only shows the number format. */}
            <div style={{ fontSize: 11, fontWeight: 750, color: T('#748c93'), margin: '0 4px 2px' }}>{label}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input autoFocus inputMode={unit === 'ft-in' ? 'text' : 'decimal'} aria-label={label} placeholder={lengthPlaceholder(unit)} value={editing.value}
                onChange={e => setEditing({ ...editing, value: e.target.value, error: undefined })} onFocus={e => e.target.select()}
                className="survey-inline-input"
                style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', fontSize: 18, fontWeight: 750, color: T('#1f424b'), padding: '4px 6px', background: 'transparent' }} />
              <span style={{ color: C.muted, fontSize: 12, fontWeight: 700 }}>m</span>
              <button type="submit" aria-label={tr('Valider', 'OK')} style={{ width: 34, height: 34, borderRadius: 9, border: 0, background: C.brand, color: '#fff', fontSize: 16 }}><Check size={16} /></button>
              <button type="button" aria-label={tr('Annuler', 'Cancel')} onClick={() => setEditing(null)} style={{ width: 30, height: 34, borderRadius: 9, border: `1px solid ${T(T('#d9e6e7'))}`, background: '#fff', color: T('#476970') }}>×</button>
            </div>
            {editing.target !== 'opening' && (
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                {(['laser', 'tape', 'manual'] as const).map(src => (
                  <button key={src} type="button" aria-pressed={editing.source === src} onClick={() => { chooseSource(src); setEditing({ ...editing, source: src }); }}
                    style={{ flex: 1, border: `1px solid ${editing.source === src ? 'var(--theme, #0a0a0a)' : '#e2e2e2'}`, background: editing.source === src ? 'var(--theme, #0a0a0a)' : '#fff', color: editing.source === src ? 'var(--theme-ink, #fff)' : '#585858', borderRadius: 999, transition: 'background-color .18s, color .18s', padding: '4px 0', fontSize: 11, fontWeight: 800 }}>
                    {src === 'laser' ? tr('Laser', 'Laser') : src === 'tape' ? tr('Mètre', 'Tape') : tr('Saisie', 'Typed')}
                  </button>
                ))}
              </div>
            )}
            {editing.target === 'wall' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: T('#476970'), fontWeight: 700 }}>
                <span style={{ flex: '0 0 auto' }}>{tr('Nom', 'Name')}</span>
                <input aria-label={tr('Nom du mur', 'Wall name')} value={editing.name} placeholder={(() => { const w = survey.levels.flatMap(l => l.rooms).find(r => r.id === editing.roomId)?.walls.find(x => x.id === editing.wallId); return w ? `P${w.from + 1}–P${w.to + 1}` : ''; })()}
                  onChange={e => setEditing({ ...editing, name: e.target.value, error: undefined })}
                  style={{ flex: 1, minWidth: 0, border: `1px solid ${T(T('#d9e6e7'))}`, borderRadius: 8, padding: '4px 6px', fontSize: 13, fontWeight: 650, color: T('#1f424b') }} />
              </div>
            )}
            {editing.target === 'wall' && (
              // Wall thickness: typed = measured (e.g. at a door jamb); a shared wall gets it on both faces.
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: T('#476970'), fontWeight: 700 }}>
                <span style={{ flex: '0 0 auto' }}>{tr('Épaisseur', 'Thickness')}</span>
                <input inputMode={unit === 'ft-in' ? 'text' : 'decimal'} aria-label={tr(`Épaisseur du mur (${unitLabel(unit)})`, `Wall thickness (${unitLabel(unit)})`)} value={editing.thickness}
                  onChange={e => setEditing({ ...editing, thickness: e.target.value, thicknessMeasured: true, error: undefined })} onFocus={e => e.target.select()}
                  style={{ width: 64, border: `1px solid ${T(T('#d9e6e7'))}`, borderRadius: 8, padding: '4px 6px', fontSize: 14, fontWeight: 750, color: T('#1f424b') }} />
                <span>{unitLabel(unit)}</span>
                <span style={{ marginLeft: 'auto', color: editing.thicknessMeasured ? C.brand : C.muted }}>{editing.thicknessMeasured ? tr('mesurée', 'measured') : tr('estimée', 'estimated')}</span>
              </div>
            )}
            {editing.target === 'wall' && editing.original !== undefined && (
              // Deleting the measured length: the wall goes back to a length estimated from the drawing.
              <button type="button" onClick={() => {
                try { onChange(clearWallLength(survey, editing.roomId, editing.wallId)); setEditing(null); }
                catch (err) { setEditing({ ...editing, error: (err as Error).message }); }
              }} style={{ marginTop: 6, width: '100%', border: '1px solid #f0d2c6', background: '#fff7f3', color: '#b0523a', borderRadius: 8, padding: '6px 8px', fontSize: 11, fontWeight: 750 }}>
                <Trash2 size={14} /> {tr('Supprimer la cote (redevient estimée ≈)', 'Delete the cote (back to estimated ≈)')}
              </button>
            )}
            {editing.error && <div role="alert" style={{ marginTop: 4, color: '#88652d', background: '#fff8eb', border: '1px solid #f0dcbe', borderRadius: 8, padding: 6, fontSize: 11, lineHeight: 1.4 }}>{editing.error}</div>}
          </form>
        );
      })()}
    </div>
  );
}
