import { serverRequest } from './serverRequest';
import type { BimOperation } from '@skaitch/core/types/bim';
import type { BimService } from '@skaitch/core/lib/bimService';

/** BIM engines have no browser fallback. */
export async function requestBim<T>(operation: BimOperation, data: unknown): Promise<T> {
  return (await serverRequest(`/api/bim?operation=${operation}`, data)).json();
}

/** The web app's BIM engine: the authenticated server API. */
export const httpBimService: BimService = { request: requestBim };
