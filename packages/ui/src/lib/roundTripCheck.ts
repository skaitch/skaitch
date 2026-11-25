import type { ItemsMap } from '@skaitch/core/types/ifc';
import type { RoundTripResult } from '@skaitch/core/types/bim';
import { requestBim } from './bimService';
export type { RoundTripResult } from '@skaitch/core/types/bim';

export function checkRoundTrip(items: ItemsMap, rawIfcText?: string | null): Promise<RoundTripResult> {
  return requestBim('check-ifc', { items, ifcText: rawIfcText });
}
export function fixRoundTripProblems(items: ItemsMap): Promise<ItemsMap> {
  return requestBim('fix-ifc', { items });
}
