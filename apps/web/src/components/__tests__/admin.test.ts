import { expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../../lib/firebase', () => ({ auth: { currentUser: null } }));
import { StatisticsView } from '../admin/AdminPage';
import AdminLink from '../admin/AdminLink';
import type { UsageStatistics } from '../../lib/adminClient';

const stats: UsageStatistics = {
  period: { days: 7, from: '2026-11-10', to: '2026-11-16' },
  accounts: { total: 42, active7: 5, active30: 12, activeInPeriod: 5 },
  operationsPerDay: [{ day: '2026-11-15', operations: {} }, { day: '2026-11-16', operations: { 'bim:import-ifc': 3, 'ai:chat': 2 } }],
  operations: [{ operation: 'bim:import-ifc', calls: 3, totalMs: 4000, errorRate: 1 / 3, outcomes: { ok: 1, refused: 1, failed: 1, timeout: 0 }, p50Ms: 1000, p95Ms: 5000 }],
  authRejects: [{ day: '2026-11-15', count: 1 }, { day: '2026-11-16', count: 2 }],
  topAccounts: { byCalls: [{ uid: 'u1', email: 'one@test', calls: 3, totalMs: 4000 }], byDuration: [{ uid: 'u2', email: null, calls: 1, totalMs: 90_000 }] },
  storage: { projects: 7, modelBytes: 3 * 1024 * 1024, unsizedProjects: 2 },
};

it('shows the statistics blocks from a response', () => {
  const html = renderToStaticMarkup(createElement(StatisticsView, { stats }));
  for (const text of ['Comptes', 'Opérations par jour', 'Erreurs et durées', 'Dix plus gros comptes', '42', 'bim:import-ifc', 'ai:chat', '33,3 %', 'one@test', 'u2', '1,5 min', 'Stockage', '3 Mo', '2 projet(s) jamais resauvegardé(s)', "Rejets d'authentification"])
    expect(html).toContain(text.replace("'", '&#x27;'));
  expect(html).toContain('3 sur la période, dont 2 aujourd');
});

it('shows empty periods without error', () => {
  const html = renderToStaticMarkup(createElement(StatisticsView, { stats: { ...stats, operationsPerDay: [], operations: [], topAccounts: { byCalls: [], byDuration: [] } } }));
  expect(html).toContain('Aucune opération sur la période.');
  expect(html).toContain('Aucun compte actif.');
  const sized = renderToStaticMarkup(createElement(StatisticsView, { stats: { ...stats, storage: { projects: 0, modelBytes: 0, unsizedProjects: 0 } } }));
  expect(sized).toContain('0 Ko');
  expect(sized).not.toContain('jamais resauvegardé');
});

it('shows no administration entry until the server confirms the role', () => {
  expect(renderToStaticMarkup(createElement(AdminLink))).toBe('');
});
