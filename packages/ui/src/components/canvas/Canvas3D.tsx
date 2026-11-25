import type { IfcWallEntity } from '@skaitch/core/types/ifc';
import { wallBodyLimits } from '@skaitch/core/lib/wallContinuity';
import { captureCanvas, nextFrame, type ViewportRef } from '../../lib/viewport';
import ifcWasmUrl from '../../lib/ifcWasmUrl';
import FreeSection, { type SectionContext } from './FreeSection';
import { selectedWallBounds, createStoreyGroup, isItemInStoreyScope } from '../../lib/storeyPlacement';
import { buildStair, slabOpenings } from '@skaitch/core/lib/stairGeometry';
import { highlightMaterial } from '../../lib/highlightMaterial';
import { wallRoofProfile } from '@skaitch/core/lib/wallRoof';
import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { buildFurnitureModel } from '@skaitch/core/geometry/furniture3d';
import { buildOpeningModel } from '@skaitch/core/geometry/opening3d';
import * as OBC from '@thatopen/components';
import * as FRAGS from '@thatopen/fragments';
import * as WEBIFC from 'web-ifc';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { IfcMeshGeometry } from '../../lib/importIFC';
import type { ItemsMap } from '@skaitch/core/types/ifc';
import { buildRoof, roofFaces } from '@skaitch/core/lib/roofGeometry';
import { structuralParts } from '@skaitch/core/lib/structuralElements';

// Force single-threaded web-ifc: the MT WASM spawns pthreads using `document.currentScript.src`
// which is undefined in Vite ESM bundles, producing `new Worker("undefined")` → 404.
// This patch applies globally (fragments also imports the same web-ifc module instance).
{
  const _origInit = WEBIFC.IfcAPI.prototype.Init;
  WEBIFC.IfcAPI.prototype.Init = function () {
    return _origInit.call(this, () => ifcWasmUrl, true); // use the matching single-threaded binary
  };
}

function itemSearchLabel(item: any): string {
  return `${item?.id ?? ''} ${item?.name ?? ''} ${item?.Name ?? ''} ${item?.ifcType ?? ''} ${item?.category ?? ''}`;
}

function isCeilingLikeElement(item: any): boolean {
  return /compound ceiling|ceiling|plafond|ifccovering/i.test(itemSearchLabel(item));
}

interface Props {
  viewportRef?: ViewportRef;
  items: ItemsMap;
  addItem?: (item: import('@skaitch/core/types/ifc').IfcEntity) => void;
  updateItem?: (id: string, patch: any) => void;
  deleteItems?: (ids: string[]) => void;
  sectionManaging?: boolean;
  sectionToolHost?: HTMLElement | null;
  section2D?: boolean;
  onViewSection2D?: () => void;
  storeyId: string;
  showAllStoreys: boolean;
  setShowAllStoreys: (all: boolean) => void;
  selection: string[];
  setSelection: (ids: string[]) => void;
  t: (k: string) => string;
  lang: string;
  meshes?: IfcMeshGeometry[];
  ifcBuffer?: ArrayBuffer | null;
  centerOffset?: [number, number];
  fitCount?: number;
  cameraViewState?: { position: [number, number, number], target: [number, number, number] };
  onCameraViewStateChange?: (state: { position: [number, number, number], target: [number, number, number] }) => void;
  hiddenTypes?: Set<string>;
  showBgImage?: boolean;
  showScopeControl?: boolean;
}

const ifcPointToThree = (x: number, y: number, z: number): [number, number, number] => [x, z, -y];
const USE_THAT_OPEN_VIEWER = true;
const USE_IMPORTED_IFC_MESHES = true;

function isUsableBox(box: THREE.Box3) {
  if (box.isEmpty()) return false;
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  return [center.x, center.y, center.z, size.x, size.y, size.z].every(Number.isFinite) &&
    Math.max(size.x, size.y, size.z) > 0.001;
}

function ifcMatrixToThree(transform: number[]): THREE.Matrix4 {
  const ifc = new THREE.Matrix4();
  ifc.set(
    transform[0], transform[4], transform[8],  transform[12],
    transform[1], transform[5], transform[9],  transform[13],
    transform[2], transform[6], transform[10], transform[14],
    transform[3], transform[7], transform[11], transform[15]
  );

  const ifcToThree = new THREE.Matrix4().set(
    1,  0,  0, 0,
    0,  0,  1, 0,
    0, -1,  0, 0,
    0,  0,  0, 1
  );

  const threeToIfc = new THREE.Matrix4().copy(ifcToThree).invert();
  return new THREE.Matrix4().multiplyMatrices(ifcToThree, ifc).multiply(threeToIfc);
}

export function StoreyScopeSwitch({lang,showAllStoreys,setShowAllStoreys}: Pick<Props,'lang'|'showAllStoreys'|'setShowAllStoreys'>) {
  return (<div role="group" aria-label={lang==='fr'?'Étages visibles':'Visible storeys'} style={{display:'flex',flexWrap:'wrap',gap:2,padding:3,background:'var(--panel)',border:'1px solid var(--border)',borderRadius:8,boxShadow:'var(--shadow-md)'}}>
        {[false,true].map(all=><button key={String(all)} type="button" aria-pressed={showAllStoreys===all} onClick={()=>setShowAllStoreys(all)} style={{padding:'6px 10px',border:0,borderRadius:5,cursor:'pointer',fontSize:11,fontFamily:'var(--font-mono)',background:showAllStoreys===all?'var(--bg)':'transparent',color:showAllStoreys===all?'var(--accent)':'var(--ink-3)',fontWeight:showAllStoreys===all?600:400}}>{all?(lang==='fr'?'Tous les étages':'All storeys'):(lang==='fr'?'Étage courant':'Current storey')}</button>)}
      </div>);
}

