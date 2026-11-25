export interface ImageCrop { x: number; y: number; width: number; height: number }

export function clampImageCrop(crop: ImageCrop, width: number, height: number): ImageCrop {
  if (![width, height, ...Object.values(crop)].every(Number.isFinite) || width < 1 || height < 1) {
    throw new Error('Invalid image dimensions');
  }
  const x = Math.max(0, Math.min(width - 1, Math.round(crop.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(crop.y)));
  return {
    x, y,
    width: Math.max(1, Math.min(width - x, Math.round(crop.width))),
    height: Math.max(1, Math.min(height - y, Math.round(crop.height))),
  };
}

export function imageCropFromPoints(a: [number, number], b: [number, number], width: number, height: number): ImageCrop {
  const x1 = Math.max(0, Math.min(width, Math.round(a[0])));
  const y1 = Math.max(0, Math.min(height, Math.round(a[1])));
  const x2 = Math.max(0, Math.min(width, Math.round(b[0])));
  const y2 = Math.max(0, Math.min(height, Math.round(b[1])));
  return clampImageCrop({ x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }, width, height);
}

/** Only the selected pixels are persisted; the original image stays in memory until the dialog closes. */
export function cropPlanImage(image: HTMLImageElement, selection: ImageCrop) {
  const crop = clampImageCrop(selection, image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = crop.width;
  canvas.height = crop.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  const url = canvas.toDataURL('image/png');
  if (!url.startsWith('data:image/png')) throw new Error('Image export failed');
  return { url, w: crop.width, h: crop.height };
}
