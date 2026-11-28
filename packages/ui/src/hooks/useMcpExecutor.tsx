import { useEffect, useRef, useCallback, useState } from 'react';
import { listedProjects } from '@skaitch/core/lib/projectArchive';
import { MCP_MODEL_TOOLS, MCP_READ_TOOLS, type BimOperation, type McpModelResponse } from '@skaitch/core/types/bim';
import type { ItemsMap, IfcDoorEntity, IfcWindowEntity, AiConfig } from '@skaitch/core/types/ifc';
import type { ElementDef } from '@skaitch/core/data/elementCatalogue';
import { runCodeMode } from '../lib/codeMode';
import { shrinkFloorplanResult } from '../lib/viewport';

type IfcEntity = ItemsMap[string];

/**
 * Runs MCP tools against the open project, with the user's confirmation for every change.
 * Shared by every host: the transport (WebSocket, cloud mailbox, Electron IPC) stays in the host.
 */
export interface McpExecutorHandlers {
  getView?: () => Record<string, unknown>;
  setView?: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  captureView?: () => Promise<Record<string, unknown>>;
  items: ItemsMap;
  catalogue: ElementDef[];
  focusStorey: string;
  /** Interface language; default names of created elements follow it (French when absent). */
  lang?: string;
  addItem: (it: IfcEntity) => void;
  updateItem: (id: string, patch: Partial<IfcEntity>) => void;
  deleteItems: (ids: string[]) => void;
  replaceItems?: (items: ItemsMap) => void;
  flushProject?: () => Promise<void>;
  openProject?: (proj: { id: string }) => Promise<void>;
  setFocusStorey?: (storeyId: string) => void;
  activeProjectId: string | null;
  uid: string | null;
  alwaysValidate?: boolean;
  setAlwaysValidate?: (v: boolean) => void;
  setSelection?: (s: string[]) => void;
  triggerFit?: () => void;
  ai?: AiConfig;
  /** The host BIM engine (web API, Electron IPC). */
  requestBim: <T>(operation: BimOperation, data: unknown) => Promise<T>;
  /** Projects the MCP client may open with select_project. */
  listProjects: () => Promise<unknown>;
  /** Hosts with an AI renderer implement generate_visualization. */
  generateVisualization?: (args: Record<string, unknown>, items: ItemsMap, ai?: AiConfig) => Promise<unknown>;
  /** Fingerprint of the AI settings a pending visualization was approved with. */
  aiPreferences?: (ai: Partial<AiConfig>) => unknown;
}

