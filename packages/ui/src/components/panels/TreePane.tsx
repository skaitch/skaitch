import { makeT } from '@skaitch/core/data/i18n';
import { useState, useEffect, useRef } from 'react';
import type { ItemsMap, IfcEntity } from '@skaitch/core/types/ifc';
import { pointInPoly } from '@skaitch/core/data/query';
import { guid } from '@skaitch/core/data/starter';
import { itemDimensions, shortName } from '../../lib/format';
import { defaultName, storeyName } from '@skaitch/core/lib/defaultNames';

interface Props {
  items: ItemsMap;
  selection: string[];
  setSelection: (ids: string[]) => void;
  addItem: (it: IfcEntity) => void;
  updateItem: (id: string, patch: any) => void;
  t: (k: string) => string;
  lang: string;
  query: string;
  setQuery: (q: string) => void;
  expandedIds: Record<string, boolean>;
  setExpandedIds: (ids: Record<string, boolean>) => void;
  focusStorey: string;
  setFocusStorey: (id: string) => void;
  onCollapse: () => void;
  rawIfcStructure?: unknown;
  /** Element types hidden in the 2D/3D views; each category row toggles its own. */
  hiddenTypes?: Set<string>;
  onToggleHiddenType?: (type: string) => void;
}

const TYPE_SORT_ORDER: Record<string, number> = {
  Building: 0, Storey: 1, Room: 2, Wall: 3, Door: 4, Window: 5, Furniture: 6, GenericElement: 7,
};

const IFC_TYPE_COLOR: Record<string, string> = {
  IFCPROJECT: 'var(--ink-3)',
  IFCBUILDING: '#6b7280',
  IFCBUILDINGSTOREY: '#8b5cf6',
  IFCSPACE: '#10b981',
  IFCWALL: '#f59e0b', IFCWALLSTANDARDCASE: '#f59e0b',
  IFCDOOR: '#ef4444',
  IFCWINDOW: '#3b82f6',
  IFCFURNISHINGELEMENT: '#ec4899',
  IFCSLAB: '#64748b',
};

