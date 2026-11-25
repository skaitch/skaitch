import { useState, type ReactNode } from 'react';

export default function Sheet({ eyebrow, title, aside, onClose, children }: { eyebrow?: string; title: string; aside?: ReactNode; onClose: () => void; children: ReactNode }) {
  // Closing from the scrim slides the sheet down before it is removed.
  const [closing, setClosing] = useState(false);
  const close = () => { if (closing) return; setClosing(true); setTimeout(onClose, 220); };
  return (
    <div className={`scrim ${closing ? 'closing' : ''}`} onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="sheet" role="dialog" aria-label={title}>
        <div className="handle" />
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <div className="sheet-head"><h3>{title}</h3>{aside}</div>
        {children}
      </div>
    </div>
  );
}
