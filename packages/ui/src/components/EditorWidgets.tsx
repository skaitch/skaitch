// Small editor widgets used by SkaitchApp: minimap, snapping, zoom, wall opacity, toolbar data, import overlay.
import { useState, useEffect, useRef } from 'react';
import type { ViewState2D } from '@skaitch/core/types/ifc';
import { makeT } from '@skaitch/core/data/i18n';
import { bbox } from '@skaitch/core/data/query';
import { type ImportProgress } from '../lib/importIFC';


export function Minimap({ items, storeyId }: { items: any; storeyId: string }) {
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
export function SnapControl({
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
export function ZoomBox({ view, setView }: { view: ViewState2D, setView: React.Dispatch<React.SetStateAction<ViewState2D>> }) {
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

export const TOOLBAR_TYPES = ['Slab', 'Roof', 'Wall', 'Column', 'Chimney', 'Stair', 'Room', 'Door', 'Window', 'Technical', 'Furniture'] as const;

// ── WallOpacityControl ──────────────────────────────────────────────────────
export function WallOpacityControl({ opacity, setOpacity, lang }: { opacity: number; setOpacity: (v: number) => void; lang: string }) {
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
export const TYPE_KEYS: Record<string, string> = { Wall: 'W', Door: 'D', Window: 'F', Room: 'R', Slab: 'S', Roof: 'K', Furniture: 'M', Technical: 'T', Column: 'P', Chimney: 'H' };
export const TYPE_ICONS: Record<string, React.ReactNode> = {
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
export function ImportOverlay({ progress, lang }: { progress: ImportProgress; lang: string }) {
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
