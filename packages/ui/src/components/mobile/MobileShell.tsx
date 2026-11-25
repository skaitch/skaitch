import type { ViewportRef } from '../../lib/viewport';
import { makeT } from '@skaitch/core/data/i18n';
import { useState } from 'react';
import type { ItemsMap, IfcEntity, ToolType, ViewType, ViewState2D } from '@skaitch/core/types/ifc';
import Canvas2D from '../canvas/Canvas2D';
import Canvas3D from '../canvas/Canvas3D';
import TreePane from '../panels/TreePane';
import PropertiesPane from '../panels/PropertiesPane';
import Drawer from './Drawer';
import ToolSheet from './ToolSheet';
import BottomNav from './BottomNav';
import type { IfcMeshGeometry } from '../../lib/importIFC';

interface Props {
  viewportRef?: ViewportRef;
  header: React.ReactNode;
  sectionToolbar: React.ReactNode;
  sectionManaging: boolean;
  openSectionSettings: () => void;
  showAllStoreys: boolean;
  setShowAllStoreys: (all: boolean) => void;
  items: ItemsMap;
  selection: string[];
  setSelection: (ids: string[]) => void;
  tool: ToolType;
  setTool: (t: ToolType) => void;
  view: ViewType;
  setView: React.Dispatch<React.SetStateAction<ViewType>>;
  focusStorey: string;
  setFocusStorey: (id: string) => void;
  storeys: IfcEntity[];
  addItem: (it: IfcEntity) => void;
  updateItem: (id: string, patch: any) => void;
  deleteItems: (ids: string[]) => void;
  replaceItems: (next: ItemsMap) => void;
  query: string;
  setQuery: (q: string) => void;
  expandedIds: Record<string, boolean>;
  setExpandedIds: (ids: Record<string, boolean>) => void;
  rawIfcStructure: unknown;
  view2d: ViewState2D;
  setView2d: React.Dispatch<React.SetStateAction<ViewState2D>>;
  fitCount: number;
  setFitCount: React.Dispatch<React.SetStateAction<number>>;
  hiddenTypes: Set<string>;
  showGrid: boolean;
  snapEnabled: boolean;
  snapSize: number;
  ifcMeshes: IfcMeshGeometry[] | undefined;
  liveIfcBuffer: ArrayBuffer | null | undefined;
  ifcCenterOffset: [number, number] | undefined;
  uiState: any;
  persistUi: (patch: any) => void;
  openSettings: () => void;
  setChatOpen: (open: boolean) => void;
  setChatPrompt: (p: { text: string; image?: string } | null) => void;
  winW: number;
  lang: string;
  t: (k: string) => string;
}

