import type { ItemsMap } from '../types/ifc.js';

export function renameProjectItems(items: ItemsMap, name: string): ItemsMap {
  return Object.fromEntries(Object.entries(items).map(([id, item]) => [
    id, item.type === 'Project' ? { ...item, name, Name: name } : item,
  ]));
}

export function uniqueProjectName(requested: string, existing: string[]): string {
  const name = requested.normalize('NFC').trim().replace(/\s+/g, ' ') || 'Nouveau projet';
  const key = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  const used = new Set(existing.map(key));
  let candidate = name;
  for (let suffix = 2; used.has(key(candidate)); suffix++) candidate = `${name} (${suffix})`;
  return candidate;
}
