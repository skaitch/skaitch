import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const state = { sets: [] as { path: string; data: any }[], fail: false, hang: false, docs: {} as Record<string, any[]>, users: [] as { uid: string; email?: string }[] };
  const commit = async () => {
    if (state.hang) return new Promise(() => {});
    if (state.fail) throw new Error('down');
  };
  return {
    state,
    batch: () => ({ set: (ref: any, data: any) => state.sets.push({ path: ref.path, data }), delete: (ref: any) => { for (const rows of Object.values(state.docs)) { const i = rows.indexOf(ref.row); if (i >= 0) rows.splice(i, 1); } }, commit }),
    doc: (path: string) => ({ path, set: async (data: any) => { state.sets.push({ path, data }); await commit(); } }),
    collectionGroup: (name: string) => {
      const rows = () => (state.docs[name] || []);
      return {
        aggregate: () => ({ get: async () => ({ data: () => ({ count: rows().length, bytes: rows().length ? rows().reduce((s, r) => s + (r.modelBytes ?? 0), 0) : null }) }) }),
        where: () => ({ count: () => ({ get: async () => ({ data: () => ({ count: rows().filter(r => typeof r.modelBytes === 'number').length }) }) }) }),
      };
    },
    collection: (name: string) => {
      const filters: [string, string, string][] = [];
      const query = {
        max: Infinity,
        where(field: string, op: string, value: string) { filters.push([field, op, value]); return query; },
        limit(n: number) { query.max = n; return query; },
        async get() {
          const rows = (state.docs[name] || []).filter(d => filters.every(([f, op, v]) => op === '>=' ? d[f] >= v : op === '<' ? d[f] < v : d[f] <= v)).slice(0, query.max);
          return { empty: !rows.length, size: rows.length, docs: rows.map(r => ({ data: () => r, ref: { row: r } })) };
        },
      };
      return query;
    },
    auth: {
      listUsers: async (max: number, token?: string) => {
        const start = token ? Number(token) : 0;
        const users = state.users.slice(start, start + max);
        return { users, pageToken: start + max < state.users.length ? String(start + max) : undefined };
      },
      getUsers: async (ids: { uid: string }[]) => ({ users: state.users.filter(u => ids.some(i => i.uid === u.uid)) }),
    },
  };
});
vi.mock('../_lib/admin.js', () => ({ getAdminDb: () => db, getAdminAuth: () => db.auth }));
vi.mock('firebase-admin/firestore', () => ({
  AggregateField: { count: () => ({ op: 'count' }), sum: (field: string) => ({ op: 'sum', field }) },
  FieldValue: { increment: (n: number) => ({ inc: n }) },
  Timestamp: { fromMillis: (ms: number) => ({ ms }) },
}));
const session = vi.hoisted(() => ({ uid: 'admin' as string | null }));
vi.mock('../_lib/sessionAuth.js', () => ({ authenticateSession: vi.fn(async () => session.uid) }));

import { bucketKey, classify, percentile, recordUsage, withUsage } from '../_lib/usage';
import handler, { isAdministrator, isCronRequest, readStatistics } from '../usage';
import { purgeAccountTotals } from '../_lib/usage';

