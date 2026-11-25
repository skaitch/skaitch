import type { ItemsMap } from '../types/ifc.js';
import { photosForElement } from './reconstruct.js';

/** Where an exported IFC references a survey photo, relative to the IFC file (ADR 0010). */
export const surveyPhotoPath = (photoId: string) => `photos/${photoId}.jpg`;

/**
 * Image files to deliver beside an IFC export: every survey photo an exported wall or space
 * references, at `surveyPhotoPath(id)` (the reduced copies kept in the project).
 */
export function ifcPhotoFiles(items: ItemsMap): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const item of Object.values(items)) {
    if (item.type !== 'Wall' && item.type !== 'Room') continue;
    for (const photo of photosForElement(items, item.id)) {
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(photo.url);
      if (!m) continue;
      const bin = atob(m[1]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      files[surveyPhotoPath(photo.id)] = bytes;
    }
  }
  return files;
}
