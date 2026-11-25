import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { makeT } from '@skaitch/core/data/i18n';
import { Info } from 'lucide-react';

interface Installer { platform: string; arch: string; format: string; url: string }

/** Button label of an installer served by /api/download. */
export function installerLabel({ platform, arch, format }: Installer) {
  if (platform === 'windows') return 'Windows';
  if (platform === 'mac') return arch === 'arm64' ? 'macOS (Apple Silicon)' : 'macOS (Intel)';
  return format === 'deb' ? 'Linux (.deb)' : 'Linux (AppImage)';
}

export default function About({ lang, placement = 'home' }: { lang: string; placement?: 'home' | 'menu' }) {
  const [server, setServer] = useState<{ release: string; build: string } | null>(null);
  const [desktop, setDesktop] = useState<{ version: string; installers: Installer[] } | null>(null);
  const t = makeT(lang);

  return (
    <Dialog.Root onOpenChange={(open) => {
      if (open) {
        setServer(null);
        fetch('/api/version', { cache: 'no-store' })
          .then(async response => {
            if (!response.ok) throw new Error('Version unavailable');
            const info = await response.json();
            if (typeof info.release !== 'string' || typeof info.build !== 'string') throw new Error('Invalid version');
            setServer(info);
          })
          .catch(() => setServer({ release: 'unknown', build: 'unknown' }));
        setDesktop(null);
        fetch('/api/download')
          .then(async response => {
            if (!response.ok) throw new Error('Downloads unavailable');
            const info = await response.json();
            setDesktop({ version: String(info.version), installers: Array.isArray(info.installers) ? info.installers : [] });
          })
          .catch(() => setDesktop({ version: '', installers: [] }));
      }
    }}>
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
          <dl style={{ margin: 0, display: 'grid', gap: 16, fontSize: 13 }}>
            <div>
              <dt style={{ color: 'var(--ink-3)', marginBottom: 6 }}>{t('Application build')}</dt>
              <dd style={{ margin: 0, fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' }}>{__RELEASE_VERSION__} · {__BUILD_VERSION__}</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--ink-3)', marginBottom: 6 }}>{t('Server build')}</dt>
              <dd aria-live="polite" style={{ margin: 0, fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' }}>{server ? `${server.release} · ${server.build}` : '…'}</dd>
            </div>
            <div>
              <dt style={{ color: 'var(--ink-3)', marginBottom: 6 }}>{t('Desktop app')}{desktop?.version ? ` · ${desktop.version}` : ''}</dt>
              <dd aria-live="polite" style={{ margin: 0 }}>
                {!desktop ? '…' : desktop.installers.length === 0 ? t('No installer available yet.') : (
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {desktop.installers.map(installer => (
                      <a key={installer.url} className="btn" href={installer.url} download style={{ textDecoration: 'none' }}>{installerLabel(installer)}</a>
                    ))}
                  </span>
                )}
              </dd>
            </div>
          </dl>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
            <Dialog.Close className="btn">{t('Close')}</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
