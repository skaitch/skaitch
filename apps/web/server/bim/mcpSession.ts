import { hydrateProject } from './projectModel.js';
import { listedProjects } from '@skaitch/core/lib/projectArchive';
import { getAiPreferences } from '../ai/preferences.js';
import { aiCredentials, resolveAiCredentials } from '../ai/vault.js';
import { renderAi, validateRenderArgs } from '../ai/render.js';
import { findCredential, localAiEndpoint } from '@skaitch/core/lib/aiCredentialTarget';
import type { AiPreferences } from '../../src/lib/aiPreferences.js';
import { createHash } from 'node:crypto';
import { getAdminDb } from '../../api/_lib/admin.js';
import { authorizeMcpTool } from '@skaitch/core/lib/mcpPermissions';
import { MCP_MODEL_TOOLS, MCP_READ_TOOLS } from '@skaitch/core/types/bim';
import { BUILTIN_CATALOGUE } from '@skaitch/core/data/elementCatalogue';
import { deleteModelItems } from '@skaitch/core/lib/deleteModelItems';
import { generateThumbnailSvg } from '@skaitch/core/lib/thumbnail';
import { computeMcpBatch } from '@skaitch/core/bim/mcpBatch';
import { computeMcpModel } from '@skaitch/core/bim/mcpModel';
import { readMcpModel } from '@skaitch/core/bim/mcpRead';
import { readStoredProject, writeStoredProject, type StoredProject } from './projectStore.js';
import { InputError, record, finiteData, validateItems } from '@skaitch/core/bim/validation';

export interface CloudRenderApproval {
  projectId: string; contextRevision: number; settingsRevision: number; preferencesRevision: number; modelRevision: number;
  credentialId: string; credentialVersion: number;
}
interface CloudBatchApproval {
  batch: true; projectId: string; storeyId: string; contextRevision: number; modelRevision: number;
}
type CloudApproval = CloudRenderApproval | CloudBatchApproval;

export type CloudToolResult = { handled: true; result: unknown } | {
  handled: false; projectId: string; storeyId: string; forceConfirm: boolean;
  approvalOnly?: boolean; batchSummary?: { added: number; updated: number }; aiPreferences?: AiPreferences; confirmationContext?: CloudApproval;
};

