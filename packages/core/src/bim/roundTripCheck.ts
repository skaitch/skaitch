import type { ItemsMap, IfcEntity } from '../types/ifc.js';
import { exportIFC } from './exportIFC.js';
import { guid } from '../data/starter.js';

import type { RoundTripResult } from '../types/bim.js';

// Very lightweight STEP parser — extracts type + quoted strings from entity lines
// #123=IFCWALL('GUID',$,'Name',...);
function parseStep(ifc: string): Map<string, { type: string; args: string[] }> {
  const map = new Map<string, { type: string; args: string[] }>();
  // Match: #N=IFCTYPE(...)
  const re = /#(\d+)=([A-Z0-9]+)\(([^)]*(?:\([^)]*\)[^)]*)*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ifc)) !== null) {
    const [, , type, argsRaw] = m;
    // Extract quoted strings (handles '' escaped quotes)
    const quoted: string[] = [];
    const qRe = /'((?:[^']|'')*)'/g;
    let q: RegExpExecArray | null;
    while ((q = qRe.exec(argsRaw)) !== null) {
      quoted.push(q[1].replace(/''/g, "'"));
    }
    map.set(type + '_' + quoted[0], { type, args: quoted });
  }
  return map;
}

// Map our internal types to IFC entity names
const TYPE_TO_IFC: Record<string, string[]> = {
  Project:   ['IFCPROJECT'],
  Building:  ['IFCBUILDING', 'IFCSITE'],
  Storey:    ['IFCBUILDINGSTOREY', 'IFCBUILDING'],
  Room:      ['IFCSPACE'],
  Wall:      ['IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCCURTAINWALL'],
  Door:      ['IFCDOOR', 'IFCDOORSTANDARDCASE'],
  Window:    ['IFCWINDOW', 'IFCWINDOWSTANDARDCASE', 'IFCCURTAINWALL'],
  Furniture: ['IFCFURNISHINGELEMENT', 'IFCFURNITURE', 'IFCSYSTEMFURNITUREELEMENT'],
};

const ALL_ACCEPTED_IFC_TYPES = new Set(Object.values(TYPE_TO_IFC).flat());

// Parse all STEP entities as {globalId → {type, name}}
function indexExport(ifc: string): Map<string, { type: string; name: string }> {
  const idx = new Map<string, { type: string; name: string }>();
  const re = /#\d+=([A-Z0-9]+)\(([^;]*)\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ifc)) !== null) {
    const [, type, argsRaw] = m;
    if (!ALL_ACCEPTED_IFC_TYPES.has(type)) continue;
    // Extract all quoted strings
    const quoted: string[] = [];
    const qRe = /'((?:[^']|'')*)'/g;
    let q: RegExpExecArray | null;
    while ((q = qRe.exec(argsRaw)) !== null) {
      quoted.push(q[1].replace(/''/g, "'"));
    }
    if (quoted.length >= 1) {
      const globalId = quoted[0];
      const name     = quoted[2] ?? quoted[1] ?? '';
      idx.set(globalId, { type, name });
    }
  }
  return idx;
}

