// Tree, Properties, Items-by-type, 3D view

const { Icon, TYPE_CONFIG, TOOLBAR_TYPES, polyArea, polyPerimeter, wallLength, bbox } = window.AS_UI;

// ============ TREE PANE ============
function TreePane({ items, selection, setSelection, t, lang, query, setQuery, expandedIds, setExpandedIds, focusStorey, setFocusStorey, onCollapse }) {
  const projects = Object.values(items).filter(i => i.type === 'Project');

  // Display-parent: doors/windows nest under their wall; furniture nests under containing room.
  const pointInPoly = (x, y, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
    }
    return inside;
  };
  const displayParentId = (it) => {
    if (it.type === 'Door' || it.type === 'Window') return it.geom?.wallId || it.parentId;
    if (it.type === 'Furniture') {
      const cx = it.geom.x + it.geom.w / 2, cy = it.geom.y + it.geom.d / 2;
      const rooms = Object.values(items).filter(r => r.type === 'Room' && r.parentId === it.parentId);
      const host = rooms.find(r => pointInPoly(cx, cy, r.geom.polygon));
      return host ? host.id : it.parentId;
    }
    return it.parentId;
  };
  const childrenOf = (parentId) =>
    Object.values(items).filter(i => displayParentId(i) === parentId);

  const sortKey = (it) => {
    const order = { Building: 0, Storey: 1, Room: 2, Wall: 3, Door: 4, Window: 5, Furniture: 6 };
    return [order[it.type] ?? 9, it.geom?.level ?? 0, it.name];
  };

  const matchesQuery = (it) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return it.name.toLowerCase().includes(q) || it.type.toLowerCase().includes(q) || (it.ifcGUID || '').toLowerCase().includes(q);
  };

  // determine which IDs are expanded by default
  const isExp = (id) => expandedIds[id] !== false; // default expanded
  const toggle = (id, e) => {
    e.stopPropagation();
    setExpandedIds({ ...expandedIds, [id]: !isExp(id) });
  };

  const handleSelect = (id, e) => {
    if (e.shiftKey || e.metaKey) {
      setSelection(selection.includes(id) ? selection.filter(s => s !== id) : [...selection, id]);
    } else {
      setSelection([id]);
    }
    // if selecting a storey, focus it
    if (items[id]?.type === 'Storey') setFocusStorey(id);
    // if descendant of another storey, switch focus
    let cur = items[id];
    while (cur && cur.type !== 'Storey' && cur.parentId) cur = items[cur.parentId];
    if (cur?.type === 'Storey') setFocusStorey(cur.id);
  };

  const renderRow = (it, depth = 0) => {
    const kids = childrenOf(it.id).sort((a, b) => {
      const A = sortKey(a), B = sortKey(b);
      for (let i = 0; i < A.length; i++) { if (A[i] < B[i]) return -1; if (A[i] > B[i]) return 1; }
      return 0;
    });
    const exp = isExp(it.id);
    const sel = selection.includes(it.id);
    const visibleKids = exp ? kids : [];
    const matches = matchesQuery(it) || kids.some(k => matchesQuery(k) || childrenOf(k.id).some(matchesQuery));

    if (!matches && query) return null;
    return (
      <div key={it.id}>
        <div className={`tree-row type-${it.type}${sel ? ' selected' : ''}`}
             onClick={(e) => handleSelect(it.id, e)}>
          <span className={`chev${kids.length === 0 ? ' empty' : ''}${exp ? ' open' : ''}`} onClick={(e) => toggle(it.id, e)}>
            <Icon name="chev" size={12} />
          </span>
          <span className="swatch" />
          <span className="label">{it.name}</span>
          {kids.length > 0 && <span className="meta">{kids.length}</span>}
        </div>
        {visibleKids.length > 0 && (
          <div className="tree-children">
            {visibleKids.map(k => renderRow(k, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="tree-pane">
      <div className="pane-head">
        <span className="title">{lang === 'fr' ? 'Arborescence' : 'Project tree'}</span>
        <div className="actions">
          <button className="icon-btn" title="Tout déplier" onClick={() => {
            const all = {}; for (const id of Object.keys(items)) all[id] = true; setExpandedIds(all);
          }}><Icon name="layers" size={13} /></button>
          <button className="icon-btn" title="Tout replier" onClick={() => {
            const all = {}; for (const id of Object.keys(items)) all[id] = false; setExpandedIds(all);
          }}><Icon name="minus" size={13} /></button>
          <button className="icon-btn" title={lang === 'fr' ? 'Replier le panneau' : 'Collapse panel'} onClick={onCollapse}>
            <svg width="13" height="13" viewBox="0 0 14 14"><path d="M3 2v10M9 4l-3 3 3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </div>
      <div className="search">
        <Icon name="search" size={13} />
        <input placeholder={t('search')} value={query} onChange={e => setQuery(e.target.value)} />
      </div>
      <div className="tree">
        {projects.map(p => renderRow(p))}
      </div>
    </div>
  );
}

// ============ PROPERTIES PANE ============
function PropertiesPane({ items, selection, updateItem, t, lang, openSettings, onCollapse }) {
  const collapseBtn = (
    <button className="icon-btn" title={lang === 'fr' ? 'Replier le panneau' : 'Collapse panel'} onClick={onCollapse}>
      <svg width="13" height="13" viewBox="0 0 14 14"><path d="M11 2v10M5 4l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </button>
  );
  if (selection.length === 0) {
    return (
      <div className="props-pane">
        <div className="pane-head">
          <span className="title">{t('properties')}</span>
          <div className="actions">
            <button className="icon-btn" onClick={openSettings} title={t('settings')}><Icon name="settings" size={13} /></button>
            {collapseBtn}
          </div>
        </div>
        <div className="props-empty">
          <div className="ghost-card">
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--border)', display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}>
              <Icon name="cursor" size={20} />
            </div>
            <div style={{ fontWeight: 500, color: 'var(--ink)' }}>{t('no_selection')}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', textAlign: 'center', maxWidth: 220 }}>{t('click_to_select')}</div>
          </div>
        </div>
      </div>
    );
  }

  if (selection.length > 1) {
    const sels = selection.map(id => items[id]).filter(Boolean);
    const types = [...new Set(sels.map(s => s.type))];
    return (
      <div className="props-pane">
        <div className="pane-head">
          <span className="title">{t('properties')}</span>
          <div className="actions">
            <button className="icon-btn" onClick={openSettings} title={t('settings')}><Icon name="settings" size={13} /></button>
            {collapseBtn}
          </div>
        </div>
        <div className="props-head">
          <div className="type">
            <span className="swatch" style={{ background: 'var(--ink)' }} />
            {selection.length} {t('selected')}
          </div>
          <div className="name" style={{ marginTop: 6 }}>{t('items')} ({types.join(', ')})</div>
        </div>
        <div className="props-body">
          <div className="section">
            <div className="section-head"><h4>{lang === 'fr' ? 'Sélection' : 'Selection'}</h4></div>
            <div style={{ padding: '4px 12px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {sels.map(it => (
                <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11.5 }}>
                  <span className={`type-${it.type}`} style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--c)' }} />
                  <span style={{ flex: 1 }}>{it.name}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)' }}>{it.type}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const it = items[selection[0]];
  if (!it) return null;
  const cfg = TYPE_CONFIG[it.type];

  const Field = ({ label, children, span2 }) => (
    <>
      <div className="field-label">{label}</div>
      <div className={`field-value${span2 ? ' flex2' : ''}`}>{children}</div>
    </>
  );

  const NumInput = ({ value, onChange, unit = 'm', step = 0.05 }) => (
    <>
      <input className="mono" type="number" step={step} value={Number(value).toFixed(2)} onChange={e => onChange(parseFloat(e.target.value) || 0)} />
      <span className="unit">{unit}</span>
    </>
  );

  const upd = (path, val) => {
    const next = JSON.parse(JSON.stringify(it));
    let cur = next; const parts = path.split('.');
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
    cur[parts[parts.length - 1]] = val;
    updateItem(it.id, next);
  };

  return (
    <div className="props-pane">
      <div className="pane-head">
        <span className="title">{t('properties')}</span>
        <div className="actions">
          <button className="icon-btn" title={t('duplicate')}><Icon name="copy" size={13} /></button>
          <button className="icon-btn" onClick={openSettings} title={t('settings')}><Icon name="settings" size={13} /></button>
          {collapseBtn}
        </div>
      </div>

      <div className={`props-head type-${it.type}`}>
        <div className="type">
          <span className="swatch" />
          {cfg.ifc || it.type}
        </div>
        <div className="name">
          <input value={it.name} onChange={e => upd('name', e.target.value)} />
        </div>
        <div className="guid">
          <Icon name="lock" size={11} /> {it.ifcGUID}
        </div>
      </div>

      <div className="props-body">
        {/* GEOMETRY */}
        {it.type === 'Wall' && (
          <div className="section">
            <div className="section-head"><h4>{t('geometry')}</h4></div>
            <div className="section-body">
              <Field label={lang === 'fr' ? 'Point A' : 'Point A'}>
                <div className="pair">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><NumInput value={it.geom.x1} onChange={v => upd('geom.x1', v)} /></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><NumInput value={it.geom.y1} onChange={v => upd('geom.y1', v)} /></div>
                </div>
              </Field>
              <Field label={lang === 'fr' ? 'Point B' : 'Point B'}>
                <div className="pair">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><NumInput value={it.geom.x2} onChange={v => upd('geom.x2', v)} /></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><NumInput value={it.geom.y2} onChange={v => upd('geom.y2', v)} /></div>
                </div>
              </Field>
              <Field label={lang === 'fr' ? 'Longueur' : 'Length'}>
                <input className="mono" value={wallLength(it.geom).toFixed(3)} readOnly />
                <span className="unit">m</span>
              </Field>
              <Field label={t('thickness')}><NumInput value={it.geom.thickness} onChange={v => upd('geom.thickness', v)} step={0.01} /></Field>
              <Field label={t('height')}><NumInput value={it.geom.height} onChange={v => upd('geom.height', v)} /></Field>
            </div>
          </div>
        )}

        {(it.type === 'Door' || it.type === 'Window') && (
          <div className="section">
            <div className="section-head"><h4>{t('geometry')}</h4></div>
            <div className="section-body">
              <Field label={lang === 'fr' ? 'Mur hôte' : 'Host wall'}>
                <input className="mono" value={items[it.geom.wallId]?.name || it.geom.wallId} readOnly />
              </Field>
              <Field label={lang === 'fr' ? 'Position (t)' : 'Position (t)'}>
                <input className="mono" type="number" step={0.01} min={0} max={1} value={it.geom.t.toFixed(3)} onChange={e => upd('geom.t', parseFloat(e.target.value) || 0)} />
                <span className="unit">/1</span>
              </Field>
              <Field label={t('width')}><NumInput value={it.geom.width} onChange={v => upd('geom.width', v)} /></Field>
              <Field label={t('height')}><NumInput value={it.geom.height} onChange={v => upd('geom.height', v)} /></Field>
              {it.type === 'Window' && (
                <Field label={t('sill_height')}><NumInput value={it.geom.sillHeight} onChange={v => upd('geom.sillHeight', v)} /></Field>
              )}
              {it.type === 'Door' && (
                <Field label={t('swing')} span2>
                  <div className="seg">
                    <button className={it.geom.swing === 'left' ? 'on' : ''} onClick={() => upd('geom.swing', 'left')}>{lang === 'fr' ? 'Gauche' : 'Left'}</button>
                    <button className={it.geom.swing === 'right' ? 'on' : ''} onClick={() => upd('geom.swing', 'right')}>{lang === 'fr' ? 'Droite' : 'Right'}</button>
                  </div>
                </Field>
              )}
            </div>
          </div>
        )}

        {it.type === 'Furniture' && (
          <div className="section">
            <div className="section-head"><h4>{t('geometry')}</h4></div>
            <div className="section-body">
              <Field label={t('position')}>
                <div className="pair">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><NumInput value={it.geom.x} onChange={v => upd('geom.x', v)} /></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><NumInput value={it.geom.y} onChange={v => upd('geom.y', v)} /></div>
                </div>
              </Field>
              <Field label={t('dimensions')}>
                <div className="pair">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><NumInput value={it.geom.w} onChange={v => upd('geom.w', v)} /></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><NumInput value={it.geom.d} onChange={v => upd('geom.d', v)} /></div>
                </div>
              </Field>
              <Field label={t('height')}><NumInput value={it.geom.h} onChange={v => upd('geom.h', v)} /></Field>
              <Field label={t('rotation')}>
                <input className="mono" type="number" step="15" value={Math.round(it.geom.rotation * 180 / Math.PI)} onChange={e => upd('geom.rotation', (parseFloat(e.target.value) || 0) * Math.PI / 180)} />
                <span className="unit">°</span>
              </Field>
            </div>
          </div>
        )}

        {it.type === 'Room' && (() => {
          const area = polyArea(it.geom.polygon);
          const peri = polyPerimeter(it.geom.polygon);
          return (
            <div className="section">
              <div className="section-head"><h4>{t('geometry')}</h4></div>
              <div className="section-body">
                <Field label={t('area')}>
                  <input className="mono" value={area.toFixed(2)} readOnly /><span className="unit">m²</span>
                </Field>
                <Field label={t('perimeter')}>
                  <input className="mono" value={peri.toFixed(2)} readOnly /><span className="unit">m</span>
                </Field>
                <Field label={t('volume')}>
                  <input className="mono" value={(area * (it.geom.height || 2.7)).toFixed(2)} readOnly /><span className="unit">m³</span>
                </Field>
                <Field label={t('height')}><NumInput value={it.geom.height} onChange={v => upd('geom.height', v)} /></Field>
                <Field label={lang === 'fr' ? 'Sommets' : 'Vertices'}>
                  <input className="mono" value={it.geom.polygon.length} readOnly />
                </Field>
              </div>
            </div>
          );
        })()}

        {it.type === 'Storey' && (
          <div className="section">
            <div className="section-head"><h4>{t('geometry')}</h4></div>
            <div className="section-body">
              <Field label={t('level')}>
                <input className="mono" type="number" value={it.geom.level} onChange={e => upd('geom.level', parseInt(e.target.value) || 0)} />
              </Field>
              <Field label={t('elevation')}><NumInput value={it.geom.elevation} onChange={v => upd('geom.elevation', v)} /></Field>
              <Field label={t('thickness')}><NumInput value={it.geom.thickness} onChange={v => upd('geom.thickness', v)} step={0.01} /></Field>
              <Field label={t('area')}>
                <input className="mono" value={(it.grossArea || 0).toFixed(2)} readOnly /><span className="unit">m²</span>
              </Field>
            </div>
          </div>
        )}

        {/* METADATA */}
        <div className="section">
          <div className="section-head"><h4>{t('metadata')}</h4></div>
          <div className="section-body">
            {it.type === 'Wall' && (<>
              <Field label={t('material')}><input value={it.material || ''} onChange={e => upd('material', e.target.value)} /></Field>
              <Field label={t('fire_rating')}><input value={it.fireRating || ''} onChange={e => upd('fireRating', e.target.value)} /></Field>
              <Field label={t('load_bearing')}>
                <div className="seg"><button className={!it.loadBearing ? 'on' : ''} onClick={() => upd('loadBearing', false)}>—</button><button className={it.loadBearing ? 'on' : ''} onClick={() => upd('loadBearing', true)}>✓</button></div>
              </Field>
              <Field label={t('external')}>
                <div className="seg"><button className={!it.isExternal ? 'on' : ''} onClick={() => upd('isExternal', false)}>—</button><button className={it.isExternal ? 'on' : ''} onClick={() => upd('isExternal', true)}>✓</button></div>
              </Field>
            </>)}
            {(it.type === 'Door' || it.type === 'Window') && (<>
              <Field label={t('material')}><input value={it.material || ''} onChange={e => upd('material', e.target.value)} /></Field>
              {it.type === 'Door' && <Field label={t('fire_rating')}><input value={it.fireRating || ''} onChange={e => upd('fireRating', e.target.value)} /></Field>}
              {it.type === 'Window' && <Field label={t('u_value')}><input className="mono" type="number" step="0.1" value={it.uValue} onChange={e => upd('uValue', parseFloat(e.target.value) || 0)} /><span className="unit">W/m²K</span></Field>}
            </>)}
            {it.type === 'Room' && (<>
              <Field label={t('function_')}><input value={it.function || ''} onChange={e => upd('function', e.target.value)} /></Field>
              <Field label={t('occupancy')}><input className="mono" type="number" value={it.occupancy} onChange={e => upd('occupancy', parseInt(e.target.value) || 0)} /></Field>
            </>)}
            {it.type === 'Furniture' && (<>
              <Field label={lang === 'fr' ? 'Catégorie' : 'Category'}><input value={it.category || ''} onChange={e => upd('category', e.target.value)} /></Field>
              <Field label={lang === 'fr' ? 'Modèle' : 'Model'}><input value={it.model || ''} onChange={e => upd('model', e.target.value)} /></Field>
            </>)}
            {it.type === 'Building' && (<>
              <Field label={lang === 'fr' ? 'Adresse' : 'Address'} span2><input value={it.address || ''} onChange={e => upd('address', e.target.value)} /></Field>
              <Field label={t('area')}>
                <input className="mono" value={(it.grossArea || 0).toFixed(2)} readOnly /><span className="unit">m²</span>
              </Field>
            </>)}
            {it.type === 'Project' && (<>
              <Field label={lang === 'fr' ? 'Nom long' : 'Long name'} span2><input value={it.longName || ''} onChange={e => upd('longName', e.target.value)} /></Field>
              <Field label={lang === 'fr' ? 'Phase' : 'Phase'}><input value={it.phase || ''} onChange={e => upd('phase', e.target.value)} /></Field>
              <Field label={lang === 'fr' ? 'Nord' : 'North'}>
                <input className="mono" type="number" value={it.northAngle || 0} onChange={e => upd('northAngle', parseFloat(e.target.value) || 0)} /><span className="unit">°</span>
              </Field>
            </>)}
          </div>
        </div>

        {/* PSets */}
        <div className="section">
          <div className="section-head"><h4>{t('psets')}</h4><span className="badge">{it.type === 'Wall' ? 'Pset_WallCommon' : it.type === 'Room' ? 'Pset_SpaceCommon' : it.type === 'Door' ? 'Pset_DoorCommon' : it.type === 'Window' ? 'Pset_WindowCommon' : 'Pset_Common'}</span></div>
          <div className="psets">
            <div className="pset">
              <div className="pset-name">{it.type === 'Wall' ? 'Pset_WallCommon' : it.type === 'Room' ? 'Pset_SpaceCommon' : 'Pset_Common'}</div>
              {it.type === 'Wall' && (
                <>
                  <div className="pset-row"><span className="k">Reference</span><span>{it.material}</span></div>
                  <div className="pset-row"><span className="k">FireRating</span><span>{it.fireRating}</span></div>
                  <div className="pset-row"><span className="k">LoadBearing</span><span>{it.loadBearing ? 'TRUE' : 'FALSE'}</span></div>
                  <div className="pset-row"><span className="k">IsExternal</span><span>{it.isExternal ? 'TRUE' : 'FALSE'}</span></div>
                  <div className="pset-row"><span className="k">ThermalTransmittance</span><span>0.24 W/m²K</span></div>
                </>
              )}
              {it.type === 'Room' && (
                <>
                  <div className="pset-row"><span className="k">Category</span><span>{it.function}</span></div>
                  <div className="pset-row"><span className="k">GrossFloorArea</span><span>{polyArea(it.geom.polygon).toFixed(2)} m²</span></div>
                  <div className="pset-row"><span className="k">NetVolume</span><span>{(polyArea(it.geom.polygon) * it.geom.height).toFixed(2)} m³</span></div>
                  <div className="pset-row"><span className="k">OccupancyNumber</span><span>{it.occupancy}</span></div>
                </>
              )}
              {it.type === 'Door' && (
                <>
                  <div className="pset-row"><span className="k">OperationType</span><span>SINGLE_SWING_LEFT</span></div>
                  <div className="pset-row"><span className="k">FireRating</span><span>{it.fireRating}</span></div>
                  <div className="pset-row"><span className="k">SecurityRating</span><span>RC2</span></div>
                  <div className="pset-row"><span className="k">SelfClosing</span><span>FALSE</span></div>
                </>
              )}
              {it.type === 'Window' && (
                <>
                  <div className="pset-row"><span className="k">OperationType</span><span>SINGLE_PANEL</span></div>
                  <div className="pset-row"><span className="k">ThermalTransmittance</span><span>{it.uValue} W/m²K</span></div>
                  <div className="pset-row"><span className="k">GlazingAreaFraction</span><span>0.78</span></div>
                </>
              )}
              {it.type === 'Furniture' && (
                <>
                  <div className="pset-row"><span className="k">Category</span><span>{it.category}</span></div>
                  <div className="pset-row"><span className="k">Reference</span><span>{it.model}</span></div>
                </>
              )}
              {it.type === 'Storey' && (
                <>
                  <div className="pset-row"><span className="k">AboveGround</span><span>{it.geom.level >= 0 ? 'TRUE' : 'FALSE'}</span></div>
                  <div className="pset-row"><span className="k">Elevation</span><span>{it.geom.elevation.toFixed(2)} m</span></div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ ITEMS-BY-TYPE BAR ============
function ItemsBar({ items, currentStorey, selection, setSelection, lang, t }) {
  const [openType, setOpenType] = React.useState(null);
  const popRef = React.useRef(null);
  const types = TOOLBAR_TYPES;

  // count instances per type, restricted to current building (storey siblings) but really show all
  const counts = {}; const perType = {};
  for (const it of Object.values(items)) {
    if (!types.includes(it.type)) continue;
    counts[it.type] = (counts[it.type] || 0) + 1;
    (perType[it.type] = perType[it.type] || []).push(it);
  }

  React.useEffect(() => {
    const h = (e) => { if (popRef.current && !popRef.current.contains(e.target)) setOpenType(null); };
    if (openType) document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [openType]);

  return (
    <div className="items-bar">
      <div className="label">{t('items_by_type')}</div>
      <div className="scroll">
        {types.map(typ => {
          const cfg = TYPE_CONFIG[typ];
          const cnt = counts[typ] || 0;
          const isOpen = openType === typ;
          return (
            <button key={typ} className={`type-chip type-${typ}${isOpen ? ' on' : ''}`}
                    onClick={() => setOpenType(isOpen ? null : typ)}>
              <span className="swatch" />
              <span>{t(typ.toLowerCase())}</span>
              <span className="count">{cnt}</span>
            </button>
          );
        })}
      </div>
      <div className="right">
        <span>{Object.keys(items).length} {t('items')}</span>
        {selection.length > 0 && <span style={{ color: 'var(--accent)', fontWeight: 600 }}>· {selection.length} {t('selected')}</span>}
      </div>
      {openType && (
        <div ref={popRef} className={`instances-pop type-${openType}`} style={{ left: 80 + types.indexOf(openType) * 110 }}>
          <div className="head">
            <span className="swatch" />
            <span>{t(openType.toLowerCase())} — {t('instances')}</span>
            <span className="count">{(perType[openType] || []).length}</span>
          </div>
          <div className="list">
            {(perType[openType] || []).map(it => {
              const sel = selection.includes(it.id);
              return (
                <div key={it.id} className={`row${sel ? ' selected' : ''}`} onClick={(e) => {
                  if (e.shiftKey || e.metaKey) {
                    setSelection(sel ? selection.filter(s => s !== it.id) : [...selection, it.id]);
                  } else {
                    setSelection([it.id]);
                  }
                }}>
                  <span className="lbl">{it.name}</span>
                  <span className="id">{(it.ifcGUID || '').slice(0, 8)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ 3D View — isometric SVG ============
function Canvas3D({ items, storeyId, selection, setSelection, lang, t }) {
  const wrapRef = React.useRef(null);
  const [size, setSize] = React.useState({ w: 1200, h: 700 });
  const [angle, setAngle] = React.useState({ az: 35, el: 30 });
  const [zoom, setZoom] = React.useState(40); // px/m

  React.useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Project all storeys; can highlight active
  const project = (x, y, z) => {
    const az = angle.az * Math.PI / 180;
    const el = angle.el * Math.PI / 180;
    // basic isometric-ish projection
    const sx = (x - y) * Math.cos(az) * zoom;
    const sy = ((x + y) * Math.sin(el) * Math.cos(az) - z * Math.cos(el)) * zoom * 0.6;
    return [size.w / 2 + sx, size.h * 0.65 + sy];
  };

  // gather all storeys to render
  const storeys = Object.values(items).filter(i => i.type === 'Storey').sort((a, b) => (a.geom.level - b.geom.level));

  // bounding box across selected storey rooms to center
  const focusItems = Object.values(items).filter(i => i.parentId === storeyId);
  const focusBB = (() => {
    const pts = [];
    for (const it of focusItems) {
      if (it.type === 'Wall') { pts.push([it.geom.x1, it.geom.y1]); pts.push([it.geom.x2, it.geom.y2]); }
      if (it.type === 'Room') for (const p of it.geom.polygon) pts.push(p);
    }
    if (!pts.length) return { cx: 0, cy: 0 };
    const bb = bbox(pts);
    return { cx: (bb.minX + bb.maxX) / 2, cy: (bb.minY + bb.maxY) / 2 };
  })();

  const renderStorey = (storey, dim = false) => {
    const z = storey.geom.elevation || 0;
    const slabT = storey.geom.thickness || 0.2;
    const inS = Object.values(items).filter(i => i.parentId === storey.id);
    const walls = inS.filter(i => i.type === 'Wall');
    const rooms = inS.filter(i => i.type === 'Room');
    const doors = inS.filter(i => i.type === 'Door');
    const wins = inS.filter(i => i.type === 'Window');
    const furn = inS.filter(i => i.type === 'Furniture');
    const wallsById = Object.fromEntries(walls.map(w => [w.id, w]));

    const elements = [];
    // Slab
    const allBB = (() => {
      const pts = [];
      for (const w of walls) { pts.push([w.geom.x1, w.geom.y1]); pts.push([w.geom.x2, w.geom.y2]); }
      for (const r of rooms) for (const p of r.geom.polygon) pts.push(p);
      if (!pts.length) return null;
      return bbox(pts);
    })();
    if (allBB) {
      const slabPts = [
        project(allBB.minX, allBB.minY, z),
        project(allBB.maxX, allBB.minY, z),
        project(allBB.maxX, allBB.maxY, z),
        project(allBB.minX, allBB.maxY, z),
      ];
      elements.push({ z: z - 0.001, depth: 0, el: <polygon key={`slab_${storey.id}`} points={slabPts.map(p => p.join(',')).join(' ')} fill="var(--c-storey)" fillOpacity={dim ? 0.18 : 0.5} stroke="var(--ink-3)" strokeWidth="0.5" /> });
    }
    // Rooms (floor color)
    for (const r of rooms) {
      const sel = selection.includes(r.id);
      const pts = r.geom.polygon.map(([x, y]) => project(x, y, z + 0.005).join(','));
      elements.push({ z: z + 0.005, depth: 0, el: (
        <polygon key={`r_${r.id}`} points={pts.join(' ')} fill="var(--c-room)" fillOpacity={dim ? 0.10 : (sel ? 0.6 : 0.30)} stroke={sel ? 'var(--accent)' : 'none'} strokeWidth="1.2" onClick={() => setSelection([r.id])} style={{ cursor: 'pointer' }} />
      )});
    }
    // Walls — extruded boxes
    for (const w of walls) {
      const sel = selection.includes(w.id);
      const wH = w.geom.height;
      // build 4 corners of footprint (account for thickness)
      const len = wallLength(w.geom);
      if (len < 0.01) continue;
      const dx = (w.geom.x2 - w.geom.x1) / len;
      const dy = (w.geom.y2 - w.geom.y1) / len;
      const nx = -dy * (w.geom.thickness / 2);
      const ny = dx * (w.geom.thickness / 2);
      const corners = [
        [w.geom.x1 + nx, w.geom.y1 + ny],
        [w.geom.x2 + nx, w.geom.y2 + ny],
        [w.geom.x2 - nx, w.geom.y2 - ny],
        [w.geom.x1 - nx, w.geom.y1 - ny],
      ];
      // bottom + top
      const bot = corners.map(([x, y]) => project(x, y, z + slabT));
      const top = corners.map(([x, y]) => project(x, y, z + slabT + wH));
      // Determine face fills by depth
      const fillBase = dim ? 'var(--border)' : (w.isExternal ? 'var(--c-wall)' : '#7d7d82');
      const lighter = dim ? 'var(--border-faint)' : (w.isExternal ? '#74747a' : '#9d9da3');
      // extrusion side faces (just two visible-ish): front (corners 0-1) and right (corners 1-2)
      const sides = [
        [bot[0], bot[1], top[1], top[0]],
        [bot[1], bot[2], top[2], top[1]],
        [bot[3], bot[0], top[0], top[3]],
      ];
      const sortKey = (top[0][1] + top[1][1] + top[2][1] + top[3][1]) / 4; // for back-to-front
      for (let i = 0; i < sides.length; i++) {
        const opacity = i === 0 ? 1 : (i === 1 ? 0.85 : 0.75);
        elements.push({ z: z + slabT + wH * 0.5, depth: sortKey + i * 0.001, el: (
          <polygon key={`w_${w.id}_s${i}`} points={sides[i].map(p => p.join(',')).join(' ')}
                   fill={i === 0 ? fillBase : lighter} fillOpacity={opacity}
                   stroke={sel ? 'var(--accent)' : 'rgba(0,0,0,0.15)'}
                   strokeWidth={sel ? 1.5 : 0.5}
                   onClick={() => setSelection([w.id])} style={{ cursor: 'pointer' }} />
        )});
      }
      // top face
      elements.push({ z: z + slabT + wH, depth: sortKey - 0.5, el: (
        <polygon key={`w_${w.id}_top`} points={top.map(p => p.join(',')).join(' ')}
                 fill={fillBase} fillOpacity={dim ? 0.35 : 0.95}
                 stroke="rgba(0,0,0,0.15)" strokeWidth="0.5" />
      )});
    }
    // Furniture as small boxes
    for (const f of furn) {
      const sel = selection.includes(f.id);
      const corners = [
        [f.geom.x, f.geom.y],
        [f.geom.x + f.geom.w, f.geom.y],
        [f.geom.x + f.geom.w, f.geom.y + f.geom.d],
        [f.geom.x, f.geom.y + f.geom.d],
      ];
      const top = corners.map(([x, y]) => project(x, y, z + slabT + f.geom.h));
      const bot = corners.map(([x, y]) => project(x, y, z + slabT));
      const sides = [
        [bot[0], bot[1], top[1], top[0]],
        [bot[1], bot[2], top[2], top[1]],
      ];
      const sortKey = (top[0][1] + top[1][1] + top[2][1] + top[3][1]) / 4;
      for (let i = 0; i < sides.length; i++) {
        elements.push({ z: z + slabT + f.geom.h * 0.5, depth: sortKey + i * 0.001, el: (
          <polygon key={`f_${f.id}_s${i}`} points={sides[i].map(p => p.join(',')).join(' ')}
                   fill="var(--c-furniture)" fillOpacity={dim ? 0.15 : (i === 0 ? 0.7 : 0.5)}
                   stroke={sel ? 'var(--accent)' : 'rgba(0,0,0,0.15)'} strokeWidth={sel ? 1.2 : 0.4}
                   onClick={() => setSelection([f.id])} style={{ cursor: 'pointer' }} />
        )});
      }
      elements.push({ z: z + slabT + f.geom.h, depth: sortKey - 0.5, el: (
        <polygon key={`f_${f.id}_top`} points={top.map(p => p.join(',')).join(' ')}
                 fill="var(--c-furniture)" fillOpacity={dim ? 0.2 : 0.85} stroke="rgba(0,0,0,0.15)" strokeWidth="0.4" />
      )});
    }
    // Windows / doors as colored insets at wall mid-height
    for (const o of [...wins, ...doors]) {
      const w = wallsById[o.geom.wallId]; if (!w) continue;
      const len = wallLength(w.geom);
      const halfW = o.geom.width / 2;
      const ang = Math.atan2(w.geom.y2 - w.geom.y1, w.geom.x2 - w.geom.x1);
      const cx = w.geom.x1 + Math.cos(ang) * o.geom.t * len;
      const cy = w.geom.y1 + Math.sin(ang) * o.geom.t * len;
      const ax = Math.cos(ang) * halfW, ay = Math.sin(ang) * halfW;
      const ox = -Math.sin(ang) * (w.geom.thickness / 2 + 0.01);
      const oy = Math.cos(ang) * (w.geom.thickness / 2 + 0.01);
      const sill = o.type === 'Window' ? (o.geom.sillHeight ?? 0.9) : 0;
      const top = sill + o.geom.height;
      const corners = [
        [cx - ax + ox, cy - ay + oy],
        [cx + ax + ox, cy + ay + oy],
      ];
      const ptsLow = corners.map(([x, y]) => project(x, y, z + slabT + sill));
      const ptsHigh = corners.map(([x, y]) => project(x, y, z + slabT + top));
      const poly = [ptsLow[0], ptsLow[1], ptsHigh[1], ptsHigh[0]];
      const fill = o.type === 'Window' ? 'var(--c-window)' : 'var(--c-door)';
      elements.push({ z: z + slabT + (sill + top) / 2, depth: ptsHigh[0][1], el: (
        <polygon key={`o_${o.id}`} points={poly.map(p => p.join(',')).join(' ')}
                 fill={fill} fillOpacity={dim ? 0.4 : 0.7} stroke={selection.includes(o.id) ? 'var(--accent)' : 'rgba(0,0,0,0.15)'}
                 strokeWidth={selection.includes(o.id) ? 1.5 : 0.5}
                 onClick={() => setSelection([o.id])} style={{ cursor: 'pointer' }} />
      )});
    }
    return elements;
  };

  // Build all elements with depth-sort
  const all = [];
  for (const s of storeys) {
    const dim = s.id !== storeyId;
    all.push(...renderStorey(s, dim));
  }
  all.sort((a, b) => a.depth - b.depth);

  return (
    <div ref={wrapRef} className="canvas3d">
      <svg width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`}>
        {/* ground gradient + grid lines */}
        <defs>
          <linearGradient id="g3d-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--panel-2)" />
            <stop offset="100%" stopColor="var(--bg)" />
          </linearGradient>
        </defs>
        <rect width={size.w} height={size.h} fill="url(#g3d-bg)" />
        {/* ground grid */}
        {(() => {
          const lines = [];
          for (let i = -20; i <= 20; i++) {
            const a = project(i, -20, 0), b = project(i, 20, 0);
            lines.push(<line key={'gx' + i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="var(--border)" strokeWidth="0.5" opacity="0.5" />);
            const c = project(-20, i, 0), d = project(20, i, 0);
            lines.push(<line key={'gy' + i} x1={c[0]} y1={c[1]} x2={d[0]} y2={d[1]} stroke="var(--border)" strokeWidth="0.5" opacity="0.5" />);
          }
          return <g>{lines}</g>;
        })()}
        {all.map((e, i) => React.cloneElement(e.el, { key: e.el.key || i }))}
      </svg>

      <div style={{ position: 'absolute', bottom: 14, left: 14, display: 'flex', gap: 8 }}>
        <div className="zoom-control">
          <button onClick={() => setAngle(a => ({ ...a, az: a.az - 15 }))}>‹</button>
          <span className="val">{angle.az}°</span>
          <button onClick={() => setAngle(a => ({ ...a, az: a.az + 15 }))}>›</button>
        </div>
        <div className="zoom-control">
          <button onClick={() => setAngle(a => ({ ...a, el: Math.max(5, a.el - 5) }))}>‹</button>
          <span className="val">{angle.el}°</span>
          <button onClick={() => setAngle(a => ({ ...a, el: Math.min(80, a.el + 5) }))}>›</button>
        </div>
        <div className="zoom-control">
          <button onClick={() => setZoom(z => Math.max(15, z - 5))}>−</button>
          <span className="val">{zoom}px/m</span>
          <button onClick={() => setZoom(z => Math.min(80, z + 5))}>+</button>
        </div>
      </div>
    </div>
  );
}

window.AS_TreePane = TreePane;
window.AS_PropertiesPane = PropertiesPane;
window.AS_ItemsBar = ItemsBar;
window.AS_Canvas3D = Canvas3D;
