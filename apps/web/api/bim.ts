import { readBody } from './_lib/boundedBody.js';
import { mcpSettings } from '../server/bim/mcpSettings.js';
import { InputError, record, finiteData } from '@skaitch/core/bim/validation';
import { isEngineOperation, runBimOperation } from '@skaitch/core/bim/dispatch';
import { readStoredProject, listStoredProjects, writeStoredProject, deleteStoredProject } from '../server/bim/projectStore.js';
import { gzipSync } from 'node:zlib';
import { authenticateSession } from './_lib/sessionAuth.js';
import { withUsage } from './_lib/usage.js';
import { BIM_BODY_LIMIT, BIM_WIRE_LIMIT } from '@skaitch/core/types/bim';

const operations = new Set(['import-ifc', 'export-ifc', 'patch-ifc', 'check-ifc', 'fix-ifc', 'mcp-model', 'mcp-batch', 'project-list', 'project-read', 'project-write', 'project-delete', 'mcp-read', 'mcp-settings', 'export-json', 'export-dxf']);
export default withUsage('bim', async function handler(req: any, res: any, usage) {
  res.setHeader('Cache-Control', 'private, no-store');
  const fail = (status: number, error: string) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error }));
  };
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return fail(405, 'Méthode non autorisée.'); }
  try {
    if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) return fail(403, 'Requête intersite refusée.');
  } catch { return fail(403, 'Origine invalide.'); }
  let uid: string | null;
  try { uid = await authenticateSession(req.headers.authorization); }
  catch { return fail(503, 'Authentification BIM non configurée.'); }
  const operation = new URL(req.url, 'http://bim.local').searchParams.get('operation');
  usage.operation = operations.has(operation || '') ? operation : 'unknown';
  if (!uid) { usage.authRejected = true; return fail(401, 'Session Firebase requise ou expirée.'); }
  usage.uid = uid;
  if (!operations.has(operation || '')) return fail(400, 'Opération BIM inconnue.');
  try {
    const bytes = await readBody(req);
    let result: unknown;
    if (isEngineOperation(operation)) {
      if (operation === 'import-ifc') result = await runBimOperation(operation, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      else {
        let payload: unknown;
        try { payload = JSON.parse(bytes.toString('utf8')); } catch { throw new InputError('JSON BIM invalide.'); }
        result = await runBimOperation(operation, payload);
      }
    } else {
      let payload: unknown;
      try { payload = JSON.parse(bytes.toString('utf8')); } catch { throw new InputError('JSON BIM invalide.'); }
      finiteData(payload);
      if (operation === 'mcp-settings') result = await mcpSettings(uid, record(payload));
      else if (operation === 'project-read') result = await readStoredProject(uid, record(payload).id);
      else if (operation === 'project-list') result = await listStoredProjects(uid);
      else if (operation === 'project-write') {
        const data = record(payload);
        result = await writeStoredProject(uid, data.id, record(data.patch), data.expectedRevision);
      } else if (operation === 'project-delete') {
        const data = record(payload);
        await deleteStoredProject(uid, data.id, data.expectedRevision);
        result = { success: true };
      }
    }
    finiteData(result);
    const compressed = gzipSync(Buffer.from(JSON.stringify(result)));
    if (compressed.length > BIM_WIRE_LIMIT) throw new InputError('Résultat BIM supérieur à 4 Mo après compression.', 413);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Encoding', 'gzip');
    res.end(compressed);
  } catch (error) {
    if (error instanceof InputError) return fail(error.status, error.message);
    console.error('[BIM server]', error);
    if (operation.startsWith('project-') || operation === 'mcp-settings') return fail(503, 'Service de sauvegarde indisponible. Réessayez sans fermer le projet.');
    return fail(400, 'Traitement BIM impossible : vérifiez le fichier et les géométries du modèle.');
  }
});
