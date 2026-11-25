/** Longest side of the floor plan copy sent to MCP vision clients (models resize to about this anyway). */
export const MCP_PLAN_MAX_SIDE = 1568;

export interface PlanCalibration { x: number; y: number; scale: number; w: number; h: number; rotation?: number }
export type PixelSpace = 'plan' | 'image';
export const PIXEL_SPACES: PixelSpace[] = ['plan', 'image'];

/** Size of the copy get_storey_floorplan attaches; derived from the stored plan only, so every runtime agrees. */
export function mcpPlanImageSize(plan: Pick<PlanCalibration, 'w' | 'h'>): { w: number; h: number } {
  const ratio = Math.min(1, MCP_PLAN_MAX_SIDE / Math.max(plan.w, plan.h));
  return { w: Math.max(1, Math.round(plan.w * ratio)), h: Math.max(1, Math.round(plan.h * ratio)) };
}

/** Calibration of the attached copy: same world placement, metres per pixel of the copy. */
export function mcpPlanImageCalibration(plan: PlanCalibration): PlanCalibration & { rotation: number } {
  const { w, h } = mcpPlanImageSize(plan);
  return { w, h, scale: plan.scale * plan.w / w, x: plan.x, y: plan.y, rotation: plan.rotation || 0 };
}

/** Calibration to convert pixel coordinates measured in the given pixel space. */
export function planCalibrationFor(plan: PlanCalibration, space: PixelSpace = 'plan'): PlanCalibration {
  return space === 'image' ? mcpPlanImageCalibration(plan) : plan;
}

/** Validates the optional pixel_space tool argument; undefined means full-resolution plan pixels. */
export function parsePixelSpace(value: unknown): PixelSpace {
  if (value === undefined || value === null) return 'plan';
  if (value === 'plan' || value === 'image') return value;
  throw new Error('pixel_space must be "plan" or "image".');
}
