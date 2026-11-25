import type { IfcWallEntity, ItemsMap } from '../types/ifc.js';
import { placementPoint } from './furniturePlacement.js';

export function openingSwing(operation: string, swing?: string): 'left' | 'right' {
  if (operation === 'SINGLE_SWING_RIGHT') return 'right';
  if (operation === 'SINGLE_SWING_LEFT') return 'left';
  return swing === 'right' ? 'right' : 'left';
}

/** Hinge is measured along the wall; side=1 is its left-hand normal in world XY. */
export function openingOrientation(args: Record<string, unknown>, wall: IfcWallEntity, t: number,
  operation: string, items: ItemsMap, fallback: { swing?: string; side?: number; width?: number } = {}) {
  if (args.swing !== undefined && args.swing !== 'left' && args.swing !== 'right') throw new Error('swing must be left or right.');
  if (args.side !== undefined && args.side !== 1 && args.side !== -1) throw new Error('side must be 1 or -1.');
  const { x1, y1, x2, y2 } = wall.geom;
  const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 1e-9) throw new Error('Host wall must have a nonzero length.');
  let swing = args.swing ?? openingSwing(operation, fallback.swing);
  let side = args.side ?? fallback.side ?? 1;
  const width = Number(args.width ?? fallback.width ?? 0.9);
  if (!Number.isFinite(width) || width <= 0) throw new Error('Opening width must be positive and finite.');
  if (!Number.isFinite(t) || t < 0 || t > 1) throw new Error('Opening position must be between 0 and 1.');
  if (args.hinge_point !== undefined && args.position === undefined) {
    const p = placementPoint(args.hinge_point, items, wall.parentId!);
    const along = ((p[0] - x1) * dx + (p[1] - y1) * dy) / length;
    t = (along + (swing === 'right' ? -width / 2 : width / 2)) / length;
  }
  if (t * length < width / 2 - 1e-6 || t * length > length - width / 2 + 1e-6) throw new Error('Opening would extend beyond the host wall; remeasure its centre and width.');
  const cx = x1 + t * dx, cy = y1 + t * dy;
  if (args.hinge_point !== undefined) {
    const p = placementPoint(args.hinge_point, items, wall.parentId!);
    const along = ((p[0] - cx) * dx + (p[1] - cy) * dy) / length;
    const offWall = Math.abs(dx * (p[1] - cy) - dy * (p[0] - cx)) / length;
    if (offWall > (wall.geom.thickness ?? 0) / 2 + 0.05) throw new Error('hinge_point is not on the host wall; recheck the wall ID and calibration.');
    if (Math.abs(Math.abs(along) - width / 2) > 0.05 + 1e-9) throw new Error('hinge_point does not match the opening jamb within 5 cm; remeasure the centre, hinge and width.');
    const resolved = along < 0 ? 'left' : 'right';
    if (args.swing !== undefined && args.swing !== resolved) throw new Error('hinge_point conflicts with swing.');
    swing = resolved;
  }
  if (args.opening_towards !== undefined) {
    const p = placementPoint(args.opening_towards, items, wall.parentId!);
    const normal = (dx * (p[1] - cy) - dy * (p[0] - cx)) / length;
    if (Math.abs(normal) < 1e-6) throw new Error('opening_towards must lie off the host wall.');
    const resolved = normal > 0 ? 1 : -1;
    if (args.side !== undefined && args.side !== resolved) throw new Error('opening_towards conflicts with side.');
    side = resolved;
  }
  if (operation.startsWith('SINGLE_SWING_')) operation = swing === 'right' ? 'SINGLE_SWING_RIGHT' : 'SINGLE_SWING_LEFT';
  return { t, swing: swing as 'left' | 'right', side: side as number, operation };
}
