import { expect, it } from 'vitest';
import { listedProjects } from '@skaitch/core/lib/projectArchive';

it('omits archived projects from list_projects unless asked', () => {
  const projects = [{ id: 'a' }, { id: 'b', archivedAt: '2026-11-25T00:00:00.000Z' }, { id: 'c', archivedAt: null }];
  expect(listedProjects(projects).map(p => p.id)).toEqual(['a', 'c']);
  expect(listedProjects(projects, { includeArchived: true }).map(p => p.id)).toEqual(['a', 'b', 'c']);
});
