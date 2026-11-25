import type { BimService } from '@skaitch/core/lib/bimService';
import type { BimOperation } from '@skaitch/core/types/bim';

let service: BimService | null = null;

/** The host app registers its BIM engine once, before the first render. */
export function provideBimService(next: BimService) {
  service = next;
}

export function requestBim<T>(operation: BimOperation, data: unknown): Promise<T> {
  if (!service) throw new Error('Moteur BIM non configuré : appelez provideBimService au démarrage de l’application.');
  return service.request<T>(operation, data);
}
