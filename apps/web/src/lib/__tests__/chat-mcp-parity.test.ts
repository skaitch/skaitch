import { expect, it, vi } from 'vitest';
import { TOOLS } from '@skaitch/core/mcp-tools';
import { executeTool, getToolSchema } from '../../components/modals/ChatPanel';

it.each(TOOLS.map(tool => [tool.name, tool] as const))('uses the same schema and executor for %s in chat and MCP', async (name, tool) => {
  expect(getToolSchema(name)).toBe(tool.inputSchema);
  const args = { request: 'unchanged' };
  const result = { success: true, updated_geom: { x: 2, y: 3 } };
  const shared = vi.fn().mockResolvedValue(result);
  const localMutation = vi.fn(() => { throw new Error('Local modelling path must not run.'); });
  expect(await executeTool(name, args, shared, {}, 's', localMutation, localMutation, localMutation)).toBe(result);
  expect(shared).toHaveBeenCalledExactlyOnceWith(name, args);
  expect(localMutation).not.toHaveBeenCalled();
});
