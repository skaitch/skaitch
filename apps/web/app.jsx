// SkAItch — main app

const { useState, useEffect, useRef, useMemo, useCallback } = React;
const { Icon, TYPE_CONFIG, TOOLBAR_TYPES, polyArea, wallLength } = window.AS_UI;

// Tweak defaults
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "density": "comfort",
  "showGrid": true,
  "snap": true,
  "snapSize": 0.25,
  "panelsLayout": "left"
}/*EDITMODE-END*/;

function App() {
  // Theme + density via tweaks
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', tweaks.theme);
    document.documentElement.setAttribute('data-density', tweaks.density);
    document.documentElement.setAttribute('data-panels', tweaks.panelsLayout);
  }, [tweaks]);

  // Language
  const [lang, setLang] = useState('fr');
  const t = (key) => (window.AS_I18N[lang][key] || key);

  // Items state
  const [items, setItems] = useState(() => window.AS_DATA.buildStarter());
  const [selection, setSelection] = useState([]);
  const [tool, setTool] = useState('select');
  const [view, setView] = useState('2d'); // 2d or 3d
  const [focusStorey, setFocusStorey] = useState('sty_A0');
  const [query, setQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState({});
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [propsCollapsed, setPropsCollapsed] = useState(false);

  // AI config — simplified
  const [ai, setAi] = useState({
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    apiKey: '',
    temperature: 0.30,
  });

  // ===== History (undo/redo) =====
  const historyRef = useRef({ past: [], future: [] });
  const [histTick, setHistTick] = useState(0);
  const bumpHist = () => setHistTick(t => t + 1);
  const HIST_MAX = 100;
  const COALESCE_MS = 600;
  const lastPushAtRef = useRef({ time: 0, key: '' });

  const pushHistory = (prev, coalesceKey) => {
    const now = Date.now();
    const last = lastPushAtRef.current;
    if (coalesceKey && last.key === coalesceKey && now - last.time < COALESCE_MS) {
      // coalesce: skip pushing a new snapshot
    } else {
      historyRef.current.past.push(prev);
      if (historyRef.current.past.length > HIST_MAX) historyRef.current.past.shift();
    }
    lastPushAtRef.current = { time: now, key: coalesceKey || '' };
    historyRef.current.future = [];
  };

  // Mutators
  const addItem = useCallback((it) => {
    setItems(prev => { pushHistory(prev, 'add_' + it.type); bumpHist(); return { ...prev, [it.id]: it }; });
  }, []);
  const updateItem = useCallback((id, patch) => {
    setItems(prev => { pushHistory(prev, 'upd_' + id); bumpHist(); return { ...prev, [id]: { ...prev[id], ...patch } }; });
  }, []);
  const deleteItems = useCallback((ids) => {
    setItems(prev => {
      pushHistory(prev, ''); bumpHist();
      const next = { ...prev };
      const toDel = new Set(ids);
      for (const id of ids) {
        const it = prev[id]; if (!it) continue;
        if (it.type === 'Wall') {
          for (const o of Object.values(prev)) {
            if ((o.type === 'Door' || o.type === 'Window') && o.geom.wallId === id) toDel.add(o.id);
          }
        }
      }
      for (const id of toDel) delete next[id];
      return next;
    });
    setSelection([]);
  }, []);

  const undo = useCallback(() => {
    if (historyRef.current.past.length === 0) return;
    setItems(curr => {
      const prev = historyRef.current.past.pop();
      historyRef.current.future.unshift(curr);
      lastPushAtRef.current = { time: 0, key: '' };
      bumpHist();
      return prev;
    });
  }, []);
  const redo = useCallback(() => {
    if (historyRef.current.future.length === 0) return;
    setItems(curr => {
      const next = historyRef.current.future.shift();
      historyRef.current.past.push(curr);
      lastPushAtRef.current = { time: 0, key: '' };
      bumpHist();
      return next;
    });
  }, []);
  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.length) { e.preventDefault(); deleteItems(selection); }
      } else if (e.key === 'Escape') {
        setSelection([]); setTool('select');
      } else if (e.key === 'v' || e.key === 'V') setTool('select');
      else if (e.key === 'w' || e.key === 'W') setTool('Wall');
      else if (e.key === 'd' || e.key === 'D') setTool('Door');
      else if (e.key === 'f' || e.key === 'F') setTool('Window');
      else if (e.key === 'r' || e.key === 'R') setTool('Room');
      else if (e.key === 'm' || e.key === 'M') setTool('Furniture');
      else if (e.key === 'g' || e.key === 'G') setTweak('showGrid', !tweaks.showGrid);
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault(); redo();
      }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const all = Object.values(items).filter(i => i.parentId === focusStorey).map(i => i.id);
        setSelection(all);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, deleteItems, items, focusStorey, tweaks.showGrid, setTweak, undo, redo]);

  // Focus storey when selecting an element via tree/2D
  useEffect(() => {
    if (selection.length === 0) return;
    const it = items[selection[0]]; if (!it) return;
    let cur = it;
    while (cur && cur.type !== 'Storey' && cur.parentId) cur = items[cur.parentId];
    if (cur?.type === 'Storey') setFocusStorey(cur.id);
  }, [selection, items]);

  const storeys = useMemo(() => Object.values(items).filter(i => i.type === 'Storey').sort((a, b) => {
    const ba = items[a.parentId]?.name || '';
    const bb = items[b.parentId]?.name || '';
    if (ba !== bb) return ba.localeCompare(bb);
    return a.geom.level - b.geom.level;
  }), [items]);

  const projects = useMemo(() => Object.values(items).filter(i => i.type === 'Project'), [items]);
  const proj = projects[0];
  const itemCount = Object.keys(items).length;

  return (
    <div className="app" data-tree-col={treeCollapsed ? '1' : '0'} data-props-col={propsCollapsed ? '1' : '0'}>
      {/* TOP BAR */}
      <div className="top-bar">
        <div className="brand">
          <div className="logo">
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 12V5l5-3 5 3v7M5 12V8h4v4" stroke="currentColor" strokeWidth="1.4" fill="none" /></svg>
          </div>
          <div className="name"><span className="skaitch-wordmark">Sk<b>AI</b>tch</span></div>
        </div>
        <div className="crumb">
          <span>{lang === 'fr' ? 'Projet' : 'Project'}</span>
          <span className="sep">/</span>
          <span className="cur">{proj?.name}</span>
          <span className="sep">·</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-3)' }}>IFC4</span>
        </div>

        <div className="spacer" />

        <div className="right">
          <button className="btn" title={(lang === 'fr' ? 'Annuler' : 'Undo') + ' · Ctrl+Z'} onClick={undo} disabled={!canUndo} style={{ opacity: canUndo ? 1 : 0.4 }}>
            <svg width="13" height="13" viewBox="0 0 14 14"><path d="M3 7h6a3 3 0 0 1 0 6H6M3 7l3-3M3 7l3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button className="btn" title={(lang === 'fr' ? 'Rétablir' : 'Redo') + ' · Ctrl+Shift+Z'} onClick={redo} disabled={!canRedo} style={{ opacity: canRedo ? 1 : 0.4 }}>
            <svg width="13" height="13" viewBox="0 0 14 14"><path d="M11 7H5a3 3 0 0 0 0 6h3M11 7L8 4M11 7L8 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <div style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 4px' }} />
          <button className="btn" title={t('import_ifc')}><Icon name="upload" size={13} /> {t('import_ifc')}</button>
          <button className="btn" title={t('export_ifc')}><Icon name="download" size={13} /> {t('export_ifc')}</button>
          <div style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 4px' }} />
          <div className="lang-toggle">
            <button className={lang === 'fr' ? 'on' : ''} onClick={() => setLang('fr')}>FR</button>
            <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
          </div>
          <button className="btn icon" onClick={() => setSettingsOpen(true)} title={t('settings')}><Icon name="settings" size={14} /></button>
          <button className="btn ai" onClick={() => setChatOpen(o => !o)} title={t('assistant')}>
            <span className="sparkle"><Icon name="sparkle" size={12} /></span>
            {t('assistant')}
          </button>
        </div>
      </div>

      {/* TOOLBOX */}
      <div className="toolbox">
        <button className={`tool${tool === 'select' ? ' active' : ''}`} data-tip={t('select') + ' (V)'} onClick={() => setTool('select')}>
          <Icon name="cursor" size={16} />
          <span className="key">V</span>
        </button>
        <div className="divider" />
        {TOOLBAR_TYPES.map(typ => (
          <button key={typ} className={`tool type-${typ}${tool === typ ? ' active' : ''}`} data-tip={`${t(typ.toLowerCase())} (${TYPE_CONFIG[typ].key})`} onClick={() => setTool(typ)}>
            <Icon name={TYPE_CONFIG[typ].icon} size={17} />
            <span className="swatch" />
            <span className="key">{TYPE_CONFIG[typ].key}</span>
          </button>
        ))}
        <div className="divider" />
        <button className="tool" data-tip={lang === 'fr' ? 'Mesurer' : 'Measure'}><Icon name="measure" size={16} /></button>
        <button className="tool" data-tip={lang === 'fr' ? 'Annoter' : 'Annotate'}><Icon name="pencil" size={16} /></button>
        <div style={{ flex: 1 }} />
        <button className={`tool${selection.length === 0 ? ' disabled' : ''}`}
                style={{ color: selection.length ? 'oklch(0.55 0.18 25)' : 'var(--ink-4)' }}
                onClick={() => selection.length && deleteItems(selection)}
                data-tip={t('delete') + ' (Suppr)'}>
          <svg width="16" height="16" viewBox="0 0 20 20"><path d="M5 6h10l-1 11H6L5 6zM3 6h14M8 6V4h4v2" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="key">⌫</span>
        </button>
      </div>

      {/* TREE PANE */}
      {treeCollapsed ? (
        <div className="pane-collapsed tree-side">
          <button className="expand-btn" onClick={() => setTreeCollapsed(false)} title={lang === 'fr' ? 'Déplier l\'arborescence' : 'Expand tree'}>
            <svg width="11" height="11" viewBox="0 0 14 14"><path d="M5 4l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <div className="vert-label">{lang === 'fr' ? 'Arborescence' : 'Project tree'}</div>
        </div>
      ) : (
        <window.AS_TreePane
          items={items}
          selection={selection}
          setSelection={setSelection}
          t={t} lang={lang}
          query={query} setQuery={setQuery}
          expandedIds={expandedIds} setExpandedIds={setExpandedIds}
          focusStorey={focusStorey} setFocusStorey={setFocusStorey}
          onCollapse={() => setTreeCollapsed(true)}
        />
      )}

      {/* CENTER */}
      <div className="center">
        <div className="view-tabs">
          <div className="tabs">
            <button className={view === '2d' ? 'on' : ''} onClick={() => setView('2d')}>
              <svg width="11" height="11" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M1 5h10M5 1v10" stroke="currentColor" strokeWidth="1.2" /></svg>
              {t('plan_2d')}
            </button>
            <button className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')}>
              <svg width="11" height="11" viewBox="0 0 12 12"><path d="M2 4l4-2 4 2v4l-4 2-4-2zM2 4l4 2 4-2M6 6v4" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
              {t('view_3d')}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 12 }}>
            <button className="icon-btn" title={t('grid')} onClick={() => setTweak('showGrid', !tweaks.showGrid)}
                    style={{ color: tweaks.showGrid ? 'var(--accent)' : 'var(--ink-3)' }}>
              <Icon name="grid" size={13} />
            </button>
            <SnapControl
              enabled={tweaks.snap !== false}
              size={tweaks.snapSize ?? 0.25}
              setEnabled={(v) => setTweak('snap', v)}
              setSize={(v) => setTweak('snapSize', v)}
              lang={lang}
            />
          </div>
          <div className="spacer" />
          <div className="meta">
            <span><b>{itemCount}</b> {t('items')}</span>
            <span><b>{storeys.length}</b> {t('storeys')}</span>
            {selection.length > 0 && <span style={{ color: 'var(--accent)' }}><b>{selection.length}</b> {t('selected')}</span>}
          </div>
        </div>
        <div className="viewport">
          {view === '2d' ? (
            <window.AS_Canvas2D
              items={items}
              storeyId={focusStorey}
              tool={tool}
              setTool={setTool}
              selection={selection}
              setSelection={setSelection}
              addItem={addItem}
              updateItem={updateItem}
              deleteItems={deleteItems}
              showGrid={tweaks.showGrid}
              snapEnabled={tweaks.snap !== false}
              snapSize={tweaks.snapSize ?? 0.25}
              t={t} lang={lang}
            />
          ) : (
            <window.AS_Canvas3D
              items={items}
              storeyId={focusStorey}
              selection={selection}
              setSelection={setSelection}
              t={t} lang={lang}
            />
          )}

          {/* overlays */}
          <div className="viewport-overlay top-left">
            <div className="storey-switch">
              <div className="head">{t('storeys')}</div>
              {storeys.map(s => {
                const bld = items[s.parentId];
                return (
                  <button key={s.id} className={s.id === focusStorey ? 'on' : ''} onClick={() => setFocusStorey(s.id)}>
                    <span className="swatch" />
                    <span style={{ flex: 1 }}>{s.name}</span>
                    <span className="lvl">L{s.geom.level}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="viewport-overlay top-right" style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
            <div className="compass"><span className="arrow" /></div>
            <Minimap items={items} storeyId={focusStorey} setStoreyId={setFocusStorey} />
          </div>

          <div className="viewport-overlay bottom-left">
            <div className="shortcut-helper">
              <span><kbd>V</kbd> {t('select')}</span>
              <span><kbd>W</kbd>/<kbd>D</kbd>/<kbd>F</kbd> {lang === 'fr' ? 'mur/porte/fen' : 'wall/door/win'}</span>
              <span><kbd>⌫</kbd> {lang === 'fr' ? 'supprimer' : 'delete'}</span>
              <span><kbd>Alt</kbd>+drag {lang === 'fr' ? 'panoramique' : 'pan'}</span>
            </div>
          </div>

          <div className="viewport-overlay bottom-right">
            <ZoomBox view={view} />
          </div>
        </div>
      </div>

      {/* PROPERTIES */}
      {propsCollapsed ? (
        <div className="pane-collapsed props-side">
          <button className="expand-btn" onClick={() => setPropsCollapsed(false)} title={lang === 'fr' ? 'Déplier les propriétés' : 'Expand properties'}>
            <svg width="11" height="11" viewBox="0 0 14 14"><path d="M9 4l-3 3 3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <div className="vert-label">{t('properties')}</div>
        </div>
      ) : (
        <window.AS_PropertiesPane
          items={items}
          selection={selection}
          updateItem={updateItem}
          t={t} lang={lang}
          openSettings={() => setSettingsOpen(true)}
          onCollapse={() => setPropsCollapsed(true)}
        />
      )}

      {/* ITEMS BAR */}
      <window.AS_ItemsBar
        items={items}
        currentStorey={focusStorey}
        selection={selection}
        setSelection={setSelection}
        t={t} lang={lang}
      />

      {/* MODALS */}
      <window.AS_SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} ai={ai} setAi={setAi} t={t} lang={lang} />
      <window.AS_ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        items={items}
        ai={ai}
        selection={selection}
        setSelection={setSelection}
        addItem={addItem}
        updateItem={updateItem}
        deleteItems={deleteItems}
        focusStorey={focusStorey}
        t={t} lang={lang}
      />
    </div>
  );
}

// Mini-map of all storeys
function Minimap({ items, storeyId, setStoreyId }) {
  // tiny overview: show all rooms across storeys, color current
  const W = 180, H = 120;
  // collect bounds across all rooms
  const rooms = Object.values(items).filter(i => i.type === 'Room');
  if (rooms.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rooms) for (const [x, y] of r.geom.polygon) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const scale = Math.min((W - 12) / (maxX - minX), (H - 12) / (maxY - minY));
  const ox = 6 - minX * scale, oy = 6 - minY * scale;
  return (
    <div className="minimap">
      <svg viewBox={`0 0 ${W} ${H}`}>
        {rooms.map(r => {
          const isActive = r.parentId === storeyId;
          const pts = r.geom.polygon.map(([x, y]) => `${x * scale + ox},${y * scale + oy}`).join(' ');
          return <polygon key={r.id} points={pts}
            fill={isActive ? 'var(--accent)' : 'var(--ink-4)'}
            fillOpacity={isActive ? 0.3 : 0.08}
            stroke={isActive ? 'var(--accent)' : 'var(--border-strong)'}
            strokeWidth={isActive ? 1 : 0.5} />;
        })}
      </svg>
    </div>
  );
}

function SnapControl({ enabled, size, setEnabled, setSize, lang }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const sizes = [0.05, 0.10, 0.25, 0.50, 1.00];
  const fmt = (s) => s < 1 ? `${(s * 100).toFixed(0)} cm` : `${s.toFixed(2)} m`;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={() => setOpen(o => !o)}
              title={(lang === 'fr' ? 'Grille aimantée' : 'Snap to grid') + ' · ' + fmt(size)}
              style={{ color: enabled ? 'var(--accent)' : 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px', height: 22 }}>
        <svg width="13" height="13" viewBox="0 0 14 14"><path d="M4 2v5a3 3 0 0 0 6 0V2M4 2H2M10 2h2M7 10v2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.04em' }}>{enabled ? fmt(size) : 'off'}</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 8px 22px rgba(0,0,0,0.08)', padding: 6, minWidth: 168, zIndex: 50 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px 6px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-3)' }}>{lang === 'fr' ? 'Aimantage' : 'Snap'}</span>
            <button onClick={() => setEnabled(!enabled)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: enabled ? 'var(--accent)' : 'var(--ink-3)', fontSize: 10, padding: '1px 6px', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
              {enabled ? 'ON' : 'OFF'}
            </button>
          </div>
          {sizes.map(s => (
            <div key={s} onClick={() => { setSize(s); setEnabled(true); setOpen(false); }}
                 style={{ padding: '5px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: enabled && Math.abs(size - s) < 1e-6 ? 'var(--hover)' : 'transparent', color: enabled && Math.abs(size - s) < 1e-6 ? 'var(--accent)' : 'var(--ink)' }}
                 onMouseEnter={e => e.currentTarget.style.background = enabled && Math.abs(size - s) < 1e-6 ? 'var(--hover)' : 'var(--bg)'}
                 onMouseLeave={e => e.currentTarget.style.background = enabled && Math.abs(size - s) < 1e-6 ? 'var(--hover)' : 'transparent'}>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{fmt(s)}</span>
              {enabled && Math.abs(size - s) < 1e-6 && <span style={{ fontSize: 10 }}>●</span>}
            </div>
          ))}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, padding: '6px 6px 2px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>{lang === 'fr' ? 'Perso' : 'Custom'}</span>
            <input type="number" min="0.01" max="5" step="0.01" value={size}
                   onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setSize(v); }}
                   style={{ flex: 1, padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 3, fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg)', color: 'var(--ink)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>m</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ZoomBox({ view }) {
  const [z, setZ] = useState(100);
  return (
    <div className="zoom-control">
      <button onClick={() => setZ(Math.max(25, z - 25))}>−</button>
      <span className="val">{z}%</span>
      <button onClick={() => setZ(Math.min(400, z + 25))}>+</button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
