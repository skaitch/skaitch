import { useEffect, useState } from 'react';
import type { ElementPhoto } from '@skaitch/core/survey/reconstruct';
import PhotoNotePin from '../survey/PhotoNotePin';

/**
 * Read-only survey photo with its notes and photo cotes drawn where they were placed on site
 * (ADR 0016, addendum). Annotations are corrected in the Survey app only.
 */
export default function SurveyPhotoViewer({ photo, title, lang, onClose }: {
  photo: ElementPhoto; title: string; lang: string; onClose: () => void;
}) {
  const tr = (fr: string, en: string) => (lang === 'fr' ? fr : en);
  const [noteStates, setNoteStates] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const notes = photo.annotationList.filter(a => a.type === 'note');
  const measures = photo.annotationList.filter(a => a.type === 'measure');
  const pct = (v: number) => `${v * 100}%`;
  const fmt = (m: number) => `${m.toFixed(2).replace('.', lang === 'fr' ? ',' : '.')} m`;
  return (
    <div role="dialog" aria-label={title} onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.82)', display: 'grid', placeItems: 'center', cursor: 'zoom-out', padding: 16 }}>
      <figure onClick={e => e.stopPropagation()} style={{ margin: 0, display: 'grid', gap: 8, cursor: 'default', maxWidth: '94vw' }}>
        <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
          <img src={photo.url} alt={title} style={{ maxWidth: '94vw', maxHeight: '80vh', display: 'block' }} />
          <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            {measures.map(m => (
              <g key={m.id}>
                <line x1={m.p1[0] * 1000} y1={m.p1[1] * 1000} x2={m.p2[0] * 1000} y2={m.p2[1] * 1000} stroke="#000" strokeOpacity={0.5} strokeWidth={6} vectorEffect="non-scaling-stroke" />
                <line x1={m.p1[0] * 1000} y1={m.p1[1] * 1000} x2={m.p2[0] * 1000} y2={m.p2[1] * 1000} stroke="#ffd23f" strokeWidth={3} vectorEffect="non-scaling-stroke" />
              </g>
            ))}
          </svg>
          {measures.map(m => (
            <span key={m.id} style={{
              position: 'absolute', left: pct((m.p1[0] + m.p2[0]) / 2), top: pct((m.p1[1] + m.p2[1]) / 2), transform: 'translate(-50%, -130%)',
              background: '#ffd23f', color: '#222', fontSize: 12, fontWeight: 600, lineHeight: 1.2, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap',
            }}>{fmt(m.value_m)}</span>
          ))}
          {notes.map((n, i) => {
            const key = `${photo.id}/${n.id}`;
            const collapsed = (noteStates[key] ?? n.collapsed) === true;
            return <button key={n.id} type="button" aria-expanded={!collapsed}
              aria-label={collapsed ? tr('Ouvrir le post-it', 'Open post-it') : undefined}
              title={collapsed ? tr('Ouvrir le post-it', 'Open post-it') : tr('Réduire le post-it', 'Collapse post-it')}
              onClick={() => setNoteStates(states => ({ ...states, [key]: !collapsed }))}
              style={{
                position: 'absolute', left: pct(n.p[0]), top: pct(n.p[1]),
                transform: collapsed ? 'translate(-50%, -50%)' : 'translate(-4px, -4px)', maxWidth: 200,
                display: collapsed ? 'grid' : undefined, placeItems: 'center', minWidth: collapsed ? 44 : undefined, minHeight: collapsed ? 44 : undefined,
                background: collapsed ? 'transparent' : '#fff59d', color: '#222', border: 0, fontSize: 12, lineHeight: 1.3, padding: '4px 6px', borderRadius: 4,
                boxShadow: collapsed ? undefined : '0 2px 6px rgba(0,0,0,.35)', whiteSpace: 'pre-wrap', textAlign: 'start', cursor: 'pointer',
              }}>{collapsed ? <PhotoNotePin /> : <><b>{i + 1}.</b> {n.text}</>}</button>;
          })}
        </div>
        <figcaption style={{ color: '#eee', fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>{title}{photo.annotations ? ` · ${notes.length} post-it · ${measures.length} ${tr('cote(s)', 'cote(s)')}` : ''}</span>
          <span style={{ opacity: 0.7 }}>{tr('Lecture seule — les annotations se corrigent dans skAItch Survey', 'Read-only — annotations are edited in skAItch Survey')}</span>
        </figcaption>
      </figure>
    </div>
  );
}
