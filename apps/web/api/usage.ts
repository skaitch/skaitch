import { AggregateField } from 'firebase-admin/firestore';
import { isAdministrator } from './_lib/adminRole.js';
import { authenticateSession } from './_lib/sessionAuth.js';
import { getAdminAuth, getAdminDb } from './_lib/admin.js';
import { timingSafeEqual } from 'node:crypto';
import { purgeAccountTotals, ACCOUNTS_COLLECTION, AUTH_REJECTS_COLLECTION, BUCKET_KEYS, OPERATIONS_COLLECTION, OUTCOMES, percentile, utcDay } from './_lib/usage.js';

export { isAdministrator };

export function isCronRequest(authorization: unknown, secret = process.env.CRON_SECRET): boolean {
  if (!secret || typeof authorization !== 'string') return false;
  const expected = Buffer.from(`Bearer ${secret}`), given = Buffer.from(authorization);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const PERIODS = [7, 30, 90] as const;
const DAY_MS = 86_400_000;
const dayBefore = (day: string, n: number) => utcDay(new Date(Date.parse(day) - n * DAY_MS));

type Totals = { calls: number; totalMs: number; outcomes: Record<string, number>; durations: Record<string, number> };
const empty = (): Totals => ({ calls: 0, totalMs: 0, outcomes: Object.fromEntries(OUTCOMES.map(o => [o, 0])), durations: Object.fromEntries(BUCKET_KEYS.map(k => [k, 0])) });
function add(into: Totals, doc: any) {
  into.calls += doc.calls || 0;
  into.totalMs += doc.totalMs || 0;
  for (const o of OUTCOMES) into.outcomes[o] += doc.outcomes?.[o] || 0;
  for (const k of BUCKET_KEYS) into.durations[k] += doc.durations?.[k] || 0;
}
/** Error rate = (failed + timed out) / total; refusals are reported apart. */
const summarize = (t: Totals) => ({
  ...t,
  errorRate: t.calls ? (t.outcomes.failed + t.outcomes.timeout) / t.calls : 0,
  p50Ms: percentile(t.durations, 0.5),
  p95Ms: percentile(t.durations, 0.95),
});

async function countAccounts(): Promise<number> {
  const auth = getAdminAuth();
  let total = 0, pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    total += page.users.length;
    pageToken = page.pageToken;
  } while (pageToken);
  return total;
}

