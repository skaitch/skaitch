import type { ViewState2D } from '@skaitch/core/types/ifc';

/** Apply a trackpad gesture, preserving the world point under the pinch centre. */
export function trackpadView(view: ViewState2D, x: number, y: number, deltaX: number, deltaY: number, pinch: boolean): ViewState2D {
  if (!pinch) return { ...view, ox: view.ox - deltaX, oy: view.oy - deltaY };
  if (!deltaY) return view;
  const scale = Math.max(0.5, Math.min(200, view.scale * Math.exp(-deltaY * 0.01)));
  const ratio = scale / view.scale;
  return { scale, ox: x - (x - view.ox) * ratio, oy: y - (y - view.oy) * ratio };
}