beforeEach(() => {
  Object.assign(db.state, { sets: [], fail: false, hang: false, docs: {}, users: [] });
  session.uid = 'admin';
  vi.stubEnv('SKAITCH_ADMIN_UIDS', 'admin, other');
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

it('classifies outcomes by response code, revision conflicts and cancellations being refusals', () => {
  expect([classify(200, false), classify(409, false), classify(499, false), classify(502, false), classify(200, true), classify(504, false)])
    .toEqual(['ok', 'refused', 'refused', 'failed', 'timeout', 'timeout']);
});

it('places durations in the fixed buckets at their bounds', () => {
  expect([bucketKey(0, 'ok'), bucketKey(999, 'ok'), bucketKey(1000, 'ok'), bucketKey(4999, 'failed'), bucketKey(5000, 'ok'), bucketKey(30_000, 'ok'), bucketKey(169_999, 'ok'), bucketKey(500_000, 'ok'), bucketKey(10, 'timeout')])
    .toEqual(['lt1s', 'lt1s', 's1to5', 's1to5', 's5to30', 's30to170', 's30to170', 's30to170', 'timeout']);
});

it('estimates the median and 95th percentile from the buckets', () => {
  expect(percentile({ lt1s: 5, s1to5: 4, s5to30: 1 }, 0.5)).toBe(1000);
  expect(percentile({ lt1s: 5, s1to5: 4, s5to30: 1 }, 0.95)).toBe(30_000);
  expect(percentile({ timeout: 1 }, 0.5)).toBeNull();
  expect(percentile({}, 0.5)).toBeNull();
});

it('counts one operation set and one account set on the UTC day, with cumulated duration and expiry', async () => {
  await recordUsage({ endpoint: 'bim', operation: 'import-ifc', uid: 'u1', outcome: 'ok', ms: 1300, now: new Date('2026-11-16T23:59:59Z') });
  await recordUsage({ endpoint: 'bim', operation: 'import-ifc', uid: 'u1', outcome: 'ok', ms: 10, now: new Date('2026-11-17T00:00:00Z') });
  const [op, account, nextDay] = db.state.sets;
  expect(op.path).toBe('usage_operations/2026-11-16_bim:import-ifc');
  expect(op.data).toMatchObject({ operation: 'bim:import-ifc', totalMs: { inc: 1300 }, outcomes: { ok: { inc: 1 } }, durations: { s1to5: { inc: 1 } } });
  expect(op.data.expireAt).toBeUndefined();
  expect(JSON.stringify(op.data)).not.toContain('u1');
  expect(account.path).toBe('usage_accounts/2026-11-16_u1');
  expect(account.data).toMatchObject({ totalMs: { inc: 1300 }, operations: { 'bim:import-ifc': { inc: 1 } } });
  expect(account.data.expireAt.ms).toBe(Date.parse('2026-11-16') + 91 * 86_400_000);
  expect(nextDay.path).toBe('usage_operations/2026-11-17_bim:import-ifc');
});

it('bounds operation names', async () => {
  await recordUsage({ endpoint: 'mcp', operation: '../../evil doc', uid: 'u', outcome: 'refused', ms: 1 });
  expect(db.state.sets[0].data.operation).toBe('mcp:unknown');
});

const run = (fill: (usage: any, res: any) => void) => withUsage('ai', async (_req, res, usage) => fill(usage, res))({ method: 'POST' }, { statusCode: 0 });

it('counts an authentication reject only in the anonymous daily total', async () => {
  await run(usage => { usage.operation = 'chat'; usage.authRejected = true; });
  expect(db.state.sets).toHaveLength(1);
  expect(db.state.sets[0].path).toMatch(/^usage_auth_rejects\/\d{4}-\d{2}-\d{2}$/);
  expect(JSON.stringify(db.state.sets[0].data)).not.toContain('chat');
});

it('counts nothing without an operation or an account', async () => {
  await run(usage => { usage.uid = 'u'; });
  await run(usage => { usage.operation = 'chat'; });
  expect(db.state.sets).toHaveLength(0);
});

it('lets a handler override the outcome of a streamed response', async () => {
  await run((usage, res) => { usage.operation = 'chat'; usage.uid = 'u'; res.statusCode = 200; usage.outcome = 'failed'; });
  expect(db.state.sets[0].data.outcomes).toEqual({ failed: { inc: 1 } });
});

it('never fails nor holds the user operation when counting fails or hangs', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  db.state.fail = true;
  await expect(run((usage, res) => { usage.operation = 'chat'; usage.uid = 'u'; res.statusCode = 200; })).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalled();
  db.state.fail = false; db.state.hang = true;
  vi.useFakeTimers();
  const pending = run(usage => { usage.operation = 'chat'; usage.uid = 'u'; });
  await vi.advanceTimersByTimeAsync(1_500);
  await expect(pending).resolves.toBeUndefined();
  warn.mockRestore();
});

it('recognises administrators from the environment list only', () => {
  expect(isAdministrator('a', 'a,b')).toBe(true);
  expect(isAdministrator('b', ' a ;  b\n')).toBe(true);
  expect(isAdministrator('c', 'a,b')).toBe(false);
  expect(isAdministrator('a', '')).toBe(false);
  expect(isAdministrator('a', undefined)).toBe(false);
  expect(isAdministrator('', ',,')).toBe(false);
  expect(isAdministrator(null, 'a')).toBe(false);
});

async function get(url = '/api/usage?days=30', options: { method?: string; headers?: Record<string, string> } = {}) {
  const res: any = { statusCode: 0, headers: {}, body: '', setHeader(k: string, v: string) { this.headers[k] = v; }, end(b: string) { this.body = b; } };
  await handler({ url, method: options.method ?? 'GET', headers: { host: 'skaitch.test', authorization: 'Bearer t', ...options.headers } }, res);
  return { status: res.statusCode, data: res.body ? JSON.parse(res.body) : null };
}

it('answers "not found" to anyone who is not an administrator', async () => {
  session.uid = null; expect((await get()).status).toBe(404);
  session.uid = 'someone'; expect((await get()).status).toBe(404);
  expect((await get('/api/usage?check=1')).status).toBe(404);
  vi.stubEnv('SKAITCH_ADMIN_UIDS', '');
  session.uid = 'admin'; expect((await get()).status).toBe(404);
});

it('refuses cross-site requests, writes and invalid periods', async () => {
  expect((await get('/api/usage', { headers: { origin: 'https://evil.test' } })).status).toBe(403);
  expect((await get('/api/usage', { method: 'POST' })).status).toBe(404);
  expect((await get('/api/usage?days=12')).status).toBe(400);
  expect(await get('/api/usage?check=1')).toEqual({ status: 200, data: { administrator: true } });
});

it('returns an empty period without error', async () => {
  const { status, data } = await get('/api/usage?days=7');
  expect(status).toBe(200);
  expect(data.operationsPerDay).toHaveLength(7);
  expect(data.operations).toEqual([]);
  expect(data.topAccounts.byCalls).toEqual([]);
  expect(data.accounts).toMatchObject({ total: 0, active7: 0, active30: 0 });
  expect(data.storage).toEqual({ projects: 0, modelBytes: 0, unsizedProjects: 0 });
});

it('aggregates the blocks over 7, 30 and 90 days', async () => {
  db.state.users = Array.from({ length: 1500 }, (_, i) => ({ uid: `x${i}` })).concat([{ uid: 'a', email: 'a@test' }, { uid: 'b', email: 'b@test' }]);
  db.state.docs = {
    usage_operations: [
      { day: '2026-11-15', operation: 'bim:import-ifc', calls: 3, totalMs: 1500, outcomes: { ok: 1, refused: 1, failed: 1 }, durations: { lt1s: 3 } },
      { day: '2026-11-16', operation: 'bim:import-ifc', calls: 1, totalMs: 6000, outcomes: { timeout: 1 }, durations: { timeout: 1 } },
      { day: '2026-10-01', operation: 'ai:chat', calls: 9, totalMs: 900, outcomes: { ok: 9 }, durations: { lt1s: 9 } },
    ],
    usage_accounts: [
      { day: '2026-11-15', uid: 'a', calls: 3, totalMs: 1500 },
      { day: '2026-11-16', uid: 'b', calls: 1, totalMs: 6000 },
      { day: '2026-10-25', uid: 'c', calls: 50, totalMs: 10 },
      { day: '2026-10-01', uid: 'd', calls: 9, totalMs: 900 },
    ],
    usage_auth_rejects: [{ day: '2026-11-16', count: 4 }, { day: '2026-11-01', count: 1 }],
  };
  const week = await readStatistics(7, '2026-11-16');
  expect(week.period).toEqual({ days: 7, from: '2026-11-10', to: '2026-11-16' });
  expect(week.accounts).toEqual({ total: 1502, active7: 2, active30: 3, activeInPeriod: 2 });
  expect(week.operationsPerDay.at(-1)).toEqual({ day: '2026-11-16', operations: { 'bim:import-ifc': 1 } });
  expect(week.operations).toHaveLength(1);
  expect(week.operations[0]).toMatchObject({ operation: 'bim:import-ifc', calls: 4, errorRate: 0.5, p50Ms: 1000, p95Ms: null });
  expect(week.authRejects.at(-1)).toEqual({ day: '2026-11-16', count: 4 });
  expect(week.topAccounts.byCalls.map(a => [a.uid, a.email])).toEqual([['a', 'a@test'], ['b', 'b@test']]);
  expect(week.topAccounts.byDuration[0].uid).toBe('b');

  const month = await readStatistics(30, '2026-11-16');
  expect(month.topAccounts.byCalls[0]).toMatchObject({ uid: 'c', email: null, calls: 50 });
  expect(month.authRejects.reduce((s, d) => s + d.count, 0)).toBe(5);
  const quarter = await readStatistics(90, '2026-11-16');
  expect(quarter.operations.map(o => o.operation)).toEqual(['ai:chat', 'bim:import-ifc']);
  expect(quarter.accounts.activeInPeriod).toBe(4);
});

it('keeps only the ten biggest accounts', async () => {
  db.state.docs = { usage_accounts: Array.from({ length: 12 }, (_, i) => ({ day: '2026-11-16', uid: `u${i}`, calls: i, totalMs: 100 - i })) };
  const stats = await readStatistics(7, '2026-11-16');
  expect(stats.topAccounts.byCalls).toHaveLength(10);
  expect(stats.topAccounts.byCalls[0].uid).toBe('u11');
  expect(stats.topAccounts.byDuration[0].uid).toBe('u0');
});

it('sums model sizes, projects never re-saved counting for zero', async () => {
  db.state.docs = { projects: [{ modelBytes: 1000 }] };
  expect((await readStatistics(7, '2026-11-16')).storage).toEqual({ projects: 1, modelBytes: 1000, unsizedProjects: 0 });
  db.state.docs = { projects: [{ modelBytes: 1000 }, { modelBytes: 24 }, {}] };
  expect((await readStatistics(7, '2026-11-16')).storage).toEqual({ projects: 3, modelBytes: 1024, unsizedProjects: 1 });
});

it('purges per-account totals older than 90 days, by batches, and keeps operation totals', async () => {
  const old = Array.from({ length: 450 }, (_, i) => ({ day: '2026-08-17', uid: `o${i}` }));
  db.state.docs = { usage_accounts: [...old, { day: '2026-08-18', uid: 'kept' }], usage_operations: [{ day: '2020-01-01', operation: 'bim:x' }] };
  expect(await purgeAccountTotals(new Date('2026-11-16T12:00:00Z'))).toBe(450);
  expect(db.state.docs.usage_accounts.map(d => d.uid)).toEqual(['kept']);
  expect(db.state.docs.usage_operations).toHaveLength(1);
});

it('runs the purge only for the cron secret', async () => {
  expect(isCronRequest('Bearer s3cret', 's3cret')).toBe(true);
  expect(isCronRequest('Bearer wrong', 's3cret')).toBe(false);
  expect(isCronRequest('Bearer ', '')).toBe(false);
  expect(isCronRequest(undefined, 's3cret')).toBe(false);
  vi.stubEnv('CRON_SECRET', 's3cret');
  db.state.docs = { usage_accounts: [{ day: '2000-01-01', uid: 'x' }] };
  expect((await get('/api/usage?purge=1')).status).toBe(404);
  expect(db.state.docs.usage_accounts).toHaveLength(1);
  expect(await get('/api/usage?purge=1', { headers: { authorization: 'Bearer s3cret' } })).toEqual({ status: 200, data: { deleted: 1 } });
});
