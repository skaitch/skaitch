import * as Dialog from '@radix-ui/react-dialog';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { makeT } from '@skaitch/core/data/i18n';

/** About dialog shell shared by the apps: a home page button or a row of the editor's "More" menu, opening `children`. */
export default function AboutDialog({ lang, placement = 'home', children }: { lang: string; placement?: 'home' | 'menu'; children: ReactNode }) {
  const t = makeT(lang);
  return (
    <Dialog.Root>
      {placement === 'menu'
        ? <Dialog.Trigger className="toolbar-menu-action"><Info size={18} />{t('About')}</Dialog.Trigger>
        : <Dialog.Trigger style={{
          padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 6,
          background: 'transparent', color: 'var(--ink)', font: 'inherit', fontSize: 12,
          cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
        }}>{t('About')}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 2000 }} />
        <Dialog.Content aria-describedby={undefined} style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(420px, calc(100vw - 32px))', boxSizing: 'border-box', padding: 24,
          background: 'var(--panel)', color: 'var(--ink)', border: '1px solid var(--border)',
          borderRadius: 12, boxShadow: '0 16px 48px rgba(0,0,0,0.25)', zIndex: 2001,
        }}>
          <Dialog.Title style={{ margin: '0 0 20px', fontSize: 18 }}>{t('About')} SkAItch</Dialog.Title>
          {children}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
            <Dialog.Close className="btn">{t('Close')}</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
