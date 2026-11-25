import type { ItemsMap } from '../types/ifc.js';
import { pointInPoly } from '../data/query.js';

export function deleteModelItems(prev: ItemsMap, ids: string[]): ItemsMap {
      const next = { ...prev };
      const toDel = new Set(ids);

      let changed = true;
      while (changed) {
        changed = false;
        for (const it of Object.values(prev)) {
          if (toDel.has(it.id)) continue;
          if (it.parentId && toDel.has(it.parentId)) {
            toDel.add(it.id);
            changed = true;
            continue;
          }

          if ((it.type === 'Door' || it.type === 'Window') && toDel.has((it as any).geom?.wallId)) {
            toDel.add(it.id);
            changed = true;
            continue;
          }

          if (it.type === 'Furniture') {
            const g = (it as any).geom;
            if (g && typeof g.x === 'number' && typeof g.y === 'number' && typeof g.w === 'number' && typeof g.d === 'number') {
              const center: [number, number] = [g.x + g.w / 2, g.y + g.d / 2];
              const hostRoom = Object.values(prev).find((candidate) =>
                toDel.has(candidate.id) &&
                candidate.type === 'Room' &&
                Array.isArray((candidate as any).geom?.polygon) &&
                pointInPoly(center, (candidate as any).geom.polygon),
              );
              if (hostRoom) {
                toDel.add(it.id);
                changed = true;
              }
            }
          }
        }
      }

      for (const id of Array.from(toDel)) {
        const it = prev[id];
        if (!it) continue;
        if (it.type === 'Wall') {
          for (const o of Object.values(prev)) {
            if ((o.type === 'Door' || o.type === 'Window') && (o as any).geom?.wallId === id) {
              toDel.add(o.id);
            }
          }
        }
      }
      for (const id of toDel) delete next[id];
      return next;
}
