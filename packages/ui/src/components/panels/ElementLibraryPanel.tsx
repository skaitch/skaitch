import { makeT } from '@skaitch/core/data/i18n';
import React, { useRef, useEffect, useState } from 'react';
import type { ToolType } from '@skaitch/core/types/ifc';
import {
  type ElementDef, type ElementSource,
  groupByCategory, getElementsByType,
  loadUserLibrary, saveUserLibrary,
  parseCustomLibrary, exportLibraryToJson,
  BUILTIN_CATALOGUE,
} from '@skaitch/core/data/elementCatalogue';
import { renderElementSvg } from '../../data/elementSvg';

// ─── Tile ─────────────────────────────────────────────────────────────────────
function Tile({ def, selected, onSelect, onDelete, lang }: {
  def: ElementDef; selected: boolean; onSelect: () => void;
  onDelete?: () => void; lang: string;
}) {
  const W = 72, H = 44;
  const label = lang === 'fr' ? def.labelFr : def.labelEn;
  const dim = `${Math.round(def.defaults.width * 100)}cm`;
  const isCustom = def.source !== 'builtin';
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        id={`el-tile-${def.id}`}
        onClick={onSelect}
        title={label}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
          padding: '6px 5px 5px',
          border: selected ? '2px solid var(--accent)' : '1px solid var(--border)',
          borderRadius: 8,
          background: selected ? 'color-mix(in oklch, var(--accent) 10%, var(--panel))' : 'var(--panel)',
          cursor: 'pointer', width: 82, flexShrink: 0,
          transition: 'all 0.13s',
          boxShadow: selected ? '0 0 0 3px color-mix(in oklch, var(--accent) 20%, transparent)' : '0 1px 3px rgba(0,0,0,0.07)',
          outline: 'none',
        }}
      >
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
          <rect x={0} y={0} width={W} height={H} fill="var(--bg)" rx={3} />
          <g transform={`translate(0,${H / 2 - 1})`}>{renderElementSvg(def.iconKey, W, H)}</g>
        </svg>
        <span style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', color: selected ? 'var(--accent)' : 'var(--ink)', textAlign: 'center', fontWeight: selected ? 600 : 400, maxWidth: 76, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>{label}</span>
        <span style={{ fontSize: 9, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>{dim}</span>
        {selected && (
          <div style={{ position: 'absolute', top: 3, right: 3, width: 13, height: 13, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={7} height={7} viewBox="0 0 10 10"><path d="M2 5l2.5 2.5 4-4" stroke='var(--bg)' strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
        )}
        {isCustom && (
          <span style={{ position: 'absolute', top: 3, left: 3, fontSize: 7, fontFamily: 'var(--font-mono)', background: def.source === 'project' ? 'oklch(0.6 0.15 270)' : 'oklch(0.6 0.15 145)', color: '#fff', borderRadius: 3, padding: '1px 3px', letterSpacing: '0.04em' }}>
            {def.source === 'project' ? 'PRJ' : 'USR'}
          </span>
        )}
      </button>
      {isCustom && onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title={makeT(lang)("Delete")}
          style={{ position: 'absolute', top: -5, right: -5, width: 16, height: 16, borderRadius: '50%', background: 'oklch(0.55 0.18 25)', border: 'none', cursor: 'pointer', display: 'none', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
          className="tile-delete-btn"
        >
          <svg width={8} height={8} viewBox="0 0 10 10"><path d="M2 2l6 6M8 2l-6 6" stroke="white" strokeWidth={1.8} strokeLinecap="round" /></svg>
        </button>
      )}
    </div>
  );
}

// ─── Category section ─────────────────────────────────────────────────────────
function CategoryGroup({ category, items, selectedElementId, onSelectElement, onDelete, lang }: {
  category: string; items: ElementDef[];
  selectedElementId: string | null; onSelectElement: (id: string) => void;
  onDelete: (id: string) => void; lang: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-4)', paddingLeft: 2 }}>{category}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {items.map((def) => (
          <Tile key={def.id} def={def} selected={selectedElementId === def.id}
            onSelect={() => onSelectElement(def.id)}
            onDelete={def.source !== 'builtin' ? () => onDelete(def.id) : undefined}
            lang={lang} />
        ))}
      </div>
    </div>
  );
}

