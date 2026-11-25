import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type KeyboardEvent } from 'react';

type Position = { x: number; y: number };
const KEY = 'skaitch_section_panel_position';
export function readPanelPosition(raw: string | null): Position | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value.x === 'number' && typeof value.y === 'number' && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: value.x, y: value.y } : null;
  } catch { return null; }
}
export function clampPanelPosition(position: Position, width: number, height: number, panelWidth: number, panelHeight: number): Position {
  return {
    x: Math.max(0, Math.min(position.x, width - panelWidth)),
    y: Math.max(0, Math.min(position.y, height - panelHeight)),
  };
}
export function usePanelPosition(visible: boolean, host?: HTMLElement | null) {
  const viewportRef = useRef<HTMLDivElement>(null), panelRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<Position | null>(() => {
    try { return readPanelPosition(localStorage.getItem(KEY)); } catch { return null; }
  });
  const [bounds, setBounds] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const drag = useRef<{ id: number; x: number; y: number; origin: Position; previous: Position | null } | null>(null);
  const current = useRef(position); current.current = position;
  const constrain = (point: Position) => {
    const viewport = viewportRef.current?.getBoundingClientRect(), panel = panelRef.current?.getBoundingClientRect();
    return viewport && panel ? clampPanelPosition(point, viewport.width, viewport.height, panel.width, Math.min(panel.height, viewport.height)) : point;
  };
  const save = (point: Position | null) => {
    try { if (point) localStorage.setItem(KEY, JSON.stringify(point)); else localStorage.removeItem(KEY); } catch { /* Storage can be unavailable in private contexts. */ }
  };
  useLayoutEffect(() => {
    const update = () => {
      const rect = viewportRef.current?.getBoundingClientRect(); if (!rect) return;
      setBounds(previous => previous.left === rect.left && previous.top === rect.top && previous.width === rect.width && previous.height === rect.height ? previous : { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      setPosition(previous => { if (!previous) return null; const next = constrain(previous); return next.x === previous.x && next.y === previous.y ? previous : next; });
    };
    update();
    const observer = new ResizeObserver(update);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (panelRef.current) observer.observe(panelRef.current);
    window.addEventListener('resize', update); window.addEventListener('scroll', update, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [visible, host]);
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const panel = panelRef.current?.getBoundingClientRect(), viewport = viewportRef.current?.getBoundingClientRect(); if (!panel || !viewport) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: { x: panel.left - viewport.left, y: panel.top - viewport.top }, previous: current.current };
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const start = drag.current; if (!start || start.id !== event.pointerId) return;
    const next = constrain({ x: start.origin.x + event.clientX - start.x, y: start.origin.y + event.clientY - start.y });
    current.current = next; setPosition(next);
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null; save(current.current); event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onPointerCancel = () => { if (drag.current) { setPosition(drag.current.previous); drag.current = null; } };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Home') { event.preventDefault(); setPosition(null); save(null); return; }
    const delta: Record<string, Position> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    const direction = delta[event.key], panel = panelRef.current?.getBoundingClientRect(), viewport = viewportRef.current?.getBoundingClientRect();
    if (!direction || !panel || !viewport) return;
    event.preventDefault(); const step = event.shiftKey ? 1 : 10;
    const next = constrain({ x: panel.left - viewport.left + direction.x * step, y: panel.top - viewport.top + direction.y * step });
    current.current = next; setPosition(next); save(next);
  };
  const style: CSSProperties | undefined = position ? { position: 'fixed', left: bounds.left + position.x, top: bounds.top + position.y, right: 'auto', bottom: 'auto', maxHeight: bounds.height || undefined, maxWidth: bounds.width || undefined } : undefined;
  return { viewportRef, panelRef, style, headerProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown, tabIndex: 0, role: 'button', 'aria-label': 'Déplacer le panneau de coupe', title: 'Glisser pour déplacer · Flèches au clavier · Début pour réinitialiser' } };
}
