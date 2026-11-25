import type { ItemsMap } from '../types/ifc.js';

export function generateThumbnailSvg(items: ItemsMap): string {
  const W = 240, H = 140;
  const rooms = Object.values(items).filter((i) => i.type === 'Room') as any[];
  const walls = Object.values(items).filter((i) => i.type === 'Wall') as any[];

  if (rooms.length === 0 && walls.length === 0) return '';

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rooms) {
    for (const [x, y] of r.geom.polygon) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  for (const w of walls) {
    const { x1, y1, x2, y2 } = w.geom;
    minX = Math.min(minX, x1, x2); maxX = Math.max(maxX, x1, x2);
    minY = Math.min(minY, y1, y2); maxY = Math.max(maxY, y1, y2);
  }

  const pad = 12;
  const sceneW = maxX - minX || 1, sceneH = maxY - minY || 1;
  const scale = Math.min((W - pad * 2) / sceneW, (H - pad * 2) / sceneH);
  const ox = pad - minX * scale + ((W - pad * 2) - sceneW * scale) / 2;
  const oy = pad - minY * scale + ((H - pad * 2) - sceneH * scale) / 2;
  const px = (x: number) => (x * scale + ox).toFixed(2);
  const py = (y: number) => (y * scale + oy).toFixed(2);

  const roomPaths = rooms.map((r: any) => {
    const pts = r.geom.polygon.map(([x, y]: [number, number]) => `${px(x)},${py(y)}`).join(' ');
    return `<polygon points="${pts}" fill="#4f7cac" fill-opacity="0.15" stroke="#4f7cac" stroke-width="1.5" stroke-opacity="0.6"/>`;
  }).join('');

  const wallPaths = walls.map((w: any) => {
    const { x1, y1, x2, y2, thickness = 0.2 } = w.geom;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const t = thickness * scale / 2;
    const nx = Math.sin(angle) * t, ny = -Math.cos(angle) * t;
    const pts = [
      [parseFloat(px(x1)) + nx, parseFloat(py(y1)) + ny],
      [parseFloat(px(x2)) + nx, parseFloat(py(y2)) + ny],
      [parseFloat(px(x2)) - nx, parseFloat(py(y2)) - ny],
      [parseFloat(px(x1)) - nx, parseFloat(py(y1)) - ny],
    ].map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    return `<polygon points="${pts}" fill="#555" fill-opacity="0.8"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${roomPaths}${wallPaths}</svg>`;
}