// ─── Custom element form ──────────────────────────────────────────────────────
function AddCustomForm({ type, onAdd, onClose, lang }: {
  type: 'Door' | 'Window'; onAdd: (def: ElementDef) => void; onClose: () => void; lang: string;
}) {
  const fr = lang === 'fr';
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('');
  const [width, setWidth] = useState(type === 'Door' ? 90 : 120);
  const [height, setHeight] = useState(type === 'Door' ? 210 : 120);
  const [sill, setSill] = useState(90);
  const [opType, setOpType] = useState(type === 'Door' ? 'SINGLE_SWING_LEFT' : 'DOUBLE_PANEL');
  const [scope, setScope] = useState<ElementSource>('user');

  const doorOpTypes = ['SINGLE_SWING_LEFT', 'SINGLE_SWING_RIGHT', 'DOUBLE_DOOR_SINGLE_SWING', 'SLIDING', 'FOLDING'];
  const winOpTypes = ['FIXED', 'SINGLE_PANEL', 'DOUBLE_PANEL', 'SLIDING', 'TILT_AND_TURN'];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    const id = `custom-${type.toLowerCase()}-${Date.now()}`;
    const def: ElementDef = {
      id, type, category: category.trim() || (makeT(lang)("Custom")),
      labelFr: label, labelEn: label,
      defaults: {
        width: width / 100, height: height / 100,
        ...(type === 'Door' ? { swing: opType.includes('RIGHT') ? 'right' : 'left', OperationType: opType } : { sillHeight: sill / 100, OperationType: opType }),
      },
      source: scope,
    };
    onAdd(def);
    onClose();
  };

  const labelStyle: React.CSSProperties = { fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', display: 'block', marginBottom: 2 };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '4px 7px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', color: 'var(--ink)', fontSize: 11, fontFamily: 'var(--font-mono)', boxSizing: 'border-box' };

  return (
    <div style={{ padding: '12px', borderTop: '1px solid var(--border)', background: 'color-mix(in oklch, var(--accent) 4%, var(--bg))' }}>
      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 10, color: 'var(--accent)' }}>{makeT(lang)("New custom element")}</div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <label style={labelStyle}>{makeT(lang)("Name")}</label>
          <input style={inputStyle} value={label} onChange={e => setLabel(e.target.value)} placeholder={makeT(lang)("e.g. Garage door")} required />
        </div>
        <div>
          <label style={labelStyle}>{makeT(lang)("Category")}</label>
          <input style={inputStyle} value={category} onChange={e => setCategory(e.target.value)} placeholder={makeT(lang)("e.g. Garage")} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{makeT(lang)("Width (cm)")}</label>
            <input type="number" style={inputStyle} value={width} onChange={e => setWidth(Number(e.target.value))} min={20} max={600} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{makeT(lang)("Height (cm)")}</label>
            <input type="number" style={inputStyle} value={height} onChange={e => setHeight(Number(e.target.value))} min={50} max={400} />
          </div>
          {type === 'Window' && (
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{makeT(lang)("Sill (cm)")}</label>
              <input type="number" style={inputStyle} value={sill} onChange={e => setSill(Number(e.target.value))} min={0} max={250} />
            </div>
          )}
        </div>
        <div>
          <label style={labelStyle}>{makeT(lang)("IFC Type")}</label>
          <select style={inputStyle} value={opType} onChange={e => setOpType(e.target.value)}>
            {(type === 'Door' ? doorOpTypes : winOpTypes).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>{makeT(lang)("Scope")}</label>
          <select style={inputStyle} value={scope} onChange={e => setScope(e.target.value as ElementSource)}>
            <option value="user">{makeT(lang)("User (global)")}</option>
            <option value="project">{makeT(lang)("Project (local)")}</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          <button type="submit" style={{ flex: 1, padding: '5px', background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{makeT(lang)("Add")}</button>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: '5px', background: 'transparent', color: 'var(--ink-3)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>{makeT(lang)("Cancel")}</button>
        </div>
      </form>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────
interface Props {
  tool: 'Door' | 'Window' | 'Furniture';
  setTool: (t: ToolType) => void;
  selectedElementId: string | null;
  onSelectElement: (id: string) => void;
  lang: string;
  /** Project-level custom elements */
  projectElements?: ElementDef[];
  onProjectElementsChange?: (els: ElementDef[]) => void;
}

export const LEROY_MERLIN_CATEGORIES = [
  { id: 'Cuisine', labelFr: 'Cuisine', labelEn: 'Kitchen', icon: 'kitchen' },
  { id: 'Salle de bain', labelFr: 'Salle de bain', labelEn: 'Bathroom', icon: 'bathroom' },
  { id: 'Chambre', labelFr: 'Chambre', labelEn: 'Bedroom', icon: 'bedroom' },
  { id: 'Dressing', labelFr: 'Dressing', labelEn: 'Dressing', icon: 'wardrobe' },
  { id: 'Univers enfant', labelFr: 'Univers enfant', labelEn: 'Kids room', icon: 'kids' },
  { id: 'Bureau', labelFr: 'Bureau', labelEn: 'Office', icon: 'office' },
  { id: 'Meubles', labelFr: 'Meubles', labelEn: 'Furniture', icon: 'sofa' },
  { id: 'Décoration & luminaires', labelFr: 'Décoration & luminaires', labelEn: 'Decoration', icon: 'deco' },
  { id: 'Électroménager et multimedia', labelFr: 'Électroménager et multimedia', labelEn: 'Appliances', icon: 'appliances' },
  { id: 'Chauffage et électricité', labelFr: 'Chauffage et électricité', labelEn: 'Heating', icon: 'heating' },
  { id: 'Jardin', labelFr: 'Jardin', labelEn: 'Garden', icon: 'garden' },
  { id: 'Personnage', labelFr: 'Personnage', labelEn: 'Character', icon: 'character' },
  { id: 'Formes paramétrables', labelFr: 'Formes paramétrables', labelEn: 'Parametric shapes', icon: 'shapes' },
  { id: 'Symboles pmr', labelFr: 'Symboles pmr', labelEn: 'PMR symbols', icon: 'pmr' },
];

export function renderCategoryIcon(icon: string) {
  const p = { stroke: 'currentColor', strokeWidth: 1.5, fill: 'none' };
  switch (icon) {
    case 'kitchen':
      return <svg width="22" height="22" viewBox="0 0 24 24" {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v6M15 9v12"/></svg>;
    case 'bathroom':
      return <svg width="22" height="22" viewBox="0 0 24 24" {...p}><path d="M4 8h16v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8z"/><path d="M8 4h8M12 4v4"/></svg>;
    case 'bedroom':
      return <svg width="22" height="22" viewBox="0 0 24 24" {...p}><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 6v4M17 6v4"/></svg>;
    case 'wardrobe':
      return <svg width="22" height="22" viewBox="0 0 24 24" {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 10h18"/></svg>;
    case 'kids':
      return <svg width="22" height="22" viewBox="0 0 24 24" {...p}><circle cx="12" cy="7" r="3"/><path d="M7 16c0-3 2-4 5-4s5 1 5 4M4 20h16"/></svg>;
    case 'office':
      return <svg width="22" height="22" viewBox="0 0 24 24" {...p}><rect x="3" y="5" width="18" height="10" rx="1"/><path d="M6 15v4M18 15v4M3 15h18"/></svg>;
    case 'sofa':
      return <svg width="22" height="22" viewBox="0 0 24 24" {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><circle cx="16" cy="8" r="1.5"/><path d="M3 13h18"/></svg>;
    case 'deco':
      return <svg width="22" height="22" viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="6"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5"/></svg>;
    case 'appliances':
      return <svg width="22" height="22" viewBox="0 0 24 24" {...p}><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M6 20h12M12 17v3"/></svg>;
    case 'heating':
      return <svg width="22" height="22" viewBox="0 0 24 24" {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M12 5v14M17 5v14"/></svg>;
    case 'garden':
      return <svg width="22" height="22" viewBox="0 0 24 24" {...p}><path d="M12 2a5 5 0 0 0-5 5c0 4 5 15 5 15s5-11 5-15a5 5 0 0 0-5-5z"/><circle cx="12" cy="7" r="1.5"/></svg>;
    case 'character':
      return <svg width="22" height="22" viewBox="0 0 24 24" {...p}><circle cx="12" cy="7" r="4"/><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>;
    case 'shapes':
      return <svg width="22" height="22" viewBox="0 0 24 24" {...p}><rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="12" cy="12" r="4"/></svg>;
    case 'pmr':
      return <svg width="22" height="22" viewBox="0 0 24 24" {...p}><circle cx="12" cy="6" r="2"/><path d="M9 10h4l2 5h-4l-2-5zm0 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg>;
    default:
      return null;
  }
}

export default function ElementLibraryPanel({ tool, setTool, selectedElementId, onSelectElement, lang, projectElements = [], onProjectElementsChange }: Props) {
  const fr = lang === 'fr';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [userEls, setUserEls] = useState<ElementDef[]>(() => loadUserLibrary());
  const [showAddForm, setShowAddForm] = useState(false);
  const [importError, setImportError] = useState('');

  // Search & Category grid state for Furniture/Aménager
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Reset category view if switching tools
  useEffect(() => {
    setSelectedCategory(null);
    setSearchQuery('');
  }, [tool]);

  // Merged catalogue: builtin + user + project
  const allElements = [...BUILTIN_CATALOGUE, ...userEls, ...projectElements];
  const forType = getElementsByType(tool, allElements);
  
  // Filtering for category or search
  const filteredForType = forType.filter(el => {
    const term = searchQuery.toLowerCase().trim();
    if (term) {
      const label = (fr ? el.labelFr : el.labelEn).toLowerCase();
      const cat = el.category.toLowerCase();
      return label.includes(term) || cat.includes(term);
    }
    if (tool === 'Furniture') {
      return selectedCategory ? el.category === selectedCategory : true;
    }
    return true;
  });

  const groups = groupByCategory(filteredForType);
  const selectedDef = allElements.find(e => e.id === selectedElementId);

  // Persist user library whenever it changes
  useEffect(() => { saveUserLibrary(userEls); }, [userEls]);

  const handleAdd = (def: ElementDef) => {
    if (def.source === 'project') {
      onProjectElementsChange?.([...projectElements.filter(e => e.id !== def.id), def]);
    } else {
      setUserEls(prev => [...prev.filter(e => e.id !== def.id), def]);
    }
    onSelectElement(def.id);
  };

  const handleDelete = (id: string) => {
    const el = allElements.find(e => e.id === id);
    if (!el || el.source === 'builtin') return;
    if (el.source === 'project') {
      onProjectElementsChange?.(projectElements.filter(e => e.id !== id));
    } else {
      setUserEls(prev => prev.filter(e => e.id !== id));
    }
    if (selectedElementId === id) {
      if (tool === 'Door') onSelectElement('door-single-left');
      else if (tool === 'Window') onSelectElement('win-double');
      else onSelectElement('meuble-canape');
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseCustomLibrary(ev.target?.result as string);
      if (!parsed.length) { setImportError(makeT(lang)("Invalid file")); return; }
      const userParsed = parsed.filter(e => e.source !== 'project').map(e => ({ ...e, source: 'user' as const }));
      const projParsed = parsed.filter(e => e.source === 'project');
      setUserEls(prev => [...prev, ...userParsed.filter(n => !prev.find(e => e.id === n.id))]);
      if (projParsed.length) onProjectElementsChange?.([...projectElements, ...projParsed.filter(n => !projectElements.find(e => e.id === n.id))]);
      setImportError('');
    };
    reader.readAsText(file);
  };

  const handleExport = () => {
    const custom = allElements.filter(e => e.source !== 'builtin');
    if (!custom.length) return;
    const blob = new Blob([exportLibraryToJson(custom)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'element-library.json'; a.click();
    URL.revokeObjectURL(url);
  };

  const isFurniture = tool === 'Furniture';
  const showGrid = isFurniture && !selectedCategory && !searchQuery.trim();

  return (
    <div style={{ position: 'fixed', left: 'calc(var(--toolbox-w, 44px) + 8px)', top: 'calc(var(--topbar-h, 36px) + 8px)', width: 356, maxHeight: 'calc(100vh - var(--topbar-h, 36px) - 24px)', display: 'flex', flexDirection: 'column', background: 'color-mix(in oklch, var(--panel) 94%, transparent)', backdropFilter: 'blur(16px)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.18)', zIndex: 200, overflow: 'hidden', animation: 'el-panel-in 0.16s ease' }}>
      <style>{`
        @keyframes el-panel-in { from { opacity:0; transform:translateX(-8px) scale(0.97); } to { opacity:1; transform:none; } }
        .tile-wrap:hover .tile-delete-btn { display:flex !important; }
        .lm-cat-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
          height: 80px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
          color: var(--ink);
          font-family: var(--font-sans);
          padding: 8px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        .lm-cat-card:hover {
          transform: translateY(-2px);
          border-color: var(--accent);
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
          background: color-mix(in oklch, var(--accent) 3%, var(--bg));
        }
        .lm-cat-card svg {
          color: var(--accent);
          transition: transform 0.2s ease;
        }
        .lm-cat-card:hover svg {
          transform: scale(1.1);
        }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', padding: '10px 12px', gap: 8, flexShrink: 0, background: 'var(--panel)', height: 42, boxSizing: 'border-box' }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ color: 'var(--accent)', flexShrink: 0 }}>
          {isFurniture
            ? <path d="M3 3h18v18H3zM3 9h18M9 9v12" />
            : tool === 'Door'
              ? <><path d="M5 3v14h7l4-2V3z" /><path d="M16 3v14" /></>
              : <><rect x="3" y="5" width={18} height={14} rx={2} /><path d="M12 5v14M3 12h18" /></>
          }
        </svg>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
          {isFurniture ? (makeT(lang)("Furnish")) : (makeT(lang)("Library"))}
        </span>

        <div style={{ flex: 1 }} />

        {/* Action controls or tabs */}
        {!isFurniture ? (
          <div style={{ display: 'flex', gap: 2, background: 'var(--bg)', borderRadius: 6, padding: 2 }}>
            {(['Door', 'Window'] as const).map(t => (
              <button key={t} onClick={() => setTool(t)} style={{ padding: '3px 9px', borderRadius: 4, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: tool === t ? 600 : 400, color: tool === t ? 'var(--accent)' : 'var(--ink-3)', background: tool === t ? 'var(--panel)' : 'transparent', boxShadow: tool === t ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', transition: 'all 0.12s' }}>
                {t === 'Door' ? (makeT(lang)("Doors")) : (makeT(lang)("Windows"))}
              </button>
            ))}
          </div>
        ) : (
          <button
            onClick={() => setTool('select')}
            title={makeT(lang)("Close")}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', display: 'flex', alignItems: 'center', padding: 2 }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        )}
      </div>

      {/* Sub-header context / search */}
      <div style={{ padding: '8px 10px', background: 'color-mix(in oklch, var(--accent) 3%, var(--panel))', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {isFurniture ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {(selectedCategory || searchQuery.trim()) && (
              <button
                onClick={() => { setSelectedCategory(null); setSearchQuery(''); }}
                style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 5, background: 'var(--bg)', cursor: 'pointer', fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}
              >
                <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
                {makeT(lang)("Back")}
              </button>
            )}
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={makeT(lang)("Search furniture...")}
                style={{ width: '100%', padding: '5px 8px 5px 24px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--ink)', fontSize: 11, boxSizing: 'border-box', outline: 'none' }}
              />
              <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-4)' }}>
                <circle cx={11} cy={11} r={8} /><path d="M21 21l-4.35-4.35" />
              </svg>
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', padding: 0 }}>
                  <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>
            {makeT(lang)("↖ Select a type, then click on a wall")}
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12, scrollbarWidth: 'thin' }}>
        {showGrid ? (
          // Leroy Merlin grid category display
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {LEROY_MERLIN_CATEGORIES.map(cat => {
              const label = fr ? cat.labelFr : cat.labelEn;
              const hasItems = forType.some(el => el.category === cat.id);
              if (!hasItems) return null; // Only show if we have models in this category
              return (
                <button
                  key={cat.id}
                  className="lm-cat-card"
                  onClick={() => setSelectedCategory(cat.id)}
                >
                  {renderCategoryIcon(cat.icon)}
                  <span style={{ fontSize: 10, fontWeight: 600, textAlign: 'center', lineHeight: 1.2 }}>{label}</span>
                </button>
              );
            })}
          </div>
        ) : (
          // Standard tile groups for Doors, Windows, or selected category
          groups.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--ink-4)', fontSize: 11, padding: '20px 0', fontFamily: 'var(--font-mono)' }}>
              {makeT(lang)("No models found")}
            </div>
          ) : (
            groups.map(({ category, items }) => (
              <CategoryGroup key={category} category={category} items={items}
                selectedElementId={selectedElementId} onSelectElement={onSelectElement}
                onDelete={handleDelete} lang={lang} />
            ))
          )
        )}
      </div>

      {/* Add form (conditional) */}
      {showAddForm && !isFurniture && <AddCustomForm type={tool as 'Door' | 'Window'} onAdd={handleAdd} onClose={() => setShowAddForm(false)} lang={lang} />}

      {/* Footer details & import/export */}
      {!showAddForm && (
        <div style={{ padding: '7px 10px', borderTop: '1px solid var(--border)', background: 'var(--panel)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {selectedDef && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fr ? selectedDef.labelFr : selectedDef.labelEn}</div>
              <div style={{ fontSize: 9.5, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>
                {Math.round(selectedDef.defaults.width * 100)}×
                {selectedDef.defaults.depth ? Math.round(selectedDef.defaults.depth * 100) : Math.round(selectedDef.defaults.height * 100)} cm
              </div>
            </div>
          )}
          {!isFurniture && (
            <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
              <button onClick={() => setShowAddForm(true)} title={makeT(lang)("Add custom element")} style={{ padding: '4px 7px', border: '1px solid var(--border)', borderRadius: 5, background: 'transparent', cursor: 'pointer', fontSize: 10, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 3 }}>
                <svg width={10} height={10} viewBox="0 0 14 14"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" /></svg>
                {makeT(lang)("Add")}
              </button>
              <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
              <button onClick={() => fileInputRef.current?.click()} title={makeT(lang)("Import JSON library")} style={{ padding: '4px 7px', border: '1px solid var(--border)', borderRadius: 5, background: 'transparent', cursor: 'pointer', fontSize: 10, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 3 }}>
                <svg width={10} height={10} viewBox="0 0 14 14"><path d="M7 9V3M4 6l3-3 3 3M2 11h10" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
                {makeT(lang)("Import")}
              </button>
              <button onClick={handleExport} title={makeT(lang)("Export custom elements")} style={{ padding: '4px 7px', border: '1px solid var(--border)', borderRadius: 5, background: 'transparent', cursor: 'pointer', fontSize: 10, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 3 }}>
                <svg width={10} height={10} viewBox="0 0 14 14"><path d="M7 5v6M4 8l3 3 3-3M2 11h10" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
                {makeT(lang)("Export")}
              </button>
            </div>
          )}
        </div>
      )}
      {importError && <div style={{ padding: '4px 12px', fontSize: 10, color: 'oklch(0.55 0.18 25)', background: 'oklch(0.96 0.04 25)', borderTop: '1px solid var(--border)' }}>{importError}</div>}
    </div>
  );
}
