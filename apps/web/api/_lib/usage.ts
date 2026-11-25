import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from './admin.js';

/** Daily aggregated usage counters (ADR 0005). No per-call record and no content is ever stored. */
export type Outcome = 'ok' | 'refused' | 'failed' | 'timeout';
export const OUTCOMES: Outcome[] = ['ok', 'refused', 'failed', 'timeout'];
/** Fixed duration buckets: < 1 s, 1–5 s, 5–30 s, 30–170 s, then timed-out calls. */
export const BUCKETS = [
  { key: 'lt1s', upperMs: 1_000 },
  { key: 's1to5', upperMs: 5_000 },
  { key: 's5to30', upperMs: 30_000 },
  { key: 's30to170', upperMs: 170_000 },
  { key: 'timeout', upperMs: null },
] as const;
export const BUCKET_KEYS = BUCKETS.map(b => b.key) as string[];
export const OPERATIONS_COLLECTION = 'usage_operations';
export const ACCOUNTS_COLLECTION = 'usage_accounts';
export const AUTH_REJECTS_COLLECTION = 'usage_auth_rejects';
export const ACCOUNT_RETENTION_DAYS = 90;
/** The user's response is never held longer than this by counting. */
export const COUNTING_BUDGET_MS = 1_500;

export function bucketKey(ms: number, outcome: Outcome): string {
  if (outcome === 'timeout') return 'timeout';
  return BUCKETS.find(b => b.upperMs !== null && ms < b.upperMs)?.key ?? 's30to170';
}

export function utcDay(date = new Date()): string { return date.toISOString().slice(0, 10); }

/** Operation names are bounded so a client cannot create arbitrary documents. */
const safe = (value: string) => /^[a-z0-9:_-]{1,64}$/i.test(value) ? value : 'unknown';

/** 2xx ok · 4xx refused (incl. 409 revision conflict, user cancellation) · 5xx failed · timeout. */
export function classify(status: number, timedOut: boolean): Outcome {
  if (timedOut || status === 504) return 'timeout';
  if (status >= 500) return 'failed';
  if (status >= 400) return 'refused';
  return 'ok';
}

export async function recordUsage(entry: { endpoint: string; operation: string; uid: string; outcome: Outcome; ms: number; now?: Date }) {
  const now = entry.now ?? new Date();
  const day = utcDay(now);
  const operation = `${entry.endpoint}:${safe(entry.operation)}`;
  const ms = Math.max(0, Math.round(entry.ms));
  const counts = { calls: FieldValue.increment(1), totalMs: FieldValue.increment(ms), outcomes: { [entry.outcome]: FieldValue.increment(1) }, durations: { [bucketKey(ms, entry.outcome)]: FieldValue.increment(1) } };
  const db = getAdminDb();
  const batch = db.batch();
  batch.set(db.doc(`${OPERATIONS_COLLECTION}/${day}_${operation}`), { day, operation, ...counts }, { merge: true });
  // expireAt lets a Firestore TTL policy take over if billing is enabled; purgeAccountTotals does it otherwise.
  const expireAt = Timestamp.fromMillis(Date.parse(day) + (ACCOUNT_RETENTION_DAYS + 1) * 86_400_000);
  batch.set(db.doc(`${ACCOUNTS_COLLECTION}/${day}_${entry.uid}`), { day, uid: entry.uid, expireAt, ...counts, operations: { [operation]: FieldValue.increment(1) } }, { merge: true });
  await batch.commit();
}

/**
 * Deletes per-account totals older than the retention period (TTL needs Firestore billing).
 * Runs daily from the Vercel cron and on each administrator read. Returns the number deleted.
 */
export async function purgeAccountTotals(now = new Date(), maxBatches = 20): Promise<number> {
  const cutoff = utcDay(new Date(Date.parse(utcDay(now)) - ACCOUNT_RETENTION_DAYS * 86_400_000));
  const db = getAdminDb();
  let deleted = 0;
  for (let i = 0; i < maxBatches; i++) {
    const old = await db.collection(ACCOUNTS_COLLECTION).where('day', '<', cutoff).limit(400).get();
    if (old.empty) break;
    const batch = db.batch();
    for (const doc of old.docs) batch.delete(doc.ref);
    await batch.commit();
    deleted += old.size;
    if (old.size < 400) break;
  }
  return deleted;
}

/** Requests without a valid token only feed an anonymous daily total. */
export async function recordAuthReject(endpoint: string, now = new Date()) {
  const day = utcDay(now);
  await getAdminDb().doc(`${AUTH_REJECTS_COLLECTION}/${day}`).set({ day, count: FieldValue.increment(1), endpoints: { [endpoint]: FieldValue.increment(1) } }, { merge: true });
}

/** What a handler tells the wrapper about the call. Nothing is counted while `operation` is null. */
export interface UsageContext { operation: string | null; uid: string | null; timedOut: boolean; authRejected: boolean; outcome?: Outcome }

const withinBudget = (work: Promise<unknown>) => Promise.race([work, new Promise(resolve => setTimeout(resolve, COUNTING_BUDGET_MS).unref?.())]);

/**
 * Wraps a serverless handler and counts the call once its response has ended.
 * Counting failures are logged and never change the user's operation.
 */
export function withUsage(endpoint: string, handler: (req: any, res: any, usage: UsageContext) => Promise<void>) {
  return async (req: any, res: any) => {
    const usage: UsageContext = { operation: null, uid: null, timedOut: false, authRejected: false };
    const start = Date.now();
    try { await handler(req, res, usage); }
    finally {
      let work: Promise<unknown> | null = null;
      try {
        if (usage.authRejected) work = recordAuthReject(endpoint);
        else if (usage.operation && usage.uid) {
          work = recordUsage({ endpoint, operation: usage.operation, uid: usage.uid, outcome: usage.outcome ?? classify(res.statusCode || 200, usage.timedOut), ms: Date.now() - start });
        }
      } catch (error) { console.warn('[usage] counter update failed', error); }
      if (work) await withinBudget(work.catch(error => console.warn('[usage] counter update failed', error)));
    }
  };
}

/** Approximate percentile: upper bound of the bucket holding the q-th call; null for the timeout bucket or no data. */
export function percentile(durations: Record<string, number>, q: number): number | null {
  const total = BUCKET_KEYS.reduce((sum, key) => sum + (durations[key] || 0), 0);
  if (!total) return null;
  let seen = 0;
  for (const bucket of BUCKETS) {
    seen += durations[bucket.key] || 0;
    if (seen >= q * total) return bucket.upperMs;
  }
  return null;
}
