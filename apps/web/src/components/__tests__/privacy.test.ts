import { expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('firebase-admin/firestore', () => ({ FieldValue: {}, Timestamp: {} }));
import PrivacyPage, { USAGE_RETENTION_DAYS } from '../PrivacyPage';
import { ACCOUNT_RETENTION_DAYS } from '../../../api/_lib/usage';

it('describes the usage counting: data, no content, purpose, retention and administrator access', () => {
  const html = renderToStaticMarkup(createElement(PrivacyPage));
  expect(html).toContain('Statistiques d');
  expect(html).toContain('jamais enregistré');
  expect(html).toContain('surveiller le bon fonctionnement du service');
  expect(html).toContain(`après ${ACCOUNT_RETENTION_DAYS} jours`);
  expect(html).toContain('administrateurs');
});

it('states the same retention as the counters', () => {
  expect(USAGE_RETENTION_DAYS).toBe(ACCOUNT_RETENTION_DAYS);
});
