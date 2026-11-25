import { STAIR_FORMS, type StairGeom } from '@skaitch/core/lib/stairGeometry';

const paths: Record<StairGeom['form'], string> = {
  straight: 'M12 40V8H28V40M12 14H28M12 20H28M12 26H28M12 32H28',
  quarter: 'M8 40V8H40V24H24V40ZM8 24H24M8 30H24M8 35H24M30 8V24M35 8V24',
  doubleQuarter: 'M4 40V6H44V40H30V20H18V40ZM4 24H18M4 30H18M4 35H18M30 24H44M30 30H44M30 35H44M22 6V20M27 6V20',
  half: 'M7 40V6H41V40H26V22H22V40ZM7 24H22M7 30H22M7 35H22M26 24H41M26 30H41M26 35H41',
  spiral: 'M24 5A19 19 0 1 1 5 24M24 5V43M5 24H43M11 11L37 37M11 37L37 11M24 20A4 4 0 1 1 23.9 20',
};

export default function StairTypePicker({ form, landing, onFormChange, onLandingChange, onClose, lang }: {
  form: StairGeom['form']; landing: boolean;
  onFormChange: (form: StairGeom['form']) => void;
  onLandingChange: (landing: boolean) => void;
  onClose: () => void; lang: string;
}) {
  const fr = lang === 'fr';
  const english: Record<StairGeom['form'], string> = { straight: 'Straight', quarter: 'Quarter turn', doubleQuarter: 'Two quarter turns', half: 'Half turn', spiral: 'Spiral' };
  return <section aria-label={fr ? 'Types d’escalier' : 'Stair types'}
    onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()}
    onDoubleClick={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()} onTouchEnd={e => e.stopPropagation()}
    style={{ position: 'fixed', left: 'calc(var(--toolbox-w, 44px) + 8px)', top: 'calc(var(--topbar-h, 36px) + 8px)', width: 356, maxWidth: 'calc(100vw - var(--toolbox-w, 44px) - 16px)', maxHeight: 'calc(100dvh - var(--topbar-h, 36px) - 24px)', display: 'flex', flexDirection: 'column', background: 'color-mix(in oklch, var(--panel) 94%, transparent)', backdropFilter: 'blur(16px)', color: 'var(--ink)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.18)', zIndex: 200, overflow: 'hidden', cursor: 'default' }}>
    <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', padding: '10px 12px', gap: 8, flexShrink: 0, background: 'var(--panel)', height: 42, boxSizing: 'border-box' }}>
      <svg aria-hidden="true" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ color: 'var(--accent)', flexShrink: 0 }}><path d="M3 21h5v-6h5V9h5V3h3" /></svg>
      <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{fr ? 'Escaliers' : 'Stairs'}</span>
      <button type="button" aria-label={fr ? 'Fermer le choix des escaliers' : 'Close stair picker'} onClick={onClose}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', display: 'flex', alignItems: 'center', padding: 2 }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 6L6 18M6 6l12 12" /></svg>
      </button>
    </div>
    <div style={{ overflow: 'auto', padding: 12 }}>
    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 8, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{fr ? 'Formes' : 'Shapes'}</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {(Object.keys(STAIR_FORMS) as StairGeom['form'][]).map(value => <button key={value} type="button" aria-pressed={form === value} onClick={() => onFormChange(value)}
        style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px 5px 5px', width: 82, flexShrink: 0, border: form === value ? '2px solid var(--accent)' : '1px solid var(--border)', borderRadius: 8, background: form === value ? 'color-mix(in oklch, var(--accent) 10%, var(--panel))' : 'var(--panel)', cursor: 'pointer', transition: 'all 0.13s', boxShadow: form === value ? '0 0 0 3px color-mix(in oklch, var(--accent) 20%, transparent)' : '0 1px 3px rgba(0,0,0,0.07)' }}>
        <svg aria-hidden="true" width="72" height="44" viewBox="0 0 72 44" style={{ display: 'block' }}><rect width="72" height="44" rx="3" fill="var(--bg)"/><g transform="translate(16 2) scale(.83)"><path d={paths[value]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></g></svg>
        <span style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', color: form === value ? 'var(--accent)' : 'var(--ink)', textAlign: 'center', fontWeight: form === value ? 600 : 400, maxWidth: 76, lineHeight: 1.2 }}>{fr ? STAIR_FORMS[value] : english[value]}</span>
        {form === value && <span style={{ position: 'absolute', top: 3, right: 3, width: 13, height: 13, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg aria-hidden="true" width={7} height={7} viewBox="0 0 10 10"><path d="M2 5l2.5 2.5 4-4" stroke='var(--bg)' strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>}
      </button>)}
    </div>
    {form !== 'straight' && form !== 'spiral' && <label style={{ display: 'block', marginTop: 10, fontSize: 12 }}>
      <input type="checkbox" checked={landing} onChange={e => onLandingChange(e.target.checked)} /> {fr ? 'Avec palier (décocher pour marches balancées)' : 'With landing (uncheck for winders)'}
    </label>}
    <p style={{ fontSize: 11, color: 'var(--ink-3)', margin: '10px 0 0', lineHeight: 1.5 }}>{fr ? 'Cliquez ensuite dans le plan pour placer l’escalier. Ses dimensions se règlent dans les propriétés.' : 'Then click in the plan to place the stair. Adjust its dimensions in Properties.'}</p>
    </div>
  </section>;
}