export function checkRoundTrip(items: ItemsMap, rawIfcText?: string | null): RoundTripResult {
  // If rawIfcText is explicitly provided (even if null), use it. null means no 3D buffer exists.
  const ifc = rawIfcText !== undefined ? (rawIfcText || '') : exportIFC(items);
  const exported = indexExport(ifc);

  const missing:      string[] = [];
  const nameMismatch: string[] = [];
  const guidMismatch: string[] = [];
  let matched = 0;

  const relevantTypes = new Set(Object.keys(TYPE_TO_IFC));
  // Exclude curtain-wall bay windows (wn_cw_*): they are not emitted as
  // standalone IFC entities (the parent IFCCURTAINWALL represents them and
  // carries the shared GlobalId), so checking them independently produces
  // spurious "missing" errors — especially once their GUID has been altered.
  const relevant = Object.values(items).filter(
    (i) => relevantTypes.has(i.type) && !i.id.startsWith('wn_cw_'),
  );

  for (const ent of relevant) {
    const gid = ent.GlobalId;
    const acceptedTypes = TYPE_TO_IFC[ent.type] || [];
    const exp = exported.get(gid);

    if (!exp) {
      missing.push(`${ent.type} "${ent.Name || ent.name}" (GlobalId=${gid})`);
      continue;
    }

    let ok = true;
    if (!acceptedTypes.includes(exp.type)) {
      guidMismatch.push(`${ent.id}: expected type in [${acceptedTypes.join(', ')}], got ${exp.type}`);
      ok = false;
    }
    const srcName = ent.Name || ent.name || '';
    // Strip trailing IFC numeric suffix (e.g. ":285330" or ":45419") before comparing,
    // since the exporter re-numbers STEP entities while keeping the same base name.
    const stripSuffix = (s: string) => s.replace(/:\d+$/, '');
    const srcBase = stripSuffix(srcName);
    const expBase = stripSuffix(exp.name);
    // Accept partial match: app stores short names, IFC has longer qualified names
    const nameOk = expBase === srcBase ||
      (srcBase.length > 0 && expBase.includes(srcBase)) ||
      (expBase.length > 0 && srcBase.includes(expBase));
    if (!nameOk && srcBase.length > 0 && expBase.length > 0 &&
        ent.type !== 'Project' && ent.type !== 'Building' && ent.type !== 'Storey') {
      nameMismatch.push(`${ent.type} ${gid}: expected name "${srcName}", got "${exp.name}"`);
      ok = false;
    }
    if (ok) matched++;
  }

  const ok = missing.length === 0 && nameMismatch.length === 0 && guidMismatch.length === 0;

  const lines: string[] = [
    `=== Round-trip check ===`,
    `Source entities   : ${relevant.length}`,
    `Exported entities : ${exported.size}`,
    `Matched (ok)      : ${matched}`,
    `Missing in export : ${missing.length}`,
    `Name mismatches   : ${nameMismatch.length}`,
    `Type mismatches   : ${guidMismatch.length}`,
    ok ? '✓ Round-trip OK' : '✗ Round-trip has issues',
  ];
  if (missing.length)      lines.push('  Missing:', ...missing.map((s) => '    - ' + s));
  if (nameMismatch.length) lines.push('  Name mismatches:', ...nameMismatch.map((s) => '    - ' + s));
  if (guidMismatch.length) lines.push('  Type mismatches:', ...guidMismatch.map((s) => '    - ' + s));

  return {
    ok,
    totalEntities:    relevant.length,
    exportedEntities: exported.size,
    matched,
    missing,
    nameMismatch,
    guidMismatch,
    report: lines.join('\n'),
  };
}

export function fixRoundTripProblems(items: ItemsMap): ItemsMap {
  const next = { ...items };
  const relevantTypes = new Set(['Project', 'Building', 'Storey', 'Room', 'Wall', 'Door', 'Window', 'Furniture']);
  const seenGuids = new Set<string>();

  for (const [id, ent] of Object.entries(next)) {
    if (!relevantTypes.has(ent.type)) continue;
    // Curtain-wall bay windows (wn_cw_*) intentionally share their parent
    // curtain wall's GlobalId and are NOT emitted as standalone entities by
    // patchIFC (see patchIFC.ts: `if (item.id.startsWith('wn_cw_')) continue`).
    // Reassigning their GUID here would permanently desync them from the
    // round-trip check (the IFC keeps the original shared GlobalId), producing
    // "missing" errors that Correct can never resolve. Skip them entirely.
    if (id.startsWith('wn_cw_')) continue;

    let gid = ent.GlobalId || '';
    const isPlaceholder =
      gid.trim() === '' ||
      gid.length < 22 ||
      gid === 'AAAAAAAAAAAAAAAAAAAAAA' ||
      gid === 'AAAAgAAAAAAAAAAAAAAAAA' ||
      /^[A0]+$/.test(gid) ||
      gid.startsWith('0FALLBACK');

    const patch: Partial<IfcEntity> = {};
    let changed = false;

    // 1. Check GlobalId duplicates or placeholder patterns
    if (isPlaceholder || seenGuids.has(gid)) {
      const newGid = guid(ent.id);
      patch.GlobalId = newGid;
      seenGuids.add(newGid);
      changed = true;
    } else {
      seenGuids.add(gid);
    }

    // 2. Synchronize Name and name
    const targetName = ent.Name || ent.name || ent.type;
    if (ent.Name !== targetName) {
      patch.Name = targetName;
      changed = true;
    }
    if (ent.name !== targetName) {
      patch.name = targetName;
      changed = true;
    }

    // Apply patch if changed
    if (changed) {
      next[id] = { ...ent, ...patch } as IfcEntity;
    }
  }

  return next;
}
