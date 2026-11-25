import type { ItemsMap } from '../types/ifc.js';
import { SheetError, validateSheet, type SheetEntity } from '../drawing/sheet.js';

export class InputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Objet BIM invalide.');
  return value as Record<string, any>;
}
export function finiteData(value: unknown, depth = 0): void {
  if (depth > 50) throw new InputError('Données BIM trop imbriquées.');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new InputError('Nombre BIM non fini.');
  if (value && typeof value === 'object') for (const child of Object.values(value)) finiteData(child, depth + 1);
}
export function validateItems(value: unknown): ItemsMap {
  const items = record(value);
  if (Object.keys(items).length > 20_000) throw new InputError('Modèle limité à 20 000 éléments.', 413);
  for (const [id, raw] of Object.entries(items)) {
    const item = record(raw);
    if (['__proto__', 'constructor', 'prototype'].includes(id) || item.id !== id || typeof item.type !== 'string') throw new InputError('Identifiant ou type BIM invalide.');
    for (const key of ['name', 'Name', 'GlobalId', 'ifcType']) {
      if (item[key] !== undefined && typeof item[key] !== 'string') throw new InputError('Métadonnée BIM invalide.');
    }
    if (item.parentId != null && typeof item.parentId !== 'string') throw new InputError('Parent BIM invalide.');
    if (['Wall', 'Room', 'Door', 'Window', 'Slab', 'Roof', 'Stair', 'Storey', 'Furniture', 'GenericElement', 'Technical', 'Column', 'Chimney', 'Dimension', 'Marker', 'Section'].includes(item.type)) record(item.geom);
    if (item.type === 'Column' || item.type === 'Chimney') {
      for (const key of ['x', 'y', 'w', 'd', 'h']) if (typeof item.geom[key] !== 'number') throw new InputError('Géométrie d’élément structurel invalide.');
      if (item.geom.w <= 0 || item.geom.d <= 0 || item.geom.h <= 0) throw new InputError('Dimensions d’élément structurel invalides.');
    }
    if (item.type === 'Wall') {
      for (const key of ['x1', 'y1', 'x2', 'y2', 'thickness', 'height']) if (typeof item.geom[key] !== 'number') throw new InputError('Géométrie de mur invalide.');
      if (item.geom.thickness <= 0 || item.geom.height <= 0) throw new InputError('Dimensions de mur invalides.');
    }
    if (item.type === 'Door' || item.type === 'Window') {
      if (typeof item.geom.wallId !== 'string' || items[item.geom.wallId]?.type !== 'Wall') throw new InputError('Mur hôte introuvable.');
      for (const key of ['t', 'width', 'height']) if (typeof item.geom[key] !== 'number') throw new InputError('Géométrie d’ouverture invalide.');
      if (item.geom.width <= 0 || item.geom.height <= 0 || item.geom.t < 0 || item.geom.t > 1) throw new InputError('Dimensions ou position d’ouverture invalides.');
    }
    if (item.type === 'Sheet') {
      record(item.geom);
      try { validateSheet(item as SheetEntity, items as ItemsMap); }
      catch (error) { if (error instanceof SheetError) throw new InputError(error.message); throw error; }
    }
    if (['Room', 'Slab', 'Roof'].includes(item.type)) {
      if (!Array.isArray(item.geom.polygon) || item.geom.polygon.length < 3 || item.geom.polygon.some((p: unknown) => !Array.isArray(p) || p.length !== 2 || !p.every(n => typeof n === 'number'))) throw new InputError('Contour BIM invalide.');
    }
  }
  return items as ItemsMap;
}

export function validateCatalogue(value: unknown) {
  if (!Array.isArray(value) || value.length > 2000 || JSON.stringify(value).length > 300_000) throw new InputError('Catalogue MCP trop volumineux.');
  finiteData(value);
  for (const entry of value) {
    const def = record(entry);
    if (typeof def.id !== 'string' || !['Door', 'Window', 'Furniture'].includes(def.type) || typeof def.labelFr !== 'string' || typeof def.labelEn !== 'string') throw new InputError('Entrée de catalogue invalide.');
    const defaults = record(def.defaults);
    for (const key of ['width', 'height']) if (typeof defaults[key] !== 'number' || defaults[key] <= 0) throw new InputError('Dimensions de catalogue invalides.');
  }
  return value;
}
