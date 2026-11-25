import { makeT } from '@skaitch/core/data/i18n';
import type { ToolType } from '@skaitch/core/types/ifc';

const TOOLS: Array<{
  type: ToolType;
  labelFr: string;
  labelEn: string;
  icon: React.ReactNode;
  color?: string;
}> = [
  {
    type: 'select', labelFr: 'Sélection', labelEn: 'Select',
    icon: <path d="M4 3l13 7-5.5 1.5L9 17 4 3z" fill="currentColor" />,
  },
  {
    type: 'Measure', labelFr: 'Mesurer', labelEn: 'Measure',
    icon: <path d="M2 12l10-10 6 6L8 18z" fill="none" stroke="currentColor" strokeWidth="1.4" />,
  },
  {
    type: 'Dimension', labelFr: 'Cotation', labelEn: 'Dimension',
    icon: <path d="M3 17l14-14M13 3h4v4M3 13v4h4" stroke="currentColor" strokeWidth="1.4" fill="none" />,
  },
  {
    type: 'Wall', labelFr: 'Mur', labelEn: 'Wall', color: 'var(--c-wall)',
    icon: <path d="M3 8h14M3 12h14" stroke="currentColor" strokeWidth="1.5" />,
  },
  {
    type: 'Stair', labelFr: 'Escalier', labelEn: 'Stair', color: 'var(--ink-3)',
    icon: <path d="M2 18h4v-4h4v-4h4V6h4" fill="none" stroke="currentColor" strokeWidth="1.4" />,
  },
  {
    type: 'Door', labelFr: 'Porte', labelEn: 'Door', color: 'var(--c-door)',
    icon: <><path d="M5 3v14h7l4-2V3z" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M16 3v14" stroke="currentColor" strokeWidth="1.4" /></>,
  },
  {
    type: 'Window', labelFr: 'Fenêtre', labelEn: 'Window', color: 'var(--c-window)',
    icon: <><rect x="3.5" y="5.5" width="13" height="9" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M10 5.5v9M3.5 10h13" stroke="currentColor" strokeWidth="1.2" /></>,
  },
  {
    type: 'Room', labelFr: 'Pièce', labelEn: 'Room', color: 'var(--c-room)',
    icon: <path d="M3 4l6-2 8 3v11l-7 2-7-3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />,
  },
  {
    type: 'Slab', labelFr: 'Dalle', labelEn: 'Slab', color: 'var(--ink-3)',
    icon: <path d="M3 8l14-3 1 7-14 3z" fill="none" stroke="currentColor" strokeWidth="1.4" />,
  },
  {
    type: 'Section', labelFr: 'Gestion des coupes', labelEn: 'Section settings', color: 'var(--ink-3)',
    icon: <path d="M2 10h16" fill="none" stroke="currentColor" strokeWidth="1.4" />,
  },
  {
    type: 'Roof', labelFr: 'Toit', labelEn: 'Roof', color: 'oklch(0.55 0.09 30)',
    icon: <><path d="M2 11l8-7 8 7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M5 9v7h10V9" fill="none" stroke="currentColor" strokeWidth="1.2" /></>,
  },
  {
    type: 'Furniture', labelFr: 'Mobilier', labelEn: 'Furniture', color: 'var(--c-furniture)',
    icon: <><rect x="3" y="9" width="14" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M5 9V7M15 9V7M4 15v2M16 15v2" stroke="currentColor" strokeWidth="1.4" /></>,
  },
];

interface ToolSheetProps {
  open: boolean;
  onClose: () => void;
  tool: ToolType;
  setTool: (t: ToolType) => void;
  lang: string;
}

export default function ToolSheet({ open, onClose, tool, setTool, lang }: ToolSheetProps) {
  return (
    <>
      <div
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.35)',
          zIndex: 199,
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.22s',
        }}
        onClick={onClose}
      />
      <div style={{
        position: 'fixed', bottom: 56, left: 0, right: 0,
        background: 'var(--panel)',
        borderRadius: '14px 14px 0 0',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.18)',
        zIndex: 200,
        transform: open ? 'translateY(0)' : 'translateY(110%)',
        transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
        padding: '0 16px 20px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 12 }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border-strong)' }} />
        </div>
        <div style={{ marginBottom: 10, fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {makeT(lang)("Drawing tools")}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {TOOLS.map(({ type, labelFr, labelEn, icon, color }) => {
            const isActive = tool === type;
            return (
              <button
                key={type}
                onClick={() => { setTool(type); onClose(); }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
                  padding: '14px 8px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: isActive ? 'var(--accent-soft)' : 'var(--hover)',
                  color: isActive ? 'var(--accent)' : (color ?? 'var(--ink-2)'),
                  fontSize: 11.5, fontFamily: 'var(--font-sans)', fontWeight: isActive ? 600 : 400,
                  transition: 'background 0.15s, color 0.15s',
                  minHeight: 70,
                }}
              >
                <svg width="26" height="26" viewBox="0 0 20 20">{icon}</svg>
                {makeT(lang)(labelEn)}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