/** Emails are resolved at display time and never copied into the counters. */
async function emails(uids: string[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>(uids.map(uid => [uid, null]));
  if (!uids.length) return result;
  const { users } = await getAdminAuth().getUsers(uids.map(uid => ({ uid })));
  for (const user of users) result.set(user.uid, user.email ?? null);
  return result;
}

/** Project count and model size, computed on display. Projects never re-saved since sizes exist count for zero. */
async function readStorage() {
  const projects = getAdminDb().collectionGroup('projects');
  const [all, sized] = await Promise.all([
    projects.aggregate({ count: AggregateField.count(), bytes: AggregateField.sum('modelBytes') }).get(),
    projects.where('modelBytes', '>=', 0).count().get(),
  ]);
  const count = all.data().count;
  return { projects: count, modelBytes: all.data().bytes ?? 0, unsizedProjects: count - sized.data().count };
}

/** Builds the statistics blocks for the last `days` UTC days, today included. */
export async function readStatistics(days: number, today = utcDay()) {
  const from = dayBefore(today, days - 1);
  const accountsFrom = dayBefore(today, Math.max(days, 30) - 1);
  const db = getAdminDb();
  const range = (collection: string, start: string) => db.collection(collection).where('day', '>=', start).where('day', '<=', today).get();
  const [ops, accountDays, rejects, totalAccounts, storage] = await Promise.all([
    range(OPERATIONS_COLLECTION, from), range(ACCOUNTS_COLLECTION, accountsFrom), range(AUTH_REJECTS_COLLECTION, from), countAccounts(), readStorage(),
  ]);

  const byOperation = new Map<string, Totals>();
  const byDay = new Map<string, Record<string, number>>();
  for (const snap of ops.docs) {
    const doc = snap.data();
    if (!byOperation.has(doc.operation)) byOperation.set(doc.operation, empty());
    add(byOperation.get(doc.operation)!, doc);
    if (!byDay.has(doc.day)) byDay.set(doc.day, {});
    byDay.get(doc.day)![doc.operation] = (byDay.get(doc.day)![doc.operation] || 0) + (doc.calls || 0);
  }

  const active = { d7: new Set<string>(), d30: new Set<string>(), period: new Set<string>() };
  const byAccount = new Map<string, Totals>();
  for (const snap of accountDays.docs) {
    const doc = snap.data();
    if (doc.day >= dayBefore(today, 6)) active.d7.add(doc.uid);
    if (doc.day >= dayBefore(today, 29)) active.d30.add(doc.uid);
    if (doc.day < from) continue;
    active.period.add(doc.uid);
    if (!byAccount.has(doc.uid)) byAccount.set(doc.uid, empty());
    add(byAccount.get(doc.uid)!, doc);
  }
  const accounts = [...byAccount].map(([uid, t]) => ({ uid, calls: t.calls, totalMs: t.totalMs }));
  const topByCalls = [...accounts].sort((a, b) => b.calls - a.calls || b.totalMs - a.totalMs).slice(0, 10);
  const topByDuration = [...accounts].sort((a, b) => b.totalMs - a.totalMs || b.calls - a.calls).slice(0, 10);
  const mails = await emails([...new Set([...topByCalls, ...topByDuration].map(a => a.uid))]);
  const withEmail = (list: typeof accounts) => list.map(a => ({ ...a, email: mails.get(a.uid) ?? null }));

  const dayList = Array.from({ length: days }, (_, i) => dayBefore(today, days - 1 - i));
  const rejectByDay = new Map(rejects.docs.map(s => [s.data().day, s.data().count || 0]));
  return {
    period: { days, from, to: today },
    accounts: { total: totalAccounts, active7: active.d7.size, active30: active.d30.size, activeInPeriod: active.period.size },
    operationsPerDay: dayList.map(day => ({ day, operations: byDay.get(day) ?? {} })),
    operations: [...byOperation].sort((a, b) => b[1].calls - a[1].calls).map(([operation, t]) => ({ operation, ...summarize(t) })),
    authRejects: dayList.map(day => ({ day, count: rejectByDay.get(day) ?? 0 })),
    topAccounts: { byCalls: withEmail(topByCalls), byDuration: withEmail(topByDuration) },
    storage,
  };
}

/**
 * GET /api/usage?days=7|30|90 — read-only statistics for administrators.
 * GET /api/usage?check=1 — answers 200 only to administrators (used to show the menu entry).
 * Everyone else, with or without a valid token, gets "not found". This function is not counted.
 */
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'private, no-store');
  const send = (status: number, body: unknown) => {
    res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body));
  };
  const notFound = () => send(404, { error: 'Introuvable.' });
  try {
    if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) return send(403, { error: 'Requête intersite refusée.' });
  } catch { return send(403, { error: 'Origine invalide.' }); }
  if (req.method !== 'GET') return notFound();
  const params = new URL(req.url, 'http://usage.local').searchParams;
  // Daily Vercel cron: Authorization is "Bearer $CRON_SECRET".
  if (params.has('purge')) {
    if (!isCronRequest(req.headers.authorization)) return notFound();
    try { return send(200, { deleted: await purgeAccountTotals() }); }
    catch (error) { console.error('[usage purge]', error); return send(503, { error: 'Purge indisponible.' }); }
  }
  let uid: string | null = null;
  try { uid = await authenticateSession(req.headers.authorization); } catch { return notFound(); }
  if (!isAdministrator(uid)) return notFound();

  if (params.has('check')) return send(200, { administrator: true });
  const days = Number(params.get('days') ?? 30);
  if (!(PERIODS as readonly number[]).includes(days)) return send(400, { error: 'Période invalide : 7, 30 ou 90 jours.' });
  try {
    const [stats] = await Promise.all([readStatistics(days), purgeAccountTotals().catch(error => console.warn('[usage purge]', error))]);
    send(200, stats);
  }
  catch (error) {
    console.error('[usage api]', error);
    // Administrators only reach this point, so the cause can be shown to them.
    const detail = error instanceof Error ? `${(error as any).code ?? error.name}: ${error.message}` : String(error);
    send(503, { error: `Statistiques indisponibles. ${detail}`.slice(0, 500) });
  }
}
