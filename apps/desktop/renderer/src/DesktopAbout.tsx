import AboutDialog from '@skaitch/ui/components/AboutDialog';
import { makeT } from '@skaitch/core/data/i18n';

/** About dialog of the desktop app: its release and build, with no server to query. */
export default function DesktopAbout({ lang, placement }: { lang: string; placement?: 'home' | 'menu' }) {
  const t = makeT(lang);
  return (
    <AboutDialog lang={lang} placement={placement}>
      <dl style={{ margin: 0, display: 'grid', gap: 16, fontSize: 13 }}>
        <div>
          <dt style={{ color: 'var(--ink-3)', marginBottom: 6 }}>{t('Desktop app')}</dt>
          <dd style={{ margin: 0, fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' }}>{__RELEASE_VERSION__} · {__BUILD_VERSION__}</dd>
        </div>
      </dl>
    </AboutDialog>
  );
}