/** The API key scopes both grants and context; the browser's selected project is unrelated. */
export async function executeCloudTool(uid: string, apiKey: string, name: string, input: unknown, approval?: CloudApproval, signal?: AbortSignal): Promise<CloudToolResult> {
  const args = record(input);
  finiteData(args);
  if (!apiKey || apiKey.includes('/')) throw new InputError('Invalid API key');
  const db = getAdminDb();
  const keyRef = db.doc(`users/${uid}/apiKeys/${apiKey}`);
  const settingsRef = db.doc(`users/${uid}/metadata/mcp`);
  const sessionRef = db.doc(`users/${uid}/mcp_sessions/${createHash('sha256').update(apiKey).digest('hex')}`);
  const access = async (get = (ref: any) => ref.get()) => {
    const [key, settings, session] = await Promise.all([get(keyRef), get(settingsRef), get(sessionRef)]);
    if (!key.exists) throw new InputError('Invalid or revoked API key', 403);
    if (settings.data()?.enabled === false) throw new InputError('MCP disabled in settings', 403);
    return { grant: key.data(), settings: settings.data() ?? {}, context: session.data() ?? {} };
  };
  const state = await access();
  if (name === 'list_projects') {
    const projects = await db.collection(`users/${uid}/projects`).get();
    const result = listedProjects(projects.docs.filter(snapshot => ['read', 'write'].includes(state.grant.accountAccess || state.grant.permissions?.[snapshot.id]))
      .map(snapshot => { const data = snapshot.data(); return { id: snapshot.id, name: data.name, description: data.description || '', createdAt: data.createdAt, updatedAt: data.updatedAt, ...(data.archivedAt ? { archivedAt: data.archivedAt as string } : {}) }; }), args);
    return { handled: true, result };
  }
  const projectId = name === 'select_project' ? args.project_id : state.context.projectId;
  if (typeof projectId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(projectId)) throw new InputError('Select a project first with select_project.');
  authorizeMcpTool(name, args, projectId, state.grant.permissions ?? {}, state.grant.accountAccess);
  const projectRef = db.doc(`users/${uid}/projects/${projectId}`);
  const project = await projectRef.get();
  if (!project.exists) throw new InputError('Project not found', 404);
  const stored = project.data()!.modelChunks ? await readStoredProject(uid, projectId) : project.data() as StoredProject;
  if (!stored) throw new InputError('Project not found', 404);
  const items = validateItems(JSON.parse(stored.itemsJson));
  finiteData(items);
  const catalogue = stored.catalogue ?? BUILTIN_CATALOGUE;
  const firstStorey = Object.values(items).find(i => i.type === 'Storey')?.id ?? '';
  const storeyId = items[state.context.storeyId]?.type === 'Storey' ? state.context.storeyId : firstStorey;
  const checkCurrent = async (tx: any) => {
    const current = await access(ref => tx.get(ref));
    authorizeMcpTool(name, args, projectId, current.grant.permissions ?? {}, current.grant.accountAccess);
    if ((current.context.revision ?? 0) !== (state.context.revision ?? 0)) throw new InputError('MCP selection changed. Retry the command.', 409);
    return current;
  };
  if (name === 'select_project' || name === 'select_storey') {
    const selectedStorey = name === 'select_storey' ? String(args.storey_id) : firstStorey;
    await db.runTransaction(async tx => {
      await checkCurrent(tx);
      const latest = await tx.get(projectRef);
      if (!latest.exists) throw new InputError('Project not found', 404);
      const latestItems = JSON.parse((await hydrateProject(uid, projectId, latest.data()!, tx)).itemsJson);
      if (name === 'select_storey' && latestItems[selectedStorey]?.type !== 'Storey') throw new InputError('Storey not found');
      tx.set(sessionRef, { projectId, storeyId: selectedStorey, revision: (state.context.revision ?? 0) + 1 });
    });
    return { handled: true, result: { success: true, project_id: projectId, storey_id: selectedStorey } };
  }
  if (MCP_READ_TOOLS.includes(name)) return { handled: true, result: readMcpModel(name, args, items, catalogue) };
  if (name === 'get_wall_connections') return { handled: true, result: computeMcpModel(name, args, items, storeyId, catalogue).result };
  if (name === 'execute_script') {
    return { handled: false, projectId, storeyId, forceConfirm: false };
  }
  if (name === 'apply_model_batch') {
    const context: CloudBatchApproval = { batch: true, projectId, storeyId,
      contextRevision: state.context.revision ?? 0, modelRevision: stored.modelRevision ?? 0 };
    if (approval && JSON.stringify(approval) !== JSON.stringify(context)) {
      throw new InputError('Le projet ou la sélection a changé depuis l’aperçu. Relancez le lot.', 409);
    }
    const batch = computeMcpBatch(args, items, storeyId, catalogue, state.settings.lang);
    if (!approval && state.settings.alwaysValidate === true) return {
      handled: false, projectId, storeyId, forceConfirm: true, approvalOnly: true, confirmationContext: context,
      batchSummary: { added: batch.result.added, updated: batch.result.updated },
    };
    signal?.throwIfAborted();
    const saved = await writeStoredProject(uid, projectId, {
      itemsJson: JSON.stringify(batch.items), name: stored.name,
      thumbnailSvg: generateThumbnailSvg(batch.items), updatedAt: new Date().toISOString(),
    }, context.modelRevision, async tx => {
      signal?.throwIfAborted();
      await checkCurrent(tx);
    });
    return { handled: true, result: { ...batch.result, model_revision: saved.modelRevision } };
  }
  if (name === 'generate_visualization') {
    validateRenderArgs(args);
    const saved = await getAiPreferences(uid);
    if (!saved.config) throw new InputError('Enregistrez les préférences IA du compte avant de demander un rendu MCP.');
    const config = saved.config;
    const renderBase = config.visualizerBaseUrl || (config.visualizerProvider === config.provider ? config.baseUrl : undefined);
    if (config.visualizerProvider === 'custom' && localAiEndpoint('custom', renderBase || 'http://localhost:11434')) {
      return { handled: false, projectId, storeyId, forceConfirm: state.settings.alwaysValidate === true, aiPreferences: config };
    }
    const credentials = await aiCredentials(uid, { action: 'list' }) as import('@skaitch/core/lib/aiCredentialTarget').AiCredentialMeta[];
    const chatKey = findCredential(credentials, 'chat', config.provider, config.baseUrl);
    const renderKey = findCredential(credentials, 'render', config.visualizerProvider, renderBase);
    const selectedKey = renderKey || (config.visualizerProvider === config.provider ? chatKey : undefined);
    if (['gemini','openai','fal','replicate'].includes(config.visualizerProvider) && !selectedKey) throw new InputError('Enregistrez la clé du fournisseur de rendu dans les réglages IA.');
    const context: CloudRenderApproval = { projectId, contextRevision: state.context.revision ?? 0, settingsRevision: state.settings.revision ?? 0,
      preferencesRevision: saved.revision, modelRevision: stored.modelRevision ?? 0, credentialId: selectedKey?.id ?? '', credentialVersion: selectedKey?.version ?? 0 };
    if (approval && JSON.stringify(approval) !== JSON.stringify(context)) throw new InputError('Le projet, les réglages ou la clé du rendu ont changé. Relancez la demande.', 409);
    const resolved = await resolveAiCredentials(uid, { ...config, apiKey: '', apiKeyRef: chatKey?.id, visualizerKeyRef: renderKey?.id }, 'render');
    if (state.settings.alwaysValidate === true && !approval) return { handled: false, projectId, storeyId, forceConfirm: true, approvalOnly: true, aiPreferences: config, confirmationContext: context };
    await db.runTransaction(async tx => {
      await checkCurrent(tx);
      const [latestProject, latestPreferences] = await Promise.all([tx.get(projectRef), tx.get(db.doc(`users/${uid}/metadata/ai`))]);
      if (!latestProject.exists || (latestProject.data()!.modelRevision ?? 0) !== context.modelRevision || latestPreferences.data()?.revision !== context.preferencesRevision) throw new InputError('Le modèle ou les préférences IA ont changé. Relancez la demande.', 409);
      if (selectedKey) {
        const latestKey = await tx.get(db.doc(`users/${uid}/ai_credentials/${selectedKey.id}`));
        if (!latestKey.exists || latestKey.data()!.version !== context.credentialVersion) throw new InputError('La clé du rendu a changé. Relancez la demande.', 409);
      }
      const settings = await tx.get(settingsRef);
      if ((settings.data()?.revision ?? 0) !== context.settingsRevision) throw new InputError('La validation MCP a changé. Relancez la demande.', 409);
    });
    signal?.throwIfAborted();
    return { handled: true, result: await renderAi(args, items, resolved, signal) };
  }
  if (!MCP_MODEL_TOOLS.includes(name) || state.settings.alwaysValidate === true) {
    return { handled: false, projectId, storeyId, forceConfirm: MCP_MODEL_TOOLS.includes(name) };
  }
  if (args.storey_id !== undefined && items[String(args.storey_id)]?.type !== 'Storey') throw new InputError('Storey not found');
  const computed = computeMcpModel(name, args, items, storeyId, catalogue, state.settings.lang);
  if ((computed.result as any)?.error) return { handled: true, result: computed.result };
  let next = { ...items };
  for (const change of computed.changes) {
    if (change.kind === 'add') next[change.item.id] = change.item;
    else if (change.kind === 'update') next[change.id] = { ...next[change.id], ...change.patch } as any;
    else if (change.kind === 'delete') next = deleteModelItems(next, change.ids);
  }
  finiteData(next);
  validateItems(next);
  const modelProject = Object.values(next).find(item => item.type === 'Project');
  const saved = await writeStoredProject(uid, projectId, {
    itemsJson: JSON.stringify(next), name: modelProject?.name ?? stored.name,
    thumbnailSvg: generateThumbnailSvg(next), updatedAt: new Date().toISOString(),
  }, stored.modelRevision ?? 0, async tx => {
    const current = await checkCurrent(tx);
    if (current.settings.alwaysValidate === true || (current.settings.revision ?? 0) !== (state.settings.revision ?? 0)) throw new InputError('MCP confirmation settings changed. Retry the command.', 409);
  });
  return { handled: true, result: { ...(computed.result as object), model_revision: saved.modelRevision } };
}
