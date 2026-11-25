import { MCP_BATCH_TOOLS } from '../mcp-automation.js';
import type { ElementDef } from '../data/elementCatalogue.js';
import type { ItemsMap } from '../types/ifc.js';
import { computeMcpModel } from './mcpModel.js';
import { finiteData, InputError, record, validateItems } from './validation.js';

export function computeMcpBatch(input: unknown, items: ItemsMap, storeyId: string, catalogue: ElementDef[], lang: unknown) {
  const { operations } = record(input);
  finiteData(operations);
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 64) {
    throw new InputError('Provide 1 to 64 batch operations.');
  }
  if (items[storeyId]?.type !== 'Storey') throw new InputError('Select a storey before batching.');
  const next = { ...items };
  const ids = new Map<string, string>();
  const results = [];
  let added = 0, updated = 0;

  function resolve(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(resolve);
    if (!value || typeof value !== 'object') return value;
    const fields = record(value);
    if (Object.prototype.hasOwnProperty.call(fields, '$ref')) {
      const ref = fields.$ref;
      const id = typeof ref === 'string' && ref.endsWith('.id') ? ids.get(ref.slice(0, -3)) : undefined;
      if (!id || Object.keys(fields).length !== 1) throw new InputError('Reference must name the ID of an earlier operation.');
      return id;
    }
    return Object.fromEntries(Object.entries(fields).map(([key, child]) => [key, resolve(child)]));
  }

  for (const [index, operation] of operations.entries()) {
    const { name, args, alias } = record(operation);
    if (typeof name !== 'string' || !MCP_BATCH_TOOLS.some(tool => tool === name)) {
      throw new InputError(`Operation ${index + 1}: tool unavailable in a batch.`);
    }
    if (alias !== undefined && (typeof alias !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(alias) || ids.has(alias))) {
      throw new InputError(`Operation ${index + 1}: invalid or duplicate alias.`);
    }
    const resolved = record(resolve(record(args)));
    if (resolved.storey_id !== undefined && resolved.storey_id !== storeyId) {
      throw new InputError(`Operation ${index + 1}: all changes must target the selected storey.`);
    }
    const computed = computeMcpModel(name, resolved, next, storeyId, catalogue, lang);
    const result = record(computed.result);
    if (result.error) throw new InputError(`Operation ${index + 1} (${name}): ${String(result.error)}`);
    for (const change of computed.changes) {
      if (change.kind === 'add' && change.item.parentId === storeyId && !next[change.item.id]) {
        next[change.item.id] = change.item;
        added++;
      } else if (change.kind === 'update' && next[change.id]?.parentId === storeyId) {
        next[change.id] = { ...next[change.id], ...change.patch } as ItemsMap[string];
        updated++;
      } else {
        throw new InputError(`Operation ${index + 1}: change outside the selected storey or unsupported in a batch.`);
      }
    }
    if (typeof alias === 'string') {
      if (typeof result.id !== 'string') throw new InputError(`Operation ${index + 1}: this tool did not return an ID.`);
      ids.set(alias, result.id);
    }
    results.push({ name, ...(alias !== undefined ? { alias } : {}), id: result.id ?? null, duplicate: result.duplicate === true });
  }
  validateItems(next);
  finiteData(next);
  return { items: next, result: { success: true, added, updated, operations: results } };
}