export function useMcpExecutor(handlers: McpExecutorHandlers) {
  const hRef     = useRef(handlers);
  hRef.current   = handlers;           // always fresh without re-subscribing


  const [pendingQueue, setPendingQueue] = useState<{
    id: string;
    toolId: string;
    name: string;
    args: Record<string, unknown>;
    resolve: (val: any) => void;
    reject: (reason?: string) => void;
    draftId?: string;
    expiresAt: number;
    uid: string | null;
    projectId: string | null;
  }[]>([]);

  const pendingConfirm = pendingQueue[0] || null;
  const bypassRef = useRef<boolean>(false);

  const [popupPos, setPopupPos] = useState({ x: 80, y: 80 });
  const [remark, setRemark] = useState('');
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const posStartRef = useRef({ x: 80, y: 80 });

  useEffect(() => {
    if (pendingConfirm) {
      setPopupPos({ x: 80, y: 80 });
      setRemark('');

      // Auto-focus & select the active item in the queue when it shifts to the front!
      const draftId = pendingConfirm.draftId;
      if (draftId && hRef.current.setSelection) {
        hRef.current.setSelection([draftId]);
        setTimeout(() => {
          if (hRef.current.triggerFit) {
            hRef.current.triggerFit();
          }
        }, 100);
      }
    }
  }, [pendingConfirm?.id]);

  // ── Execute a single tool call against the live ItemsMap ──────────────────
  useEffect(() => {
    if (!pendingConfirm) return;
    const timer = setTimeout(() => {
      pendingConfirm.reject('La demande MCP a expiré. Relancez la commande.');
      setPendingQueue(queue => queue.filter(item => item.id !== pendingConfirm.id));
    }, Math.max(0, pendingConfirm.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [pendingConfirm?.id]);

  useEffect(() => {
    const invalid = pendingQueue.filter(request => request.uid !== handlers.uid || request.projectId !== handlers.activeProjectId);
    if (!invalid.length) return;
    invalid.forEach(request => request.reject('La session ou le projet a changé. Relancez la commande MCP.'));
    setPendingQueue(queue => queue.filter(request => !invalid.includes(request)));
  }, [handlers.uid, handlers.activeProjectId, pendingQueue]);

  const execute = useCallback(async (name: string, args: Record<string, unknown>, forceConfirm = false, expiresAt = Date.now() + 120_000, approvalOnly = false): Promise<unknown> => {
    if (Date.now() >= expiresAt) throw new Error('La demande MCP a expiré. Relancez la commande.');
    const commandUid = hRef.current.uid, commandProject = hRef.current.activeProjectId;
    const renderSettings = JSON.stringify((hRef.current.aiPreferences ?? (() => null))(hRef.current.ai || {}));
    const sameContext = () => hRef.current.uid === commandUid && hRef.current.activeProjectId === commandProject && (name !== 'generate_visualization' || approvalOnly || JSON.stringify((hRef.current.aiPreferences ?? (() => null))(hRef.current.ai || {})) === renderSettings);
    const { items, focusStorey, addItem, updateItem, deleteItems, alwaysValidate } = hRef.current;

    const resolveId = (qid: string): IfcEntity | undefined =>
      items[qid] ?? Object.values(items).find((i) => i.GlobalId === qid);

    if (name === 'execute_script') {
      if (alwaysValidate) throw new Error('execute_script is disabled while MCP change validation is enabled.');
      return runCodeMode(args.code, items, hRef.current.catalogue, AbortSignal.timeout(expiresAt - Date.now()));
    }

    if (name === 'apply_model_batch') {
      const snapshot = hRef.current;
      const prepared = approvalOnly ? null : await snapshot.requestBim<{ items: ItemsMap; result: { added: number; updated: number } }>('mcp-batch', {
        args, items, focusStorey, catalogue: snapshot.catalogue, lang: snapshot.lang,
      });
      const current = () => sameContext() && hRef.current.items === items && hRef.current.focusStorey === focusStorey;
      if (!current() || Date.now() >= expiresAt) throw new Error('Le projet a changé ou le lot a expiré.');
      if (prepared && !snapshot.replaceItems) throw new Error('Application du lot indisponible dans cet éditeur.');
      if (prepared && !forceConfirm && !alwaysValidate) {
        snapshot.replaceItems!(prepared.items);
        return prepared.result;
      }
      return new Promise((resolve, reject) => {
        const id = String(Date.now() + Math.random());
        setPendingQueue(queue => [...queue, {
          id, toolId: id, name, args: { ...args, batchSummary: prepared?.result ?? args.batchSummary }, expiresAt, uid: commandUid, projectId: commandProject,
          resolve: () => {
            if (!current() || Date.now() >= expiresAt) { reject(new Error('Le projet a changé ou le lot a expiré.')); return; }
            if (prepared) snapshot.replaceItems!(prepared.items);
            resolve(prepared ? prepared.result : { approved: true });
          },
          reject: reason => reject(new Error(reason || 'Lot refusé.')),
        }]);
      });
    }

    const needsConfirm = (forceConfirm || alwaysValidate) &&
      !bypassRef.current &&
      ['create_ifc_element', 'update_ifc_element', 'delete_ifc_element', 'generate_visualization', 'create_storey', 'update_storey', 'delete_storey', 'create_section', 'create_roof', 'create_stair', 'create_slab', 'create_wall', 'connect_walls', 'create_space', 'create_door', 'create_window', 'create_dimension', 'delete_element', 'update_wall', 'create_marker', 'create_technical', 'update_technical', 'create_column', 'update_column', 'create_chimney', 'update_chimney', 'update_opening', 'create_furniture', 'update_furniture', 'update_element', 'create_sheet', 'add_sheet_view', 'update_sheet_view'].includes(name);

    if (needsConfirm) {
      if (name === 'delete_element' || name === 'delete_ifc_element' || name === 'delete_storey' || name === 'generate_visualization') {
        const ids = (name === 'generate_visualization' ? [] : args.ids as string[] ?? [(args.element_id ?? args.storey_id ?? args.id) as string]).map((qid) => resolveId(qid)?.id).filter(Boolean) as string[];
        if (ids.length && hRef.current.setSelection) {
          hRef.current.setSelection(ids);
          if (hRef.current.triggerFit) {
            hRef.current.triggerFit();
          }
        }

        return new Promise((resolve, reject) => {
          const newConfirm = {
            id: String(Date.now() + Math.random()),
            toolId: String(Date.now() + Math.random()),
            name,
            args,
            expiresAt, uid: commandUid, projectId: commandProject,
            resolve: async () => {
              if (!sameContext()) { newConfirm.reject('La session ou le projet a changé.'); return; }
              if (Date.now() >= expiresAt) { newConfirm.reject('La demande MCP a expiré.'); return; }
              if (approvalOnly) { resolve({ approved: true }); return; }
              bypassRef.current = true;
              try {
                const res = await execute(name, args, false, expiresAt);
                resolve(res);
              } catch (err) {
                reject(err);
              } finally {
                bypassRef.current = false;
              }
            },
            reject: (reason?: string) => {
              reject(new Error(reason || 'Suppression annulée par l\'utilisateur.'));
            }
          };
          setPendingQueue(prev => [...prev, newConfirm]);
        });
      }

      // For updates, backup the original item's geometry
      const isUpdate = name.startsWith('update_');
      const targetId = isUpdate ? (resolveId(String(args.id ?? args.storey_id))?.id) : null;
      const originalItem = targetId ? items[targetId] : null;
      const originalItemBackup = originalItem ? {
        ...Object.fromEntries(['description', 'name', 'Name', 'OperationType', 'OverallWidth', 'OverallHeight', 'Material', 'material', 'FireRating', 'fireRating', 'ThermalTransmittance', 'uValue', 'category', 'model', 'discipline', 'circuitRef', 'amperage', 'fluidType', 'diameter', 'hvacType', 'longName', 'phase', 'northAngle', 'lat', 'lon', 'siteElevation', 'siteAddress', 'address', 'grossArea', 'function', 'occupancy'].map(key => [key, undefined])),
        ...JSON.parse(JSON.stringify(originalItem)),
      } : null;
      const continuityBackup = (name === 'connect_walls' || name === 'update_wall' || (args.attach_walls === true && (name === 'create_roof' || name === 'update_element')))
        ? Object.values(items).filter((item) => item.type === 'Wall' || item.type === 'Door' || item.type === 'Window').map((item) => [item.id, JSON.parse(JSON.stringify((item as any).geom))] as const)
        : null;

      // Creation & Update tools: execute immediately as a draft preview
      bypassRef.current = true;
      let draftRes: any;
      try {
        draftRes = await execute(name, args, false, expiresAt);
      } catch (err) {
        bypassRef.current = false;
        throw err;
      }
      bypassRef.current = false;

      if (draftRes?.error || draftRes?.duplicate) return draftRes;
      const draftId = isUpdate ? targetId : draftRes?.id ?? draftRes?.storey_id;

      if (draftId && hRef.current.setSelection) {
        hRef.current.setSelection([draftId]);
        setTimeout(() => {
          if (hRef.current.triggerFit) {
            hRef.current.triggerFit();
          }
        }, 100);
      }

      return new Promise((resolve, reject) => {
        const newConfirm = {
          id: String(Date.now() + Math.random()),
          toolId: String(Date.now() + Math.random()),
          name,
          args,
          expiresAt, uid: commandUid, projectId: commandProject,
          draftId,
          resolve: async () => {
            if (!sameContext()) { newConfirm.reject('La session ou le projet a changé.'); return; }
            if (Date.now() >= expiresAt) { newConfirm.reject('La demande MCP a expiré.'); return; }
            const finalItems = hRef.current.items;
            const finalItem = draftId ? finalItems[draftId] : null;
            if (finalItem) {
              resolve({
                ...draftRes,
                success: true,
                id: draftId,
                global_id: finalItem.GlobalId,
                ifc_type: finalItem.ifcType,
                updated_geom: (finalItem as any).geom,
                ...(name === 'create_wall' ? { start_point: [(finalItem as any).geom.x1, (finalItem as any).geom.y1], end_point: [(finalItem as any).geom.x2, (finalItem as any).geom.y2] } : {}),
                message: "L'utilisateur a validé et éventuellement ajusté la géométrie de l'élément."
              });
            } else {
              resolve(draftRes);
            }
          },
          reject: (reason?: string) => {
            if (!sameContext()) { reject(new Error(reason || 'Le projet a changé.')); return; }
            if (continuityBackup) {
              for (const [id, geom] of continuityBackup) updateItem(id, { geom } as any);
            }
            if (isUpdate && draftId && originalItemBackup) {
              updateItem(draftId, originalItemBackup);
            } else if (!isUpdate && draftId) {
              deleteItems([draftId]);
              hRef.current.setSelection?.([]);
            }
            reject(new Error(reason || 'Action refusée par l\'utilisateur.'));
          }
        };
        setPendingQueue(prev => [...prev, newConfirm]);
      });
    }

    if (MCP_READ_TOOLS.includes(name)) {
      const read = await hRef.current.requestBim('mcp-read', { name, args, items, catalogue: hRef.current.catalogue });
      return name === 'get_storey_floorplan' ? shrinkFloorplanResult(read) : read;
    }

    if (MCP_MODEL_TOOLS.includes(name)) {
      const snapshot = hRef.current;
      const response = await hRef.current.requestBim<McpModelResponse>('mcp-model', {
        name, args, items, focusStorey, catalogue: snapshot.catalogue, lang: snapshot.lang,
      });
      if (Date.now() >= expiresAt) throw new Error('La demande MCP a expiré. Relancez la commande.');
      if (hRef.current.items !== items || !sameContext()) {
        throw new Error('Le projet a changé pendant le calcul MCP. Relancez la commande.');
      }
      for (const change of response.changes) {
        if (change.kind === 'add') addItem(change.item);
        else if (change.kind === 'update') updateItem(change.id, change.patch);
        else if (change.kind === 'delete') deleteItems(change.ids);
        else hRef.current.setFocusStorey?.(change.id);
      }
      return response.result;
    }

    switch (name) {
      // ── Project Navigation ──────────────────────────────────────────────────
      case 'list_projects': {
        const projects = await hRef.current.listProjects();
        return Array.isArray(projects) ? listedProjects(projects, args) : projects;
      }

      case 'select_project': {
        const { project_id } = args as { project_id: string };
        if (hRef.current.openProject) {
          await hRef.current.openProject({ id: project_id });
          return { success: true, project_id };
        }
        return { error: 'openProject handler not configured' };
      }

      case 'select_storey': {
        const { storey_id } = args as { storey_id: string };
        const found = items[storey_id];
        if (!found || found.type !== 'Storey') {
          return { error: `Storey not found: ${storey_id}` };
        }
        if (hRef.current.setFocusStorey) {
          hRef.current.setFocusStorey(storey_id);
          return { success: true, storey_id };
        }
        return { error: 'setFocusStorey handler not configured' };
      }

      // ── Queries ────────────────────────────────────────────────────────────
      case 'get_view':
      case 'set_view':
      case 'capture_view': {
        try {
          const h = hRef.current;
          if (name === 'get_view' && h.getView) return h.getView();
          if (name === 'set_view' && h.setView) return await h.setView(args);
          if (name === 'capture_view' && h.captureView) return await h.captureView();
          return { error: 'Viewport controls are unavailable.' };
        } catch (error) { return { error: (error as Error).message }; }
      }

      // ── Creation ───────────────────────────────────────────────────────────
      // ── Export ─────────────────────────────────────────────────────────────
      case 'generate_visualization':
        if (!hRef.current.generateVisualization) return { error: 'La génération de rendus est indisponible ici.' };
        return hRef.current.generateVisualization(args, items, hRef.current.ai);

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }, []);


  const renderConfirmDialog = () => {
    if (!pendingConfirm) return null;
    const { name, args, resolve, reject } = pendingConfirm;
    const isFr = (hRef.current.lang ?? 'fr') === 'fr';

    const handleReject = () => {
      const msg = remark.trim() 
        ? `Action refusée par l'utilisateur. Motif : ${remark.trim()}`
        : `Action refusée par l'utilisateur.`;
      reject(msg);
      setPendingQueue(prev => prev.slice(1));
    };

    const handleAccept = () => {
      resolve(null);
      setPendingQueue(prev => prev.slice(1));
    };

    const { items, alwaysValidate, setAlwaysValidate } = hRef.current;

    const resolveId = (qid: string): IfcEntity | undefined =>
      items[qid] ?? Object.values(items).find((i) => i.GlobalId === qid);

    // Human-friendly tool descriptions
    let actionDesc = '';
    let details = '';
    let objectName = '';

    if (name === 'apply_model_batch') {
      actionDesc = isFr ? 'Appliquer le lot de modélisation' : 'Apply the modelling batch';
      const summary = args.batchSummary as { added: number; updated: number } | undefined;
      if (summary) objectName = isFr ? `${summary.added} ajouts, ${summary.updated} mises à jour` : `${summary.added} additions, ${summary.updated} updates`;
      details = JSON.stringify(args.operations, null, 2);
    } else if (name === 'generate_visualization') {
      actionDesc = isFr ? 'Générer un rendu' : 'Generate a visualization';
      objectName = String(args.fournisseur || hRef.current.ai?.visualizerProvider || 'pollinations');
      details = JSON.stringify(args, null, 2);
    } else if (name === 'create_slab') {
      objectName = String(args.name || (isFr ? 'Dalle sans nom' : 'Unnamed Slab'));
      actionDesc = isFr 
        ? `Créer une dalle` 
        : `Create a slab`;
      details = isFr
        ? `Polygone : ${JSON.stringify(args.polygon)}\nÉpaisseur : ${args.thickness ?? 0.2} m`
        : `Polygon: ${JSON.stringify(args.polygon)}\nThickness: ${args.thickness ?? 0.2} m`;
    } else if (name === 'create_wall') {
      objectName = String(args.name || (isFr ? 'Mur sans nom' : 'Unnamed Wall'));
      actionDesc = isFr
        ? `Dessiner un mur`
        : `Draw a wall`;
      const startPt = args.start_connection ? JSON.stringify(args.start_connection) : args.start_point ? JSON.stringify(args.start_point) : '?';
      const endPt = args.end_connection ? JSON.stringify(args.end_connection) : args.end_point ? JSON.stringify(args.end_point) : '?';
      details = isFr
        ? `Départ : ${startPt}\nArrivée : ${endPt}\nÉpaisseur : ${args.thickness ?? 0.2} m\nHauteur : ${args.height ?? 2.8} m\nIntérieur : ${args.interior_side ?? 'left'} (par rapport au trajet)`
        : `Start: ${startPt}\nEnd: ${endPt}\nThickness: ${args.thickness ?? 0.2} m\nHeight: ${args.height ?? 2.8} m\nInterior: ${args.interior_side ?? 'left'} (relative to direction)`;
    } else if (name === 'update_wall') {
      const targetWall = args.id ? resolveId(String(args.id)) : null;
      const originalName = targetWall ? (targetWall.Name || targetWall.name) : null;
      objectName = String(args.name || originalName || (isFr ? 'Mur sans nom' : 'Unnamed Wall'));
      actionDesc = isFr
        ? `Modifier le mur`
        : `Modify the wall`;
      details = isFr
        ? `ID : ${args.id}\nNom d'origine : ${originalName || 'inconnu'}\nDépart : ${args.start_point ? JSON.stringify(args.start_point) : 'inchangé'}\nArrivée : ${args.end_point ? JSON.stringify(args.end_point) : 'inchangé'}\nÉpaisseur : ${args.thickness ?? 'inchangée'}\nHauteur : ${args.height ?? 'inchangée'}`
        : `ID: ${args.id}\nOriginal Name: ${originalName || 'unknown'}\nStart: ${args.start_point ? JSON.stringify(args.start_point) : 'unchanged'}\nEnd: ${args.end_point ? JSON.stringify(args.end_point) : 'unchanged'}\nThickness: ${args.thickness ?? 'unchanged'}\nHeight: ${args.height ?? 'unchanged'}`;
    } else if (name === 'connect_walls') {
      objectName = isFr ? 'Jonction de murs' : 'Wall junction';
      actionDesc = isFr ? 'Raccorder deux murs' : 'Connect two walls';
      details = 'First: ' + JSON.stringify(args.first) + '\nSecond: ' + JSON.stringify(args.second) + '\nPoint: ' + (args.point ? JSON.stringify(args.point) : 'midpoint');
    } else if (name === 'create_space') {
      objectName = String(args.name || (isFr ? 'Pièce sans nom' : 'Unnamed Room'));
      actionDesc = isFr
        ? `Créer une pièce`
        : `Create a room`;
      details = isFr
        ? `Polygone : ${JSON.stringify(args.polygon)}\nHauteur : ${args.height ?? 2.5} m`
        : `Polygon: ${JSON.stringify(args.polygon)}\nHeight: ${args.height ?? 2.5} m`;
    } else if (name === 'create_door') {
      objectName = String(args.name || (isFr ? 'Porte sans nom' : 'Unnamed Door'));
      actionDesc = isFr
        ? `Insérer une porte`
        : `Insert a door`;
      const hostWall = args.wall_id ? resolveId(String(args.wall_id)) : null;
      const hostWallName = hostWall ? (hostWall.Name || hostWall.name || hostWall.id) : args.wall_id;
      details = isFr
        ? `Mur hôte : "${hostWallName}"\nPosition relative (t) : ${args.position ?? 0.5}\nLargeur : ${args.width ?? 0.9} m\nHauteur : ${args.height ?? 2.1} m`
        : `Host Wall: "${hostWallName}"\nRelative position (t): ${args.position ?? 0.5}\nWidth: ${args.width ?? 0.9} m\nHeight: ${args.height ?? 2.1} m`;
    } else if (name === 'create_window') {
      objectName = String(args.name || (isFr ? 'Fenêtre sans nom' : 'Unnamed Window'));
      actionDesc = isFr
        ? `Insérer une fenêtre`
        : `Insert a window`;
      const hostWall = args.wall_id ? resolveId(String(args.wall_id)) : null;
      const hostWallName = hostWall ? (hostWall.Name || hostWall.name || hostWall.id) : args.wall_id;
      details = isFr
        ? `Mur hôte : "${hostWallName}"\nPosition relative (t) : ${args.position ?? 0.5}\nLargeur : ${args.width ?? 1.2} m\nHauteur : ${args.height ?? 1.2} m\nHauteur d'allège : ${args.sill_height ?? 0.9} m`
        : `Host Wall: "${hostWallName}"\nRelative position (t): ${args.position ?? 0.5}\nWidth: ${args.width ?? 1.2} m\nHeight: ${args.height ?? 1.2} m\nSill Height: ${args.sill_height ?? 0.9} m`;
    } else if (name === 'create_dimension') {
      objectName = String(args.name || (isFr ? 'Cotation sans nom' : 'Unnamed Dimension'));
      actionDesc = isFr
        ? `Ajouter une ligne de cotation`
        : `Add a dimension line`;
      details = `P1: ${JSON.stringify(args.p1)}\nP2: ${JSON.stringify(args.p2)}`;
    } else if (name === 'create_marker') {
      objectName = String(args.name || (isFr ? 'Jalon sans nom' : 'Unnamed Marker'));
      actionDesc = isFr
        ? `Créer un jalon de repère`
        : `Create a position marker`;
      const ptStr = args.point ? JSON.stringify(args.point) : JSON.stringify([args.x, args.y]);
      details = isFr
        ? `Coordonnées : ${ptStr}\nDescription : ${args.description ?? ''}`
        : `Coordinates: ${ptStr}\nDescription: ${args.description ?? ''}`;
    } else if (name === 'create_technical') {
      objectName = String(args.name || (isFr ? 'Élément technique sans nom' : 'Unnamed Technical Element'));
      actionDesc = isFr
        ? `Créer un élément technique`
        : `Create a technical element`;
      const ptStr = args.point ? JSON.stringify(args.point) : JSON.stringify([args.x, args.y]);
      details = isFr
        ? `Coordonnées : ${ptStr}\nDiscipline : ${args.discipline}\nCatégorie : ${args.category}\nModèle : ${args.model}\nHauteur : ${args.mount_height ?? args.mountHeight ?? 0.5} m`
        : `Coordinates: ${ptStr}\nDiscipline: ${args.discipline}\nCategory: ${args.category}\nModel: ${args.model}\nMount Height: ${args.mount_height ?? args.mountHeight ?? 0.5} m`;
    } else if (name === 'create_column' || name === 'update_column' || name === 'create_chimney' || name === 'update_chimney') {
      const isColumn = name.endsWith('_column'), isUpdate = name.startsWith('update_');
      const target = isUpdate && args.id ? resolveId(String(args.id)) : null;
      objectName = String(args.name || (target ? (target.Name || target.name) : '') || (isColumn ? (isFr ? 'Poteau' : 'Column') : (isFr ? 'Cheminée' : 'Chimney')));
      actionDesc = isColumn
        ? (isUpdate ? (isFr ? 'Modifier le poteau' : 'Modify the column') : (isFr ? 'Créer un poteau' : 'Create a column'))
        : (isUpdate ? (isFr ? 'Modifier la cheminée' : 'Modify the chimney') : (isFr ? 'Créer une cheminée' : 'Create a chimney'));
      const dims = ['shape', 'kind', 'width', 'depth', 'diameter', 'height'].filter(k => args[k] !== undefined).map(k => `${k}: ${args[k]}`).join(', ');
      details = `${args.point ? (isFr ? 'Coordonnées : ' : 'Coordinates: ') + JSON.stringify(args.point) : ''}${dims ? '\n' + dims : ''}`;
    } else if (name === 'update_technical') {
      const targetTech = args.id ? resolveId(String(args.id)) : null;
      const originalName = targetTech ? (targetTech.Name || targetTech.name) : null;
      objectName = String(args.name || originalName || (isFr ? 'Élément technique sans nom' : 'Unnamed Technical Element'));
      actionDesc = isFr
        ? `Modifier l'élément technique`
        : `Modify the technical element`;
      details = isFr
        ? `ID : ${args.id}\nNom d'origine : ${originalName || 'inconnu'}\nCoordonnées : ${args.point ? JSON.stringify(args.point) : 'inchangées'}\nHauteur : ${args.mount_height ?? args.mountHeight ?? 'inchangée'}`
        : `ID: ${args.id}\nOriginal Name: ${originalName || 'unknown'}\nCoordinates: ${args.point ? JSON.stringify(args.point) : 'unchanged'}\nMount Height: ${args.mount_height ?? args.mountHeight ?? 'unchanged'}`;
    } else if (name === 'delete_element') {
      const targetIds = (args.ids as string[] ?? [args.element_id as string]).filter(Boolean);
      const resolvedNames = targetIds
        .map(qid => {
          const found = resolveId(qid);
          return found ? (found.Name || found.name || found.type || qid) : qid;
        });
      objectName = resolvedNames.join(', ');
      actionDesc = isFr
        ? `Supprimer des éléments`
        : `Delete elements`;
      details = isFr
        ? `ID des éléments à supprimer : ${JSON.stringify(args.ids ?? [args.element_id])}`
        : `IDs of elements to delete: ${JSON.stringify(args.ids ?? [args.element_id])}`;
    } else {
      if (args.name) objectName = String(args.name);
      actionDesc = `${isFr ? 'Exécuter l\'action' : 'Execute action'}: ${name}`;
      details = JSON.stringify(args, null, 2);
    }

    const draft = pendingConfirm.draftId ? items[pendingConfirm.draftId] : undefined;
    if (draft?.type === 'Door' || draft?.type === 'Window') {
      const opening = draft as IfcDoorEntity | IfcWindowEntity;
      const g = opening.geom;
      details = `${isFr ? 'Type' : 'Type'}: ${opening.OperationType ?? ''}\n${isFr ? 'Largeur / hauteur' : 'Width / height'}: ${g.width} / ${g.height} m\n${isFr ? 'Charnière vers' : 'Hinge toward'}: ${g.swing === 'right' ? (isFr ? 'fin du mur' : 'wall end') : (isFr ? 'début du mur' : 'wall start')}\n${isFr ? 'Côté du mur' : 'Wall side'}: ${g.side ?? 1}\n${isFr ? 'Position sur le mur' : 'Wall position'}: ${g.t}`;
    } else if (draft?.type === 'Furniture') {
      const g = (draft as any).geom;
      details = `${isFr ? 'Modèle' : 'Model'}: ${(draft as any).model}\n${isFr ? 'Centre' : 'Centre'}: [${(g.x + g.w / 2).toFixed(3)}, ${(g.y + g.d / 2).toFixed(3)}] m\n${isFr ? 'Rotation' : 'Rotation'}: ${(g.rotation * 180 / Math.PI).toFixed(1)}°\n${isFr ? 'Largeur / profondeur' : 'Width / depth'}: ${g.w} / ${g.d} m`;
    }

    const handleMouseDown = (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      
      isDraggingRef.current = true;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      posStartRef.current = popupPos;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const dx = moveEvent.clientX - dragStartRef.current.x;
        const dy = moveEvent.clientY - dragStartRef.current.y;
        
        const newX = Math.max(10, posStartRef.current.x + dx);
        const newY = Math.max(10, posStartRef.current.y + dy);
        
        setPopupPos({ x: newX, y: newY });
      };

      const handleMouseUp = () => {
        isDraggingRef.current = false;
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    };

    return (
      <div 
        className="scrim-floating-mcp" 
        style={{ 
          position: 'fixed', 
          top: `${popupPos.y}px`, 
          left: `${popupPos.x}px`, 
          zIndex: 9999, 
          pointerEvents: 'none', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          animation: 'fadeIn 0.2s ease-out'
        }}
      >
        <div 
          className="modal" 
          style={{ 
            width: '440px', 
            background: 'var(--bg)', 
            border: '1.5px solid var(--accent)', 
            borderRadius: '12px', 
            boxShadow: '0 20px 45px rgba(0,0,0,0.4)',
            display: 'flex', 
            flexDirection: 'column', 
            overflow: 'hidden',
            pointerEvents: 'auto',
            animation: 'scaleUp 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)'
          }}
        >
          {/* Modal Header */}
          <div 
            className="modal-head" 
            onMouseDown={handleMouseDown}
            style={{ 
              padding: '16px 20px', 
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              cursor: 'grab',
              userSelect: 'none'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>🤖</span>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--ink)' }}>
                {isFr ? 'Validation de l\'action IA' : 'Confirm AI Action'}
              </h3>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--ink-3)' }}>
              {isFr ? 'L\'Assistant IA demande l\'autorisation d\'exécuter :' : 'The AI Assistant requests permission to execute:'}
            </div>
          </div>

          {/* Modal Body */}
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div 
              style={{ 
                fontSize: '13px', 
                fontWeight: 600, 
                color: 'var(--accent)', 
                background: 'rgba(59, 130, 246, 0.1)',
                padding: '10px 14px',
                borderRadius: '6px',
                borderLeft: '3px solid var(--accent)'
              }}
            >
              {actionDesc}
            </div>

            {objectName && (
              <div 
                style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '6px',
                  background: 'var(--panel-2, #181818)',
                  border: '1px solid var(--border-faint)',
                  padding: '10px 14px',
                  borderRadius: '6px'
                }}
              >
                <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--ink-3, #888)' }}>
                  {isFr ? "Nom de l'objet :" : "Object name:"}
                </span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink, #fff)' }}>
                  {objectName}
                </span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--ink-2)' }}>
                {isFr ? 'Détails techniques :' : 'Technical Details:'}
              </span>
              <pre 
                style={{ 
                  margin: 0, 
                  padding: '10px', 
                  background: 'var(--panel-2, #181818)', 
                  border: '1px solid var(--border-faint)', 
                  borderRadius: '6px', 
                  fontSize: '11px', 
                  fontFamily: 'var(--font-mono)', 
                  color: 'var(--ink-2)', 
                  maxHeight: '120px', 
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all'
                }}
              >
                {details}
              </pre>
            </div>

            {/* Always Validate Toggle */}
            {setAlwaysValidate && name !== 'apply_model_batch' && (
              <div 
                onClick={() => setAlwaysValidate(!alwaysValidate)}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px', 
                  cursor: 'pointer',
                  fontSize: '11px',
                  color: 'var(--ink-2)',
                  userSelect: 'none',
                  marginTop: '4px'
                }}
              >
                <input 
                  type="checkbox" 
                  checked={alwaysValidate ?? true} 
                  onChange={() => {}} 
                  style={{ cursor: 'pointer' }}
                />
                <span>{isFr ? "Toujours demander confirmation pour l'IA" : "Always ask for confirmation before AI actions"}</span>
              </div>
            )}

            {/* Remark / Feedback Field */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--ink-2)' }}>
                {isFr ? 'Motif de refus (optionnel, pour guider l\'IA) :' : 'Reason for rejection (optional, to guide the AI):'}
              </span>
              <input 
                type="text" 
                placeholder={isFr ? "Ex: Déplacer de 1m vers la droite, agrandir la dalle..." : "e.g. Move 1m right, enlarge slab..."}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                style={{ 
                  padding: '8px 12px', 
                  background: 'var(--panel-2, #181818)', 
                  border: '1px solid var(--border-faint)', 
                  borderRadius: '6px', 
                  fontSize: '12px', 
                  color: 'var(--ink)', 
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
              />
            </div>
          </div>

          {/* Modal Footer */}
          <div 
            style={{ 
              padding: '12px 20px', 
              background: 'var(--panel-2, #181818)', 
              borderTop: '1px solid var(--border-faint)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '12px'
            }}
          >
            {pendingConfirm.draftId && (
              <button 
                className="btn secondary" 
                onClick={() => {
                  const draftId = pendingConfirm.draftId;
                  if (draftId && hRef.current.setSelection) {
                    hRef.current.setSelection([draftId]);
                    setTimeout(() => {
                      if (hRef.current.triggerFit) {
                        hRef.current.triggerFit();
                      }
                    }, 50);
                  }
                }}
                style={{ 
                  padding: '6px 14px', 
                  fontSize: '12px',
                  marginRight: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                🔍 {isFr ? 'Recadrer' : 'Re-center'}
              </button>
            )}
            <button 
              className="btn secondary" 
              onClick={handleReject}
              style={{ padding: '6px 14px', fontSize: '12px' }}
            >
              {isFr ? 'Refuser' : 'Reject'}
            </button>
            <button 
              className="btn" 
              onClick={handleAccept}
              style={{ 
                padding: '6px 16px', 
                fontSize: '12px',
                background: 'linear-gradient(135deg, var(--accent) 0%, #3c7bfd 100%)',
                color: '#fff',
                border: 'none'
              }}
            >
              {isFr ? 'Accepter' : 'Accept'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return { pending: pendingQueue.length > 0, renderConfirmDialog, execute };
}
