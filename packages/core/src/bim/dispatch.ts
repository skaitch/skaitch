import { exportToBimJSON, exportToDXF } from './exportFormats.js';
import { readMcpModel } from './mcpRead.js';
import { computeMcpBatch } from './mcpBatch.js';
import { computeMcpModel } from './mcpModel.js';
import { importIFCBuffer } from './importIFC.js';
import { importBimwiq } from './importBimwiq.js';
import { exportIFC } from './exportIFC.js';
import { patchIFC } from './patchIFC.js';
import { checkRoundTrip, fixRoundTripProblems } from './roundTripCheck.js';
import { InputError, record, finiteData, validateItems, validateCatalogue } from './validation.js';
import { MCP_MODEL_TOOLS, MCP_READ_TOOLS, type BimOperation } from '../types/bim.js';
import type { ItemsMap } from '../types/ifc.js';

/** Operations computed by the BIM engine alone, without any storage. */
export const ENGINE_OPERATIONS = ['import-ifc', 'import-bimwiq', 'export-ifc', 'patch-ifc', 'check-ifc', 'fix-ifc', 'mcp-model', 'mcp-read', 'mcp-batch', 'export-json', 'export-dxf'] as const;
export type EngineOperation = typeof ENGINE_OPERATIONS[number];

export function isEngineOperation(operation: string | null | undefined): operation is EngineOperation {
  return (ENGINE_OPERATIONS as readonly string[]).includes(operation ?? '');
}

const MAX_IMPORTED_ITEMS = 20_000;

/**
 * Runs one engine operation with the same validation for every host (web server API,
 * desktop main process). `input` is the IFC bytes for `import-ifc` and the JSON payload otherwise.
 * Throws InputError for invalid input.
 */
export async function runBimOperation(operation: EngineOperation | BimOperation, input: Uint8Array | unknown): Promise<unknown> {
  if (!isEngineOperation(operation)) throw new InputError('Opération BIM inconnue.');
  let result: unknown;
  if (operation === 'import-ifc') {
    if (!(input instanceof Uint8Array)) throw new InputError('Fichier IFC invalide.');
    const header = new TextDecoder('latin1').decode(input.subarray(0, 1024));
    if (!header.includes('ISO-10303-21;')) throw new InputError('En-tête IFC STEP invalide.');
    const buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
    const imported = await importIFCBuffer(buffer);
    result = { items: imported.items, rawStructure: imported.rawStructure, centerOffset: imported.centerOffset };
  } else {
    finiteData(input);
    if (operation === 'import-bimwiq') result = importBimwiq(input);
    else {
      const data = record(input);
      const items = validateItems(data.items);
      if (data.ifcText != null && typeof data.ifcText !== 'string') throw new InputError('Texte IFC invalide.');
      if (data.centerOffset !== undefined && (!Array.isArray(data.centerOffset) || data.centerOffset.length !== 2 || !data.centerOffset.every((n: unknown) => typeof n === 'number' && Number.isFinite(n)))) throw new InputError('Décalage IFC invalide.');
      switch (operation) {
        case 'mcp-batch':
          if (typeof data.focusStorey !== 'string') throw new InputError('Contexte MCP invalide.');
          validateCatalogue(data.catalogue);
          result = computeMcpBatch(data.args, items, data.focusStorey, data.catalogue, data.lang);
          break;
        case 'mcp-read':
        case 'mcp-model': {
          if (typeof data.name !== 'string' || !(operation === 'mcp-read' ? MCP_READ_TOOLS : MCP_MODEL_TOOLS).includes(data.name)) throw new InputError('Outil de modèle inconnu.');
          if (operation === 'mcp-model' && typeof data.focusStorey !== 'string') throw new InputError('Contexte MCP invalide.');
          validateCatalogue(data.catalogue);
          if (operation === 'mcp-read') { result = readMcpModel(data.name, record(data.args), items, data.catalogue); break; }
          const computed = computeMcpModel(data.name, record(data.args), items, data.focusStorey, data.catalogue, data.lang);
          const next = { ...items };
          for (const change of computed.changes) {
            if (change.kind === 'add') next[change.item.id] = change.item;
            else if (change.kind === 'update') next[change.id] = { ...next[change.id], ...change.patch } as ItemsMap[string];
          }
          validateItems(next);
          result = computed;
          break;
        }
        case 'export-json':
        case 'export-dxf':
          if (typeof data.projectName !== 'string' || data.projectName.length > 256 || operation === 'export-json' && typeof data.projectId !== 'string') throw new InputError('Projet d’export invalide.');
          result = operation === 'export-json' ? exportToBimJSON(items, data.projectId, data.projectName) : exportToDXF(items, data.projectName); break;
        case 'export-ifc': result = exportIFC(items); break;
        case 'patch-ifc':
          if (!data.ifcText) throw new InputError('IFC d’origine requis.');
          result = await patchIFC(items, new TextEncoder().encode(data.ifcText).buffer, data.centerOffset); break;
        case 'check-ifc': result = checkRoundTrip(items, data.ifcText); break;
        case 'fix-ifc': result = fixRoundTripProblems(items); break;
      }
    }
  }
  if (operation.startsWith('import-') && Object.keys((result as any).items).length > MAX_IMPORTED_ITEMS) throw new InputError('Modèle limité à 20 000 éléments.', 413);
  finiteData(result);
  return result;
}