export default function Canvas3D({ viewportRef, sectionToolHost, addItem, updateItem, deleteItems, sectionManaging = false, section2D = false, onViewSection2D, meshes, ifcBuffer, centerOffset, fitCount = 0, items, selection, setSelection, storeyId, cameraViewState, onCameraViewStateChange, hiddenTypes, showBgImage = true, lang, showAllStoreys, setShowAllStoreys, showScopeControl = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<string[]>(selection);
  const thatOpenFitRef = useRef<(() => Promise<void>) | null>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    animId: number;
  } | null>(null);
  const visibilityReady = useRef<Promise<unknown>>(Promise.resolve());
  const previousStoreyScope = useRef(false);
  const [sceneKey, setSceneKey] = useState(0);
  const [thatOpenLoading, setThatOpenLoading] = useState(false);
  const [thatOpenError, setThatOpenError] = useState<string | null>(null);

  // Tracks the live OBC.Components so a stale instance (StrictMode double-invoke,
  // or a buffer change that races an in-flight async load) can be force-disposed
  // before a new one is created — otherwise two ThatOpen worlds stack in the same
  // container and the previous buffer's geometry (e.g. an old wall opening) keeps
  // rendering behind the new one.
  const componentsRef = useRef<OBC.Components | null>(null);
  const worldRef = useRef<OBC.SimpleWorld<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer> | null>(null);
  const fragmentsMgrRef = useRef<OBC.FragmentsManager | null>(null);
  // Unique counter to make every ifcLoader.load call use a different model name
  // (see the rationale in the ThatOpen init useEffect below).
  const modelCounterRef = useRef(0);
  const pickerRef = useRef<OBC.FastModelPicker | null>(null);
  const modelIdRef = useRef<string | null>(null);
  const classifierRef = useRef<OBC.Classifier | null>(null);
  const hiderRef = useRef<OBC.Hider | null>(null);
  const itemsRef = useRef<ItemsMap>(items);


  useEffect(() => { selectionRef.current = selection; }, [selection]);
  useEffect(() => { itemsRef.current = items; }, [items]);


  // ── Vanilla Three.js scene for blank projects (no IFC buffer) ──────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || ifcBuffer) return; // Only when no IFC buffer
    console.log('[Canvas3D] Vanilla scene init (no IFC buffer)');

    container.replaceChildren();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f2f5);
    scene.add(new THREE.HemisphereLight(0xe8f0fa, 0xd4c9a8, 0.85));
    const sun = new THREE.DirectionalLight(0xfff5e0, 2.8);
    sun.position.set(60, 120, 50);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.01, 10000);
    camera.position.set(10, 20, 10);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.zoomSpeed = 2;
    controls.panSpeed = 2;
    controls.enableDamping = false;
    controls.target.set(0, 0, 0);

    if (cameraViewState) {
      camera.position.set(...cameraViewState.position);
      controls.target.set(...cameraViewState.target);
    }
    controls.update();

    let lastReportAt = 0;
    controls.addEventListener('change', () => {
      if (!onCameraViewStateChange) return;
      const now = Date.now();
      if (now - lastReportAt < 500) return;
      lastReportAt = now;
      onCameraViewStateChange({
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      });
    });

    sceneRef.current = { scene, camera, renderer, controls, animId: 0 };
    setSceneKey(key => key + 1);

    const grid = new THREE.GridHelper(100, 100, 0xcccccc, 0xe0e0e0);
    scene.add(grid);

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth, h = container.clientHeight;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    ro.observe(container);

    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      sceneRef.current!.animId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(sceneRef.current?.animId ?? 0);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      try { container.replaceChildren(); } catch {}
      sceneRef.current = null;
    };
  }, [ifcBuffer]);

  useEffect(() => {
    const container = containerRef.current;
    if (!USE_THAT_OPEN_VIEWER || !container || !ifcBuffer) return;
    console.log('[Canvas3D] ThatOpen init, ifcBuffer:', ifcBuffer.byteLength, 'bytes');

    // Force-dispose any world left over from a previous run that wasn't torn down
    // (StrictMode double-invoke or a buffer change racing an in-flight load).
    // Without this, the old renderer/scene keeps drawing the previous buffer and
    // its geometry (e.g. a wall opening at the old position) shows behind the new.
    if (componentsRef.current) {
      try {
        const oldComps = componentsRef.current;
        // Explicitly dispose every FragmentsModel still in the old FragmentsManager
        // BEFORE disposing the components. components.dispose() iterates its
        // components, but the FragmentsManager.dispose() signature here is plain
        // `dispose(): void` (no `full` flag), so we cannot assume it cascades
        // into a FragmentsModels.disposeModel() for every loaded model. If an old
        // model lingers, the worker's tile data and the THREE.Group that holds
        // its geometry stay referenced — and the next time we read fragments.core
        // it still reports the old model. Disposing it by name here closes that
        // gap and is cheap even if it's already empty.
        try {
          const oldFragMgr = oldComps.get(OBC.FragmentsManager) as any;
          const oldCore = oldFragMgr?.core;
          const oldModelList: Map<string, any> | undefined = oldCore?.models?.list instanceof Map
            ? oldCore.models.list
            : (oldCore?.models instanceof Map ? oldCore.models : undefined);
          if (oldModelList && oldModelList.size > 0) {
            console.log('[Canvas3D] Pre-dispose: old fragments models =', [...oldModelList.keys()]);
            for (const [mid, mdl] of oldModelList) {
              try {
                // Remove the model's THREE.Group from any world scene it might be attached to,
                // and dispose its geometry/materials.
                if (mdl?.object?.parent) mdl.object.parent.remove(mdl.object);
                if (typeof mdl?.dispose === 'function') {
                  // dispose() returns a Promise; fire-and-forget — the loadIfc that runs
                  // in the new useEffect invocation is independent of this cleanup.
                  void mdl.dispose().catch((e: any) => console.warn(`[Canvas3D] disposeModel(${mid}) failed:`, e));
                }
              } catch (modelErr) { console.warn(`[Canvas3D] disposeModel(${mid}) failed:`, modelErr); }
            }
            if (typeof oldCore?.dispose === 'function') {
              void oldCore.dispose().catch((e: any) => console.warn('[Canvas3D] core.dispose failed:', e));
            }
          } else if (oldModelList) {
            console.log('[Canvas3D] Pre-dispose: no old models to clean (size =', oldModelList.size, ')');
          } else {
            console.log('[Canvas3D] Pre-dispose: could not locate model list. core keys:', oldCore ? Object.keys(oldCore) : 'no core');
          }
        } catch (probeErr) {
          console.warn('[Canvas3D] Pre-dispose probe failed:', probeErr);
        }
        oldComps.dispose();
      } catch (err) { console.warn('ThatOpen stale dispose failed', err); }
      componentsRef.current = null;
    }
    container.replaceChildren();
    thatOpenFitRef.current = null;
    setThatOpenError(null);
    setThatOpenLoading(true);
    let disposed = false;
    let components: OBC.Components | null = null;
    let ro: ResizeObserver | null = null;
    let handleWheel: ((e: WheelEvent) => void) | null = null;

    const loadIfc = async () => {
      components = new OBC.Components();
      componentsRef.current = components;
      const worlds = components.get(OBC.Worlds);
      const world = worlds.create<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>();

      world.scene = new OBC.SimpleScene(components);
      world.renderer = new OBC.SimpleRenderer(components, container, { antialias: true });
      world.renderer.showLogo = false;
      world.camera = new OBC.SimpleCamera(components);
      // ThatOpen defaults to a very wide FOV (~75°); 50° is standard for architectural views.
      const perspCam = world.camera.three as THREE.PerspectiveCamera;
      perspCam.fov = 50;
      perspCam.updateProjectionMatrix();

      // Fetch worker locally (getWorker() fetches from unpkg.com — blocked by COEP require-corp).
      // Convert to classic worker: strip ES module export so it loads without SyntaxError.
      const fragments = components.get(OBC.FragmentsManager);
      const workerResp = await fetch('/fragments-worker.mjs');
      if (!workerResp.ok) throw new Error(`Worker fetch failed: ${workerResp.status}`);
      const workerSrc = await workerResp.text();
      const exportIdx = workerSrc.lastIndexOf('\nexport {');
      const classicSrc = exportIdx >= 0 ? workerSrc.slice(0, exportIdx) : workerSrc;
      const workerUrl = URL.createObjectURL(new Blob([classicSrc], { type: 'text/javascript' }));
      if (disposed) return;

      components.init();
      fragments.init(workerUrl, { classicWorker: true });

      // ── Renderer quality (must be done before components.init rendering starts) ─
      const threeRenderer = world.renderer.three;
      threeRenderer.localClippingEnabled = true;
      threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      threeRenderer.shadowMap.enabled = true;
      threeRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
      threeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      threeRenderer.toneMappingExposure = 1.15;
      threeRenderer.outputColorSpace = THREE.SRGBColorSpace;

      // Camera controls — tuned for fast, cursor-centred zoom (bldrs-style)
      const cameraControls = world.camera.controls;
      cameraControls.dollySpeed = 15;
      cameraControls.dollyToCursor = true;
      cameraControls.truckSpeed = 8;
      cameraControls.azimuthRotateSpeed = 1.2;
      cameraControls.polarRotateSpeed = 1.2;
      cameraControls.smoothTime = 0.08;
      cameraControls.draggingSmoothTime = 0.04;
      cameraControls.mouseButtons.left = 1;   // ROTATE
      cameraControls.mouseButtons.middle = 2; // TRUCK
      cameraControls.mouseButtons.right = 2;  // TRUCK

      // ── Scene: light architectural background (BLDRS-style) ──────────────────
      world.scene.setup({ backgroundColor: new THREE.Color(0xf0f2f5) });
      const threeScene = world.scene.three;

      // Replace ThatOpen's flat default lights with architectural-quality setup
      threeScene.children
        .filter((c): c is THREE.Light => c instanceof THREE.Light)
        .forEach(l => threeScene.remove(l));

      // Sky↔ground hemisphere: warm ground bounce, cool sky fill
      threeScene.add(new THREE.HemisphereLight(0xeef5fc, 0xe2d6c3, 0.95));

      // Primary sun (NW elevation, casts soft shadows)
      const sun = new THREE.DirectionalLight(0xfff5e0, 1.8);
      sun.position.set(60, 120, 50);
      sun.castShadow = true;
      sun.shadow.mapSize.setScalar(2048);
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 600;
      sun.shadow.bias = -0.0003;
      sun.shadow.normalBias = 0.02;
      // Shadow bounds adjusted after model loads to fit actual model size
      const sh = 60;
      sun.shadow.camera.left = -sh; sun.shadow.camera.right = sh;
      sun.shadow.camera.top = sh;   sun.shadow.camera.bottom = -sh;
      threeScene.add(sun);

      // Cool fill from opposite side (simulates sky reflection)
      const fillLight = new THREE.DirectionalLight(0xc0d8f8, 0.7);
      fillLight.position.set(-40, 30, -30);
      threeScene.add(fillLight);

      // Subtle atmospheric fog for depth perception
      threeScene.fog = new THREE.FogExp2(0xf0f2f5, 0.004);

      // ── Physical Environment Reflection (PMREM) ─────────────────────────────
      const pmremGenerator = new THREE.PMREMGenerator(threeRenderer);
      pmremGenerator.compileEquirectangularShader();
      threeScene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

      // ── Grid: architectural fine grid on light background ────────────────────
      const grids = components.get(OBC.Grids);
      grids.create(world);

      // Init uses the bundled WASM; avoid the loader's automatic CDN download.
      const ifcLoader = components.get(OBC.IfcLoader);
      ifcLoader.settings.webIfc = { COORDINATE_TO_ORIGIN: false, CIRCLE_SEGMENTS: 32 };
      await ifcLoader.setup({ autoSetWasm: false });
      if (disposed) return;

      // addAllRelations loads IfcMember/IfcPlate sub-elements of curtain walls (armature).
      // CRITICAL: use a unique model name each load. If the same name is reused,
      // ThatOpen's FragmentsManager keeps the old model in its internal map AND
      // its geometry stays in world.scene.three, so the previous IFC's windows
      // (e.g. those at the position the edited window was moved FROM) keep
      // rendering at the new position. Unique name → old model is orphaned and
      // swept when components.dispose() runs at the start of the next init.
      const modelName = `aai-ifc-${Date.now()}-${modelCounterRef.current++}`;
      console.log('[Canvas3D] Loading IFC with unique model name:', modelName, 'buffer bytes:', ifcBuffer.byteLength);
      const model = await ifcLoader.load(new Uint8Array(ifcBuffer), true, modelName, {
        instanceCallback: (importer) => {
          importer.addAllAttributes();
          importer.addAllRelations();
        },
      });
      if (disposed) return;
      // Building-scale models don't need LOD. Fragments frees the CPU copy of LOD geometry
      // once uploaded, and switching to it later (e.g. when a section plane is placed)
      // re-uploads that freed data and kills the render loop. Always use full geometry.
      await model.setLodMode(FRAGS.LodMode.ALL_GEOMETRY);
      if (disposed) return;
      console.log('[Canvas3D] Model loaded. modelId:', model.modelId, 'object children:', model.object.children.length);
      // Diagnostic: log the FragmentsCore model count to confirm the old world was actually swept.
      try {
        const core = (fragments as any).core;
        const modelList: Map<string, any> | undefined = core?.models?.list instanceof Map
          ? core.models.list
          : (core?.models instanceof Map ? core.models : undefined);
        if (modelList) {
          console.log('[Canvas3D] Post-load: fragments.core.models.list.size =', modelList.size, 'ids:', [...modelList.keys()]);
        }
      } catch {}
      // Diagnostic: use ThatOpen's own API to get per-element world positions
      try {
        const modelIdMap: Record<string, Set<number>> = { [modelName]: new Set([16584, 16955, 16964, 17039]) };
        const positions = await fragments.getPositions(modelIdMap);
        const winNames = ['wn_16584', 'wn_16955', 'wn_16964', 'wn_17039'];
        console.log('[Canvas3D] ThatOpen getPositions for windows:');
        positions.forEach((p, i) => {
          console.log(`  ${winNames[i]}: [${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}]`);
        });
      } catch (probeErr) {
        console.warn('[Canvas3D] getPositions probe failed:', probeErr);
      }

      world.scene.three.add(model.object);

      // Center the ThatOpen model if the loaded buffer was not centered
      let isModelCentered = true;
      if (centerOffset && (Math.abs(centerOffset[0]) > 0.001 || Math.abs(centerOffset[1]) > 0.001)) {
        const mc = new THREE.Vector3();
        model.box.getCenter(mc);
        const distToOffset = Math.hypot(mc.x - centerOffset[0], mc.z - (-centerOffset[1]));
        const distToOrigin = Math.hypot(mc.x, mc.z);
        if (distToOffset < distToOrigin) {
          isModelCentered = false;
        }
      }
      if (!isModelCentered && centerOffset) {
        console.log('[Canvas3D] Centering ThatOpen model by offset:', centerOffset);
        const translation = new THREE.Vector3(-centerOffset[0], 0, centerOffset[1]);
        model.object.position.copy(translation);
        model.object.updateMatrixWorld(true);
        model.box.translate(translation);
      }


      // Enable shadow cast/receive and realistic material response on all fragment meshes
      model.object.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          if (mesh.material) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach(m => {
              if (m instanceof THREE.MeshStandardMaterial) {
                m.envMapIntensity = 1.0;
                m.roughness = Math.max(0.15, m.roughness); // Prevent perfectly smooth unrealistic surfaces
                m.needsUpdate = true;
              }
            });
          }
        }
      });

      // Fit sun shadow camera to actual model bounds for correct shadow coverage
      if (isUsableBox(model.box)) {
        const mc = new THREE.Vector3();
        const ms = new THREE.Vector3();
        model.box.getCenter(mc);
        model.box.getSize(ms);
        const maxDim = Math.max(ms.x, ms.y, ms.z, 10);
        const pad = maxDim * 0.6;
        sun.position.set(mc.x + maxDim, mc.y + maxDim * 2, mc.z + maxDim * 0.8);
        sun.shadow.camera.left = -pad;   sun.shadow.camera.right = pad;
        sun.shadow.camera.top = pad;     sun.shadow.camera.bottom = -pad;
        sun.shadow.camera.far = maxDim * 6;
        sun.shadow.camera.updateProjectionMatrix();
        sun.target.position.copy(mc);
        sun.target.updateWorldMatrix(false, false);
      }

      // Expose scene so manual-items and highlight effects can use it
      sceneRef.current = {
        scene: world.scene.three,
        camera: world.camera.three as THREE.PerspectiveCamera,
        renderer: world.renderer.three,
        controls: world.camera.controls as any,
        animId: 0,
      };
      setSceneKey(c => c + 1);

      // ── Classifier + Hider for type visibility ────────────────────────────
      const classifier = components.get(OBC.Classifier);
      await classifier.byCategory();
      try {
        await classifier.aggregateItemRelations('StoreyIds',{categories:[/BUILDINGSTOREY/]},'ContainsElements',{attribute:'GlobalId'});
      } catch(error) { console.warn('[Canvas3D] Storey classification unavailable:',error); }
      classifierRef.current = classifier;
      hiderRef.current = components.get(OBC.Hider);

      // Apply initial type visibility now that classifier/hider are ready.
      // The visibility effect can run earlier and bail while refs are still null.
      {
        const TYPE_TO_IFC: Record<string, string[]> = {
          Wall:      ['IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCWALLELEMENTEDCASE'],
          Door:      ['IFCDOOR', 'IFCDOORSTANDARDCASE'],
          Window:    ['IFCWINDOW', 'IFCWINDOWSTANDARDCASE', 'IFCCURTAINWALL', 'IFCPLATE', 'IFCMEMBER'],
          Room:      ['IFCSPACE'],
          Slab:      ['IFCSLAB', 'IFCFOOTING'],
          Roof:      ['IFCROOF'],
          Ceiling:   ['IFCCOVERING'],
          Furniture: ['IFCFURNISHINGELEMENT', 'IFCFURNITURE'],
          GenericElement: ['IFCCOLUMN', 'IFCBEAM', 'IFCSTAIR', 'IFCSTAIRFLIGHT', 'IFCRAILING', 'IFCRAMP', 'IFCRAMPFLIGHT', 'IFCBUILDINGELEMENTPROXY', 'IFCCHIMNEY', 'IFCPILE', 'IFCDISCRETEACCESSORY', 'IFCELECTRICALELEMENT', 'IFCFLOWTERMINAL', 'IFCFLOWSEGMENT'],
        };
        const hider = hiderRef.current;
        if (hider) {
          for (const [type, ifcNames] of Object.entries(TYPE_TO_IFC)) {
            const visible = type === 'Room' ? false : !hiddenTypes?.has(type);
            const existing = ifcNames.filter(name => classifier.list.get('Categories')?.has(name));
            if (existing.length === 0) continue;
            try {
              const ids = await classifier.find({ Categories: existing });
              await hider.set(visible, ids);
            } catch { /* entity type absent from this model */ }
          }
          const roomExpressIds = Object.values(items)
            .filter((item) => item.type === 'Room' || (item.type === 'Wall' && wallRoofProfile(item, items) !== null))
            .map((item) => Number.parseInt(item.id.split('_').pop() ?? '', 10))
            .filter((id): id is number => Number.isFinite(id));
          if (roomExpressIds.length > 0) {
            await hider.set(false, { [model.modelId]: new Set(roomExpressIds) } as any);
          }
          fragments.core.update(true);
        }
        setSceneKey(c=>c+1);
      }

      // ── Section plane setup ───────────────────────────────────────────────
      worldRef.current = world;
      fragmentsMgrRef.current = fragments;
      modelIdRef.current = model.modelId;
      pickerRef.current = components.get(OBC.FastModelPickers).get(world);
      // ── Camera positioning ──────────────────────────────────────────────
      const fitToBox = (box: THREE.Box3, animated = true) => {
        if (!isUsableBox(box)) return;
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        box.getCenter(center);
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z, 1);
        // Camera sits diagonally at (dist, 0.75*dist, dist) from center, so the
        // actual distance is sqrt(2.5625) ≈ 1.6 × dist. Using maxDim * 0.9 puts
        // the camera ~1.4 × maxDim away — close enough to see interior detail
        // (furniture, mullions) without clipping into the model.
        const dist = maxDim * 0.9;
        const cam = world.camera.three as THREE.PerspectiveCamera;
        cam.near = Math.max(0.01, dist / 1000);
        cam.far = dist * 100;
        cam.updateProjectionMatrix();
        return world.camera.controls
          .setLookAt(
            center.x + dist,
            center.y + dist * 0.75,
            center.z + dist,
            center.x, center.y, center.z,
            animated,
          )
          .then(() => { model.useCamera(world.camera.three); fragments.core.update(); })
          .catch(console.error);
      };

      const fitToModel = async () => {
        const selectedBox = selectedWallBounds(itemsRef.current, selectionRef.current);
        const selected = new Set(selectionRef.current);
        world.scene.three.getObjectByName('manual-items')?.traverse(object => {
          if (selected.has(object.userData?.itemId)) {
            object.updateWorldMatrix(true, true);
            selectedBox.union(new THREE.Box3().setFromObject(object));
          }
        });
        if (isUsableBox(selectedBox)) { await fitToBox(selectedBox); return; }
        const selectedIds = selectionRef.current
          .map((id) => {
            const last = id.split('_').pop();
            const n = last ? Number.parseInt(last, 10) : NaN;
            return Number.isSafeInteger(n) && n > 0 && n < 2 ** 31 ? n : null;
          })
          .filter((n): n is number => n !== null);

        if (selectedIds.length > 0) {
          try {
            const boxes = await fragments.getBBoxes({ [model.modelId]: new Set(selectedIds) });
            const selBox = new THREE.Box3();
            for (const b of boxes) selBox.union(b);
            if (isUsableBox(selBox)) { await fitToBox(selBox); return; }
          } catch { /* fall through to whole-model fit */ }
        }

        const visibleIds = await model.getItemsByVisibility(true);
        const boxes = visibleIds.length ? await fragments.getBBoxes({ [model.modelId]: new Set(visibleIds) }) : [];
        const box = new THREE.Box3();
        for (const bounds of boxes) box.union(bounds);
        const manual = world.scene.three.getObjectByName('manual-items');
        if (manual) box.union(new THREE.Box3().setFromObject(manual));
        if (isUsableBox(box)) await fitToBox(box);
      };
      thatOpenFitRef.current = fitToModel;

      const modelBox = model.box.clone();
      if (cameraViewState) {
        const [px, py, pz] = cameraViewState.position;
        const [tx, ty, tz] = cameraViewState.target;
        const camDist = Math.hypot(px - tx, py - ty, pz - tz);
        let maxDim = 50;
        if (isUsableBox(modelBox)) {
          const size = new THREE.Vector3();
          modelBox.getSize(size);
          maxDim = Math.max(size.x, size.y, size.z, 1);
        }
        const dist = Math.max(maxDim * 0.9, camDist);
        const cam = world.camera.three as THREE.PerspectiveCamera;
        cam.near = Math.max(0.01, dist / 1000);
        cam.far = dist * 100;
        cam.updateProjectionMatrix();

        await world.camera.controls.setLookAt(px, py, pz, tx, ty, tz, false);
        model.useCamera(world.camera.three);
        fragments.core.update();
      } else if (isUsableBox(modelBox)) {
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        modelBox.getCenter(center);
        modelBox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z, 1);
        // Match fitToBox: maxDim * 0.9 → ~1.4 × maxDim camera distance.
        const dist = maxDim * 0.9;
        const cam = world.camera.three as THREE.PerspectiveCamera;
        cam.near = Math.max(0.01, dist / 1000);
        cam.far = dist * 100;
        cam.updateProjectionMatrix();
        await world.camera.controls.setLookAt(
          center.x + dist, center.y + dist, center.z + dist,
          center.x, center.y, center.z,
          false,
        );
      }
      // Register camera AFTER positioning so ThatOpen computes the correct initial LOD frustum
      model.useCamera(world.camera.three);
      fragments.core.update();
      setThatOpenLoading(false);

      // ── Resize ─────────────────────────────────────────────────────────
      const onResize = () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        world.renderer.three.setSize(w, h);
        const cam = world.camera.three;
        if (cam instanceof THREE.PerspectiveCamera) {
          cam.aspect = w / h;
          cam.updateProjectionMatrix();
        }
        fragments.core.update(true);
      };
      ro = new ResizeObserver(onResize);
      ro.observe(container);

      // ── Camera change reporting ─────────────────────────────────────────
      let lastReportAt = 0;
      world.camera.controls.addEventListener('update', () => {
        model.useCamera(world.camera.three);
        fragments.core.update();
        if (!onCameraViewStateChange) return;
        const now = Date.now();
        if (now - lastReportAt < 500) return;
        lastReportAt = now;
        const pos = new THREE.Vector3();
        const tgt = new THREE.Vector3();
        world.camera.controls.getPosition(pos);
        world.camera.controls.getTarget(tgt);
        onCameraViewStateChange({
          position: [pos.x, pos.y, pos.z],
          target: [tgt.x, tgt.y, tgt.z],
        });
      });

      handleWheel = (e: WheelEvent) => e.preventDefault();
      container.addEventListener('wheel', handleWheel, { passive: false });
    };

    loadIfc().catch((err) => {
      if (disposed) return; // cleanup ran while loading — expected, not an error
      console.error('ThatOpen IFC viewer failed:', err);
      setThatOpenError(String(err?.message ?? err));
      setThatOpenLoading(false);
    });

    return () => {
      disposed = true;
      thatOpenFitRef.current = null;
      ro?.disconnect();
      if (handleWheel) container.removeEventListener('wheel', handleWheel);
      worldRef.current = null;
      fragmentsMgrRef.current = null;
      pickerRef.current = null;
      modelIdRef.current = null;
      classifierRef.current = null;
      hiderRef.current = null;
      try { components?.dispose(); } catch (err) { console.warn('ThatOpen dispose failed', err); }
      if (componentsRef.current === components) componentsRef.current = null;
      try { container.replaceChildren(); } catch {}
      sceneRef.current = null;
      setThatOpenLoading(false);
      setThatOpenError(null);
    };
  }, [ifcBuffer]);

  useEffect(() => {
    if (!USE_THAT_OPEN_VIEWER || !ifcBuffer || fitCount === 0) return;
    thatOpenFitRef.current?.().catch(console.error);
  }, [fitCount, ifcBuffer]);

  useEffect(() => {
    if (USE_THAT_OPEN_VIEWER && ifcBuffer) return;
    if (fitCount === 0 || !sceneRef.current) return;
    const { scene, camera, controls } = sceneRef.current;
    const targetBox = new THREE.Box3();
    const selected = new Set(selection);

    const includeObject = (obj: THREE.Object3D) => {
      obj.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(obj);
      if (!box.isEmpty()) targetBox.union(box);
    };

    const manualGroup = scene.getObjectByName('manual-items');
    if (manualGroup && selected.size > 0) {
      manualGroup.traverse((obj) => {
        const itemId = obj.userData?.itemId;
        if (typeof itemId === 'string' && selected.has(itemId)) includeObject(obj);
      });
    }

    if (targetBox.isEmpty()) {
      const ifcGroup = scene.getObjectByName('ifc-model');
      if (manualGroup) includeObject(manualGroup);
      if (ifcGroup) includeObject(ifcGroup);
    }

    if (!isUsableBox(targetBox)) return;

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    targetBox.getCenter(center);
    targetBox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const distance = Math.max(maxDim * 1.8, 5);

    camera.near = Math.max(0.01, distance / 1000);
    camera.far = distance * 100;
    camera.position.set(center.x + distance, center.y + distance * 0.75, center.z + distance);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  }, [fitCount, selection, sceneKey]);

  // Initialize Three.js scene (vanilla path — skipped entirely when ThatOpen is active)
  useEffect(() => {
    if (USE_THAT_OPEN_VIEWER) return;
    const container = containerRef.current;
    if (!container) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    // Camera
    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.set(20, 15, 20);
    camera.lookAt(0, 0, 0);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.2; // Even snappier
    controls.zoomSpeed = 5.0;     // Much faster zoom
    controls.enablePan = true;    // Ensure lateral movement is enabled
    controls.minDistance = 2;
    controls.maxDistance = 1000;  // More headroom
    controls.maxPolarAngle = Math.PI * 0.85;

    // Restore camera state
    if (cameraViewState) {
      camera.position.set(...cameraViewState.position);
      controls.target.set(...cameraViewState.target);
      controls.update();
    }

    // Report changes
    let lastReportAt = 0;
    controls.addEventListener('change', () => {
      if (!onCameraViewStateChange) return;
      const now = Date.now();
      if (now - lastReportAt < 500) return; // Debounce
      lastReportAt = now;
      onCameraViewStateChange({
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      });
    });

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff8ee, 1.2);
    dirLight.position.set(15, 25, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 100;
    dirLight.shadow.camera.left = -30;
    dirLight.shadow.camera.right = 30;
    dirLight.shadow.camera.top = 30;
    dirLight.shadow.camera.bottom = -30;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xc0d8f8, 0.5);
    fillLight.position.set(-10, 10, -10);
    scene.add(fillLight);

    const hemisphereLight = new THREE.HemisphereLight(0xeef5fc, 0xe2d6c3, 0.45);
    scene.add(hemisphereLight);

    // Grid helper (subtle)
    const gridHelper = new THREE.GridHelper(50, 50, 0x333355, 0x222244);
    gridHelper.position.y = -0.01;
    scene.add(gridHelper);

    // Animation loop
    const animate = () => {
      const id = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
      sceneRef.current!.animId = id;
    };

    sceneRef.current = { scene, camera, renderer, controls, animId: 0 };
    setSceneKey(key => key + 1);
    setSceneKey(c => c + 1);
    animate();

    // Resize handler
    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    // Prevent default zoom/pinch behavior
    const handleWheel = (e: WheelEvent) => e.preventDefault();
    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      ro.disconnect();
      container.removeEventListener('wheel', handleWheel);
      if (sceneRef.current) {
        cancelAnimationFrame(sceneRef.current.animId);
      }
      renderer.dispose();
      controls.dispose();
      container.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  // Re-evaluate when ifcBuffer changes so ThatOpen can take over (or hand back) the canvas
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!ifcBuffer]);

  // Load meshes into the scene when they change (vanilla path only)
  useEffect(() => {
    // ThatOpen loads IFC geometry itself via IfcLoader — don't touch its scene objects
    if (USE_THAT_OPEN_VIEWER && ifcBuffer) return;
    if (!sceneRef.current) return;
    const { scene, camera, controls } = sceneRef.current;

    const oldGroup = scene.getObjectByName('ifc-model');
    if (oldGroup) {
      oldGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (obj.material instanceof THREE.Material) obj.material.dispose();
        }
      });
      scene.remove(oldGroup);
    }

    if (!USE_IMPORTED_IFC_MESHES || !meshes || meshes.length === 0) return;

    const group = new THREE.Group();
    group.name = 'ifc-model';
    const boundingBox = new THREE.Box3();

    const itemsByExpressId=new Map(Object.values(items).map(item=>[(item as any).expressID ?? Number.parseInt(item.id.split('_').pop()??'',10),item]));
    for (const mesh of meshes) {
      const item=itemsByExpressId.get(mesh.expressID);
      if(item && !isItemInStoreyScope(item,storeyId,showAllStoreys)) continue;
      const { vertices, indices, color, transform } = mesh;

      // Build BufferGeometry
      const geom = new THREE.BufferGeometry();
      const vertexCount = vertices.length / 6;
      const positions = new Float32Array(vertexCount * 3);
      const normals = new Float32Array(vertexCount * 3);

      for (let i = 0; i < vertexCount; i++) {
        const [x, y, z] = ifcPointToThree(vertices[i * 6], vertices[i * 6 + 1], vertices[i * 6 + 2]);
        const [nx, ny, nz] = ifcPointToThree(vertices[i * 6 + 3], vertices[i * 6 + 4], vertices[i * 6 + 5]);
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
        normals[i * 3] = nx;
        normals[i * 3 + 1] = ny;
        normals[i * 3 + 2] = nz;
      }

      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geom.setIndex(new THREE.BufferAttribute(indices, 1));

      // Material with IFC color
      // Ensure minimum brightness so dark/default IFC colors are visible
      const r = Math.max(color[0], 0.35);
      const g = Math.max(color[1], 0.35);
      const b = Math.max(color[2], 0.35);
      const mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(r, g, b),
        opacity: color[3],
        transparent: color[3] < 0.99,
        side: THREE.DoubleSide,
        flatShading: false,
      });

      const meshObj = new THREE.Mesh(geom, mat);

      meshObj.applyMatrix4(ifcMatrixToThree(transform));
      meshObj.userData.expressID = mesh.expressID;
      meshObj.castShadow = true;
      meshObj.receiveShadow = true;

      group.add(meshObj);
    }

    // Compute bounding box and center the model
    boundingBox.setFromObject(group);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    boundingBox.getCenter(center);
    boundingBox.getSize(size);

    // Center model at origin - DISABLED to maintain world coordinates
    // group.position.sub(center);

    scene.add(group);

    // Position camera to fit the model (if no saved state)
    if (cameraViewState) return;
    if (boundingBox.isEmpty()) return;

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraDistance = maxDim / (2 * Math.tan(fov / 2));
    cameraDistance = Math.max(cameraDistance * 1.5, 5);

    camera.position.set(
      center.x + cameraDistance * 0.7,
      center.y + cameraDistance * 0.5,
      center.z + cameraDistance * 0.7
    );
    camera.near = 0.01;
    camera.far = cameraDistance * 10;
    camera.updateProjectionMatrix();

    controls.target.copy(center);
    controls.update();

    // Update shadow camera to fit model
    const dirLight = scene.children.find(
      (c) => c instanceof THREE.DirectionalLight && c.castShadow
    ) as THREE.DirectionalLight | undefined;
    if (dirLight) {
      const shadowRange = maxDim * 1.5;
      dirLight.shadow.camera.left = -shadowRange;
      dirLight.shadow.camera.right = shadowRange;
      dirLight.shadow.camera.top = shadowRange;
      dirLight.shadow.camera.bottom = -shadowRange;
      dirLight.shadow.camera.far = cameraDistance * 5;
      dirLight.shadow.camera.updateProjectionMatrix();
      dirLight.position.set(
        center.x + cameraDistance * 0.5,
        center.y + cameraDistance * 0.8,
        center.z + cameraDistance * 0.3
      );
    }

    // Update grid to match model size
    const gridHelper = scene.children.find(c => c instanceof THREE.GridHelper);
    if (gridHelper) {
      scene.remove(gridHelper);
    }
    const newGrid = new THREE.GridHelper(
      maxDim * 3, Math.max(10, Math.round(maxDim * 3)),
      0x333355, 0x222244
    );
    newGrid.position.set(center.x, center.y - size.y / 2 - 0.05, center.z);
    scene.add(newGrid);

  }, [meshes, items, storeyId, sceneKey, showAllStoreys]);

  // Raycasting for selection — ThatOpen uses GPU picker, vanilla uses Three.js raycaster
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const thatOpenMode = USE_THAT_OPEN_VIEWER && !!ifcBuffer;

    if (thatOpenMode) {
      // GPU-based picking: no raycasting overhead, works with LOD fragment tiles
      const onClick = async (event: MouseEvent) => {
        if (event.button !== 0) return;
        const picker = pickerRef.current;
        const fragments = fragmentsMgrRef.current;
        if (!picker || !fragments) return;
        const hit = await picker.getItemAt();
        if (!hit) { setSelection([]); return; }
        const suffix = `_${hit.localId}`;
        const matched = Object.values(itemsRef.current).find(it => it.id.endsWith(suffix));
        setSelection(matched ? [matched.id] : []);
      };
      container.addEventListener('click', onClick);
      return () => container.removeEventListener('click', onClick);
    }

    // Vanilla Three.js raycasting
    const sceneObj = sceneRef.current;
    if (!sceneObj) return;
    const { camera, scene } = sceneObj;
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const rect = container.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const group = scene.getObjectByName('ifc-model');
      if (!group) return;
      const intersects = raycaster.intersectObject(group, true);
      for (const hit of intersects) {
        const expressId = hit.object.userData.expressID;
        if (expressId !== undefined) {
          const matched = Object.values(itemsRef.current).find(it => it.id.endsWith(`_${expressId}`));
          setSelection(matched ? [matched.id] : []);
          return;
        }
      }
      setSelection([]);
    };

    container.addEventListener('click', onClick);
    return () => container.removeEventListener('click', onClick);
  }, [ifcBuffer, setSelection, sceneKey]);

  // Highlighting selected items (vanilla path only — ThatOpen handles its own highlighting)
  useEffect(() => {
    if (USE_THAT_OPEN_VIEWER && ifcBuffer) return;
    const sceneObj = sceneRef.current;
    if (!sceneObj) return;

    const ifcGroup = sceneObj.scene.getObjectByName('ifc-model');
    const manualGroup = sceneObj.scene.getObjectByName('manual-items');

    const selectedExpressIDs = selection.map(selId => {
      const parts = selId.split('_');
      return parseInt(parts[parts.length - 1], 10);
    });

    const highlight = (group: THREE.Object3D) => {
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          const expressID = obj.userData.expressID;
          const itemId = obj.userData.itemId;

          highlightMaterial(obj.material,
            selection.includes(itemId) || (expressID !== undefined && selectedExpressIDs.includes(expressID)));
        }
      });
    };

    if (ifcGroup) highlight(ifcGroup);
    if (manualGroup) highlight(manualGroup);
  }, [selection, meshes, items]);

  // ThatOpen type visibility — hide/show IFC entities by type
  useEffect(() => {
    if (!USE_THAT_OPEN_VIEWER || !ifcBuffer) return;
    const classifier = classifierRef.current;
    const hider = hiderRef.current;
    if (!classifier || !hider) return;

    const TYPE_TO_IFC: Record<string, string[]> = {
      Wall:      ['IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCWALLELEMENTEDCASE'],
      Door:      ['IFCDOOR', 'IFCDOORSTANDARDCASE'],
      Window:    ['IFCWINDOW', 'IFCWINDOWSTANDARDCASE', 'IFCCURTAINWALL', 'IFCPLATE', 'IFCMEMBER'],
      Room:      ['IFCSPACE'],
      Slab:      ['IFCSLAB', 'IFCFOOTING'],
          Roof:      ['IFCROOF'],
      Ceiling:   ['IFCCOVERING'],
      Furniture: ['IFCFURNISHINGELEMENT', 'IFCFURNITURE'],
      GenericElement: ['IFCCOLUMN', 'IFCBEAM', 'IFCSTAIR', 'IFCSTAIRFLIGHT', 'IFCRAILING', 'IFCRAMP', 'IFCRAMPFLIGHT', 'IFCBUILDINGELEMENTPROXY', 'IFCCHIMNEY', 'IFCPILE', 'IFCDISCRETEACCESSORY', 'IFCELECTRICALELEMENT', 'IFCFLOWTERMINAL', 'IFCFLOWSEGMENT'],
    };

    visibilityReady.current = (async () => {
      await hider.set(true);
      for (const [type, ifcNames] of Object.entries(TYPE_TO_IFC)) {
        const visible = type === 'Room' ? false : !hiddenTypes?.has(type);
        const existing = ifcNames.filter(name => classifier.list.get('Categories')?.has(name));
        if (existing.length === 0) continue;
        try {
          const ids = await classifier.find({ Categories: existing });
          await hider.set(visible, ids);
        } catch { /* entity type absent from this model */ }
      }
      const modelId = modelIdRef.current;
      const roomExpressIds = Object.values(items)
        .filter((item) => item.type === 'Room' || (item.type === 'Wall' && wallRoofProfile(item, items) !== null))
        .map((item) => Number.parseInt(item.id.split('_').pop() ?? '', 10))
        .filter((id): id is number => Number.isFinite(id));
      if (modelId && roomExpressIds.length > 0) {
        await hider.set(false, { [modelId]: new Set(roomExpressIds) } as any);
      }
      const active=items[storeyId];
      const storeys=classifier.list.get('StoreyIds');
      if(!showAllStoreys && active?.type==='Storey' && storeys?.has(active.GlobalId)) {
        for(const key of storeys.keys()) {
          if(key===active.GlobalId) continue;
          const ids=await classifier.find({StoreyIds:[key]});
          await hider.set(false,ids);
        }
      }
      await fragmentsMgrRef.current?.core.update(true);
    })();
  }, [hiddenTypes, ifcBuffer, items, showAllStoreys, storeyId, sceneKey]);

  // ThatOpen selection highlighting — sync selection state to fragment highlight pass
  useEffect(() => {
    if (!USE_THAT_OPEN_VIEWER || !ifcBuffer) return;
    const fragments = fragmentsMgrRef.current;
    const modelId = modelIdRef.current;
    if (!fragments || !modelId) return;

    fragments.resetHighlight().catch(console.error);
    if (selection.length === 0) return;

    const expressIds = selection
      .map(id => { const n = parseInt(id.split('_').pop() ?? '', 10); return Number.isFinite(n) ? n : null; })
      .filter((n): n is number => n !== null);
    if (expressIds.length === 0) return;

    const style: FRAGS.MaterialDefinition = {
      color: new THREE.Color(0x2255ff),
      renderedFaces: FRAGS.RenderedFaces.TWO,
      opacity: 1,
      transparent: false,
      preserveOriginalMaterial: true,
    };
    fragments.highlight(style, { [modelId]: new Set(expressIds) }).catch(console.error);
  }, [selection, ifcBuffer]);

  // Synthetic meshes for manual items (full path in vanilla mode; furniture/generic fallback in ThatOpen mode)
  useEffect(() => {
    const thatOpenMode = USE_THAT_OPEN_VIEWER && !!ifcBuffer;
    if (!sceneRef.current) return;
    const { scene } = sceneRef.current;
    // In ThatOpen mode, rooms are rendered manually as flat editable floor areas.
    // IFCSPACE fragments are volumetric and can look like cubes after a room edit.
    // Walls/doors/windows/slabs are already rendered by ThatOpen.
    // Do NOT apply centerOffset here: the patched IFC buffer (live view) uses local
    // coords, so manual Three.js meshes must use the same local coordinate space.

    // Remove ALL previous manual items groups (React StrictMode may run effects
    // twice, leaving stale duplicates that getObjectByName would miss).
    {
      let oldGroup: THREE.Object3D | undefined;
      while ((oldGroup = scene.getObjectByName('manual-items') as THREE.Object3D | undefined)) {
        oldGroup.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            const disposeMaterial = (mat: THREE.Material) => {
              const mapped = mat as THREE.Material & { map?: THREE.Texture };
              mapped.map?.dispose();
              mat.dispose();
            };
            if (Array.isArray(obj.material)) obj.material.forEach(disposeMaterial);
            else if (obj.material instanceof THREE.Material) disposeMaterial(obj.material);
          }
        });
        scene.remove(oldGroup);
      }
    }

    const group = new THREE.Group();
    group.name = 'manual-items';
    // We only render items that don't seem to come from the current IFC meshes
    const isManual = (id: string) => /^(st|sl|slb|w|d|dr|wn|op|r|rm|rf|fur|tech|col|chm|ifc|ifcelement)_/.test(id) || id.includes('_ifc_');

    const renderedManual: string[] = [];

    if (showBgImage) {
      const textureLoader = new THREE.TextureLoader();
      for (const storey of Object.values(items)) {
        if (storey.type !== 'Storey' || !isItemInStoreyScope(storey,storeyId,showAllStoreys)) continue;
        const plan = (storey as any).geom?.plan;
        if (!plan?.url) continue;
        const width = Number(plan.w ?? 0) * Number(plan.scale ?? 1);
        const depth = Number(plan.h ?? 0) * Number(plan.scale ?? 1);
        const x = Number(plan.x ?? 0);
        const y = Number(plan.y ?? 0);
        const elevation = Number((storey as any).geom?.elevation ?? 0);
        if (![width, depth, x, y, elevation].every(Number.isFinite) || width <= 0 || depth <= 0) continue;

        const texture = textureLoader.load(String(plan.url));
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        const active = storey.id === storeyId;
        const opacity = Math.max(0.05, Math.min(1, Number(plan.opacity ?? 0.45))) * (active ? 1 : 0.55);
        const mat = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          opacity,
          side: THREE.DoubleSide,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), mat);
        mesh.name = 'background-plan-' + storey.id;
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x + width / 2, elevation + 0.012, -(y + depth / 2));
        mesh.renderOrder = -10;
        mesh.userData.itemId = storey.id;
        group.add(mesh);
        renderedManual.push('BackgroundPlan:' + storey.id);
      }
    }

    const manualGroup = group;
    for (const item of Object.values(items)) {
      if (!isManual(item.id) && !(item as any).isGenericIfcElement) continue;
      if (!isItemInStoreyScope(item,storeyId,showAllStoreys)) continue;
      if (hiddenTypes?.has(item.type)) continue;
      if (isCeilingLikeElement(item) && hiddenTypes?.has('Ceiling')) continue;

      // In ThatOpen mode, structural elements are rendered by the IFC engine.
      // Rooms are the exception: IFCSPACE is hidden above and we draw the editable
      // room footprint manually to avoid visible volumetric space boxes.
      if (thatOpenMode) {
        if (item.type !== 'Technical' && item.type !== 'Column' && item.type !== 'Chimney' && item.type !== 'Room' && !(item.type === 'Wall' && wallRoofProfile(item, items)) && !(item.type === 'Roof' && item.id.startsWith('rf_'))) {
          continue;
        }
      }
      const group = createStoreyGroup(items,item.parentId);
      group.userData.itemId=item.id;
      manualGroup.add(group);
      renderedManual.push(`${item.type}:${item.id}`);

      if (item.type === 'Door' || item.type === 'Window') {
        const { wallId, t, height, sillHeight } = (item as any).geom;
        const wall = items[wallId];
        if (!wall) continue;
        const { x1, y1, x2, y2, thickness: wThick } = (wall as any).geom;
        const dx = x2 - x1, dy = y2 - y1;
        const angle = Math.atan2(-dy, dx);
        const px = x1 + dx * t;
        const py = y1 + dy * t;
        const groupObj = buildOpeningModel(item as any, wThick);
        if (!groupObj) continue;
        groupObj.position.set(px, (sillHeight || 0) + height / 2, -py);
        groupObj.rotation.y = -angle;

        groupObj.userData.itemId = item.id;
        group.add(groupObj);
      } else if (item.type === 'Wall') {
        const { x1, y1, x2, y2, thickness: wThick = 0.2, height: wHeight = 3 } = (item as any).geom;
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.01) continue;
        const angle = Math.atan2(-dy, dx);
        const isCurtain = (item as any).ifcType === 'IfcCurtainWall';
        const mat = new THREE.MeshPhongMaterial({
          color: isCurtain ? 0x88ccee : 0xebeae6,
          flatShading: true,
          transparent: isCurtain,
          opacity: isCurtain ? 0.2 : 1,
          side: isCurtain ? THREE.DoubleSide : THREE.FrontSide,
        });

        const roofProfile = wallRoofProfile(item as any, items);
        const wallGroup = new THREE.Group();
        wallGroup.position.set(x1, 0, -y1);
        wallGroup.rotation.y = -angle;
        wallGroup.userData.itemId = item.id;

        const [bodyStart, bodyEnd] = wallBodyLimits(item as IfcWallEntity, items);
        const addWallPiece = (a: number, b: number, yBottom: number, yTop: number) => {
          if (a === 0) a = bodyStart;
          if (b === len) b = bodyEnd;
          const segLen = Math.max(0, b - a);
          const h = Math.max(0, yTop - yBottom);
          if (segLen < 0.01 || h < 0.01) return;
          let geom: THREE.BufferGeometry = new THREE.BoxGeometry(segLen, h, wThick);
          if (roofProfile && yTop === wHeight) {
            const heightAt = (x: number) => {
              const i = Math.max(1, roofProfile.findIndex(p => p[0] >= x));
              const p = roofProfile[i - 1], q = roofProfile[i];
              return p[1] + (q[1] - p[1]) * (x - p[0]) / (q[0] - p[0]);
            };
            const top = [[a, heightAt(a)], ...roofProfile.filter(p => p[0] > a && p[0] < b), [b, heightAt(b)]];
            if (top.some(p => p[1] <= yBottom)) return;
            const shape = new THREE.Shape();
            shape.moveTo(a, yBottom); shape.lineTo(b, yBottom);
            for (const p of top.reverse()) shape.lineTo(p[0], p[1]);
            shape.closePath();
            geom.dispose();
            geom = new THREE.ExtrudeGeometry(shape, { depth: wThick, bevelEnabled: false });
            geom.translate(0, 0, -wThick / 2);
          }
          const mesh = new THREE.Mesh(geom, mat);
          if (!roofProfile || yTop !== wHeight) mesh.position.set(a + segLen / 2, yBottom + h / 2, 0);
          mesh.userData.itemId = item.id;
          mesh.castShadow = !isCurtain;
          mesh.receiveShadow = true;
          wallGroup.add(mesh);
        };

        const openings = Object.values(items)
          .filter((o) => (o.type === 'Door' || o.type === 'Window') && (o as any).geom?.wallId === item.id && !hiddenTypes?.has(o.type))
          .map((o) => {
            const og = (o as any).geom ?? {};
            const width = Math.max(0, Number(og.width ?? 0));
            const center = Math.max(0, Math.min(len, Number(og.t ?? 0) * len));
            const a = Math.max(0, center - width / 2);
            const b = Math.min(len, center + width / 2);
            const sill = o.type === 'Window' ? Math.max(0, Number(og.sillHeight ?? 0.9)) : 0;
            const top = Math.min(wHeight, sill + Math.max(0, Number(og.height ?? (o.type === 'Door' ? 2.1 : 1.2))));
            return { a, b, sill, top };
          })
          .filter((o) => o.b - o.a > 0.01 && o.top - o.sill > 0.01)
          .sort((a, b) => a.a - b.a);

        let cursor = 0;
        for (const op of openings) {
          if (op.a > cursor) addWallPiece(cursor, op.a, 0, wHeight);
          addWallPiece(op.a, op.b, 0, op.sill);
          addWallPiece(op.a, op.b, op.top, wHeight);
          cursor = Math.max(cursor, op.b);
        }
        if (cursor < len) addWallPiece(cursor, len, 0, wHeight);
        if (wallGroup.children.length === 0) addWallPiece(0, len, 0, wHeight);
        group.add(wallGroup);
      } else if (item.type === 'Room') {
        const { polygon } = (item as any).geom;
        if (!polygon || polygon.length < 3) continue;
        
        const shape = new THREE.Shape();
        shape.moveTo(polygon[0][0], -polygon[0][1]);
        for (let i = 1; i < polygon.length; i++) {
          shape.lineTo(polygon[i][0], -polygon[i][1]);
        }
        shape.closePath();
        
        const geom = new THREE.ShapeGeometry(shape);
        const isSelected = selection.includes(item.id);
        const storeyElevation = 0;

        // Indigo/Teal aesthetic floor plane
        const mat = new THREE.MeshPhongMaterial({
          color: isSelected ? 0x4f46e5 : 0x818cf8, // Indigo accent
          side: THREE.DoubleSide,
          opacity: isSelected ? 0.5 : 0.3,
          transparent: true,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(geom, mat);
        
        mesh.rotation.x = Math.PI / 2;
        mesh.position.y = storeyElevation + 0.02; // Elevated above floor finish to prevent occlusion
        mesh.userData.itemId = item.id;
        group.add(mesh);

        // Premium border outline around the room
        const linePoints: THREE.Vector3[] = [];
        for (const pt of polygon) {
          linePoints.push(new THREE.Vector3(pt[0], -pt[1], 0));
        }
        linePoints.push(new THREE.Vector3(polygon[0][0], -polygon[0][1], 0));
        
        const lineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
        const lineMat = new THREE.LineBasicMaterial({
          color: isSelected ? 0x4338ca : 0x4f46e5, // Indigos
          transparent: true,
          opacity: isSelected ? 0.9 : 0.6,
        });
        const line = new THREE.Line(lineGeom, lineMat);
        line.rotation.x = Math.PI / 2;
        line.position.y = storeyElevation + 0.021; // Slightly above the plane mesh to prevent z-fighting
        line.userData.itemId = item.id;
        group.add(line);
      } else if (item.type === 'Stair') {
        const elevation = 0;
        for (const part of buildStair(item.geom,item.parentId,items).parts) {
          const shape = new THREE.Shape(part.polygon.map(([x,y])=>new THREE.Vector2(x,y)));
          const geometry = new THREE.ExtrudeGeometry(shape,{depth:part.thickness,bevelEnabled:false});
          geometry.rotateX(-Math.PI/2);
          const mesh = new THREE.Mesh(geometry,new THREE.MeshPhongMaterial({color:selection.includes(item.id)?0x6655cc:part.kind==='rail'?0x666666:0xb89970}));
          mesh.position.y=elevation+part.z-part.thickness; mesh.userData.itemId=item.id;
          mesh.castShadow=mesh.receiveShadow=true; group.add(mesh);
        }
      } else if (item.type === 'Slab') {
        const { polygon, thickness = 0.2 } = (item as any).geom;
        if (!polygon || polygon.length < 3) continue;
        
        const shape = new THREE.Shape();
        shape.moveTo(polygon[0][0], -polygon[0][1]);
        for (let i = 1; i < polygon.length; i++) {
          shape.lineTo(polygon[i][0], -polygon[i][1]);
        }
        shape.closePath();
        
        for(const hole of slabOpenings(item.id,items)) {
          const vertices=hole.map(([x,y])=>new THREE.Vector2(x,-y));
          if(THREE.ShapeUtils.isClockWise(vertices)===THREE.ShapeUtils.isClockWise(shape.getPoints())) vertices.reverse();
          shape.holes.push(new THREE.Path(vertices));
        }
        const extrudeSettings = { depth: thickness, bevelEnabled: false };
        const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        const mat = new THREE.MeshPhongMaterial({ color: 0xa8855e, flatShading: true });
        const mesh = new THREE.Mesh(geom, mat);
        
        const storeyElevation = 0;

        // Extrude goes along Z by default. 
        // We want it to go DOWN or be positioned such that top is at 0?
        // Usually slab top is at level.
        mesh.rotation.x = Math.PI / 2;
        mesh.position.y = storeyElevation; 
        mesh.userData.itemId = item.id;
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
      } else if (item.type === 'Roof') {
        const solid = buildRoof((item as any).geom);
        if (!solid) continue;
        // Plan (x, y, z) → world (x, z, -y), same convention as walls.
        const positions: number[] = [];
        for (const face of roofFaces(solid)) {
          // Project on the dominant plane axis for triangulation
          const n = new THREE.Vector3();
          for (let i = 0; i < face.length; i++) {
            const a = face[i], b = face[(i + 1) % face.length];
            n.x += (a[1] - b[1]) * (a[2] + b[2]);
            n.y += (a[2] - b[2]) * (a[0] + b[0]);
            n.z += (a[0] - b[0]) * (a[1] + b[1]);
          }
          const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
          const proj = face.map((p) => az >= ax && az >= ay
            ? new THREE.Vector2(p[0], p[1])
            : ax >= ay ? new THREE.Vector2(p[1], p[2]) : new THREE.Vector2(p[2], p[0]));
          // Double-sided flat-shaded material: triangle winding is irrelevant.
          for (const tri of THREE.ShapeUtils.triangulateShape(proj, [])) {
            for (const k of tri) {
              const p = face[k];
              positions.push(p[0], p[2], -p[1]);
            }
          }
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geom.computeVertexNormals();
        const isSelected = selection.includes(item.id);
        const mat = new THREE.MeshPhongMaterial({
          color: isSelected ? 0xc0603a : 0xa0442c, flatShading: true, side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.y = 0;
        mesh.userData.itemId = item.id;
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
      } else if (item.type === 'Column' || item.type === 'Chimney') {
        // Shared local-frame parts (see core lib/structuralElements): extrude each footprint
        // along +Z, then turn Z up (local y → −z, matching the world mapping (x, −y)).
        const { x, y, rotation } = item.geom;
        const isSelected = selection.includes(item.id);
        const body = new THREE.Group();
        body.position.set(x, 0, -y);
        body.rotation.y = rotation || 0;
        for (const part of structuralParts(item)) {
          const shape = new THREE.Shape(part.polygon.map(([px, py]) => new THREE.Vector2(px, py)));
          const geometry = new THREE.ExtrudeGeometry(shape, { depth: part.h, bevelEnabled: false, curveSegments: 24 });
          geometry.rotateX(-Math.PI / 2);
          geometry.translate(0, part.z, 0);
          const colour = isSelected ? 0x6655cc : item.type === 'Column' ? 0xa8a8a2 : item.kind === 'stove' ? (part.role === 'hearth' ? 0x2f2f2f : 0x444444) : part.role === 'hearth' ? 0x8c5a46 : 0x9e6b55;
          const mesh = new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({ color: colour, flatShading: item.type !== 'Column' || item.geom.shape !== 'circle' }));
          mesh.castShadow = mesh.receiveShadow = true;
          mesh.userData.itemId = item.id;
          body.add(mesh);
        }
        body.userData.itemId = item.id;
        group.add(body);
      } else if (item.type === 'Furniture') {
        const { x, y, w, d, rotation } = (item as any).geom;
        const itemGroup = buildFurnitureModel(item as any, { translucentFallback: thatOpenMode });
        itemGroup.position.set(x + w / 2, 0, -y - d / 2);
        itemGroup.rotation.y = rotation;

        // Attach item meta and add to group
        itemGroup.userData.itemId = item.id;
        group.add(itemGroup);
      } else if (item.type === 'Technical') {
        const { x, y, rotation, mountHeight } = (item as any).geom;
        const disc = (item as any).discipline || 'electrical';
        const modelId = (item as any).model || '';
        
        // Map discipline color to HEX values
        const colorMap: Record<string, number> = {
          electrical: 0xf59e0b, // amber
          plumbing: 0x3b82f6,   // blue
          hvac: 0x10b981,       // emerald
          data: 0x8b5cf6,       // violet
          fire: 0xdc2626,       // red
        };
        const baseColor = colorMap[disc] ?? 0xf59e0b;

        const techGroup = new THREE.Group();
        techGroup.position.set(x, mountHeight ?? 0.3, -y);
        techGroup.rotation.y = rotation;

        if (modelId === 'fire-extincteur') {
          const body = new THREE.Mesh(
            new THREE.CylinderGeometry(0.075, 0.075, 0.38, 16),
            new THREE.MeshPhongMaterial({ color: baseColor }),
          );
          body.position.z = 0.085;
          const handle = new THREE.Mesh(
            new THREE.BoxGeometry(0.10, 0.05, 0.04),
            new THREE.MeshPhongMaterial({ color: 0x374151 }),
          );
          handle.position.set(0, 0.21, 0.085);
          techGroup.add(body, handle);
        } else if (modelId === 'hvac-chaudiere') {
          const body = new THREE.Mesh(
            new THREE.BoxGeometry(0.42, 0.62, 0.26),
            new THREE.MeshPhongMaterial({ color: 0xf3f4f6 }),
          );
          body.position.z = 0.14;
          const display = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 0.04, 0.01),
            new THREE.MeshPhongMaterial({ color: baseColor }),
          );
          display.position.set(0, -0.18, 0.27);
          techGroup.add(body, display);
        } else if (disc === 'electrical') {
          // Electrical outlet/switch plate: a thin box flat against wall
          const plateGeom = new THREE.BoxGeometry(0.08, 0.08, 0.015);
          const plateMat = new THREE.MeshPhongMaterial({ color: 0xeeeeee, specular: 0xffffff, shininess: 30 });
          const plate = new THREE.Mesh(plateGeom, plateMat);
          plate.castShadow = plate.receiveShadow = true;
          techGroup.add(plate);

          // Sockets details or buttons
          const btnGeom = new THREE.BoxGeometry(0.04, 0.04, 0.005);
          const btnMat = new THREE.MeshPhongMaterial({ color: baseColor });
          const btn = new THREE.Mesh(btnGeom, btnMat);
          btn.position.z = 0.01;
          btn.castShadow = true;
          techGroup.add(btn);

        } else if (disc === 'plumbing') {
          // Plumbing fixture: water points/valves or pipe connectors
          if (modelId.includes('evac')) {
            // Drain/pipe: a vertical drain cylinder
            const cylGeom = new THREE.CylinderGeometry(0.04, 0.04, 0.4, 16);
            const cylMat = new THREE.MeshPhongMaterial({ color: 0x9ca3af }); // Grey PVC
            const cyl = new THREE.Mesh(cylGeom, cylMat);
            cyl.position.y = -0.2;
            cyl.castShadow = cyl.receiveShadow = true;
            techGroup.add(cyl);
          } else {
            // Hot/Cold water supply point: nice shiny brass valve tap
            const valGeom = new THREE.CylinderGeometry(0.015, 0.015, 0.1, 16);
            const valMat = new THREE.MeshPhongMaterial({ color: 0xd97706, specular: 0xffffff, shininess: 100 }); // Brass
            const valve = new THREE.Mesh(valGeom, valMat);
            valve.rotation.x = Math.PI / 2;
            valve.castShadow = true;
            techGroup.add(valve);

            // Red/Blue handle
            const isHot = modelId.includes('chaude');
            const handGeom = new THREE.BoxGeometry(0.03, 0.015, 0.015);
            const handMat = new THREE.MeshPhongMaterial({ color: isHot ? 0xef4444 : 0x3b82f6 });
            const hand = new THREE.Mesh(handGeom, handMat);
            hand.position.z = 0.05;
            hand.castShadow = true;
            techGroup.add(hand);
          }

        } else if (disc === 'hvac') {
          // HVAC: ventilation grille or radiator unit
          if (modelId.includes('radiateur')) {
            // Radiator: thin detailed ribbed box
            const radGeom = new THREE.BoxGeometry(0.8, 0.6, 0.08);
            const radMat = new THREE.MeshPhongMaterial({ color: 0xf3f4f6, specular: 0xffffff, shininess: 40 });
            const rad = new THREE.Mesh(radGeom, radMat);
            rad.castShadow = rad.receiveShadow = true;
            techGroup.add(rad);

            // Add fine vertical ribs on the radiator body
            for (let dx = -0.35; dx <= 0.35; dx += 0.08) {
              const ribGeom = new THREE.BoxGeometry(0.02, 0.56, 0.09);
              const rib = new THREE.Mesh(ribGeom, radMat);
              rib.position.x = dx;
              techGroup.add(rib);
            }
          } else {
            // Vent diffuser/grille
            const grilleGeom = new THREE.BoxGeometry(0.2, 0.2, 0.02);
            const grilleMat = new THREE.MeshPhongMaterial({ color: 0xe5e7eb });
            const grille = new THREE.Mesh(grilleGeom, grilleMat);
            grille.castShadow = grille.receiveShadow = true;
            techGroup.add(grille);

            // Center details
            const cenGeom = new THREE.BoxGeometry(0.12, 0.12, 0.005);
            const cenMat = new THREE.MeshPhongMaterial({ color: baseColor });
            const cen = new THREE.Mesh(cenGeom, cenMat);
            cen.position.z = 0.01;
            techGroup.add(cen);
          }

        } else if (disc === 'data') {
          // RJ45 data socket / Fiber ont
          const rjGeom = new THREE.BoxGeometry(0.08, 0.08, 0.02);
          const rjMat = new THREE.MeshPhongMaterial({ color: 0xf9fafb });
          const rj = new THREE.Mesh(rjGeom, rjMat);
          rj.castShadow = rj.receiveShadow = true;
          techGroup.add(rj);

          const slotGeom = new THREE.BoxGeometry(0.02, 0.02, 0.005);
          const slotMat = new THREE.MeshPhongMaterial({ color: 0x4b5563 });
          const slot1 = new THREE.Mesh(slotGeom, slotMat);
          slot1.position.set(-0.015, -0.01, 0.01);
          const slot2 = new THREE.Mesh(slotGeom, slotMat);
          slot2.position.set(0.015, -0.01, 0.01);
          techGroup.add(slot1);
          techGroup.add(slot2);
        } else {
          // Fallback generic MEP element box with discipline color
          const boxGeom = new THREE.BoxGeometry(0.1, 0.1, 0.1);
          const boxMat = new THREE.MeshPhongMaterial({ color: baseColor });
          const box = new THREE.Mesh(boxGeom, boxMat);
          box.castShadow = box.receiveShadow = true;
          techGroup.add(box);
        }

        techGroup.userData.itemId = item.id;
        group.add(techGroup);
      } else if ((item as any).isGenericIfcElement) {
        const g = (item as any).geom ?? {};
        if ([g.x, g.y, g.w, g.d, g.h].some((v) => typeof v !== 'number')) continue;
        const geom = new THREE.BoxGeometry(g.w, g.h, g.d);
        const mat = new THREE.MeshPhongMaterial({ color: 0x7f9fbd, flatShading: true, transparent: true, opacity: thatOpenMode ? 0.4 : 0.75 });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(g.x + g.w / 2, g.h / 2, -g.y - g.d / 2);
        mesh.rotation.y = -Number(g.rotation ?? 0);
        mesh.userData.itemId = item.id;
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
      }
    }

    if (renderedManual.length > 0) console.log('[Canvas3D] Manual meshes rendered:', renderedManual);
    scene.add(group);

    const scopeChanged=previousStoreyScope.current!==showAllStoreys;
    previousStoreyScope.current=showAllStoreys;
    if(scopeChanged && thatOpenMode) thatOpenFitRef.current?.().catch(console.error);
    // If no IFC meshes, fit view to manual items (vanilla mode only)
    const ifcGroup = scene.getObjectByName('ifc-model');
    const hasVisibleIfcMeshes = Boolean(ifcGroup && ifcGroup.children.length > 0);
    if (!thatOpenMode && (!meshes || meshes.length === 0 || !hasVisibleIfcMeshes) && (!cameraViewState || scopeChanged)) {
      const box = new THREE.Box3().setFromObject(group);
      if (!box.isEmpty()) {
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        box.getCenter(center);
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const cameraDistance = Math.max(maxDim * 1.5, 5);
        const sceneObj = sceneRef.current;
        if (!sceneObj) return;
        sceneObj.camera.position.set(center.x + cameraDistance, center.y + cameraDistance, center.z + cameraDistance);
        sceneObj.camera.lookAt(center);
        sceneObj.controls.target?.copy(center);
        sceneObj.controls.update();
      }
    }
  }, [items, storeyId, meshes, selection, sceneKey, centerOffset, ifcBuffer, hiddenTypes, showBgImage, showAllStoreys]);

  useEffect(() => {
    if (!viewportRef || !sceneRef.current || thatOpenLoading || thatOpenError) return;
    const api = {
      view: '3d' as const, storeyId, allStoreys: showAllStoreys,
      read: () => {
        const { camera, controls, renderer } = sceneRef.current!;
        const target = worldRef.current ? worldRef.current.camera.controls.getTarget(new THREE.Vector3()) : controls.target;
        return { position: camera.position.toArray(), target: target.toArray(), width: renderer.domElement.clientWidth, height: renderer.domElement.clientHeight };
      },
      set: async (request: import('../../lib/viewport').ViewRequest) => {
        if (request.center || request.scale !== undefined) throw new Error('center and scale require the 2d view.');
        await visibilityReady.current;
        const { scene, camera, controls } = sceneRef.current!;
        const world = worldRef.current;
        let target = world ? world.camera.controls.getTarget(new THREE.Vector3()) : controls.target.clone();
        let position = camera.position.clone();
        if (request.fit) {
          if (world && thatOpenFitRef.current) { await thatOpenFitRef.current(); position.copy(camera.position); target = world.camera.controls.getTarget(new THREE.Vector3()); }
          else {
            const box = new THREE.Box3();
            scene.traverseVisible(object => {
              if (object instanceof THREE.Mesh && object.userData.itemId) box.union(new THREE.Box3().setFromObject(object));
            });
            // Manual items can store their identity on a parent group.
            if (box.isEmpty()) { const group = scene.getObjectByName('manual-items'); if (group) box.setFromObject(group); }
            if (!isUsableBox(box)) throw new Error('No visible geometry to fit.');
            box.getCenter(target); const size = box.getSize(new THREE.Vector3());
            position.copy(target).add(new THREE.Vector3(1, 0.75, 1).multiplyScalar(Math.max(size.x, size.y, size.z, 1) * 1.8));
          }
        }
        if (request.target) target.set(...request.target);
        if (request.position) position.set(...request.position);
        if (request.preset) {
          const directions = { top: [0,1,0.000001], front: [0,0,1], back: [0,0,-1], left: [-1,0,0], right: [1,0,0], isometric: [1,0.75,1] };
          const distance = Math.max(position.distanceTo(target), 1);
          position.copy(target).add(new THREE.Vector3(...directions[request.preset]).normalize().multiplyScalar(distance));
        }
        position.sub(target).divideScalar(request.zoom_factor ?? 1).add(target);
        const distance = position.distanceTo(target);
        if (!Number.isFinite(distance) || distance < 0.01 || distance > 1e7) throw new Error('Camera position and target must be distinct and within range.');
        camera.near = Math.max(0.001, distance / 10000); camera.far = Math.max(1000, distance * 100); camera.updateProjectionMatrix();
        if (world) { await world.camera.controls.setLookAt(...position.toArray(), ...target.toArray(), false); await fragmentsMgrRef.current?.core.update(true); }
        else { camera.position.copy(position); controls.target.copy(target); controls.update(); }
        onCameraViewStateChange?.({ position: position.toArray(), target: target.toArray() });
      },
      capture: async () => {
        await visibilityReady.current;
        if (fragmentsMgrRef.current) await fragmentsMgrRef.current.core.update(true);
        await nextFrame();
        const { renderer, scene, camera } = sceneRef.current!;
        renderer.render(scene, camera);
        return captureCanvas(renderer.domElement);
      },
    };
    viewportRef.current = api;
    return () => { if (viewportRef.current === api) viewportRef.current = null; };
  });

  const getSectionContext = useCallback((): SectionContext | null => {
    const world = worldRef.current;
    if (world?.renderer) {
      let geometryKey='',sectionMeshes:THREE.Mesh[]=[],disposed=false;
      const disposeMeshes=()=>{for(const mesh of sectionMeshes){mesh.geometry.dispose();const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];materials.forEach(material=>material.dispose());}sectionMeshes=[];};
      return {
        scene: world.scene.three, camera: world.camera.three,
        renderer: world.renderer.three as THREE.WebGLRenderer, controls: world.camera.controls,
        pick: point => pickerRef.current?.getFullPick(point) ?? Promise.resolve(null),
        update: () => { fragmentsMgrRef.current?.core.update(true); },
        disposeMeshes:()=>{disposed=true;disposeMeshes();},
        getMeshes:async()=>{
          const fragments=fragmentsMgrRef.current,id=modelIdRef.current;
          const model=fragments&&id?fragments.list.get(id):undefined;
          if(!model||disposed)return [];
          const ids=await model.getItemsByVisibility(true),key=ids.join(',');
          if(disposed)return [];
          if(key===geometryKey)return sectionMeshes;
          const data=await model.getItemsGeometry(ids);
          if(disposed)return [];
          disposeMeshes();model.object.updateWorldMatrix(true,false);
          for(const parts of data)for(const part of parts){
            if(!part.positions||!part.indices)continue;
            const geometry=new THREE.BufferGeometry();
            geometry.setAttribute('position',new THREE.BufferAttribute(part.positions,3));
            geometry.setIndex(new THREE.BufferAttribute(part.indices,1));
            const mesh=new THREE.Mesh(geometry);
            mesh.matrixAutoUpdate=false;
            mesh.matrix.multiplyMatrices(model.object.matrixWorld,part.transform);
            mesh.updateMatrixWorld(true);sectionMeshes.push(mesh);
          }
          geometryKey=key;return sectionMeshes;
        },
      };
    }
    return sceneRef.current;
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} className="canvas3d" style={{ cursor: 'grab', width: '100%', height: '100%', visibility: (USE_THAT_OPEN_VIEWER && thatOpenLoading) ? 'hidden' : 'visible' }} />
      {showScopeControl && <div style={{position:'absolute',top:12,left:12,zIndex:20}}>
        <StoreyScopeSwitch lang={lang} showAllStoreys={showAllStoreys} setShowAllStoreys={setShowAllStoreys}/>
      </div>}
      {thatOpenLoading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#0a0a18', color: 'var(--ink-3)',
          fontFamily: 'var(--font-mono)', fontSize: 12, gap: 10, pointerEvents: 'none',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite' }}>
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="31" strokeDashoffset="10" />
          </svg>
          Chargement IFC…
        </div>
      )}
      {thatOpenError && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(10,10,24,0.85)', color: 'oklch(0.65 0.18 25)',
          fontFamily: 'var(--font-mono)', fontSize: 11, gap: 8, padding: 24,
          textAlign: 'center', pointerEvents: 'none',
        }}>
          <svg width="18" height="18" viewBox="0 0 20 20"><path d="M10 3L2 17h16L10 3z" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10 8v5M10 14.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          Erreur IFC
          <span style={{ fontSize: 10, color: 'var(--ink-4)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>{thatOpenError}</span>
        </div>
      )}

      <FreeSection toolHost={sectionToolHost} items={items} storeyId={storeyId} managing={sectionManaging} ready={sceneKey}
        loading={thatOpenLoading || !!thatOpenError} getContext={getSectionContext} addItem={addItem} updateItem={updateItem}
        deleteItems={deleteItems} onView2D={onViewSection2D} selection={selection} setSelection={setSelection} is2D={section2D}/>
    </div>
  );
}
