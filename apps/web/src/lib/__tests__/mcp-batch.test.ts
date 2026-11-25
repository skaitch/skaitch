import { expect, it, vi } from 'vitest';
import { computeMcpBatch } from '@skaitch/core/bim/mcpBatch';
import { buildEmpty } from '@skaitch/core/data/starter';
import { authorizeMcpTool } from '@skaitch/core/lib/mcpPermissions';
import { MCP_PUBLIC_TOOLS, mcpDiscovery, unwrapMcpTool } from '@skaitch/core/mcp-automation';

const operations = [
  { name: 'create_wall', alias: 'a', args: { start_point: [0, 0], end_point: [4, 0] } },
  { name: 'create_wall', alias: 'b', args: { start_point: [4, 0], end_point: [4, 4] } },
  { name: 'create_door', args: { wall_id: { $ref: 'a.id' }, position: 0.5 } },
];

it('stages dependent edits with unique IDs and leaves the original model untouched', () => {
  const original = buildEmpty();
  const storey = Object.values(original).find(item => item.type === 'Storey')!.id;
  const before = JSON.stringify(original);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100);
  try {
    const staged = computeMcpBatch({ operations }, original, storey, [], 'fr');
    const [wallA, wallB, door] = staged.result.operations;
    expect(staged.result.added).toBe(3);
    expect(wallA.id).not.toBe(wallB.id);
    expect(staged.items[door.id]).toMatchObject({ type: 'Door', geom: { wallId: wallA.id } });
    expect(() => computeMcpBatch({ operations: [...operations, {
      name: 'create_door', args: { wall_id: { $ref: 'missing.id' } },
    }] }, original, storey, [], 'fr')).toThrow(/earlier operation/);
    expect(JSON.stringify(original)).toBe(before);
  } finally { clock.mockRestore(); }
});

it('publishes compact tools and authorizes wrapped actions by their underlying capability', () => {
  expect(MCP_PUBLIC_TOOLS).toHaveLength(8);
  expect(MCP_PUBLIC_TOOLS.map(tool => tool.name)).not.toContain('create_wall');
  expect(mcpDiscovery('search_tools', { query: 'create_wall' })).toMatchObject({ tools: [{ name: 'create_wall' }] });
  const { name, args } = unwrapMcpTool('call_tool', { name: 'create_wall', arguments_json: '{}' });
  expect(() => authorizeMcpTool(name, args, 'project', { project: 'read' })).toThrow(/read-only/);
  expect(() => authorizeMcpTool('apply_model_batch', {}, 'project', { project: 'read' })).toThrow(/read-only/);
  expect(() => authorizeMcpTool('execute_script', {}, 'project', { project: 'read' })).not.toThrow();
});
