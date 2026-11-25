/**
 * Minimal edit history of the Survey app (spec F-06): a bounded stack of snapshots.
 * Pure and immutable so it can be tested and kept in React state.
 */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 100;

export const historyOf = <T>(present: T): History<T> => ({ past: [], present, future: [] });

/** Records a new state; consecutive edits of the same gesture can be merged with `merge`. */
export function record<T>(h: History<T>, next: T, merge = false): History<T> {
  if (next === h.present) return h;
  if (merge) return { ...h, present: next, future: [] };
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
