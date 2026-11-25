import { useRef, useState, type PointerEvent } from 'react';
import PhotoNotePin from '@skaitch/ui/components/survey/PhotoNotePin';

type Position = [number, number];

export default function PhotoNoteMarker({ at, zoom, label, positionOnPhoto, onOpen, onMove }: {
  at: Position; zoom: number; label: string;
  positionOnPhoto: (e: { clientX: number; clientY: number }) => Position;
  onOpen: () => void; onMove?: (at: Position) => void;
}) {
  const drag = useRef<{ pointerId: number; x: number; y: number; start: Position; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const [preview, setPreview] = useState<Position>();
  const [x, y] = preview ?? at;

  function move(e: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    if (!start || e.pointerId !== start.pointerId) return;
    if (!start.moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
    start.moved = true;
    const [px, py] = positionOnPhoto(e);
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    return [clamp(at[0] + px - start.start[0]), clamp(at[1] + py - start.start[1])] satisfies Position;
  }

  function clear() {
    drag.current = null;
    setPreview(undefined);
  }

  return <button type="button" className="photo-note photo-note-marker" data-movable={!!onMove} aria-label={label} aria-expanded={false}
    style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
    onPointerDown={e => {
      e.stopPropagation();
      if (e.button !== 0 || !e.isPrimary) return;
      dragged.current = false;
      if (!onMove) return;
      drag.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, start: positionOnPhoto(e), moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onPointerMove={e => { const next = move(e); if (next) setPreview(next); }}
    onPointerUp={e => {
      if (drag.current?.pointerId !== e.pointerId) return;
      const next = move(e);
      dragged.current = !!next;
      clear();
      if (next) onMove?.(next);
    }}
    onPointerCancel={clear} onLostPointerCapture={clear}
    onClick={e => {
      e.stopPropagation();
      if (!dragged.current || e.detail === 0) onOpen();
      dragged.current = false;
    }}><PhotoNotePin /></button>;
}
