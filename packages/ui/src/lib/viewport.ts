import type { MutableRefObject } from 'react';
import { MCP_PLAN_MAX_SIDE, mcpPlanImageCalibration, mcpPlanImageSize, type PlanCalibration } from '@skaitch/core/lib/planImage';

export { MCP_PLAN_MAX_SIDE };

export interface ViewRequest {
  view?: '2d' | '3d';
  storey_id?: string;
  all_storeys?: boolean;
  fit?: boolean;
  zoom_factor?: number;
  center?: [number, number];
  scale?: number;
  position?: [number, number, number];
  target?: [number, number, number];
  preset?: 'top' | 'front' | 'back' | 'left' | 'right' | 'isometric';
}
export interface ViewportApi {
  view: '2d' | '3d';
  storeyId: string;
  allStoreys: boolean;
  read: () => Record<string, unknown>;
  set: (request: ViewRequest) => Promise<void>;
  capture: () => Promise<string>;
}
export type ViewportRef = MutableRefObject<ViewportApi | null>;
export const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

export function validateViewRequest(args: Record<string, unknown>): ViewRequest {
  const allowed = ['view', 'storey_id', 'all_storeys', 'fit', 'zoom_factor', 'center', 'scale', 'position', 'target', 'preset'];
  for (const key of Object.keys(args)) if (!allowed.includes(key)) throw new Error(`Unknown view parameter: ${key}`);
  if (args.view !== undefined && !['2d', '3d'].includes(args.view as string)) throw new Error('view must be 2d or 3d.');
  if (args.storey_id !== undefined && typeof args.storey_id !== 'string') throw new Error('storey_id must be a string.');
  for (const key of ['all_storeys', 'fit']) if (args[key] !== undefined && typeof args[key] !== 'boolean') throw new Error(`${key} must be boolean.`);
  for (const [key, length] of [['center', 2], ['position', 3], ['target', 3]] as const) {
    const v = args[key];
    if (v !== undefined && (!Array.isArray(v) || v.length !== length || !v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7))) throw new Error(`${key} must contain ${length} finite coordinates.`);
  }
  for (const [key, min, max] of [['zoom_factor', 0.05, 20], ['scale', 0.5, 200]] as const) {
    const v = args[key];
    if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)) throw new Error(`${key} must be between ${min} and ${max}.`);
  }
  if (args.preset !== undefined && !['top', 'front', 'back', 'left', 'right', 'isometric'].includes(args.preset as string)) throw new Error('Invalid camera preset.');
  return args as ViewRequest;
}

/** Keep image responses below Firestore's document limit, without duplicating base64 in text. */
export function captureCanvas(source: HTMLCanvasElement): string {
  if (!source.width || !source.height) throw new Error('Viewport has no drawable size.');
  const ratio = Math.min(1, 1024 / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * ratio));
  canvas.height = Math.max(1, Math.round(source.height * ratio));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image capture is unavailable.');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.65, 0.45]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length < 700_000) return url;
  }
  throw new Error('Captured image exceeds the transport size limit.');
}

/**
 * Downscale the floor plan returned by get_storey_floorplan so the native image block fits MCP and Firestore
 * transports. `plan` keeps the stored calibration; `image` describes the copy sent, whose pixels the tools
 * accept with coordinates_in_pixels + pixel_space "image". Its size comes from the stored plan only
 * (mcpPlanImageSize), so the tools convert with exactly the same calibration.
 */
export async function shrinkFloorplanResult(result: any): Promise<any> {
  const plan = result?.plan;
  if (typeof plan?.url !== 'string' || !plan.url.startsWith('data:image/') || !(plan.w > 0) || !(plan.h > 0)) return result;
  if (typeof Image === 'undefined' || typeof document === 'undefined') return result; // no DOM (tests, workers)
  const image = new Image();
  image.src = plan.url;
  await image.decode();
  const size = mcpPlanImageSize(plan);
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Floor plan image is unavailable.');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  let url = '';
  for (const quality of [0.85, 0.7, 0.55]) {
    url = canvas.toDataURL('image/jpeg', quality);
    if (url.length < 700_000) break;
  }
  if (url.length >= 700_000) throw new Error('Floor plan image exceeds the transport size limit.');
  return {
    ...result,
    plan: { ...plan, url },
    image: {
      ...mcpPlanImageCalibration(plan as PlanCalibration),
      downscaled: size.w !== plan.w || size.h !== plan.h,
      note: 'The attached image is this copy. For pixels measured on it, pass coordinates_in_pixels: true with pixel_space: "image" (converted with this calibration). pixel_space "plan" (default) means full-resolution plan pixels (plan.w × plan.h). Converting to world metres yourself uses the same formulas with image.x/y/scale/h.',
    },
  };
}

export async function captureSvg(svg: SVGSVGElement): Promise<string> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const originals = [svg, ...svg.querySelectorAll('*')];
  const clones = [copy, ...copy.querySelectorAll('*')];
  originals.forEach((node, i) => {
    const computed = getComputedStyle(node);
    clones[i].setAttribute('style', Array.from(computed).filter(key => !key.startsWith('--')).map(key => `${key}:${computed.getPropertyValue(key)}`).join(';'));
  });
  // SVG images must be embedded: external resources are not loaded inside an SVG image.
  for (const image of copy.querySelectorAll('image')) {
    const href = image.getAttribute('href');
    if (href && !href.startsWith('data:')) {
      const response = await fetch(href);
      if (!response.ok) throw new Error('Cannot load the background image for capture.');
      const blob = await response.blob();
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Cannot embed background image.')); reader.readAsDataURL(blob);
      });
      image.setAttribute('href', data);
    }
  }
  const { width, height } = svg.getBoundingClientRect();
  if (!width || !height) throw new Error('Viewport has no drawable size.');
  copy.setAttribute('width', String(width)); copy.setAttribute('height', String(height));
  copy.style.position = 'static'; copy.style.width = `${width}px`; copy.style.height = `${height}px`;
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(width); canvas.height = Math.ceil(height);
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Image capture is unavailable.');
    ctx.drawImage(image, 0, 0); return captureCanvas(canvas);
  } finally { URL.revokeObjectURL(url); }
}
