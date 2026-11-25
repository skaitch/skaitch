import { requestBim } from './bimService';
import type { ImportResult } from '@skaitch/core/types/bim';
export function importBimwiq(data: unknown): Promise<ImportResult> {
  return requestBim('import-bimwiq', data);
}
