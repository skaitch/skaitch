import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { fetchUsageStatistics, NotFoundError, type OperationStats, type Period, type TopAccount, type UsageStatistics } from '../../lib/adminClient';

const PERIODS: Period[] = [7, 30, 90];
const number = (n: number) => n.toLocaleString('fr-FR');
const percent = (n: number) => `${(n * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
/** Bucket upper bound; null means the call reached the timeout bucket. */
const bound = (ms: number | null) => ms === null ? '—' : ms < 1000 ? `< ${ms} ms` : `≤ ${ms / 1000} s`;
const size = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Ko` : `${(bytes / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
const duration = (ms: number) => ms < 60_000 ? `${(ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s` : `${(ms / 60_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} min`;

function Block({ title, children }: { title: string; children: ReactNode }) {
  return <section className="admin-block"><h2>{title}</h2>{children}</section>;
}

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className="admin-empty">{empty}</p>;
  return (
    <div className="admin-scroll">
      <table className="admin-table">
        <thead><tr>{head.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const accountRows = (list: TopAccount[]) => list.map(a => [a.email ?? <code>{a.uid}</code>, number(a.calls), duration(a.totalMs)]);

/** The five statistics blocks, from an already-loaded response. */
export function StatisticsView({ stats }: { stats: UsageStatistics }) {
  const operationNames = [...new Set(stats.operationsPerDay.flatMap(d => Object.keys(d.operations)))].sort();
  const days = [...stats.operationsPerDay].reverse();
  return (
    <>
      <Block title="Comptes">
        <dl className="admin-figures">
          <div><dt>Comptes</dt><dd>{number(stats.accounts.total)}</dd></div>
          <div><dt>Actifs sur 7 jours</dt><dd>{number(stats.accounts.active7)}</dd></div>
          <div><dt>Actifs sur 30 jours</dt><dd>{number(stats.accounts.active30)}</dd></div>
        </dl>
      </Block>
      <Block title="Opérations par jour">
        <Table empty="Aucune opération sur la période."
          head={['Jour (UTC)', ...operationNames, 'Total']}
          rows={operationNames.length ? days.map(d => [d.day, ...operationNames.map(op => number(d.operations[op] ?? 0)), number(Object.values(d.operations).reduce((a, b) => a + b, 0))]) : []} />
      </Block>
      <Block title="Erreurs et durées">
        <Table empty="Aucune opération sur la période."
          head={['Opération', 'Appels', "Taux d'erreur", 'Refusées', 'Délais dépassés', 'Médiane', '95e centile']}
          rows={stats.operations.map((o: OperationStats) => [<code>{o.operation}</code>, number(o.calls), percent(o.errorRate), number(o.outcomes.refused), number(o.outcomes.timeout), bound(o.p50Ms), bound(o.p95Ms)])} />
        <p className="admin-note">Taux d'erreur = (en échec + délais dépassés) / appels. Médiane et centile sont estimés par tranche de durée.</p>
        <h3>Rejets d'authentification</h3>
        <p>{number(stats.authRejects.reduce((sum, d) => sum + d.count, 0))} sur la période, dont {number(stats.authRejects[stats.authRejects.length - 1]?.count ?? 0)} aujourd'hui.</p>
      </Block>
      <Block title="Dix plus gros comptes">
        <div className="admin-columns">
          <div><h3>En appels</h3><Table empty="Aucun compte actif." head={['Compte', 'Appels', 'Durée cumulée']} rows={accountRows(stats.topAccounts.byCalls)} /></div>
          <div><h3>En durée cumulée</h3><Table empty="Aucun compte actif." head={['Compte', 'Appels', 'Durée cumulée']} rows={accountRows(stats.topAccounts.byDuration)} /></div>
        </div>
      </Block>
      <Block title="Stockage">
        <dl className="admin-figures">
          <div><dt>Projets</dt><dd>{number(stats.storage.projects)}</dd></div>
          <div><dt>Taille des modèles</dt><dd>{size(stats.storage.modelBytes)}</dd></div>
        </dl>
        {stats.storage.unsizedProjects > 0 && <p className="admin-note">{number(stats.storage.unsizedProjects)} projet(s) jamais resauvegardé(s) depuis la mesure ne sont pas comptés dans la taille.</p>}
      </Block>
    </>
  );
}

/** /admin: read-only usage statistics. Anyone the server does not confirm as administrator sees "not found". */
export default function AdminPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [days, setDays] = useState<Period>(30);
  const [stats, setStats] = useState<UsageStatistics | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => onAuthStateChanged(auth, setUser), []);
  const load = useCallback(async () => {
    if (!user) return;
    setState(current => current === 'ready' ? 'ready' : 'loading');
    try { setStats(await fetchUsageStatistics(user, days)); setState('ready'); setError(''); }
    catch (e) {
      if (e instanceof NotFoundError) setState('notfound');
      else { setError((e as Error).message); setState('error'); }
    }
  }, [user, days]);
  useEffect(() => { if (user === null) setState('notfound'); else void load(); }, [user, load]);

  if (state === 'notfound') return <main className="admin-page"><h1>Introuvable</h1><p><a href="/">Retour à skAItch</a></p></main>;
  return (
    <main className="admin-page">
      <header className="admin-header">
        <h1>Administration</h1>
        <div className="admin-actions">
          <div role="group" aria-label="Période" className="admin-periods">
            {PERIODS.map(p => <button key={p} className="btn" aria-pressed={days === p} onClick={() => setDays(p)}>{p} jours</button>)}
          </div>
          <button className="btn" onClick={() => void load()}>Actualiser</button>
          <a className="btn" href="/">Retour</a>
        </div>
      </header>
      {state === 'loading' && !stats && <p>Chargement…</p>}
      {state === 'error' && <p role="alert">{error}</p>}
      {stats && <StatisticsView stats={stats} />}
    </main>
  );
}
