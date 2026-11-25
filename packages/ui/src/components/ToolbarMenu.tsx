import { useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, X } from 'lucide-react';
import { makeT } from '@skaitch/core/data/i18n';

export default function ToolbarMenu({ label, lang, icon, children, active }: {
  label: string; lang: string; icon?: ReactNode; children: ReactNode; active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ top: 64, right: 16 });
  return <Dialog.Root open={open} onOpenChange={next => {
    if (next && trigger.current) {
      const rect = trigger.current.getBoundingClientRect();
      setPosition({ top: rect.bottom + 8, right: Math.max(12, Math.min(window.innerWidth - rect.right, window.innerWidth - 312)) });
    }
    setOpen(next);
  }}>
    <Dialog.Trigger ref={trigger} className={`header-command${icon ? ' header-command-icon' : ''}`} title={label} aria-label={label} aria-pressed={active}>
      {icon ?? <>{label}<ChevronDown size={13} /></>}
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="toolbar-menu-backdrop" />
      <Dialog.Content aria-describedby={undefined} className="toolbar-menu-content" style={{
        '--menu-top': `${position.top}px`, '--menu-right': `${position.right}px`,
      } as React.CSSProperties} onClick={e => {
        if ((e.target as HTMLElement).closest('[data-menu-close]')) setOpen(false);
      }}>
        <div className="toolbar-menu-heading">
          <Dialog.Title>{label}</Dialog.Title>
          <Dialog.Close className="header-command header-command-icon" aria-label={makeT(lang)('Close')}><X size={18} /></Dialog.Close>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
