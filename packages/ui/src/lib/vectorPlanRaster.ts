import { parseDxf, type DxfDrawing } from '@skaitch/core/cad/dxf';
import type { VectorPlanData } from '@skaitch/core/cad/vectorPlan';

/** Longest side, in pixels, of the raster preview stored in `plan.url`. */
export const VECTOR_PREVIEW_MAX_SIDE = 2048;

/** Neutral ink for monochrome plans and for CAD white (ACI 7), which means "black on paper". */
export const VECTOR_INK = '#3a3f47';

/** Display colour of a path or text: white is the CAD background-contrast colour. */
export function vectorColor(data: VectorPlanData, color: string): string {
  if (data.monochrome) return VECTOR_INK;
  return color.toLowerCase() === '#ffffff' ? VECTOR_INK : color;
}

/**
 * Draws the visible layers into a transparent PNG of w × h pixels: the preview every
 * image consumer reads (3D view, chat, get_storey_floorplan).
 */
export function rasterizeVectorPlan(data: VectorPlanData, w: number, h: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  const k = w / data.w;
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  const visible = data.layers.map(l => l.visible);
  const byColor = new Map<string, number[][]>();
  for (const path of data.paths) {
    if (!visible[path.l]) continue;
    const c = vectorColor(data, path.c);
    let list = byColor.get(c);
    if (!list) byColor.set(c, list = []);
    list.push(path.p);
  }
  for (const [color, list] of byColor) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (const p of list) {
      ctx.moveTo(p[0] * k, h - p[1] * k);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * k, h - p[i + 1] * k);
    }
    ctx.stroke();
  }
  ctx.textBaseline = 'alphabetic';
  for (const t of data.texts) {
    const size = t.h * k;
    if (!visible[t.l] || size < 3) continue;
    ctx.save();
    ctx.translate(t.x * k, h - t.y * k);
    ctx.rotate(-t.r * Math.PI / 180);
    ctx.fillStyle = vectorColor(data, t.c);
    ctx.font = `${size}px Geist, ui-sans-serif, system-ui, sans-serif`;
    t.s.split('\n').forEach((line, i) => ctx.fillText(line, 0, i * size * 1.25));
    ctx.restore();
  }
  const url = canvas.toDataURL('image/png');
  if (!url.startsWith('data:image/png')) throw new Error('Image export failed');
  return url;
}

/** Reads a DXF file off the main thread when workers are available. */
export async function readDxfFile(file: File): Promise<DxfDrawing> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('./dxfWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    return parseDxf(bytes);
  }
  try {
    return await new Promise<DxfDrawing>((resolve, reject) => {
      worker!.onmessage = (e: MessageEvent<{ ok: true; drawing: DxfDrawing } | { ok: false; error: string }>) =>
        { const d = e.data; if (d.ok === true) resolve(d.drawing); else reject(new Error((d as { error: string }).error)); };
      worker!.onerror = e => { e.preventDefault(); resolve(parseDxf(bytes)); };
      worker!.postMessage(bytes);
    });
  } finally {
    worker.terminate();
  }
}
