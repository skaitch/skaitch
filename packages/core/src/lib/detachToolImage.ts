/** Data URLs shorter than this are kept inline (icons, tiny swatches). */
const MIN_DETACHED_LENGTH = 1000;
export const DETACHED_IMAGE = '[Image attached to the next request]';

/**
 * Tool results go back to the model as text. An image inside them (capture_view's image_url,
 * get_storey_floorplan's plan.url…) would cost ~100k tokens as base64 text, so it is replaced
 * by a placeholder and returned apart, to be sent as a real image with the next request.
 * Only the first image is kept: a request carries one image.
 */
export function detachToolImage(result: unknown): { result: unknown; image: string | null } {
  let image: string | null = null;
  const walk = (value: unknown, depth: number): unknown => {
    if (typeof value === 'string') {
      if (value.length < MIN_DETACHED_LENGTH || !/^data:image\/[a-z+.-]+;base64,/i.test(value)) return value;
      image ??= value;
      return DETACHED_IMAGE;
    }
    if (!value || typeof value !== 'object' || depth > 8) return value;
    if (Array.isArray(value)) return value.map(item => walk(item, depth + 1));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, depth + 1)]));
  };
  return { result: walk(result, 0), image };
}
