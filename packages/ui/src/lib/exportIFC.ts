import type { ItemsMap } from '@skaitch/core/types/ifc';
import { requestBim } from './bimService';
import { patchIFC } from './patchIFC';
import { triggerFileDownload } from './exportFormats';
import { strToU8, zipSync } from 'fflate';
import { ifcPhotoFiles } from '@skaitch/core/survey/ifcPhotos';

export function exportIFC(items: ItemsMap): Promise<string> {
  return requestBim('export-ifc', { items });
}

export async function downloadIFC(items: ItemsMap, buffer: ArrayBuffer | null, filename = 'export.ifc', centerOffset?: [number, number]) {
  const content = buffer ? await patchIFC(items, buffer, centerOffset) : await exportIFC(items);
  // Survey photos referenced by the model travel beside it, in one archive (ADR 0010).
  const photos = buffer ? {} : ifcPhotoFiles(items);
  if (!Object.keys(photos).length) { triggerFileDownload(content, filename, 'application/x-step'); return; }
  const zip = zipSync({ [filename]: strToU8(content), ...Object.fromEntries(Object.entries(photos).map(([k, v]) => [k, [v, { level: 0 }] as [Uint8Array, { level: 0 }]])) });
  triggerFileDownload(new Blob([zip as BlobPart], { type: 'application/zip' }), `${filename.replace(/\.ifc$/i, '')}.ifc.zip`, 'application/zip');
}