function TypeIcon({ type }: { type: string }) {
  const paths: Record<string, string> = {
    Project: 'M3 4h14v12H3zM3 8h14',
    Building: 'M3 17V7l7-3 7 3v10M7 17v-4h6v4M7 11h2M11 11h2',
    Storey: 'M2 6l8-3 8 3-8 3z M2 11l8 3 8-3M2 14.5l8 3 8-3',
    Room: 'M3 4l6-2 8 3v11l-7 2-7-3z',
    Wall: 'M3 8h14M3 12h14',
    Door: 'M5 3v14h7l4-2V3z M16 3v14',
    Window: 'M3.5 5.5h13v9h-13z M10 5.5v9M3.5 10h13',
    Furniture: 'M3 9h14v6H3z M5 9V7M15 9V7M4 15v2M16 15v2',
  };
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
      <path d={paths[type] || ''} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── IFC Browser ────────────────────────────────────────────────────────────

interface IfcNode {
  expressID: number;
  type: string;
  children?: IfcNode[];
  [key: string]: unknown;
}

function IfcNodeRow({ node, depth = 0 }: { node: IfcNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  const kids = node.children ?? [];
  const color = IFC_TYPE_COLOR[node.type] ?? 'var(--ink-3)';
  const hasKids = kids.length > 0;

  return (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          paddingLeft: 8 + depth * 14, paddingTop: 3, paddingBottom: 3,
          cursor: hasKids ? 'pointer' : 'default',
          borderRadius: 4,
        }}
        onClick={() => hasKids && setOpen((o) => !o)}
      >
        <span style={{ width: 14, flexShrink: 0, color: 'var(--ink-4)', fontSize: 9 }}>
          {hasKids ? (open ? '▾' : '▸') : ''}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, color,
          fontWeight: 600, flexShrink: 0, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {node.type}
        </span>
        <span style={{ fontSize: 10, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', marginLeft: 4 }}>
          #{node.expressID}
        </span>
        {(node.Name as { value?: string })?.value && (
          <span style={{ fontSize: 10.5, color: 'var(--ink)', marginLeft: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {(node.Name as { value: string }).value}
          </span>
        )}
        {hasKids && (
          <span style={{ fontSize: 9, color: 'var(--ink-4)', marginLeft: 'auto', paddingRight: 8, fontFamily: 'var(--font-mono)' }}>
            {kids.length}
          </span>
        )}
      </div>
      {open && hasKids && (
        <div style={{ borderLeft: '1px solid var(--border)', marginLeft: 14 + depth * 14 }}>
          {kids.map((k) => <IfcNodeRow key={k.expressID} node={k} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}

function IfcBrowserFromItems({ items, lang, selection, onSelect }: { items: ItemsMap; lang: string; selection: string[]; onSelect: (id: string, e: React.MouseEvent) => void }) {
  // Build a synthetic IFC tree from the ItemsMap
  // Group by ifcType, showing hierarchy
  const IFC_ORDER = ['IfcProject', 'IfcBuilding', 'IfcBuildingStorey', 'IfcSpace', 'IfcWall', 'IfcDoor', 'IfcWindow', 'IfcFurnishingElement'];
  const byType: Record<string, IfcEntity[]> = {};
  for (const it of Object.values(items)) {
    if (it.type === 'Sheet') continue; // skAItch-only: no IFC entity behind a sheet
    const t = it.ifcType || it.type;
    if (!byType[t]) byType[t] = [];
    byType[t].push(it);
  }

  const types = [...new Set([...IFC_ORDER, ...Object.keys(byType)])].filter((t) => byType[t]?.length);

  return (
    <div style={{ padding: '8px 0' }}>
      {types.map((ifcType) => {
        const ents = byType[ifcType] ?? [];
        const color = IFC_TYPE_COLOR[ifcType.toUpperCase()] ?? 'var(--ink-3)';
        return (
          <TypeSection key={ifcType} ifcType={ifcType} ents={ents} color={color} lang={lang} selection={selection} onSelect={onSelect} />
        );
      })}
    </div>
  );
}

function TypeSection({
  ifcType, ents, color, lang, selection, onSelect,
}: {
  ifcType: string; ents: IfcEntity[]; color: string; lang: string;
  selection: string[]; onSelect: (id: string, e: React.MouseEvent) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
          cursor: 'pointer', borderBottom: '1px solid var(--border)',
          background: 'var(--panel-2)',
        }}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ fontSize: 9, color: 'var(--ink-4)' }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700, color }}>{ifcType}</span>
        <span style={{ fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
          {ents.length} {makeT(lang)("entities")}
        </span>
      </div>
      {open && (
        <div>
          {ents.map((e) => {
            const sel = selection.includes(e.id);
            return (
              <div
                key={e.id}
                data-sel-id={e.id}
                onClick={(ev) => onSelect(e.id, ev)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '3px 10px 3px 20px', fontSize: 11,
                  cursor: 'pointer', borderRadius: 3,
                  background: sel ? 'var(--hover)' : 'transparent',
                  outline: sel ? '1px solid var(--accent)' : 'none',
                  outlineOffset: -1,
                }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: sel ? 'var(--accent)' : 'var(--ink-4)' }}>
                  {e.GlobalId?.slice(0, 8) ?? e.id}
                </span>
                <span style={{ color: sel ? 'var(--accent)' : 'var(--ink)', fontWeight: sel ? 600 : 400, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.name}
                </span>
                {e.parentId && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-4)' }}>
                    ↑ {e.parentId.split('_')[0]}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Category Helpers ─────────────────────────────────────────────────────────

function CategoryIcon({ type }: { type: string }) {
  const paths: Record<string, string> = {
    Room: 'M3 4l6-2 8 3v11l-7 2-7-3z',
    Wall: 'M3 8h14M3 12h14',
    Door: 'M5 3v14h7l4-2V3z M16 3v14',
    Window: 'M3.5 5.5h13v9h-13z M10 5.5v9M3.5 10h13',
    Stair: 'M2 18h4v-4h4v-4h4V6h4',
    Section: 'M2 10h16',
    Slab: 'M3 4h14v12H3z',
    Roof: 'M2 11l8-7 8 7 M5 9v7h10V9',
    Furniture: 'M3 9h14v6H3z M5 9V7M15 9V7M4 15v2M16 15v2',
    Column: 'M7 3h6v14H7z M5 3h10M5 17h10',
    Chimney: 'M3 18V10h14v8M8 10V3h4v7',
    Technical: 'M10 2v4M10 14v4M2 10h4m8 0h4',
    Dimension: 'M2 10h16M5 7v6M15 7v6',
    Marker: 'M10 2c-3.3 0-6 2.7-6 6c0 4.5 6 10 6 10s6-5.5 6-10c0-3.3-2.7-6-6-6zm0 8c-1.1 0-2-.9-2-2s.9-2 2-2s2 .9 2 2s-.9 2-2 2z',
    GenericElement: 'M4 4h12v12H4z',
  };
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
      <path d={paths[type] || 'M3 4h14v12H3z'} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function getCategoryLabel(type: string, lang: string): string {
  const en: Record<string, string> = {
    Room: 'Rooms',
    Wall: 'Walls',
    Door: 'Doors',
    Window: 'Windows',
    Stair: 'Escaliers', Section: 'Coupes',
    Slab: 'Slabs',
    Roof: 'Roofs',
    Furniture: 'Furniture',
    Column: 'Columns',
    Chimney: 'Chimneys and stoves',
    Technical: 'Technical',
    Dimension: 'Dimensions',
    Marker: 'Markers',
    GenericElement: 'Generic Elements',
  };
  return makeT(lang)(en[type] || type);
}

// ── Main TreePane ──────────────────────────────────────────────────────────

export default function TreePane({
  items, selection, setSelection, addItem, updateItem, t, lang, query, setQuery,
  expandedIds, setExpandedIds, focusStorey, setFocusStorey, onCollapse,
  rawIfcStructure, hiddenTypes, onToggleHiddenType,
}: Props) {
  const [activeTab, setActiveTab] = useState<'tree' | 'ifc'>('tree');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Auto-expand ancestors and scroll to first selected item whenever selection changes
  useEffect(() => {
    if (selection.length === 0) return;
    const toExpand: Record<string, boolean> = {};
    for (const id of selection) {
      let cur: IfcEntity | undefined = items[id];
      while (cur && cur.parentId) {
        if (!expandedIds[cur.parentId]) toExpand[cur.parentId] = true;
        cur = items[cur.parentId];
      }
    }
    if (Object.keys(toExpand).length > 0) setExpandedIds({ ...expandedIds, ...toExpand });
    setTimeout(() => {
      treeRef.current?.querySelector<HTMLElement>(`[data-sel-id="${selection[0]}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 60);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  const projects = Object.values(items).filter((i) => i.type === 'Project');

  const displayParentId = (it: IfcEntity): string | null => {
    if (it.type === 'Door' || it.type === 'Window') return (it as any).geom?.wallId || it.parentId;
    if (it.type === 'Furniture') {
      const g = (it as any).geom;
      const cx = g.x + g.w / 2, cy = g.y + g.d / 2;
      const rooms = Object.values(items).filter((r) => r.type === 'Room' && r.parentId === it.parentId);
      const host = rooms.find((r) => pointInPoly([cx, cy], (r as any).geom.polygon));
      return host ? host.id : it.parentId;
    }
    return it.parentId;
  };

  const childrenOf = (parentId: string): IfcEntity[] =>
    Object.values(items).filter((i) => displayParentId(i) === parentId);

  const getStoreyChildren = (storeyId: string): IfcEntity[] => {
    return Object.values(items).filter((child) => child.parentId === storeyId && child.type !== 'Storey');
  };

  const sortKey = (it: IfcEntity): [number, number, string] =>
    [TYPE_SORT_ORDER[it.type] ?? 9, (it as any).geom?.level ?? 0, it.name];

  const matchesQuery = (it: IfcEntity): boolean => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      it.name.toLowerCase().includes(q) ||
      it.type.toLowerCase().includes(q) ||
      (it.GlobalId || '').toLowerCase().includes(q)
    );
  };

  const isExp = (id: string) => expandedIds[id] !== false;

  const toggle = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds({ ...expandedIds, [id]: !isExp(id) });
  };

  const handleSelect = (id: string, e: React.MouseEvent) => {
    if (e.shiftKey && lastSelectedId) {
      const nodes = Array.from(rootRef.current?.querySelectorAll('[data-sel-id]') || []);
      const visibleIds = nodes.map(n => n.getAttribute('data-sel-id')).filter(Boolean) as string[];
      const idx1 = visibleIds.indexOf(lastSelectedId);
      const idx2 = visibleIds.indexOf(id);
      
      if (idx1 !== -1 && idx2 !== -1) {
        const start = Math.min(idx1, idx2);
        const end = Math.max(idx1, idx2);
        const range = visibleIds.slice(start, end + 1);
        
        if (e.ctrlKey || e.metaKey) {
          setSelection([...new Set([...selection, ...range])]);
        } else {
          setSelection(range);
        }
        return;
      }
    }

    if (e.ctrlKey || e.metaKey) {
      setSelection(selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]);
    } else {
      setSelection([id]);
    }
    setLastSelectedId(id);

    if (items[id]?.type === 'Storey') setFocusStorey(id);
    let cur: IfcEntity | undefined = items[id];
    while (cur && cur.type !== 'Storey' && cur.parentId) cur = items[cur.parentId];
    if (cur?.type === 'Storey') setFocusStorey(cur.id);
  };

  const addBuilding = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const id = 'bldg_' + Date.now();
    addItem({
      id, type: 'Building', ifcType: 'IfcBuilding', name: defaultName('newBuilding', lang), Name: defaultName('newBuilding', lang),
      GlobalId: guid(id), parentId: projectId, address: '', grossArea: 0,
    } as any);
    setExpandedIds({ ...expandedIds, [projectId]: true, [id]: true });
    setSelection([id]);
  };

  const addStorey = (buildingId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const id = 'lvl_' + Date.now();
    const existing = Object.values(items).filter(it => it.type === 'Storey' && it.parentId === buildingId);
    const level = existing.length;
    addItem({
      id, type: 'Storey', ifcType: 'IfcBuildingStorey', name: storeyName(level, lang), Name: storeyName(level, lang),
      GlobalId: guid(id), parentId: buildingId,
      geom: { level, elevation: level * 3, thickness: 0.3 },
      grossArea: 0,
    } as any);
    setExpandedIds({ ...expandedIds, [buildingId]: true, [id]: true });
    setSelection([id]);
    setFocusStorey(id);
  };

  const startRename = (it: IfcEntity, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(it.id);
    setTempName(it.name);
  };

  const submitRename = () => {
    if (renamingId && tempName.trim()) {
      updateItem(renamingId, { name: tempName, Name: tempName });
    }
    setRenamingId(null);
  };

  const renderCategoryRow = (storeyId: string, type: string, categoryItems: IfcEntity[]) => {
    const folderKey = `folder_${storeyId}_${type}`;
    const exp = expandedIds[folderKey] !== false; // default expanded
    const label = getCategoryLabel(type, lang);
    const count = query ? categoryItems.filter(matchesQuery).length : categoryItems.length;

    return (
      <div key={folderKey}>
        <div
          className="tree-row category-folder"
          onClick={(e) => {
            e.stopPropagation();
            setExpandedIds({ ...expandedIds, [folderKey]: !exp });
          }}
        >
          <span className={`chev${exp ? ' open' : ''}`} style={{ color: 'var(--ink-3)' }}>
            <svg width="12" height="12" viewBox="0 0 20 20">
              <path d="M7 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center' }}>
            <CategoryIcon type={type} />
          </span>
          <span className="label" style={{ fontSize: '11px', fontWeight: 600, color: 'var(--ink-2)' }}>
            {label}
          </span>
          {onToggleHiddenType && (
            <button className="row-add-btn" title={makeT(lang)(hiddenTypes?.has(type) ? 'Show' : 'Hide')} aria-pressed={!hiddenTypes?.has(type)}
              style={{ marginLeft: 'auto', opacity: hiddenTypes?.has(type) ? 0.5 : 1 }}
              onClick={(e) => { e.stopPropagation(); onToggleHiddenType(type); }}>
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M1.5 10S5 4 10 4s8.5 6 8.5 6-3.5 6-8.5 6S1.5 10 1.5 10z" /><circle cx="10" cy="10" r="2.5" />
                {hiddenTypes?.has(type) && <path d="M3 17L17 3" />}
              </svg>
            </button>
          )}
          <span className="meta" style={{ fontWeight: 'bold' }}>{count}</span>
        </div>
        {exp && (
          <div className="tree-children" style={{ paddingLeft: 8 }}>
            {categoryItems
              .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
              .map((child) => renderItemRow(child))}
          </div>
        )}
      </div>
    );
  };

  const renderItemRow = (child: IfcEntity) => {
    if (query && !matchesQuery(child)) return null;
    const sel = selection.includes(child.id);

    return (
      <div
        key={child.id}
        className={`tree-row type-${child.type}${sel ? ' selected' : ''}`}
        data-sel-id={child.id}
        onClick={(e) => handleSelect(child.id, e)}
        onDoubleClick={(e) => startRename(child, e)}
      >
        <span className="chev empty" />
        <span className="swatch" />
        {renamingId === child.id ? (
          <input
            autoFocus
            className="tree-rename-input"
            value={tempName}
            onChange={(e) => setTempName(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename();
              if (e.key === 'Escape') setRenamingId(null);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="label" title={child.name}>{shortName(child, lang)}</span>
        )}
        
        {!renamingId && (
          <span className="meta" style={{ marginLeft: 'auto', flexShrink: 0, paddingLeft: 8 }}>
            {itemDimensions(child)}
          </span>
        )}

        <div className="row-actions" style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', flexShrink: 0 }}>
          {!renamingId && (
            <button className="row-add-btn edit-btn" title="Renommer" onClick={(e) => startRename(child, e)}>
              <svg width="10" height="10" viewBox="0 0 20 20">
                <path d="M13.5 2.5l4 4L7.5 16.5H3.5v-4l10-10z" fill="none" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderRow = (it: IfcEntity, depth = 0): React.ReactNode => {
    const kids = childrenOf(it.id).sort((a, b) => {
      const A = sortKey(a), B = sortKey(b);
      for (let i = 0; i < A.length; i++) { if (A[i] < B[i]) return -1; if (A[i] > B[i]) return 1; }
      return 0;
    });
    const exp = isExp(it.id);
    const sel = selection.includes(it.id);

    const storeyChildren = it.type === 'Storey' ? getStoreyChildren(it.id) : [];
    const hasMatch = matchesQuery(it) || (
      it.type === 'Storey'
        ? storeyChildren.some(matchesQuery)
        : kids.some((k) => matchesQuery(k) || childrenOf(k.id).some(matchesQuery))
    );
    if (!hasMatch && query) return null;

    if (it.type === 'Storey') {
      // Group items by type
      const groups: Record<string, IfcEntity[]> = {};
      for (const child of storeyChildren) {
        if (!groups[child.type]) groups[child.type] = [];
        groups[child.type].push(child);
      }

      const categoryOrder = ['Room', 'Wall', 'Column', 'Door', 'Window', 'Slab', 'Roof', 'Stair', 'Chimney', 'Section', 'Furniture', 'Technical', 'Dimension', 'Marker', 'GenericElement'];
      // Known categories first, then any other type so no element is left out of the tree.
      const sortedTypes = [...categoryOrder, ...Object.keys(groups).filter((t) => !categoryOrder.includes(t)).sort()].filter((t) => groups[t]?.length > 0);

      return (
        <div key={it.id}>
          <div
            className={`tree-row type-${it.type}${sel ? ' selected' : ''}`}
            data-sel-id={it.id}
            onClick={(e) => handleSelect(it.id, e)}
            onDoubleClick={(e) => startRename(it, e)}
          >
            <span
              className={`chev${sortedTypes.length === 0 ? ' empty' : ''}${exp ? ' open' : ''}`}
              onClick={(e) => toggle(it.id, e)}
            >
              <svg width="12" height="12" viewBox="0 0 20 20">
                <path d="M7 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="swatch" />
            {renamingId === it.id ? (
              <input
                autoFocus
                className="tree-rename-input"
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                onBlur={submitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRename();
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="label" title={it.name}>{shortName(it, lang)}</span>
            )}
            <div className="row-actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
              {!renamingId && (
                <button className="row-add-btn edit-btn" title="Renommer" onClick={(e) => startRename(it, e)}>
                  <svg width="10" height="10" viewBox="0 0 20 20"><path d="M13.5 2.5l4 4L7.5 16.5H3.5v-4l10-10z" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
                </button>
              )}
              <span className="meta">{storeyChildren.length > 0 ? storeyChildren.length : ''}</span>
            </div>
          </div>
          {exp && sortedTypes.length > 0 && (
            <div className="tree-children" style={{ paddingLeft: 8 }}>
              {sortedTypes.map((type) => {
                const categoryItems = groups[type];
                if (query && !categoryItems.some(matchesQuery)) return null;
                return renderCategoryRow(it.id, type, categoryItems);
              })}
            </div>
          )}
        </div>
      );
    }

    return (
      <div key={it.id}>
        <div
          className={`tree-row type-${it.type}${sel ? ' selected' : ''}`}
          data-sel-id={it.id}
          onClick={(e) => handleSelect(it.id, e)}
          onDoubleClick={(e) => startRename(it, e)}
        >
          <span
            className={`chev${kids.length === 0 ? ' empty' : ''}${exp ? ' open' : ''}`}
            onClick={(e) => toggle(it.id, e)}
          >
            <svg width="12" height="12" viewBox="0 0 20 20">
              <path d="M7 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="swatch" />
          {renamingId === it.id ? (
            <input
              autoFocus
              className="tree-rename-input"
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onBlur={submitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRename();
                if (e.key === 'Escape') setRenamingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="label" title={it.name}>{shortName(it, lang)}</span>
          )}
          <div className="row-actions" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
            {!renamingId && (
              <button className="row-add-btn edit-btn" title="Renommer" onClick={(e) => startRename(it, e)}>
                <svg width="10" height="10" viewBox="0 0 20 20"><path d="M13.5 2.5l4 4L7.5 16.5H3.5v-4l10-10z" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
              </button>
            )}
            {it.type === 'Project' && (
              <button className="row-add-btn" title="Ajouter bâtiment" onClick={(e) => addBuilding(it.id, e)}>+</button>
            )}
            {it.type === 'Building' && (
              <button className="row-add-btn" title="Ajouter étage" onClick={(e) => addStorey(it.id, e)}>+</button>
            )}
            <span className="meta">{itemDimensions(it) || (kids.length > 0 ? kids.length : '')}</span>
          </div>
        </div>
        {exp && kids.length > 0 && (
          <div className="tree-children">
            {kids.map((k) => renderRow(k, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="tree-pane" ref={rootRef}>
      <div className="pane-head">
        <span className="title">{makeT(lang)("Project tree")}</span>
        <div className="actions">
          {activeTab === 'tree' && (
            <>
              <button className="icon-btn" title="Tout déplier" onClick={() => {
                const all: Record<string, boolean> = {};
                for (const id of Object.keys(items)) all[id] = true;
                setExpandedIds(all);
              }}>
                <svg width="13" height="13" viewBox="0 0 20 20"><path d="M10 2L2 6l8 4 8-4zM2 10l8 4 8-4M2 14l8 4 8-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
              </button>
              <button className="icon-btn" title="Tout replier" onClick={() => {
                const all: Record<string, boolean> = {};
                for (const id of Object.keys(items)) all[id] = false;
                setExpandedIds(all);
              }}>
                <svg width="13" height="13" viewBox="0 0 20 20"><path d="M4 10h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </button>
            </>
          )}
          <button className="icon-btn" title={makeT(lang)("Collapse panel")} onClick={onCollapse}>
            <svg width="13" height="13" viewBox="0 0 14 14"><path d="M3 2v10M9 4l-3 3 3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--panel-2)' }}>
        <button
          onClick={() => setActiveTab('tree')}
          style={{
            flex: 1, border: 0, background: 'transparent', cursor: 'pointer',
            padding: '6px 10px', fontSize: 11, fontWeight: activeTab === 'tree' ? 600 : 400,
            color: activeTab === 'tree' ? 'var(--accent)' : 'var(--ink-3)',
            borderBottom: activeTab === 'tree' ? '2px solid var(--accent)' : '2px solid transparent',
            transition: 'all 0.15s',
          }}
        >
          {makeT(lang)("Project")}
        </button>
        <button
          onClick={() => setActiveTab('ifc')}
          style={{
            flex: 1, border: 0, background: 'transparent', cursor: 'pointer',
            padding: '6px 10px', fontSize: 11, fontWeight: activeTab === 'ifc' ? 600 : 400,
            color: activeTab === 'ifc' ? 'var(--accent)' : 'var(--ink-3)',
            borderBottom: activeTab === 'ifc' ? '2px solid var(--accent)' : '2px solid transparent',
            transition: 'all 0.15s',
          }}
        >
          IFC Browser
        </button>
      </div>

      {activeTab === 'tree' ? (
        <>
          <div className="search">
            <svg width="13" height="13" viewBox="0 0 20 20" style={{ color: 'var(--ink-3)', flexShrink: 0 }}>
              <circle cx="9" cy="9" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M13 13l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              placeholder={t('search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="tree" ref={treeRef}>
            {projects.map((p) => renderRow(p))}
          </div>
        </>
      ) : (
        <div className="tree" style={{ overflowY: 'auto' }}>
          <IfcBrowserFromItems items={items} lang={lang} selection={selection} onSelect={handleSelect} />
        </div>
      )}
    </div>
  );
}
