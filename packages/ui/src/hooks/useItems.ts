import { useState, useRef, useCallback } from 'react';
import type { ItemsMap, IfcEntity } from '@skaitch/core/types/ifc';
import { buildEmpty } from '@skaitch/core/data/starter';
import { deleteModelItems } from '@skaitch/core/lib/deleteModelItems';

const HIST_MAX = 100;
const COALESCE_MS = 600;

export function useItems() {
  const [items, setItems] = useState<ItemsMap>(() => buildEmpty());
  const historyRef = useRef<{ past: ItemsMap[]; future: ItemsMap[] }>({ past: [], future: [] });
  const [histTick, setHistTick] = useState(0);
  const lastPushAtRef = useRef<{ time: number; key: string }>({ time: 0, key: '' });

  const bumpHist = () => setHistTick((t) => t + 1);

  const pushHistory = useCallback((prev: ItemsMap, coalesceKey?: string) => {
    const now = Date.now();
    const last = lastPushAtRef.current;
    if (coalesceKey && last.key === coalesceKey && now - last.time < COALESCE_MS) {
      // coalesce — skip
    } else {
      historyRef.current.past.push(prev);
      if (historyRef.current.past.length > HIST_MAX) historyRef.current.past.shift();
    }
    lastPushAtRef.current = { time: now, key: coalesceKey ?? '' };
    historyRef.current.future = [];
  }, []);

  const addItem = useCallback((it: IfcEntity) => {
    setItems((prev) => {
      pushHistory(prev, 'add_' + it.type);
      bumpHist();
      return { ...prev, [it.id]: it };
    });
  }, [pushHistory]);

  const updateItem = useCallback((id: string, patch: Partial<IfcEntity> | ((prev: IfcEntity) => Partial<IfcEntity>)) => {
    setItems((prev) => {
      const it = prev[id];
      if (!it) return prev;
      const actualPatch = typeof patch === 'function' ? patch(it) : patch;
      pushHistory(prev, 'upd_' + id);
      bumpHist();
      return { ...prev, [id]: { ...it, ...actualPatch } as IfcEntity };
    });
  }, [pushHistory]);

  const deleteItems = useCallback((ids: string[]) => {
    setItems((prev) => {
      pushHistory(prev, '');
      bumpHist();
      return deleteModelItems(prev, ids);
    });
  }, [pushHistory]);

  const undo = useCallback(() => {
    if (historyRef.current.past.length === 0) return;
    setItems((curr) => {
      const prev = historyRef.current.past.pop()!;
      historyRef.current.future.unshift(curr);
      lastPushAtRef.current = { time: 0, key: '' };
      bumpHist();
      return prev;
    });
  }, []);

  const redo = useCallback(() => {
    if (historyRef.current.future.length === 0) return;
    setItems((curr) => {
      const next = historyRef.current.future.shift()!;
      historyRef.current.past.push(curr);
      lastPushAtRef.current = { time: 0, key: '' };
      bumpHist();
      return next;
    });
  }, []);

  const replaceItems = useCallback((next: ItemsMap, clearHistory = false) => {
    setItems((prev) => {
      if (clearHistory) {
        historyRef.current = { past: [], future: [] };
      } else {
        historyRef.current.past.push(prev);
        if (historyRef.current.past.length > HIST_MAX) historyRef.current.past.shift();
        historyRef.current.future = [];
      }
      lastPushAtRef.current = { time: 0, key: '' };
      bumpHist();
      return next;
    });
  }, []);

  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  return {
    items,
    setItems,
    addItem,
    updateItem,
    deleteItems,
    replaceItems,
    undo,
    redo,
    canUndo,
    canRedo,
    histTick,
  };
}
