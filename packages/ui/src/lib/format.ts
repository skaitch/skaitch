import { makeT } from '@skaitch/core/data/i18n';
import type { IfcEntity } from '@skaitch/core/types/ifc';
import { polyArea, wallLength } from '@skaitch/core/data/query';

const titleWord = (word: string) => word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word;

function cleanTokenText(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\bw\s*chairs?\b/gi, 'chairs')
    .replace(/\bw\s*(\d+)\s*seats?\b/gi, '$1 seats')
    .replace(/\b(rectangular|plain|flush|sgl|dbl|int|ext|case|standard|element|family|type)\b/gi, ' ')
    .replace(/\b(furniture|doors?|windows?|curtain wall|system panel|system)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDimToken(value: string): string {
  const match = value.match(/(\d+(?:[.,]\d+)?(?:\s*[xX×]\s*\d+(?:[.,]\d+)?){1,2})\s*(mm|cm|m)?/);
  return match ? match[1].replace(/\s*[xX×]\s*/g, '×') : '';
}

export function shortName(item: IfcEntity | { type?: string; name?: string; Name?: string; ifcType?: string } | string, lang = 'fr'): string {
  const raw = typeof item === 'string' ? item : (item.name || item.Name || item.ifcType || item.type || '');
  const type = typeof item === 'string' ? '' : (item.type || item.ifcType || '');
  const dim = extractDimToken(raw);
  const upper = raw.toUpperCase();

  if (/CURTAIN|EXTERIOR[_ -]?GLAZING|SLIDING_BAY/.test(upper)) return makeT(lang)('Glazed bay');
  if (/DOOR|PORTE/.test(upper) || type === 'Door') return `${makeT(lang)('Door')}${dim ? ` ${dim}` : ''}`;
  if (/WINDOW|FEN[EÊ]TRE/.test(upper) || type === 'Window') return `${makeT(lang)('Window')}${dim ? ` ${dim}` : ''}`;

  const parts = raw.split(':')
    .map((part) => part.trim())
    .filter((part) => part && !/^\d+$/.test(part) && !/^[A-Za-z0-9_$-]{16,}$/.test(part));
  let base = parts.find((part) => !extractDimToken(part)) || parts[0] || raw;
  base = cleanTokenText(base);

  const replacements: Array<[RegExp, string]> = [
    [/\btable dining\b/i, makeT(lang)('Dining table')],
    [/\btable coffee\b/i, makeT(lang)('Coffee table')],
    [/\bchair dining\b/i, makeT(lang)('Chair')],
    [/\bchair viper\b/i, makeT(lang)('Armchair')],
    [/\bcouch viper\b/i, makeT(lang)('Sofa')],
    [/\bbed\b/i, makeT(lang)('Bed')],
    [/\bdesk\b/i, makeT(lang)('Desk')],
    [/\bpiano\b/i, 'Piano'],
  ];
  for (const [pattern, replacement] of replacements) base = base.replace(pattern, replacement);

  base = base.replace(/\s+/g, ' ').trim();
  if (!base) base = typeof item === 'string' ? 'Objet' : (item.type || 'Objet');
  if (!/[A-ZÀ-Ü]/.test(base[0])) base = base.split(' ').map(titleWord).join(' ');

  return `${base}${dim && !base.includes(dim) ? ` ${dim}` : ''}`.trim();
}

export function formatLength(value: number, unit = 'm'): string {
  if (!Number.isFinite(value)) return `— ${unit}`;
  const abs = Math.abs(value);
  const decimals = abs >= 10 ? 1 : abs >= 0.1 ? 2 : 3;
  return `${value.toFixed(decimals)} ${unit}`;
}

export function formatArea(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(value >= 100 ? 0 : 1)} m²` : '— m²';
}

export function formatVolume(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(value >= 100 ? 0 : 1)} m³` : '— m³';
}

export function formatDims(values: Array<number | undefined | null>, unit = 'm'): string {
  const nums = values.filter((v): v is number => Number.isFinite(v));
  if (!nums.length) return '';
  return `${nums.map((v) => Math.abs(v).toFixed(Math.abs(v) >= 10 ? 1 : 2)).join(' × ')} ${unit}`;
}

export function itemDimensions(item: IfcEntity): string {
  const g: any = (item as any).geom;
  if (!g) return '';
  if (item.type === 'Stair') return formatDims([g.width,g.going]);
  if (item.type === 'Wall') return formatDims([wallLength(g), g.thickness, g.height]);
  if (item.type === 'Door' || item.type === 'Window') return formatDims([g.width, g.height]);
  if (item.type === 'Furniture' || item.type === 'GenericElement') return formatDims([g.w, g.d, g.h]);
  if (item.type === 'Room' || item.type === 'Slab' || item.type === 'Roof') return formatArea(polyArea(g.polygon || []));
  if (item.type === 'Dimension') return formatLength(Math.hypot(g.x2 - g.x1, g.y2 - g.y1));
  return '';
}
