import ViewSelect from '../ViewSelect';
import type { ViewType } from '@skaitch/core/types/ifc';
import { makeT } from '@skaitch/core/data/i18n';
interface BottomNavProps {
  treeOpen: boolean;
  toolOpen: boolean;
  propsOpen: boolean;
  view: ViewType;
  selectionCount: number;
  onTreeToggle: () => void;
  onToolToggle: () => void;
  onViewChange: (view: ViewType) => void;
  onPropsToggle: () => void;
  lang: string;
}

export default function BottomNav({
  treeOpen, toolOpen, propsOpen, view, selectionCount,
  onTreeToggle, onToolToggle, onViewChange, onPropsToggle, lang,
}: BottomNavProps) {
  return (
    <nav style={{
      height: 'calc(56px + env(safe-area-inset-bottom, 0px))',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      display: 'flex', flexShrink: 0,
      background: 'var(--panel)', borderTop: '1px solid var(--border)',
    }}>
      <button className={`mobile-nav-tab${treeOpen ? ' active' : ''}`} aria-expanded={treeOpen} onClick={onTreeToggle}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M3 6h18M3 12h12M3 18h8" />
        </svg>
        <span>{makeT(lang)("Tree")}</span>
      </button>

      <button className={`mobile-nav-tab${toolOpen ? ' active' : ''}`} aria-expanded={toolOpen} onClick={onToolToggle}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8h14M3 12h14" />
          <rect x="3" y="16" width="14" height="4" rx="1" />
        </svg>
        <span>{makeT(lang)("Tools")}</span>
      </button>

      <div className="mobile-nav-tab mobile-view-select">
        <ViewSelect view={view} onChange={onViewChange} lang={lang} />
      </div>

      <button
        className={`mobile-nav-tab${propsOpen ? ' active' : ''}`}
        aria-expanded={propsOpen} onClick={onPropsToggle}
        style={{ position: 'relative' }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
        {selectionCount > 0 && (
          <span style={{
            position: 'absolute', top: 6, right: 'calc(50% - 15px)',
            background: 'var(--accent)', color: 'var(--bg)',
            borderRadius: '50%', width: 16, height: 16, fontSize: 9, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-mono)', pointerEvents: 'none',
          }}>
            {selectionCount > 9 ? '9+' : selectionCount}
          </span>
        )}
        <span>{makeT(lang)("Props")}</span>
      </button>
    </nav>
  );
}
