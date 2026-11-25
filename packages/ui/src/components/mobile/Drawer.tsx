import { useEffect } from 'react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side: 'bottom' | 'left' | 'right';
  size?: string;
  title?: string;
  children: React.ReactNode;
}

export default function Drawer({ open, onClose, side, size, title, children }: DrawerProps) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const sideStyle: React.CSSProperties =
    side === 'bottom' ? {
      bottom: 0, left: 0, right: 0,
      height: size ?? '72vh',
      maxHeight: '90vh',
      borderRadius: '14px 14px 0 0',
      transform: open ? 'translateY(0)' : 'translateY(100%)',
      boxShadow: '0 -8px 32px rgba(0,0,0,0.18)',
    } : side === 'left' ? {
      top: 0, bottom: 0, left: 0,
      width: size ?? '300px',
      transform: open ? 'translateX(0)' : 'translateX(-100%)',
      boxShadow: '8px 0 32px rgba(0,0,0,0.18)',
    } : {
      top: 0, bottom: 0, right: 0,
      width: size ?? '320px',
      transform: open ? 'translateX(0)' : 'translateX(100%)',
      boxShadow: '-8px 0 32px rgba(0,0,0,0.18)',
    };

  return (
    <>
      <div
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.45)',
          zIndex: 199,
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.25s',
        }}
        onClick={onClose}
      />
      <div style={{
        position: 'fixed',
        zIndex: 200,
        background: 'var(--panel)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
        ...sideStyle,
      }}>
        {side === 'bottom' && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, flexShrink: 0 }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border-strong)' }} />
          </div>
        )}
        {title && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px',
                color: 'var(--ink-3)', fontSize: 20, lineHeight: 1, borderRadius: 4,
              }}
            >×</button>
          </div>
        )}
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {children}
        </div>
      </div>
    </>
  );
}
