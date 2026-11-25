import type { ItemsMap } from '@skaitch/core/types/ifc';
import { requestBim } from './bimService';
export function patchIFC(items: ItemsMap, originalBuffer: ArrayBuffer, centerOffset?: [number, number]): Promise<string> {
  return requestBim('patch-ifc', { items, ifcText: new TextDecoder().decode(originalBuffer), centerOffset });
}
