import { requestBim } from './bimService';
import type { ImportProgress, ImportResult } from '@skaitch/core/types/bim';
export type { ImportProgress, ImportResult, IfcMeshGeometry } from '@skaitch/core/types/bim';

export async function importIFCBuffer(buffer: ArrayBuffer, onProgress?: (progress: ImportProgress) => void): Promise<ImportResult> {
  onProgress?.({ phase: 'Import IFC sur le serveur…', pct: 10 });
  const result = await requestBim<ImportResult>('import-ifc', buffer);
  onProgress?.({ phase: 'Terminé', pct: 100 });
  // The browser viewer renders the original IFC; no duplicate mesh payload is needed.
  return { ...result, rawIfcBuffer: buffer };
}
