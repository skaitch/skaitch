import { expect, it } from 'vitest';
import { authorizeMcpTool } from '@skaitch/core/lib/mcpPermissions';
it('enforces project grants for reads, project switches and mutations', () => {
  expect(() => authorizeMcpTool('list_projects', {}, null, {})).not.toThrow();
  expect(() => authorizeMcpTool('get_ifc_scene_overview', {}, 'p', {})).toThrow();
  expect(() => authorizeMcpTool('select_project', { project_id: 'other' }, 'p', { p: 'write' })).toThrow();
  expect(() => authorizeMcpTool('create_wall', {}, 'p', { p: 'read' })).toThrow('read-only');
  expect(() => authorizeMcpTool('update_element', {}, 'p', { p: 'read' })).toThrow('read-only');
  expect(() => authorizeMcpTool('update_element', {}, 'p', { p: 'write' })).not.toThrow();
  expect(() => authorizeMcpTool('get_ifc_scene_overview', {}, 'p', { p: 'read' })).not.toThrow();
  expect(() => authorizeMcpTool('list_opening_types', {}, 'p', { p: 'read' })).not.toThrow();
  expect(() => authorizeMcpTool('list_object_types', {}, 'p', { p: 'read' })).not.toThrow();
  expect(() => authorizeMcpTool('update_furniture', {}, 'p', { p: 'read' })).toThrow('read-only');
  expect(() => authorizeMcpTool('update_furniture', {}, 'p', { p: 'write' })).not.toThrow();
  expect(() => authorizeMcpTool('create_wall', {}, 'p', { p: 'write' })).not.toThrow();
});

it('applies account grants to new projects while preserving read-only access', () => {
  expect(() => authorizeMcpTool('select_project', { project_id: 'new' }, null, {}, 'read')).not.toThrow();
  expect(() => authorizeMcpTool('create_wall', {}, 'new', {}, 'read')).toThrow('read-only');
  expect(() => authorizeMcpTool('create_wall', {}, 'new', {}, 'write')).not.toThrow();
});

it('requires write access to create sections', () => {
  expect(() => authorizeMcpTool('create_section', {}, 'p', { p: 'read' })).toThrow('read-only');
  expect(() => authorizeMcpTool('create_section', {}, 'p', { p: 'write' })).not.toThrow();
});

it.each(['get_view', 'set_view', 'capture_view'])('allows %s for read grants but denies unauthorized projects', name => {
  expect(() => authorizeMcpTool(name, {}, 'p', { p: 'read' })).not.toThrow();
  expect(() => authorizeMcpTool(name, {}, 'p', {})).toThrow('Access denied');
});

it.each(['generate_visualization','create_storey','update_storey','delete_storey'])('requires write grants for %s in every MCP transport', name => {
  expect(() => authorizeMcpTool(name, {}, 'p', { p: 'read' })).toThrow('read-only');
  expect(() => authorizeMcpTool(name, {}, 'p', { p: 'write' })).not.toThrow();
});
