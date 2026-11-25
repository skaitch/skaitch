// Canvas2D — top-down architectural plan editor
// Features: pan, zoom, grid, render walls/doors/windows/rooms/furniture,
// selection (click + multi via Shift, marquee), drag-to-move,
// drag-to-add (wall, door on wall, window on wall, room rect, furniture rect),
// delete via Suppr.

const { useState, useRef, useEffect, useMemo, useCallback } = React;
const { Icon, TYPE_CONFIG, wallLength, wallAngle, wallPointAtT, pointInPoly, bbox } = window.AS_UI;

function Canvas2D({ items, storeyId, tool, setTool, selection, setSelection, addItem, updateItem, deleteItems, density, showGrid, snapEnabled = true, snapSize = 0.25, t, lang }) {
  const wrapRef = useRef(null);
  const [view, setView] = useState({ scale: 36, ox: 80, oy: 80 }); // px per meter
  const [size, setSize] = useState({ w: 1200, h: 700 });
  const [hover, setHover] = useState(null); // {type, id} hovered
  const [drag, setDrag] = useState(null); // active drag op
  const [marquee, setMarquee] = useState(null);
  const [cursorWorld, setCursorWorld] = useState(null);

  // ResizeObserver for canvas size
  useEffect(() => {
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ w: r.width, h: r.height });
    });
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Helpers — world ↔ screen
  const w2s = (x, y) => [x * view.scale + view.ox, y * view.scale + view.oy];
  const s2w = (x, y) => [(x - view.ox) / view.scale, (y - view.oy) / view.scale];
  const snap = (v) => snapEnabled ? Math.round(v / snapSize) * snapSize : v;

  // Visible items on this storey
  const storey = items[storeyId];
  const inStorey = useMemo(() => {
    return Object.values(items).filter(it => it.parentId === storeyId);
  }, [items, storeyId]);
  const walls = inStorey.filter(i => i.type === 'Wall');
  const rooms = inStorey.filter(i => i.type === 'Room');
  const doors = inStorey.filter(i => i.type === 'Door');
  const windowsArr = inStorey.filter(i => i.type === 'Window');
  const furniture = inStorey.filter(i => i.type === 'Furniture');
  const wallsById = useMemo(() => Object.fromEntries(walls.map(w => [w.id, w])), [walls]);

  // Auto-fit on first load / storey change
  useEffect(() => {
    const all = [];
    for (const r of rooms) for (const p of r.geom.polygon) all.push(p);
    for (const w of walls) { all.push([w.geom.x1, w.geom.y1]); all.push([w.geom.x2, w.geom.y2]); }
    if (!all.length) return;
    const bb = bbox(all);
    const wW = bb.maxX - bb.minX, wH = bb.maxY - bb.minY;
    const pad = 80;
    const scale = Math.min((size.w - pad * 2) / Math.max(wW, 1), (size.h - pad * 2) / Math.max(wH, 1));
    const sc = Math.max(20, Math.min(80, scale));
    const ox = (size.w - wW * sc) / 2 - bb.minX * sc;
    const oy = (size.h - wH * sc) / 2 - bb.minY * sc;
    setView({ scale: sc, ox, oy });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeyId, size.w, size.h]);

  // ============ Hit testing ============
  function hitTest(wx, wy) {
    // Furniture (above), then doors/windows on walls, then walls, then rooms
    for (let i = furniture.length - 1; i >= 0; i--) {
      const f = furniture[i];
      const { x, y, w: fw, d: fd, rotation } = f.geom;
      // axis-aligned approximation
      const cx = x + fw / 2, cy = y + fd / 2;
      const dx = wx - cx, dy = wy - cy;
      const ca = Math.cos(-rotation), sa = Math.sin(-rotation);
      const lx = dx * ca - dy * sa, ly = dx * sa + dy * ca;
      if (Math.abs(lx) <= fw / 2 && Math.abs(ly) <= fd / 2) return { type: 'Furniture', id: f.id };
    }
    for (const d of doors) {
      const w = wallsById[d.geom.wallId]; if (!w) continue;
      const [px, py] = wallPointAtT(w.geom, d.geom.t);
      const ang = wallAngle(w.geom);
      const dx = wx - px, dy = wy - py;
      const lx = dx * Math.cos(-ang) - dy * Math.sin(-ang);
      const ly = dx * Math.sin(-ang) + dy * Math.cos(-ang);
      if (Math.abs(lx) <= d.geom.width / 2 && Math.abs(ly) <= 0.20) return { type: 'Door', id: d.id };
    }
    for (const wn of windowsArr) {
      const w = wallsById[wn.geom.wallId]; if (!w) continue;
      const [px, py] = wallPointAtT(w.geom, wn.geom.t);
      const ang = wallAngle(w.geom);
      const dx = wx - px, dy = wy - py;
      const lx = dx * Math.cos(-ang) - dy * Math.sin(-ang);
      const ly = dx * Math.sin(-ang) + dy * Math.cos(-ang);
      if (Math.abs(lx) <= wn.geom.width / 2 && Math.abs(ly) <= 0.18) return { type: 'Window', id: wn.id };
    }
    for (const w of walls) {
      // distance to segment
      const { x1, y1, x2, y2, thickness } = w.geom;
      const dxw = x2 - x1, dyw = y2 - y1;
      const len2 = dxw * dxw + dyw * dyw;
      let tt = ((wx - x1) * dxw + (wy - y1) * dyw) / len2;
      tt = Math.max(0, Math.min(1, tt));
      const px = x1 + tt * dxw, py = y1 + tt * dyw;
      const dist = Math.hypot(wx - px, wy - py);
      if (dist <= thickness / 2 + 0.05) return { type: 'Wall', id: w.id };
    }
    for (const r of rooms) {
      if (pointInPoly([wx, wy], r.geom.polygon)) return { type: 'Room', id: r.id };
    }
    return null;
  }

  // Closest wall to a point (used to constrain doors/windows)
  function closestWall(wx, wy) {
    let best = null; let bestD = Infinity;
    for (const w of walls) {
      const { x1, y1, x2, y2 } = w.geom;
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

  // ============ Mouse handlers ============
  const onMouseDown = (e) => {
    if (e.button === 1 || (e.button === 0 && (e.altKey || e.metaKey))) {
      // pan
      setDrag({ kind: 'pan', startX: e.clientX, startY: e.clientY, ox0: view.ox, oy0: view.oy });
      return;
    }
    if (e.button !== 0) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const [wx, wy] = s2w(sx, sy);

    if (tool === 'select') {
      const hit = hitTest(wx, wy);
      if (hit) {
        const exists = selection.includes(hit.id);
        if (e.shiftKey || e.metaKey) {
          setSelection(exists ? selection.filter(id => id !== hit.id) : [...selection, hit.id]);
        } else if (!exists) {
          setSelection([hit.id]);
        }
        // start move
        setDrag({ kind: 'move', startX: wx, startY: wy, ids: exists || (e.shiftKey || e.metaKey) ? selection.includes(hit.id) ? selection : [...selection, hit.id] : [hit.id], originals: snapshotItems(items) });
      } else {
        if (!e.shiftKey) setSelection([]);
        setDrag({ kind: 'marquee', startX: sx, startY: sy, x: sx, y: sy });
      }
    } else if (tool === 'Wall') {
      // start drawing wall — drag end
      const sx0 = snap(wx), sy0 = snap(wy);
      setDrag({ kind: 'draw-wall', x1: sx0, y1: sy0, x2: sx0, y2: sy0 });
    } else if (tool === 'Door' || tool === 'Window') {
      const cw = closestWall(wx, wy);
      if (cw && cw.d < 0.6) {
        const id = (tool === 'Door' ? 'd_' : 'wn_') + 'new_' + Date.now();
        const newItem = tool === 'Door' ? {
          id, type: 'Door', name: tool === 'Door' ? 'Nouvelle porte' : 'Nouvelle fenêtre',
          parentId: storeyId,
          ifcGUID: window.AS_DATA.guid(id),
          geom: { wallId: cw.wall.id, t: cw.t, width: 0.90, height: 2.10, swing: 'left', side: 1 },
          material: 'Bois — chêne', fireRating: 'EI 30',
        } : {
          id, type: 'Window', name: 'Nouvelle fenêtre',
          parentId: storeyId,
          ifcGUID: window.AS_DATA.guid(id),
          geom: { wallId: cw.wall.id, t: cw.t, width: 1.20, height: 1.20, sillHeight: 0.90 },
          material: 'Aluminium — double vitrage', uValue: 1.4,
        };
        addItem(newItem);
        setSelection([id]);
        setTool('select');
      }
    } else if (tool === 'Room' || tool === 'Furniture') {
      const sx0 = snap(wx), sy0 = snap(wy);
      setDrag({ kind: tool === 'Room' ? 'draw-room' : 'draw-fur', x1: sx0, y1: sy0, x2: sx0, y2: sy0 });
    }
  };

  function snapshotItems(items) {
    const s = {};
    for (const id of Object.keys(items)) s[id] = JSON.parse(JSON.stringify(items[id]));
    return s;
  }

  const onMouseMove = (e) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const [wx, wy] = s2w(sx, sy);
    setCursorWorld([wx, wy]);
    if (!drag) {
      if (tool === 'select') {
        const hit = hitTest(wx, wy);
        setHover(hit);
      } else {
        setHover(null);
      }
      return;
    }
    if (drag.kind === 'pan') {
      setView(v => ({ ...v, ox: drag.ox0 + (e.clientX - drag.startX), oy: drag.oy0 + (e.clientY - drag.startY) }));
    } else if (drag.kind === 'marquee') {
      setMarquee({ x1: drag.startX, y1: drag.startY, x2: sx, y2: sy });
      setDrag({ ...drag, x: sx, y: sy });
    } else if (drag.kind === 'move') {
      const dx = wx - drag.startX, dy = wy - drag.startY;
      const sdx = snap(dx), sdy = snap(dy);
      const updates = {};
      for (const id of drag.ids) {
        const it = drag.originals[id];
        if (!it) continue;
        if (it.type === 'Wall') {
          updates[id] = { ...it, geom: { ...it.geom, x1: it.geom.x1 + sdx, y1: it.geom.y1 + sdy, x2: it.geom.x2 + sdx, y2: it.geom.y2 + sdy } };
        } else if (it.type === 'Furniture') {
          updates[id] = { ...it, geom: { ...it.geom, x: it.geom.x + sdx, y: it.geom.y + sdy } };
        } else if (it.type === 'Room') {
          updates[id] = { ...it, geom: { ...it.geom, polygon: it.geom.polygon.map(([x, y]) => [x + sdx, y + sdy]) } };
        } else if (it.type === 'Door' || it.type === 'Window') {
          // can shift along wall: change t
          const w = wallsById[it.geom.wallId];
          if (w) {
            const len = wallLength(w.geom);
            const ang = wallAngle(w.geom);
            const along = (dx * Math.cos(ang) + dy * Math.sin(ang)) / len;
            const nt = Math.max(0.05, Math.min(0.95, it.geom.t + along));
            updates[id] = { ...it, geom: { ...it.geom, t: nt } };
          }
        }
      }
      for (const id of Object.keys(updates)) updateItem(id, updates[id]);
    } else if (drag.kind === 'draw-wall') {
      // axis-snap (15deg increments via shift)
      let x2 = snap(wx), y2 = snap(wy);
      const adx = Math.abs(x2 - drag.x1), ady = Math.abs(y2 - drag.y1);
      if (adx > ady * 3) y2 = drag.y1; else if (ady > adx * 3) x2 = drag.x1;
      setDrag({ ...drag, x2, y2 });
    } else if (drag.kind === 'draw-room' || drag.kind === 'draw-fur') {
      setDrag({ ...drag, x2: snap(wx), y2: snap(wy) });
    }
  };

  const onMouseUp = (e) => {
    if (!drag) return;
    if (drag.kind === 'marquee' && marquee) {
      const [x1, y1] = s2w(Math.min(marquee.x1, marquee.x2), Math.min(marquee.y1, marquee.y2));
      const [x2, y2] = s2w(Math.max(marquee.x1, marquee.x2), Math.max(marquee.y1, marquee.y2));
      const ids = [];
      for (const it of inStorey) {
        let cx, cy;
        if (it.type === 'Wall') { cx = (it.geom.x1 + it.geom.x2) / 2; cy = (it.geom.y1 + it.geom.y2) / 2; }
        else if (it.type === 'Furniture') { cx = it.geom.x + it.geom.w / 2; cy = it.geom.y + it.geom.d / 2; }
        else if (it.type === 'Room') { const bb = bbox(it.geom.polygon); cx = (bb.minX + bb.maxX) / 2; cy = (bb.minY + bb.maxY) / 2; }
        else continue;
        if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) ids.push(it.id);
      }
      setSelection(e.shiftKey ? [...new Set([...selection, ...ids])] : ids);
      setMarquee(null);
    } else if (drag.kind === 'draw-wall') {
      const len = Math.hypot(drag.x2 - drag.x1, drag.y2 - drag.y1);
      if (len > 0.3) {
        const id = 'w_new_' + Date.now();
        addItem({
          id, type: 'Wall', name: 'Nouveau mur',
          parentId: storeyId,
          ifcGUID: window.AS_DATA.guid(id),
          geom: { x1: drag.x1, y1: drag.y1, x2: drag.x2, y2: drag.y2, thickness: 0.20, height: 2.70 },
          material: 'Brique 200mm', fireRating: 'EI 60', loadBearing: false, isExternal: false,
        });
        setSelection([id]);
      }
      setTool('select');
    } else if (drag.kind === 'draw-room' || drag.kind === 'draw-fur') {
      const x1 = Math.min(drag.x1, drag.x2), y1 = Math.min(drag.y1, drag.y2);
      const x2 = Math.max(drag.x1, drag.x2), y2 = Math.max(drag.y1, drag.y2);
      if (x2 - x1 > 0.3 && y2 - y1 > 0.3) {
        const id = (drag.kind === 'draw-room' ? 'rm_' : 'fur_') + 'new_' + Date.now();
        if (drag.kind === 'draw-room') {
          addItem({
            id, type: 'Room', name: 'Nouvelle pièce',
            parentId: storeyId,
            ifcGUID: window.AS_DATA.guid(id),
            geom: { polygon: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], height: 2.70 },
            function: 'Habitation', occupancy: 1,
          });
        } else {
          addItem({
            id, type: 'Furniture', name: 'Nouveau meuble',
            parentId: storeyId,
            ifcGUID: window.AS_DATA.guid(id),
            geom: { x: x1, y: y1, w: x2 - x1, d: y2 - y1, h: 0.75, rotation: 0 },
            category: 'Mobilier', model: '—',
          });
        }
        setSelection([id]);
      }
      setTool('select');
    }
    setDrag(null);
  };

  // Wheel zoom
  const onWheel = (e) => {
    e.preventDefault();
    const rect = wrapRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const [wx, wy] = s2w(sx, sy);
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(8, Math.min(200, view.scale * factor));
    const nox = sx - wx * newScale, noy = sy - wy * newScale;
    setView({ scale: newScale, ox: nox, oy: noy });
  };

  // Render
  const renderGrid = () => {
    if (!showGrid) return null;
    const step = view.scale; // 1m grid in screen px
    const subStep = view.scale * 0.25;
    if (step < 8) return null;
    const lines = [];
    const fineCol = 'var(--border-faint)';
    const majorCol = 'var(--border)';
    // major (1m)
    let firstX = view.ox % step; if (firstX > 0) firstX -= step;
    for (let x = firstX; x < size.w; x += step) {
      lines.push(<line key={'gx' + x} x1={x} y1={0} x2={x} y2={size.h} stroke={majorCol} strokeWidth="1" />);
    }
    let firstY = view.oy % step; if (firstY > 0) firstY -= step;
    for (let y = firstY; y < size.h; y += step) {
      lines.push(<line key={'gy' + y} x1={0} y1={y} x2={size.w} y2={y} stroke={majorCol} strokeWidth="1" />);
    }
    // origin axes
    lines.push(<line key="ax" x1={view.ox} y1={0} x2={view.ox} y2={size.h} stroke="var(--border-strong)" strokeWidth="1.2" strokeDasharray="2 2" />);
    lines.push(<line key="ay" x1={0} y1={view.oy} x2={size.w} y2={view.oy} stroke="var(--border-strong)" strokeWidth="1.2" strokeDasharray="2 2" />);
    return <g>{lines}</g>;
  };

  const isSelected = (id) => selection.includes(id);
  const isHover = (id) => hover && hover.id === id;

  // SVG rendering
  return (
    <div ref={wrapRef} className={`canvas2d tool-${tool}${drag ? ' dragging' : ''}`}
         onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
         onMouseLeave={() => { setHover(null); setCursorWorld(null); }}
         onWheel={onWheel}
         onContextMenu={(e) => e.preventDefault()}>
      <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
        {renderGrid()}
        {/* Rooms (filled) */}
        {rooms.map(r => {
          const pts = r.geom.polygon.map(([x, y]) => w2s(x, y).join(',')).join(' ');
          const sel = isSelected(r.id);
          return (
            <g key={r.id}>
              <polygon points={pts}
                fill="var(--c-room)" fillOpacity={sel ? 0.30 : 0.14}
                stroke={sel ? 'var(--accent)' : 'transparent'}
                strokeWidth={sel ? 2 : 0}
                strokeDasharray={sel ? '4 3' : ''}
              />
              {(() => {
                const bb = bbox(r.geom.polygon);
                const [cx, cy] = w2s((bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2);
                const area = window.AS_UI.polyArea(r.geom.polygon);
                return (
                  <g key={`lab_${r.id}`} pointerEvents="none">
                    <text x={cx} y={cy - 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--ink)">{r.name}</text>
                    <text x={cx} y={cy + 9} textAnchor="middle" fontSize="9" fill="var(--ink-3)" fontFamily="var(--font-mono)">{area.toFixed(1)} m²</text>
                  </g>
                );
              })()}
            </g>
          );
        })}

        {/* Furniture */}
        {furniture.map(f => {
          const { x, y, w: fw, d: fd, rotation } = f.geom;
          const cx = x + fw / 2, cy = y + fd / 2;
          const [scx, scy] = w2s(cx, cy);
          const sw = fw * view.scale, sd = fd * view.scale;
          const sel = isSelected(f.id), hov = isHover(f.id);
          return (
            <g key={f.id} transform={`translate(${scx} ${scy}) rotate(${rotation * 180 / Math.PI})`}>
              <rect x={-sw / 2} y={-sd / 2} width={sw} height={sd}
                    fill="var(--c-furniture)" fillOpacity={sel ? 0.42 : 0.22}
                    stroke={sel ? 'var(--accent)' : (hov ? 'var(--ink-2)' : 'var(--c-furniture)')}
                    strokeWidth={sel ? 2 : 1} rx="2" />
              <line x1={-sw / 2} y1={-sd / 2} x2={sw / 2} y2={sd / 2} stroke="var(--c-furniture)" strokeOpacity="0.6" strokeWidth="0.7" />
              {sw > 50 && sd > 30 && (
                <text textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="var(--ink-2)" pointerEvents="none">{f.name}</text>
              )}
            </g>
          );
        })}

        {/* Walls — render as thick segments with cuts for openings */}
        {walls.map(w => {
          const sel = isSelected(w.id), hov = isHover(w.id);
          const len = wallLength(w.geom);
          const ang = wallAngle(w.geom);
          const [sx1, sy1] = w2s(w.geom.x1, w.geom.y1);
          const tpx = w.geom.thickness * view.scale;
          // Compute opening cuts in screen-local coords
          const wallDoors = [...doors, ...windowsArr].filter(o => o.geom.wallId === w.id);
          const cuts = wallDoors.map(o => {
            const c = o.geom.t * len;
            const halfW = o.geom.width / 2;
            return [c - halfW, c + halfW, o.type, o];
          }).sort((a, b) => a[0] - b[0]);

          // build segments excluding cuts
          const segs = [];
          let cursor = 0;
          for (const [a, b] of cuts) {
            if (a > cursor) segs.push([cursor, a]);
            cursor = Math.max(cursor, b);
          }
          if (cursor < len) segs.push([cursor, len]);

          const fill = w.isExternal ? 'var(--c-wall)' : 'var(--ink-2)';
          const cap = w.isExternal ? tpx : tpx * 0.75;

          return (
            <g key={w.id} transform={`translate(${sx1} ${sy1}) rotate(${ang * 180 / Math.PI})`}>
              {segs.map(([a, b], i) => (
                <rect key={i} x={a * view.scale} y={-cap / 2} width={(b - a) * view.scale} height={cap}
                      fill={fill} fillOpacity={sel ? 1 : (hov ? 0.95 : 0.92)}
                      stroke={sel ? 'var(--accent)' : 'transparent'} strokeWidth={sel ? 1.6 : 0} />
              ))}
              {/* cuts visualisation: doors and windows drawn here */}
              {cuts.map((c, i) => {
                const [a, b, type, item] = c;
                const halfW = (item.geom.width / 2) * view.scale;
                const cx = (a + b) / 2 * view.scale;
                const sel = isSelected(item.id);
                if (type === 'Window') {
                  return (
                    <g key={'wn' + i}>
                      <rect x={cx - halfW} y={-cap / 2} width={halfW * 2} height={cap}
                            fill="var(--bg)" stroke="var(--c-window)" strokeWidth="1.2" />
                      <line x1={cx - halfW} y1={0} x2={cx + halfW} y2={0} stroke="var(--c-window)" strokeWidth={sel ? 2.5 : 1.6} />
                      {sel && <rect x={cx - halfW - 2} y={-cap / 2 - 2} width={halfW * 2 + 4} height={cap + 4} fill="none" stroke="var(--accent)" strokeWidth="1.4" strokeDasharray="3 2" />}
                    </g>
                  );
                } else {
                  // Door — opening + arc (swing)
                  const doorW = halfW * 2;
                  const side = item.geom.side || 1;
                  const dirSign = item.geom.swing === 'right' ? -1 : 1;
                  const arcStart = `M ${cx - halfW} 0 L ${cx - halfW} ${-side * doorW * dirSign}`;
                  const arcPath = `M ${cx - halfW} 0 A ${doorW} ${doorW} 0 0 ${dirSign === 1 ? 0 : 1} ${cx - halfW + doorW * dirSign} ${-side * doorW}`;
                  return (
                    <g key={'d' + i}>
                      <rect x={cx - halfW} y={-cap / 2} width={halfW * 2} height={cap} fill="var(--bg)" />
                      <line x1={cx - halfW} y1={0} x2={cx - halfW + doorW * dirSign} y2={-side * doorW * 0.0} stroke="var(--c-door)" strokeOpacity="0" />
                      <path d={arcPath} fill="none" stroke="var(--c-door)" strokeWidth={sel ? 1.6 : 1} strokeOpacity={sel ? 1 : 0.6} />
                      <line x1={cx - halfW} y1={0} x2={cx - halfW + doorW * dirSign} y2={-side * doorW} stroke="var(--c-door)" strokeWidth={sel ? 2 : 1.4} />
                      {sel && <rect x={cx - halfW - 2} y={-cap / 2 - 2} width={halfW * 2 + 4} height={cap + 4} fill="none" stroke="var(--accent)" strokeWidth="1.4" strokeDasharray="3 2" />}
                    </g>
                  );
                }
              })}
            </g>
          );
        })}

        {/* Selection bbox + size labels */}
        {selection.length > 0 && (() => {
          const sels = selection.map(id => items[id]).filter(Boolean);
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const it of sels) {
            if (it.type === 'Wall') {
              minX = Math.min(minX, it.geom.x1, it.geom.x2);
              maxX = Math.max(maxX, it.geom.x1, it.geom.x2);
              minY = Math.min(minY, it.geom.y1, it.geom.y2);
              maxY = Math.max(maxY, it.geom.y1, it.geom.y2);
            } else if (it.type === 'Furniture') {
              minX = Math.min(minX, it.geom.x); maxX = Math.max(maxX, it.geom.x + it.geom.w);
              minY = Math.min(minY, it.geom.y); maxY = Math.max(maxY, it.geom.y + it.geom.d);
            } else if (it.type === 'Room') {
              const bb = bbox(it.geom.polygon);
              minX = Math.min(minX, bb.minX); maxX = Math.max(maxX, bb.maxX);
              minY = Math.min(minY, bb.minY); maxY = Math.max(maxY, bb.maxY);
            }
          }
          if (!isFinite(minX)) return null;
          const [x1, y1] = w2s(minX, minY);
          const [x2, y2] = w2s(maxX, maxY);
          return (
            <g pointerEvents="none">
              <rect x={x1 - 4} y={y1 - 4} width={x2 - x1 + 8} height={y2 - y1 + 8}
                    fill="none" stroke="var(--accent)" strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />
              <text x={x1} y={y1 - 8} fontSize="10" fontFamily="var(--font-mono)" fill="var(--accent)">
                {(maxX - minX).toFixed(2)} × {(maxY - minY).toFixed(2)} m
              </text>
            </g>
          );
        })()}

        {/* Drawing previews */}
        {drag && drag.kind === 'draw-wall' && (() => {
          const [x1, y1] = w2s(drag.x1, drag.y1);
          const [x2, y2] = w2s(drag.x2, drag.y2);
          const len = Math.hypot(drag.x2 - drag.x1, drag.y2 - drag.y1);
          return (
            <g>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--accent)" strokeWidth="6" strokeOpacity="0.3" strokeLinecap="round" />
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 2" />
              <circle cx={x1} cy={y1} r="3" fill="var(--accent)" />
              <circle cx={x2} cy={y2} r="3" fill="var(--accent)" />
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8} textAnchor="middle" fontSize="10" fontFamily="var(--font-mono)" fill="var(--accent)">{len.toFixed(2)} m</text>
            </g>
          );
        })()}

        {drag && (drag.kind === 'draw-room' || drag.kind === 'draw-fur') && (() => {
          const x1 = Math.min(drag.x1, drag.x2), y1 = Math.min(drag.y1, drag.y2);
          const x2 = Math.max(drag.x1, drag.x2), y2 = Math.max(drag.y1, drag.y2);
          const [sx1, sy1] = w2s(x1, y1);
          const [sx2, sy2] = w2s(x2, y2);
          const fill = drag.kind === 'draw-room' ? 'var(--c-room)' : 'var(--c-furniture)';
          return (
            <g>
              <rect x={sx1} y={sy1} width={sx2 - sx1} height={sy2 - sy1}
                    fill={fill} fillOpacity="0.25" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 2" />
              <text x={(sx1 + sx2) / 2} y={(sy1 + sy2) / 2} textAnchor="middle" dominantBaseline="middle" fontSize="11" fontFamily="var(--font-mono)" fill="var(--accent)">
                {(x2 - x1).toFixed(2)} × {(y2 - y1).toFixed(2)} m
              </text>
            </g>
          );
        })()}

        {/* Tool cursor preview */}
        {!drag && cursorWorld && tool !== 'select' && (() => {
          if (tool === 'Door' || tool === 'Window') {
            const cw = closestWall(...cursorWorld);
            if (cw && cw.d < 0.6) {
              const [px, py] = w2s(cw.px, cw.py);
              const c = tool === 'Door' ? 'var(--c-door)' : 'var(--c-window)';
              return (
                <g pointerEvents="none">
                  <circle cx={px} cy={py} r="8" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="3 2" />
                  <circle cx={px} cy={py} r="2.5" fill={c} />
                </g>
              );
            }
          }
          const [sx, sy] = w2s(...cursorWorld.map(snap));
          return <circle cx={sx} cy={sy} r="3" fill="var(--accent)" pointerEvents="none" />;
        })()}
      </svg>

      {/* Marquee */}
      {marquee && (
        <div className="marquee" style={{
          left: Math.min(marquee.x1, marquee.x2),
          top: Math.min(marquee.y1, marquee.y2),
          width: Math.abs(marquee.x2 - marquee.x1),
          height: Math.abs(marquee.y2 - marquee.y1),
        }} />
      )}
    </div>
  );
}

window.AS_Canvas2D = Canvas2D;
