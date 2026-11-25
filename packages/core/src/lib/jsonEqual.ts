/** Firestore maps do not preserve the insertion order of JSON object keys. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  const sorted = (_key: string, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    : value;
  return JSON.stringify(a, sorted) === JSON.stringify(b, sorted);
}
