import type { User } from 'firebase/auth';

export type Period = 7 | 30 | 90;
export interface OperationStats {
  operation: string; calls: number; totalMs: number; errorRate: number;
  outcomes: { ok: number; refused: number; failed: number; timeout: number };
  p50Ms: number | null; p95Ms: number | null;
}
export interface TopAccount { uid: string; email: string | null; calls: number; totalMs: number }
export interface UsageStatistics {
  period: { days: Period; from: string; to: string };
  accounts: { total: number; active7: number; active30: number; activeInPeriod: number };
  operationsPerDay: { day: string; operations: Record<string, number> }[];
  operations: OperationStats[];
  authRejects: { day: string; count: number }[];
  topAccounts: { byCalls: TopAccount[]; byDuration: TopAccount[] };
  storage: { projects: number; modelBytes: number; unsizedProjects: number };
}

async function get(user: User, query: string): Promise<Response> {
  return fetch(`/api/usage?${query}`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, credentials: 'same-origin', cache: 'no-store' });
}

/** The role is decided by the server only; any failure means "not an administrator". */
export async function isAdministrator(user: User): Promise<boolean> {
  try { return (await get(user, 'check=1')).ok; } catch { return false; }
}

export class NotFoundError extends Error {}

export async function fetchUsageStatistics(user: User, days: Period): Promise<UsageStatistics> {
  const response = await get(user, `days=${days}`);
  if (response.status === 404) throw new NotFoundError('Introuvable.');
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json()).error; } catch { /* keep default */ }
    throw new Error(detail || `Statistiques indisponibles (${response.status}).`);
  }
  return response.json();
}