export default function MobileShell({
  header, sectionToolbar, sectionManaging, openSectionSettings,
  viewportRef, items, selection, setSelection, tool, setTool, view, setView, showAllStoreys, setShowAllStoreys,
  focusStorey, setFocusStorey, storeys,
  addItem, updateItem, deleteItems, replaceItems,
  query, setQuery, expandedIds, setExpandedIds, rawIfcStructure,
  view2d, setView2d, fitCount, hiddenTypes,
  showGrid, snapEnabled, snapSize,
  ifcMeshes, liveIfcBuffer, ifcCenterOffset, uiState, persistUi,
  openSettings, setChatOpen, setChatPrompt,
  winW, lang, t,
}: Props) {
  const [treeOpen, setTreeOpen] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);
  const [toolOpen, setToolOpen] = useState(false);

  const isPhone = winW < 640;

  const closeAll = () => { setTreeOpen(false); setPropsOpen(false); setToolOpen(false); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg)' }}>

      {header}
      {(view === '3d' || view === 'section') && <div className="mobile-section-toolbar">{sectionToolbar}</div>}

      {/* CANVAS AREA */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: 0 }}>
        {view === '2d' ? (
          <Canvas2D viewportRef={viewportRef} showAllStoreys={showAllStoreys}
            items={items} storeyId={focusStorey} tool={tool} setTool={setTool}
            selection={selection} setSelection={setSelection}
            addItem={addItem} updateItem={updateItem} deleteItems={deleteItems}
            showGrid={showGrid} snapEnabled={snapEnabled} snapSize={snapSize}
            t={t} lang={lang} view={view2d} setView={setView2d}
            fitCount={fitCount} hiddenTypes={hiddenTypes}
          />
        ) : (view === '3d' || view === 'section') ? (
          <Canvas3D viewportRef={viewportRef} sectionManaging={sectionManaging} addItem={addItem} updateItem={updateItem} deleteItems={deleteItems} section2D={view === 'section'} onViewSection2D={()=>setView('section')}
            showAllStoreys={showAllStoreys} setShowAllStoreys={setShowAllStoreys}
            key={`3d-mobile-${focusStorey}`}
            items={items} storeyId={focusStorey}
            selection={selection} setSelection={setSelection}
            t={t} lang={lang}
            meshes={ifcMeshes}
            ifcBuffer={liveIfcBuffer}
            centerOffset={ifcCenterOffset}
            fitCount={fitCount}
            cameraViewState={uiState.camera3d}
            onCameraViewStateChange={(cam: any) => persistUi({ camera3d: cam })}
            hiddenTypes={hiddenTypes}
          />
        ) : null}


        {/* Selection action bar */}
        {selection.length > 0 && (
          <div style={{
            position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
            background: 'var(--panel)', border: '1px solid var(--border)',
            borderRadius: 24, padding: '7px 18px',
            fontSize: 12, display: 'flex', alignItems: 'center', gap: 14,
            boxShadow: 'var(--shadow-md)', whiteSpace: 'nowrap',
          }}>
            <span style={{ color: 'var(--ink-3)' }}>
              {selection.length} {makeT(lang)('selected')}
            </span>
            <button
              onClick={() => { setPropsOpen(true); closeAll(); setPropsOpen(true); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 12, fontWeight: 600, padding: 0 }}
            >
              {makeT(lang)("Properties")}
            </button>
            <button
              onClick={() => { deleteItems(selection); setSelection([]); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'oklch(0.55 0.18 25)', fontSize: 12, padding: 0 }}
            >
              {makeT(lang)("Delete")}
            </button>
          </div>
        )}
      </div>

      {/* BOTTOM NAV */}
      <BottomNav
        treeOpen={treeOpen}
        toolOpen={toolOpen}
        propsOpen={propsOpen}
        view={view}
        selectionCount={selection.length}
        onTreeToggle={() => { setTreeOpen(v => !v); setPropsOpen(false); setToolOpen(false); }}
        onToolToggle={() => { setToolOpen(v => !v); setTreeOpen(false); setPropsOpen(false); }}
        onViewChange={next => { closeAll(); setView(next); }}
        onPropsToggle={() => { setPropsOpen(v => !v); setTreeOpen(false); setToolOpen(false); }}
        lang={lang}
      />

      {/* TREE DRAWER */}
      <Drawer
        open={treeOpen}
        onClose={() => setTreeOpen(false)}
        side={isPhone ? 'bottom' : 'left'}
        size={isPhone ? '78vh' : '300px'}
        title={makeT(lang)("Project tree")}
      >
        <TreePane
          items={items} selection={selection}
          setSelection={ids => { setSelection(ids); }}
          addItem={addItem} updateItem={updateItem}
          t={t} lang={lang} query={query} setQuery={setQuery}
          expandedIds={expandedIds} setExpandedIds={setExpandedIds}
          focusStorey={focusStorey} setFocusStorey={setFocusStorey}
          onCollapse={() => setTreeOpen(false)}
          rawIfcStructure={rawIfcStructure}
        />
      </Drawer>

      {/* PROPERTIES DRAWER */}
      <Drawer
        open={propsOpen}
        onClose={() => setPropsOpen(false)}
        side={isPhone ? 'bottom' : 'right'}
        size={isPhone ? '68vh' : '320px'}
        title={makeT(lang)("Properties")}
      >
        <PropertiesPane
          items={items} selection={selection} updateItem={updateItem}
          addItem={addItem} deleteItems={deleteItems}
          tool={tool} setTool={setTool}
          t={t} lang={lang}
          openSettings={openSettings}
          onCollapse={() => setPropsOpen(false)}
          replaceItems={replaceItems}
        />
      </Drawer>

      {/* TOOL SHEET */}
      <ToolSheet
        open={toolOpen}
        onClose={() => setToolOpen(false)}
        tool={tool}
        setTool={next=>{if(next==='Section'){setTool('select');openSectionSettings();}else setTool(next);}}
        lang={lang}
      />
    </div>
  );
}
