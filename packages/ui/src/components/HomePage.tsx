import { SkaitchMark } from './SkaitchMark';
import ToolbarMenu from './ToolbarMenu';
import { ChevronDown, Settings } from 'lucide-react';
import LanguageSelect from './LanguageSelect';
import type { LangType } from '@skaitch/core/types/ifc';
import { makeT } from '@skaitch/core/data/i18n';
import { useEffect, useState } from 'react';
import { isArchived } from '@skaitch/core/lib/projectArchive';
import type { ProjectMeta } from '@skaitch/core/types/project';
import type { ReactNode } from 'react';

// ── Mini preview SVG ──────────────────────────────────────────────────────

function ProjectThumbnail({ thumbnailSvg }: { thumbnailSvg?: string }) {
  const W = 240, H = 140;
  if (!thumbnailSvg) {
    return (
      <div style={{ width: W, height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', borderRadius: 6 }}>
        <svg width="36" height="36" viewBox="0 0 20 20" style={{ color: 'var(--border-strong)', opacity: 0.5 }}>
          <path d="M3 17V7l7-3 7 3v10M7 17v-4h6v4M7 11h2M11 11h2" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        </svg>
      </div>
    );
  }
  return (
    <div
      style={{ width: W, height: H, borderRadius: 6, overflow: 'hidden' }}
      dangerouslySetInnerHTML={{ __html: thumbnailSvg }}
    />
  );
}

// ── Relative time ─────────────────────────────────────────────────────────

function relTime(iso: string, lang: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  const relative = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (mins < 1) return relative.format(0, 'second');
  if (mins < 60) return relative.format(-mins, 'minute');
  if (hrs < 24) return relative.format(-hrs, 'hour');
  if (days < 7) return relative.format(-days, 'day');
  return new Date(iso).toLocaleDateString(lang);
}

// ── Edit modal ────────────────────────────────────────────────────────────

function EditModal({ project, onSave, onClose, lang }: {
  project: ProjectMeta;
  onSave: (name: string, description: string) => void;
  onClose: () => void;
  lang: string;
}) {
  const [name, setName] = useState(project.name);
  const [desc, setDesc] = useState(project.description);
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12,
        padding: 24, width: 440, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column', gap: 16,
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
          {makeT(lang)("Edit project")}
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {makeT(lang)("Name")}
          </span>
          <input
            autoFocus value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSave(name, desc); if (e.key === 'Escape') onClose(); }}
            style={{
              padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--bg)', color: 'var(--ink)', fontSize: 13,
              fontFamily: 'var(--font-sans)',
            }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {makeT(lang)("Description")}
          </span>
          <textarea
            value={desc} onChange={(e) => setDesc(e.target.value)} rows={3}
            style={{
              padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--bg)', color: 'var(--ink)', fontSize: 13,
              resize: 'vertical', fontFamily: 'var(--font-sans)', outline: 'none',
            }}
          />
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '7px 16px', border: '1px solid var(--border)', borderRadius: 6,
            background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', fontSize: 13,
          }}>
            {makeT(lang)("Cancel")}
          </button>
          <button onClick={() => onSave(name, desc)} style={{
            padding: '7px 16px', border: 0, borderRadius: 6,
            background: 'var(--accent)', color: 'var(--bg)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
          }}>
            {makeT(lang)("Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete confirm ────────────────────────────────────────────────────────

function DeleteConfirm({ name, onConfirm, onClose, lang }: {
  name: string; onConfirm: () => void; onClose: () => void; lang: string;
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12,
        padding: 28, minWidth: 360, boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column', gap: 16,
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
          {makeT(lang)("Delete project?")}
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          {makeT(lang)('Project “{name}” will be permanently deleted.', { name })}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '7px 16px', border: '1px solid var(--border)', borderRadius: 6,
            background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', fontSize: 13,
          }}>
            {makeT(lang)("Cancel")}
          </button>
          <button onClick={onConfirm} style={{
            padding: '7px 16px', border: 0, borderRadius: 6,
            background: 'oklch(0.55 0.18 25)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
          }}>
            {makeT(lang)("Delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Project card ──────────────────────────────────────────────────────────

function ProjectCard({ project, onOpen, onEdit, onDuplicate, onArchive, onDelete, lang, limitNotice }: {
  project: ProjectMeta;
  onOpen: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  /** Set when the account is full: duplication is disabled and this explains why. */
  limitNotice?: string;
  /** Archives an active project, unarchives an archived one. */
  onArchive: () => void;
  onDelete: () => void;
  lang: string;
}) {
  const archiveLabel = makeT(lang)(isArchived(project) ? 'Unarchive' : 'Archive');
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        background: 'var(--panel)', border: `1px solid ${hovered ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 10, overflow: 'hidden', cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: hovered ? '0 4px 20px rgba(0,0,0,0.12)' : '0 1px 4px rgba(0,0,0,0.05)',
        display: 'flex', flexDirection: 'column',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onOpen}
    >
      {/* Thumbnail */}
      <div style={{ position: 'relative', overflow: 'hidden' }}>
        <ProjectThumbnail thumbnailSvg={project.thumbnailSvg} />
        {/* Hover overlay with actions */}
        {hovered && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap', padding: 8,
          }} onClick={(e) => e.stopPropagation()}>
            <button onClick={onOpen} style={actionBtn('#fff', 'var(--accent)')}>
              <svg width="13" height="13" viewBox="0 0 20 20"><path d="M5 3l12 7-12 7z" fill="currentColor" /></svg>
              {makeT(lang)("Open")}
            </button>
            <button onClick={onEdit} title={makeT(lang)("Edit")} aria-label={makeT(lang)("Edit")} style={iconBtn('#fff')}>
              <svg width="13" height="13" viewBox="0 0 20 20"><path d="M14 3l3 3-9 9H5v-3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
            </button>
            <button onClick={onDuplicate} disabled={!!limitNotice} title={limitNotice ?? makeT(lang)("Duplicate")} aria-label={makeT(lang)("Duplicate")} style={{ ...iconBtn('#fff'), ...(limitNotice ? disabledStyle : {}) }}>
              <svg width="13" height="13" viewBox="0 0 20 20"><rect x="6" y="6" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M3 13V4a1 1 0 011-1h9" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
            </button>
            <button onClick={onArchive} title={archiveLabel} aria-label={archiveLabel} style={iconBtn('#fff')}>
              <svg width="13" height="13" viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M4.5 8v8h11V8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d={isArchived(project) ? 'M10 14v-4.5M8 11.5l2-2 2 2' : 'M10 9.5V14M8 12l2 2 2-2'} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button onClick={onDelete} title={makeT(lang)("Delete")} aria-label={makeT(lang)("Delete")} style={iconBtn('oklch(0.85 0.15 25)')}>
              <svg width="13" height="13" viewBox="0 0 20 20"><path d="M5 6h10l-1 11H6L5 6zM3 6h14M8 6V4h4v2" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" /></svg>
            </button>
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {project.name}
        </div>
        {project.description && (
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.description}
          </div>
        )}
        <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
          {relTime(project.updatedAt, lang)}
        </div>
      </div>
    </div>
  );
}

function actionBtn(color: string, bg: string) {
  return {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '6px 12px', border: 0, borderRadius: 6,
    background: bg, color, cursor: 'pointer', fontSize: 12, fontWeight: 500,
    backdropFilter: 'blur(4px)',
  } as React.CSSProperties;
}

function iconBtn(color: string) {
  return {
    display: 'grid', placeItems: 'center',
    width: 30, height: 30, padding: 0, border: 0, borderRadius: 6,
    background: 'rgba(255,255,255,0.15)', color, cursor: 'pointer',
    backdropFilter: 'blur(4px)',
  } as React.CSSProperties;
}

function Chip({ icon, label }: { icon: string; label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 10.5, color: 'var(--ink-3)', background: 'var(--hover)',
      borderRadius: 4, padding: '2px 6px',
    }}>
      {icon} {label}
    </span>
  );
}

// ── HomePage ──────────────────────────────────────────────────────────────

/** The signed-in account, when the host app has accounts (the desktop app has none). */
export interface HomeUser {
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
}

interface HomePageProps {
  projects: ProjectMeta[];
  loading?: boolean;
  user: HomeUser | null;
  /** Host-specific "about" control (version, build), rendered in the header. */
  about?: ReactNode;
  /** Absent when the host app has no accounts. */
  onLogout?: () => void;
  lang: LangType;
  onLangChange: (lang: LangType) => void;
  onOpen: (project: ProjectMeta) => void;
  onCreate: () => void;
  onEdit: (id: string, name: string, description: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  /** Archives (true) or unarchives (false) a project (ADR 0020). */
  onArchive: (id: string, archived: boolean) => void;
  onImportIFC: () => void;
  onImportBimwiq: () => void;
  onImportSkaitch: () => void;
  onSettings: () => void;
  onLoadSample: () => void;
  /** Maximum number of projects for this account; creation, imports and duplication stop there. */
  projectLimit?: number;
}

const disabledStyle: React.CSSProperties = { opacity: 0.45, cursor: 'not-allowed' };

export default function HomePage({
  projects, loading, user, about, onLogout, lang, onLangChange, onOpen, onCreate, onEdit, onDuplicate, onDelete, onArchive, onImportIFC, onImportBimwiq, onImportSkaitch, onSettings, onLoadSample, projectLimit,
}: HomePageProps) {
  const [query, setQuery] = useState('');
  const [editTarget, setEditTarget] = useState<ProjectMeta | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectMeta | null>(null);
  const [view, setView] = useState<'active' | 'archived'>('active');
  /** Last archive action, offered for undo until the toast closes. */
  const [undo, setUndo] = useState<{ id: string; archived: boolean } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(timer);
  }, [undo]);
  const toggleArchive = (project: ProjectMeta) => {
    const archived = !isArchived(project);
    onArchive(project.id, archived);
    setUndo({ id: project.id, archived });
  };
  const archivedCount = projects.filter(isArchived).length;
  const shown = projects.filter(p => isArchived(p) === (view === 'archived'));

  const atLimit = projectLimit !== undefined && projects.length >= projectLimit;
  const limitNotice = atLimit ? makeT(lang)('Project limit reached ({limit} projects during the beta, archived included). Delete a project to create a new one.', { limit: projectLimit }) : undefined;
  const limited = (style: React.CSSProperties) => atLimit ? { ...style, ...disabledStyle } : style;

  // The limit counts every project, archived ones included (ADR 0020).
  const filtered = query
    ? shown.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()) || p.description.toLowerCase().includes(query.toLowerCase()))
    : shown;

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column',
    }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '10px 28px', flexWrap: 'wrap',
        minHeight: 56, borderBottom: '1px solid var(--border)', background: 'var(--panel)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SkaitchMark size={38} />
          <span style={{ fontWeight: 700, fontSize: 36, lineHeight: 1, letterSpacing: '-0.02em' }}>
            <span className="skaitch-wordmark">sk<b>ai</b>tch</span>
          </span>
        </div>

        <div style={{ flex: 1 }} />

        {/* User info + logout */}
        {user && (onLogout || user.displayName || user.email) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {user.photoURL && (
              <img src={user.photoURL} alt="" style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--border)' }} />
            )}
            <span style={{ fontSize: 12, color: 'var(--ink-3)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.displayName || user.email}
            </span>
            {onLogout && <button onClick={onLogout} style={{
              padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 5,
              background: 'transparent', color: 'var(--ink-3)', cursor: 'pointer', fontSize: 11,
            }}>
              {makeT(lang)("Sign out")}
            </button>}
          </div>
        )}

        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
          padding: '4px 10px',
        }}>
          <svg width="13" height="13" viewBox="0 0 20 20" style={{ color: 'var(--ink-3)', flexShrink: 0 }}>
            <circle cx="9" cy="9" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M13 13l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={makeT(lang)("Search…")}
            style={{
              border: 0, background: 'transparent', fontSize: 13,
              color: 'var(--ink)', width: 200, fontFamily: 'var(--font-sans)',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={onImportIFC} disabled={atLimit} title={limitNotice} style={limited(headerBtn())}>
            <svg width="13" height="13" viewBox="0 0 20 20"><path d="M10 14V5M5 9l5-5 5 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /><path d="M3 16h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            {makeT(lang)("import_ifc")}
          </button>
          <ToolbarMenu label={makeT(lang)('Other imports')} lang={lang} icon={<ChevronDown size={14} />}>
            <button className="toolbar-menu-action" data-menu-close disabled={atLimit} title={limitNotice} onClick={onImportBimwiq}>{makeT(lang)('import_bimwiq')}</button>
            <button className="toolbar-menu-action" data-menu-close disabled={atLimit} title={limitNotice} onClick={onImportSkaitch}>{makeT(lang)('Import skAItch project (.skaitch)')}</button>
          </ToolbarMenu>
          <button onClick={onCreate} disabled={atLimit} title={limitNotice} style={limited(headerBtn(true))}>
            <svg width="13" height="13" viewBox="0 0 20 20"><path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            {makeT(lang)("New project")}
          </button>
        </div>

        <button onClick={onSettings} style={headerBtn()} aria-label={makeT(lang)('settings')} title={makeT(lang)('settings')}>
          <Settings size={16} aria-hidden="true" />
        </button>
        {about}
        <LanguageSelect lang={lang} onChange={onLangChange} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '32px 28px', overflowY: 'auto' }}>
        {/* Section title */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>
            {makeT(lang)("My projects")}
          </h1>
          <span style={{ fontSize: 12, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>
            {projectLimit !== undefined && !query
              ? makeT(lang)('{count}/{limit} projects', { count: projects.length, limit: projectLimit })
              : filtered.length}
          </span>
        </div>
        <div role="tablist" aria-label={makeT(lang)('My projects')} style={{ display: 'flex', gap: 4, margin: '-12px 0 20px' }}>
          {(['active', 'archived'] as const).map(tab => (
            <button key={tab} role="tab" aria-selected={view === tab} onClick={() => setView(tab)} style={{
              padding: '4px 12px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
              border: `1px solid ${view === tab ? 'var(--accent)' : 'var(--border)'}`,
              background: view === tab ? 'var(--accent)' : 'transparent', color: view === tab ? '#fff' : 'var(--ink-3)',
            }}>
              {makeT(lang)(tab === 'active' ? 'Active projects' : 'Archived projects')} · {tab === 'active' ? projects.length - archivedCount : archivedCount}
            </button>
          ))}
        </div>
        {limitNotice && (
          <p role="status" style={{ margin: '-12px 0 20px', fontSize: 12.5, color: 'var(--ink-3)' }}>{limitNotice}</p>
        )}

        {filtered.length === 0 ? (
          view === 'archived' && !query
            ? <p style={{ textAlign: 'center', padding: '60px 0', color: 'var(--ink-4)', fontSize: 13 }}>{makeT(lang)('No archived projects')}</p>
            : <EmptyState lang={lang} hasQuery={!!query} onCreate={onCreate} onImport={onImportIFC} />
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 16,
          }}>
            {filtered.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                lang={lang}
                onOpen={() => onOpen(p)}
                onEdit={() => setEditTarget(p)}
                onDuplicate={() => onDuplicate(p.id)}
                onArchive={() => toggleArchive(p)}
                limitNotice={limitNotice}
                onDelete={() => setDeleteTarget(p)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--ink-4)', fontSize: 13 }}>
          {makeT(lang)("Loading projects…")}
        </div>
      )}

      {editTarget && (
        <EditModal
          project={editTarget} lang={lang}
          onClose={() => setEditTarget(null)}
          onSave={(name, description) => {
            onEdit(editTarget.id, name, description);
            setEditTarget(null);
          }}
        />
      )}
      {undo && (
        <div role="status" style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 50,
          display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px', borderRadius: 8,
          background: 'var(--ink)', color: 'var(--bg)', fontSize: 13, boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
        }}>
          {makeT(lang)(undo.archived ? 'Project archived' : 'Project unarchived')}
          <button onClick={() => { onArchive(undo.id, !undo.archived); setUndo(null); }} style={{
            border: 0, background: 'transparent', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer', fontSize: 13,
          }}>{makeT(lang)('Undo')}</button>
        </div>
      )}
      {deleteTarget && (
        <DeleteConfirm
          name={deleteTarget.name} lang={lang}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => { onDelete(deleteTarget.id); setDeleteTarget(null); }}
        />
      )}
    </div>
  );
}

function headerBtn(primary = false): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 14px', border: primary ? 0 : '1px solid var(--border)',
    borderRadius: 6, cursor: 'pointer', fontSize: 12.5, fontWeight: primary ? 600 : 400,
    background: primary ? 'var(--accent)' : 'transparent',
    color: primary ? '#fff' : 'var(--ink)',
  };
}

function EmptyState({ lang, hasQuery, onCreate, onImport }: {
  lang: string; hasQuery: boolean; onCreate: () => void; onImport: () => void;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '80px 0', gap: 20, color: 'var(--ink-3)',
    }}>
      <svg width="56" height="56" viewBox="0 0 20 20" style={{ opacity: 0.3 }}>
        <path d="M3 17V7l7-3 7 3v10M7 17v-4h6v4M7 11h2M11 11h2" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </svg>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>
          {hasQuery
            ? (makeT(lang)("No results"))
            : (makeT(lang)("No projects yet"))}
        </div>
        <div style={{ fontSize: 13 }}>
          {hasQuery
            ? (makeT(lang)("Try a different search term"))
            : (makeT(lang)("Create a project or import an IFC file"))}
        </div>
      </div>
      {!hasQuery && (
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCreate} style={headerBtn(true)}>
            <svg width="13" height="13" viewBox="0 0 20 20"><path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            {makeT(lang)("New project")}
          </button>
          <button onClick={onImport} style={headerBtn()}>
            <svg width="13" height="13" viewBox="0 0 20 20"><path d="M10 14V5M5 9l5-5 5 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /><path d="M3 16h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            {makeT(lang)("import_ifc")}
          </button>
        </div>
      )}
    </div>
  );
}
