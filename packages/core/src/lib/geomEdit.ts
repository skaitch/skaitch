/** Geometry keys that only move or orient an element; any other key changes its shape. */
const PLACEMENT_KEYS = new Set(['x', 'y', 'x1', 'y1', 'x2', 'y2', 't', 'rotation', 'wallId', 'side', 'swing', 'mountHeight', 'sillHeight', '_placementWorld', 'plan', 'level', 'elevation', 'opening', 'targetId']);

/**
 * Flags an edit for the IFC patch: `_edited` always, `_shapeEdited` when an imported
 * body can no longer be reused by only moving its placement.
 */
export function markGeomEdit<T extends Record<string, any>>(geom: T, changedKeys: Iterable<string>): T & { _edited: true } {
  const next: any = { ...geom, _edited: true };
  for (const key of changedKeys) if (!PLACEMENT_KEYS.has(key)) { next._shapeEdited = true; break; }
  return next;
}
