import { PHOTO_MAX_SIDE } from '@skaitch/core/survey/surveyFile';

/**
 * Re-encodes a picked or captured image as JPEG, 2048 px at most (ADR 0010). Drawing it on a
 * canvas applies the EXIF orientation and drops every metadata (GPS position, device).
 */
export async function reencodePhoto(file: Blob, maxSide = PHOTO_MAX_SIDE, quality = 0.85): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * k), height = Math.round(bitmap.height * k);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Image illisible.'))), 'image/jpeg', quality));
  return { blob, width, height };
}
